from __future__ import annotations

from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "production"]

# 既有園務系統資料庫，官網一律不得連線。
_FORBIDDEN_DB_NAMES = {"ivymanagement"}


class Settings(BaseSettings):
    """官網後台設定。所有欄位一律來自環境變數，不寫死秘密或預設密碼。"""

    model_config = SettingsConfigDict(env_prefix="WEBSITE_", extra="ignore", hide_input_in_errors=True)

    environment: Environment = "development"
    database_url: str
    test_database_url: str | None = None
    media_root: str = "./var/media"
    session_secret: str
    enable_fixture: bool = False
    indexing_enabled: bool = False
    admin_origin: str | None = None
    google_client_id: str | None = None
    google_client_secret: str | None = Field(default=None, repr=False)
    google_redirect_uri: str | None = None
    notification_email_sink_dir: str | None = None
    # 真實寄信（SMTP）。沒設定 smtp_host 就不會寄；開發環境繼續用 sink_dir。
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_security: Literal["starttls", "ssl", "none"] = "starttls"
    retention_allow_real_run: bool = False
    # 公開端點限流要綁訪客而非代理。Nuxt server route 會把訪客 IP 放進
    # 這個 header；API 不直接對外時才可信任，見 deploy/README.md。
    trusted_client_ip_header: str | None = "x-website-client-ip"
    # 每個校區（共用素材另算一份）素材原檔的累計上限。單檔有 15/200 MB
    # 限制，但五校共用同一顆 volume，沒有累計上限時一個校區帳號反覆上傳
    # 就能把磁碟塞滿、讓其他校區也無法上傳。
    media_quota_bytes_per_campus: int = 5 * 1024 * 1024 * 1024

    @field_validator("google_client_id", "google_client_secret", "google_redirect_uri")
    @classmethod
    def _normalize_google_settings(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @property
    def google_oauth_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret and self.google_redirect_uri)

    @field_validator("database_url", "test_database_url")
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
        google_fields = (self.google_client_id, self.google_client_secret, self.google_redirect_uri)
        if any(google_fields) and not all(google_fields):
            raise ValueError("Google OAuth 必須同時設定 CLIENT_ID、CLIENT_SECRET 與 REDIRECT_URI")
        if self.google_redirect_uri:
            uri = urlsplit(self.google_redirect_uri)
            local_http = self.environment != "production" and uri.scheme == "http" and (
                uri.hostname in {"localhost", "127.0.0.1", "::1"}
                or self.environment == "test" and uri.hostname == "test"
            )
            if (
                not uri.hostname or uri.username or uri.password
                or (uri.scheme != "https" and not local_http)
                or uri.path != "/api/website/v1/auth/google/callback"
                or uri.query or uri.fragment
            ):
                raise ValueError("Google REDIRECT_URI 必須是公開同源 HTTPS 的 /api/website/v1/auth/google/callback")
            if self.admin_origin and f"{uri.scheme}://{uri.netloc}" != self.admin_origin.rstrip("/"):
                raise ValueError("Google REDIRECT_URI 必須與 WEBSITE_ADMIN_ORIGIN 同源")
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
        if self.smtp_host and not self.smtp_from:
            raise ValueError("設定 WEBSITE_SMTP_HOST 時必須一併設定 WEBSITE_SMTP_FROM")
        if self.smtp_host and self.environment == "production" and self.smtp_security == "none":
            # 通知信含員工信箱與案件編號，正式環境不走明文 SMTP。
            raise ValueError("production 環境寄信必須使用 starttls 或 ssl")
        return self

    def active_database_url(self) -> str:
        if self.environment == "test":
            assert self.test_database_url is not None
            return self.test_database_url
        return self.database_url


def get_settings() -> Settings:
    """由環境變數建立設定；import 這個模組不會連真實 DB。"""
    return Settings()  # type: ignore[call-arg]
