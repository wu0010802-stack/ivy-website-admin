from __future__ import annotations

import re
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "production"]

# 既有園務系統資料庫，官網一律不得連線。
_FORBIDDEN_DB_NAMES = {"ivymanagement"}

# 一看就是範例或佔位的 session secret 字眼（.env.example 的值就是公開的）。
# production 用這種值等於任何人都能簽出 OAuth 握手 cookie、算出限流 HMAC key。
_PLACEHOLDER_SECRET_MARKERS = ("change-me", "changeme", "change_me", "example", "placeholder")


class Settings(BaseSettings):
    """官網後台設定。所有欄位一律來自環境變數，不寫死秘密或預設密碼。"""

    model_config = SettingsConfigDict(env_prefix="WEBSITE_", extra="ignore", hide_input_in_errors=True)

    environment: Environment = "development"
    database_url: str
    test_database_url: str | None = None
    media_root: str = "./var/media"
    # 素材存哪裡：local＝media_root（Railway volume，api 只能單一實例）；
    # s3＝S3 相容物件儲存（Cloudflare R2、AWS S3…），見 deploy/README.md。
    media_storage: Literal["local", "s3"] = "local"
    s3_bucket: str | None = None
    s3_endpoint_url: str | None = None
    s3_region: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = Field(default=None, repr=False)
    s3_prefix: str = ""
    session_secret: str
    enable_fixture: bool = False
    indexing_enabled: bool = False
    admin_origin: str | None = None
    google_client_id: str | None = None
    google_client_secret: str | None = Field(default=None, repr=False)
    google_redirect_uri: str | None = None
    line_channel_id: str | None = None
    line_channel_secret: str | None = Field(default=None, repr=False)
    line_redirect_uri: str | None = None
    notification_email_sink_dir: str | None = None
    # 真實寄信（SMTP）。沒設定 smtp_host 就不會寄；開發環境繼續用 sink_dir。
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_security: Literal["starttls", "ssl", "none"] = "starttls"
    # LINE 官方帳號 Messaging API（園方群組推播）。與「用 LINE 登入」是不同
    # 類型的 channel，金鑰也不同，所以另外命名。兩個都有才啟用。
    line_messaging_channel_secret: str | None = Field(default=None, repr=False)
    line_messaging_access_token: str | None = Field(default=None, repr=False)
    retention_allow_real_run: bool = False
    # 招生入學模組（2026-10）。預設關閉：規格 §15 Q1（預約同意書是否涵蓋參觀後的
    # 招生聯繫、招生訪視保存幾天）裁定前，正式站不可開啟。關閉時「標記已到場」
    # 不建招生訪視，/admin/admissions/* 不掛路由（404）；保存政策的招生類別照常。
    admissions_enabled: bool = False
    # API 內建定期工作（排程發布、逾期占位、通知、清限流計數）的間隔秒數。
    # 沒設定時 production 每 60 秒一輪，其他環境關閉；設 0 明確關閉。
    background_jobs_interval_seconds: int | None = None
    # 公開端點限流要綁訪客而非代理。Nuxt server route 會把訪客 IP 放進
    # 這個 header；API 不直接對外時才可信任，見 deploy/README.md。
    trusted_client_ip_header: str | None = "x-website-client-ip"
    # 每個校區（共用素材另算一份）素材原檔的累計上限。單檔有上限（預設
    # 圖片 15 MB、影片 150 MB），但五校共用同一顆 volume，沒有累計上限時
    # 一個校區帳號反覆上傳就能把磁碟塞滿、讓其他校區也無法上傳。
    media_quota_bytes_per_campus: int = 5 * 1024 * 1024 * 1024
    # 單檔上限（規格 L140：初始圖片 15 MB、影片 150 MB，可由部署設定調整）。
    # API 的請求本文上限由這兩個值推導（較大者＋5 MB）。web 代理的本文上限
    # 另外讀 NUXT_MEDIA_MAX_UPLOAD_MB（預設 150，web/shared/request-guard.ts），
    # 不會自動同步：調高這裡時 web 那邊要設成兩者較大的值，否則大檔先被 web 以 413 擋下。
    media_max_image_mb: int = Field(default=15, ge=1, le=100)
    media_max_video_mb: int = Field(default=150, ge=1, le=2048)
    # 刪除的素材先標記待清理，過這麼多天才由定期工作真的刪檔，期間可以復原。
    media_purge_delay_days: int = Field(default=7, ge=1, le=90)
    # 影片上傳後的 poster 與轉檔（app/media/jobs.py）：background＝交給 API 程序內的
    # 背景處理，上傳馬上回應「處理中」；inline＝在上傳請求裡做完。沒設時正式站
    # background、其他環境 inline（測試與本機開發上傳完就能用）。
    media_video_processing: Literal["inline", "background"] | None = None
    media_jobs_poll_seconds: int = Field(default=5, ge=1, le=300)
    # migration 專用連線（schema owner）。沒設定時沿用 database_url；設定後
    # 執行期的 database_url 可以改成只有 DML 權限的角色，見 deploy/README.md。
    migration_database_url: str | None = Field(default=None, repr=False)
    # 請求用主連線池（app/db.py；限流另有固定的小池）。公開送單、後台與素材讀檔
    # 共用這個池，池太小或等待太久會讓匿名併發拖垮整個 API；預設與 PR #14 寫死的
    # 10＋10、等 10 秒相同。lock／idle-in-transaction 逾時（加上固定 30 秒的
    # statement_timeout）是最後一道防線。
    db_pool_size: int = Field(default=10, ge=1, le=50)
    db_max_overflow: int = Field(default=10, ge=0, le=50)
    db_pool_timeout_seconds: int = Field(default=10, ge=1, le=60)
    db_lock_timeout_ms: int = Field(default=10_000, ge=0, le=600_000)
    db_idle_in_transaction_timeout_ms: int = Field(default=300_000, ge=0, le=3_600_000)
    # 後台 session：閒置超過這麼久就失效（另有 12 小時絕對上限）。
    session_idle_minutes: int = Field(default=120, ge=5, le=720)
    # Cloudflare Turnstile（公開預約的機器人驗證）。兩個都設定才啟用；
    # 沒設定時公開送單不要求驗證，其他防線（限流、占位上限）照常。
    turnstile_site_key: str | None = None
    turnstile_secret_key: str | None = Field(default=None, repr=False)
    # 公開預約的濫用上限（全部以伺服器端計數，超過回 429）。
    booking_slot_holds_per_source_per_day: int = Field(default=5, ge=1, le=1000)
    booking_submissions_per_campus_per_hour: int = Field(default=30, ge=1, le=10_000)
    # 公開 telemetry／點擊事件的全站上限：資料照留、不清除，改用上限封住
    # 單日可以被灌進來的列數。超過時安靜丟棄（仍回 204）。
    telemetry_global_per_minute: int = Field(default=600, ge=1, le=100_000)
    telemetry_daily_cap: int = Field(default=20_000, ge=1, le=10_000_000)
    analytics_clicks_global_per_minute: int = Field(default=120, ge=1, le=100_000)
    analytics_clicks_daily_cap: int = Field(default=5_000, ge=1, le=10_000_000)

    @field_validator(
        "google_client_id", "google_client_secret", "google_redirect_uri",
        "line_channel_id", "line_channel_secret", "line_redirect_uri",
    )
    @classmethod
    def _normalize_oauth_settings(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("background_jobs_interval_seconds")
    @classmethod
    def _sane_background_interval(cls, value: int | None) -> int | None:
        if value is not None and value != 0 and not 10 <= value <= 3600:
            raise ValueError("WEBSITE_BACKGROUND_JOBS_INTERVAL_SECONDS 必須是 0（關閉）或 10–3600 秒")
        return value

    @field_validator(
        "line_messaging_channel_secret", "line_messaging_access_token",
        "turnstile_site_key", "turnstile_secret_key", "migration_database_url",
    )
    @classmethod
    def _normalize_line_messaging(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("s3_bucket", "s3_endpoint_url", "s3_region", "s3_access_key_id", "s3_secret_access_key")
    @classmethod
    def _normalize_s3(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("s3_prefix")
    @classmethod
    def _normalize_s3_prefix(cls, value: str) -> str:
        value = value.strip().strip("/")
        if not value:
            return ""
        if not re.fullmatch(r"[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*", value) or ".." in value:
            raise ValueError("WEBSITE_S3_PREFIX 只能是英數、.、_、- 組成的路徑")
        return f"{value}/"

    def media_max_bytes(self, kind: str) -> int:
        """kind 是 "image" 或 "video"。"""
        megabytes = self.media_max_video_mb if kind == "video" else self.media_max_image_mb
        return megabytes * 1024 * 1024

    @property
    def media_upload_body_limit(self) -> int:
        """素材上傳請求本文上限：最大單檔再加 multipart 欄位與邊界的餘裕。"""
        return max(self.media_max_bytes("image"), self.media_max_bytes("video")) + 5 * 1024 * 1024

    @property
    def s3_configured(self) -> bool:
        return bool(self.s3_bucket and self.s3_access_key_id and self.s3_secret_access_key)

    @property
    def line_messaging_enabled(self) -> bool:
        return bool(self.line_messaging_channel_secret and self.line_messaging_access_token)

    @property
    def background_jobs_interval(self) -> int:
        """0 代表不在 API 程序內跑定期工作。本機開發與測試預設關閉，避免
        背景自己動資料；正式站預設開啟，因為沒有另外的排程在呼叫 CLI。"""
        if self.background_jobs_interval_seconds is not None:
            return self.background_jobs_interval_seconds
        return 60 if self.environment == "production" else 0

    @property
    def media_video_processing_mode(self) -> Literal["inline", "background"]:
        if self.media_video_processing is not None:
            return self.media_video_processing
        return "background" if self.environment == "production" else "inline"

    @property
    def turnstile_enabled(self) -> bool:
        return bool(self.turnstile_site_key and self.turnstile_secret_key)

    def active_migration_database_url(self) -> str:
        """alembic 用的連線：test 環境一律用測試庫；其他環境優先用 migration 專用連線。"""
        if self.environment == "test":
            return self.active_database_url()
        return self.migration_database_url or self.database_url

    @property
    def google_oauth_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret and self.google_redirect_uri)

    @property
    def line_oauth_enabled(self) -> bool:
        return bool(self.line_channel_id and self.line_channel_secret and self.line_redirect_uri)

    @field_validator("database_url", "test_database_url", "migration_database_url")
    @classmethod
    def _reject_shared_business_database(cls, value: str | None) -> str | None:
        if value is None:
            return value
        lowered = value.lower()
        for forbidden in _FORBIDDEN_DB_NAMES:
            if forbidden in lowered:
                raise ValueError(
                    "官網必須使用獨立資料庫，偵測到連線字串指向既有園務系統資料庫"
                )
        return value

    @field_validator("session_secret")
    @classmethod
    def _reject_weak_secret(cls, value: str) -> str:
        if not value or len(value) < 16:
            raise ValueError("WEBSITE_SESSION_SECRET 未設定或長度不足，拒絕啟動")
        return value

    @model_validator(mode="after")
    def _validate_environment_rules(self) -> "Settings":
        self._check_oauth_provider(
            "Google", "google", "CLIENT_ID、CLIENT_SECRET",
            (self.google_client_id, self.google_client_secret), self.google_redirect_uri,
        )
        self._check_oauth_provider(
            "LINE", "line", "CHANNEL_ID、CHANNEL_SECRET",
            (self.line_channel_id, self.line_channel_secret), self.line_redirect_uri,
        )
        if self.environment == "test":
            if not self.test_database_url:
                raise ValueError("test 環境必須明確設定 WEBSITE_TEST_DATABASE_URL")
            if "test" not in self.test_database_url.lower():
                raise ValueError(
                    "WEBSITE_TEST_DATABASE_URL 必須是明確標示的測試資料庫，"
                    "不得指向開發或正式資料庫"
                )
        if self.environment == "production" and self.enable_fixture:
            raise ValueError("production 環境禁止啟用 fixture 模式")
        s3_fields = (self.s3_bucket, self.s3_access_key_id, self.s3_secret_access_key)
        if any(s3_fields) and not all(s3_fields):
            raise ValueError("S3 必須同時設定 WEBSITE_S3_BUCKET、WEBSITE_S3_ACCESS_KEY_ID 與 WEBSITE_S3_SECRET_ACCESS_KEY")
        if self.media_storage == "s3" and not self.s3_configured:
            raise ValueError("WEBSITE_MEDIA_STORAGE=s3 需要設定 S3 bucket 與金鑰")
        if self.s3_endpoint_url:
            endpoint = urlsplit(self.s3_endpoint_url)
            if not endpoint.hostname or endpoint.username or endpoint.password or endpoint.path not in ("", "/"):
                raise ValueError("WEBSITE_S3_ENDPOINT_URL 必須是不含帳密與路徑的網址")
            if self.environment == "production" and endpoint.scheme != "https":
                raise ValueError("production 環境的 WEBSITE_S3_ENDPOINT_URL 必須使用 HTTPS")
        if bool(self.turnstile_site_key) != bool(self.turnstile_secret_key):
            raise ValueError("Turnstile 必須同時設定 WEBSITE_TURNSTILE_SITE_KEY 與 WEBSITE_TURNSTILE_SECRET_KEY")
        if bool(self.line_messaging_channel_secret) != bool(self.line_messaging_access_token):
            raise ValueError(
                "LINE 推播必須同時設定 WEBSITE_LINE_MESSAGING_CHANNEL_SECRET 與 WEBSITE_LINE_MESSAGING_ACCESS_TOKEN"
            )
        if self.smtp_host and not self.smtp_from:
            raise ValueError("設定 WEBSITE_SMTP_HOST 時必須一併設定 WEBSITE_SMTP_FROM")
        if self.smtp_host and self.environment == "production" and self.smtp_security == "none":
            # 通知信含員工信箱與案件編號，正式環境不走明文 SMTP。
            raise ValueError("production 環境寄信必須使用 starttls 或 ssl")
        if self.environment == "production":
            self._check_production_safety()
        return self

    def _check_production_safety(self) -> None:
        """production 的安全前提不能靠「記得設定」：admin_origin 空白時後台
        Origin 檢查與 OAuth 同源檢查會整段跳過；session secret 用公開的範例值
        等於沒有秘密。放在所有其他檢查之後，既有的錯誤訊息維持優先。
        長度下限維持 16（正式站實際長度未知，提高下限可能讓部署起不來）。"""
        origin = urlsplit(self.admin_origin or "")
        if (
            origin.scheme != "https" or not origin.hostname
            or origin.username or origin.password
            or origin.path not in ("", "/") or origin.query or origin.fragment
        ):
            raise ValueError(
                "production 必須設定 WEBSITE_ADMIN_ORIGIN，且是不含路徑的 HTTPS 網址（例如 https://後台網域）"
            )
        lowered = self.session_secret.lower()
        if any(marker in lowered for marker in _PLACEHOLDER_SECRET_MARKERS):
            raise ValueError("production 的 WEBSITE_SESSION_SECRET 不能使用範例或佔位值，請改成隨機產生的秘密")

    def _check_oauth_provider(
        self, label: str, slug: str, credential_names: str,
        credentials: tuple[str | None, ...], redirect_uri: str | None,
    ) -> None:
        fields = (*credentials, redirect_uri)
        if any(fields) and not all(fields):
            raise ValueError(f"{label} OAuth 必須同時設定 {credential_names} 與 REDIRECT_URI")
        if not redirect_uri:
            return
        callback_path = f"/api/website/v1/auth/{slug}/callback"
        uri = urlsplit(redirect_uri)
        local_http = self.environment != "production" and uri.scheme == "http" and (
            uri.hostname in {"localhost", "127.0.0.1", "::1"}
            or self.environment == "test" and uri.hostname == "test"
        )
        if (
            not uri.hostname or uri.username or uri.password
            or (uri.scheme != "https" and not local_http)
            or uri.path != callback_path
            or uri.query or uri.fragment
        ):
            raise ValueError(f"{label} REDIRECT_URI 必須是公開同源 HTTPS 的 {callback_path}")
        if self.admin_origin and f"{uri.scheme}://{uri.netloc}" != self.admin_origin.rstrip("/"):
            raise ValueError(f"{label} REDIRECT_URI 必須與 WEBSITE_ADMIN_ORIGIN 同源")

    def active_database_url(self) -> str:
        if self.environment == "test":
            assert self.test_database_url is not None
            return self.test_database_url
        return self.database_url


def get_settings() -> Settings:
    """由環境變數建立設定；import 這個模組不會連真實 DB。"""
    return Settings()  # type: ignore[call-arg]
