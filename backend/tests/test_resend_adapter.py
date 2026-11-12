"""Resend 寄信 adapter（2026-11-11）：走 HTTPS API，不走 SMTP。用 httpx.MockTransport 驗證送出的內容與
錯誤分類，不連外。"""
from __future__ import annotations

import json

import httpx
import pytest

from app.config import Settings
from app.notifications import email_adapter
from app.notifications.email_adapter import (
    EmailNotConfigured,
    ResendAuthError,
    ResendEmailAdapter,
    ResendError,
    ResendQuotaError,
    ResendRejectedError,
    ResendServerError,
    SmtpEmailAdapter,
    deployment_email_adapter,
    email_channel_available,
    get_email_adapter,
)
from app.operations import system_status

API_KEY = "re_test_key_never_real_0123456789"
SENDER = "常春藤幼兒園 <noreply@mail.ivy.example>"


def _settings(**extra) -> Settings:
    base = dict(
        environment="test",
        database_url="postgresql+asyncpg://localhost/ivy_website_dev",
        test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
        session_secret="test-only-secret-please-rotate",
    )
    base.update(extra)
    return Settings(**base)


def _adapter(handler) -> ResendEmailAdapter:
    return ResendEmailAdapter(api_key=API_KEY, sender=SENDER, transport=httpx.MockTransport(handler))


def test_send_posts_plain_text_to_the_emails_endpoint():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"})

    _adapter(handler).send(to="parent@example.org", subject="預約成功", body="您已預約參觀\n時間：週六 10:00")

    [request] = seen
    assert request.method == "POST"
    assert str(request.url) == "https://api.resend.com/emails"
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    assert json.loads(request.content) == {
        "from": SENDER,
        "to": ["parent@example.org"],
        "subject": "預約成功",
        "text": "您已預約參觀\n時間：週六 10:00",
    }


@pytest.mark.parametrize(
    ("status", "name", "expected"),
    [
        (401, "missing_api_key", ResendAuthError),
        (401, "validation_error", ResendAuthError),
        (403, "restricted_api_key", ResendAuthError),
        (403, "suspended_api_key", ResendAuthError),
        (403, "invalid_permission", ResendAuthError),
        # 403 validation_error：寄件網域還沒驗證，或測試模式只能寄給自己。
        (403, "validation_error", ResendRejectedError),
        (400, "validation_error", ResendRejectedError),
        (422, "missing_required_field", ResendRejectedError),
        (429, "daily_quota_exceeded", ResendQuotaError),
        (429, "monthly_quota_exceeded", ResendQuotaError),
        (429, "rate_limit_exceeded", ResendQuotaError),
        (500, "application_error", ResendServerError),
        (503, "service_unavailable", ResendServerError),
        (404, "not_found", ResendError),
    ],
)
def test_error_responses_become_typed_errors_without_the_raw_message(status, name, expected):
    message = "The mail.ivy.example domain is not verified. parent@example.org"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"statusCode": status, "name": name, "message": message})

    with pytest.raises(ResendError) as caught:
        _adapter(handler).send(to="parent@example.org", subject="s", body="b")

    assert type(caught.value) is expected
    # 回應訊息可能帶收件地址與網域；例外只留狀態碼與錯誤種類。金鑰也不能出現。
    assert str(caught.value) == f"RESEND_HTTP_{status}:{name}"
    assert API_KEY not in repr(caught.value)


def test_error_response_that_is_not_json_still_raises_a_typed_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="<html>bad gateway</html>")

    with pytest.raises(ResendServerError) as caught:
        _adapter(handler).send(to="parent@example.org", subject="s", body="b")
    assert str(caught.value) == "RESEND_HTTP_502:unknown"


