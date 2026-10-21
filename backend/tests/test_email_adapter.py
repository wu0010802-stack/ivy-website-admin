"""寄信管道的選擇規則：outbox 背景工作、重設密碼、系統狀態測試信三處共用（2026-10-21）。

正式環境只認 SMTP；沒設 SMTP 就算有 sink 資料夾也不寫檔——否則家長信只是躺在伺服器的資料夾裡，
系統卻當成已寄出。非正式環境另外接受本機 sink（開發與 stack e2e 讀信用）。"""
from __future__ import annotations

import pytest

from app.auth import password_reset
from app.config import Settings
from app.notifications.email_adapter import (
    EmailNotConfigured,
    LocalSinkEmailAdapter,
    SmtpEmailAdapter,
    deployment_email_adapter,
    email_channel_available,
)
from app.operations import system_status


def _settings(**overrides) -> Settings:
    base = Settings(
        environment="test",
        database_url="postgresql+asyncpg://localhost/ivy_website_dev",
        test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
        session_secret="test-only-secret-please-rotate",
    )
    # model_copy 不重跑正式環境檢查：這裡只關心寄信管道的選擇。
    return base.model_copy(update={"smtp_host": None, "notification_email_sink_dir": None, **overrides})


def test_production_without_smtp_ignores_the_sink_dir(tmp_path):
    settings = _settings(environment="production", notification_email_sink_dir=str(tmp_path))

    assert email_channel_available(settings) is False
    with pytest.raises(EmailNotConfigured):
        deployment_email_adapter(settings)
    assert list(tmp_path.iterdir()) == []


def test_production_with_smtp_uses_smtp(tmp_path):
    settings = _settings(environment="production", smtp_host="smtp.example", notification_email_sink_dir=str(tmp_path))

    assert email_channel_available(settings) is True
    assert isinstance(deployment_email_adapter(settings), SmtpEmailAdapter)


@pytest.mark.parametrize("environment", ["development", "test"])
def test_non_production_accepts_the_sink_dir(environment, tmp_path):
    settings = _settings(environment=environment, notification_email_sink_dir=str(tmp_path))

    assert email_channel_available(settings) is True
    assert isinstance(deployment_email_adapter(settings), LocalSinkEmailAdapter)


@pytest.mark.parametrize("environment", ["production", "development"])
def test_no_channel_at_all_is_not_configured(environment):
    settings = _settings(environment=environment)

    assert email_channel_available(settings) is False
    with pytest.raises(EmailNotConfigured):
        deployment_email_adapter(settings)


def test_password_reset_and_system_status_follow_the_same_rule(tmp_path):
    production = _settings(environment="production", notification_email_sink_dir=str(tmp_path), admin_origin="https://ivy.example")
    development = _settings(environment="development", notification_email_sink_dir=str(tmp_path), admin_origin="https://ivy.example")

    assert password_reset.email_enabled(production) is False
    assert password_reset.email_enabled(development) is True
    for module in (password_reset, system_status):
        with pytest.raises(EmailNotConfigured):
            module.mail_adapter(production)
        assert isinstance(module.mail_adapter(development), LocalSinkEmailAdapter)
