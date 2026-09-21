from __future__ import annotations

from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "production"]

# 既有園務系統資料庫，官網一律不得連線。
_FORBIDDEN_DB_NAMES = {"ivymanagement"}


class Settings(BaseSettings):
    """官網後台設定。所有欄位一律來自環境變數，不寫死秘密或預設密碼。"""

    model_config = SettingsConfigDict(env_prefix="WEBSITE_", extra="ignore")

    environment: Environment = "development"
    database_url: str
    test_database_url: str | None = None
    media_root: str = "./var/media"
    session_secret: str
    enable_fixture: bool = False
    indexing_enabled: bool = False
    admin_origin: str | None = None
    notification_email_sink_dir: str | None = None

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
        return self

    def active_database_url(self) -> str:
        if self.environment == "test":
            assert self.test_database_url is not None
            return self.test_database_url
        return self.database_url


def get_settings() -> Settings:
    """由環境變數建立設定；import 這個模組不會連真實 DB。"""
    return Settings()  # type: ignore[call-arg]