def test_unexpected_error_name_is_not_echoed():
    """錯誤種類是對方回的字串：只認得英數底線的短代碼，其他一律記成 unknown（不把任意內容帶進紀錄）。"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"name": "parent@example.org is blocked", "message": "x"})

    with pytest.raises(ResendError) as caught:
        _adapter(handler).send(to="parent@example.org", subject="s", body="b")
    assert str(caught.value) == "RESEND_HTTP_403:unknown"


def test_network_errors_propagate_as_httpx_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    with pytest.raises(httpx.ConnectTimeout):
        _adapter(handler).send(to="parent@example.org", subject="s", body="b")


# --- 設定與管道選擇 -----------------------------------------------------------


def test_settings_pick_resend_when_the_api_key_is_set():
    settings = _settings(resend_api_key=API_KEY, resend_from=SENDER)

    adapter = get_email_adapter(None, settings)

    assert isinstance(adapter, ResendEmailAdapter)
    assert adapter.sender == SENDER
    assert settings.real_email_enabled is True
    assert API_KEY not in repr(settings)


def test_real_email_enabled_covers_smtp_and_neither():
    assert _settings(smtp_host="smtp.example.org", smtp_from="a@example.org").real_email_enabled is True
    assert _settings().real_email_enabled is False
    assert _settings(notification_email_sink_dir="/tmp/ivy-website-test-mail").real_email_enabled is False


def test_settings_validation():
    with pytest.raises(ValueError, match="WEBSITE_RESEND_FROM"):
        _settings(resend_api_key=API_KEY)
    with pytest.raises(ValueError, match="WEBSITE_RESEND_API_KEY"):
        _settings(resend_from=SENDER)
    # 兩種都設就不知道該走哪一條：啟動時直接擋，不默默挑一個。
    with pytest.raises(ValueError, match="擇一"):
        _settings(resend_api_key=API_KEY, resend_from=SENDER, smtp_host="smtp.example.org", smtp_from="a@example.org")


def test_production_with_resend_counts_as_a_real_channel(tmp_path):
    base = _settings(resend_api_key=API_KEY, resend_from=SENDER, notification_email_sink_dir=str(tmp_path))
    production = base.model_copy(update={"environment": "production"})

    assert email_channel_available(production) is True
    assert isinstance(deployment_email_adapter(production), ResendEmailAdapter)
    assert list(tmp_path.iterdir()) == []


def test_smtp_still_wins_its_own_settings():
    settings = _settings(smtp_host="smtp.example.org", smtp_from="a@example.org")
    assert isinstance(get_email_adapter(None, settings), SmtpEmailAdapter)
    with pytest.raises(EmailNotConfigured):
        get_email_adapter(None, _settings())


# --- 系統狀態 -----------------------------------------------------------------


def test_system_status_row_shows_provider_and_sender_but_never_the_key():
    settings = _settings(resend_api_key=API_KEY, resend_from=SENDER)

    [row] = [item for item in system_status.service_items(settings, policy_auto_run=False) if item.key == "smtp"]

    assert row.level == "ok"
    assert row.detail == {"provider": "resend", "sender": SENDER}


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (ResendAuthError(401, "missing_api_key"), "auth_failed"),
        (ResendRejectedError(403, "validation_error"), "rejected"),
        (ResendQuotaError(429, "daily_quota_exceeded"), "quota"),
        (ResendServerError(500, "application_error"), "other"),
        (ResendError(404, "not_found"), "other"),
        (httpx.ConnectTimeout("t"), "timeout"),
        (httpx.ReadTimeout("t"), "timeout"),
        (httpx.ConnectError("c"), "connect_failed"),
        (httpx.RemoteProtocolError("p"), "connect_failed"),
    ],
)
def test_test_email_error_kinds_for_resend_and_httpx(error, kind):
    assert system_status.classify_email_error(error) == kind


def test_module_exports_the_default_endpoint():
    assert email_adapter.RESEND_API_BASE == "https://api.resend.com"


# --- 路由：有沒有寄信看的是「真實寄信」，不是只看 SMTP ----------------------------


async def test_booking_config_turns_parent_mail_on_with_resend(app, admin_client, public_client):
    api = "/api/website/v1"
    off = (await public_client.get(f"{api}/public/booking-config/yihua")).json()
    app.state.settings.resend_api_key = API_KEY
    app.state.settings.resend_from = SENDER
    on = (await public_client.get(f"{api}/public/booking-config/yihua")).json()
    admin = (await admin_client.get(f"{api}/admin/booking-config/yihua")).json()

    assert off["parent_email_enabled"] is False
    assert on["parent_email_enabled"] is True
    assert admin["parent_email_enabled"] is True
