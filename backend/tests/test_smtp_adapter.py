"""SMTP 寄信 adapter：用假的 smtplib 驗證連線方式與信件內容，不連外。"""
from __future__ import annotations

import pytest

from app.config import Settings
from app.notifications import email_adapter
from app.notifications.email_adapter import LocalSinkEmailAdapter, SmtpEmailAdapter, get_email_adapter


class _FakeSMTP:
    instances: list["_FakeSMTP"] = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port = host, port
        self.calls: list[str] = []
        self.sent = []
        _FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.calls.append("quit")

    def starttls(self, context=None):
        self.calls.append("starttls")

    def login(self, user, password):
        self.calls.append(f"login:{user}")

    def send_message(self, message):
        self.sent.append(message)


def _settings(**extra) -> Settings:
    base = dict(
        environment="test",
        database_url="postgresql+asyncpg://localhost/ivy_website_dev",
        test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
        session_secret="test-only-secret-please-rotate",
    )
    base.update(extra)
    return Settings(**base)


def test_starttls_login_and_message(monkeypatch):
    _FakeSMTP.instances.clear()
    monkeypatch.setattr(email_adapter.smtplib, "SMTP", _FakeSMTP)
    adapter = get_email_adapter(None, _settings(
        smtp_host="smtp.example.org", smtp_from="官網通知 <noreply@example.org>",
        smtp_username="bot", smtp_password="secret",
    ))
    assert isinstance(adapter, SmtpEmailAdapter)
    adapter.send(to="staff@example.org", subject="新的參觀需求", body="請到後台查看")
    smtp = _FakeSMTP.instances[0]
    assert (smtp.host, smtp.port) == ("smtp.example.org", 587)
    assert smtp.calls == ["starttls", "login:bot", "quit"]
    message = smtp.sent[0]
    assert message["To"] == "staff@example.org"
    assert message["Subject"] == "新的參觀需求"
    assert "請到後台查看" in message.get_content()


def test_ssl_mode_uses_smtp_ssl(monkeypatch):
    _FakeSMTP.instances.clear()
    monkeypatch.setattr(email_adapter.smtplib, "SMTP_SSL", _FakeSMTP)
    adapter = get_email_adapter(None, _settings(smtp_host="smtp.example.org", smtp_port=465, smtp_from="a@example.org", smtp_security="ssl"))
    adapter.send(to="x@example.org", subject="s", body="b")
    assert _FakeSMTP.instances[0].calls == ["quit"]


def test_falls_back_to_sink_then_not_configured(tmp_path):
    assert isinstance(get_email_adapter(str(tmp_path), _settings()), LocalSinkEmailAdapter)
    with pytest.raises(email_adapter.EmailNotConfigured):
        get_email_adapter(None, _settings())


def test_settings_validation():
    with pytest.raises(ValueError):
        _settings(smtp_host="smtp.example.org")
    with pytest.raises(ValueError):
        Settings(
            environment="production",
            database_url="postgresql+asyncpg://localhost/ivy_website_prod",
            session_secret="a-production-secret-that-is-long-enough-1234",
            smtp_host="smtp.example.org", smtp_from="a@example.org", smtp_security="none",
        )
