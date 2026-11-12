"""官網 origin 與後台 origin 分開（2026-11-12，後台獨立子網域的準備）。

WEBSITE_ADMIN_ORIGIN 改成後台子網域之後，家長看到的連結（信裡的改期、重新預約、後台複製的家長連結）
仍要指向官網，家長頁的寫入 Origin 也是官網；後台的寫入照舊只接受後台的 origin。
沒設 WEBSITE_PUBLIC_ORIGIN 時一切沿用 admin_origin（現況）。
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot

pytestmark = pytest.mark.usefixtures("booking_consent")

ADMIN = "https://admin.ivy.example"
PUBLIC = "https://www.ivy.example"
EXCHANGE = "/api/website/v1/public/visit-manage/exchange"


def _settings(**overrides) -> Settings:
    return Settings(database_url="postgresql://localhost/ivy_website_test", session_secret="test-session-secret-0123", **overrides)


def test_parent_origin_falls_back_to_admin_origin_and_normalizes():
    assert _settings(admin_origin=f"{ADMIN}/").parent_origin == ADMIN
    split = _settings(admin_origin=ADMIN, public_origin=f"{PUBLIC}/")
    assert split.public_origin == PUBLIC
    assert split.parent_origin == PUBLIC
    assert split.parent_origin_allowed(PUBLIC) and split.parent_origin_allowed(ADMIN) and split.parent_origin_allowed(None)
    assert not split.parent_origin_allowed("https://evil.example")
    # 後台寫入不接受官網的 Origin
    assert not split.origin_allowed(PUBLIC)


@pytest.mark.parametrize("value", ["http://www.ivy.example", "https://www.ivy.example/visit", "https://user:pw@www.ivy.example"])
def test_production_public_origin_must_be_bare_https(value):
    with pytest.raises(ValidationError, match="WEBSITE_PUBLIC_ORIGIN"):
        _settings(environment="production", admin_origin=ADMIN, public_origin=value)
    assert _settings(environment="production", admin_origin=ADMIN, public_origin=PUBLIC).public_origin == PUBLIC


@pytest.mark.asyncio
async def test_parent_links_and_parent_writes_use_public_origin(app, admin_client, public_client, db_session, recording_mail_adapter):
    booked = await book_slot(admin_client, public_client, "yihua", idempotency_key="public-origin-01")
    receipt_id = booked["receipt_id"]
    app.state.settings.admin_origin = ADMIN
    app.state.settings.public_origin = PUBLIC

    # 後台「產生家長連結」給的是官網網址
    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link", headers={"origin": ADMIN})
    assert link.status_code == 200, link.text
    assert link.json()["manage_url"].startswith(f"{PUBLIC}/visit/manage#token=")
    token = link.json()["manage_url_fragment"].split("token=")[1]

    # 家長頁在官網主機：Origin 是官網也能寫；其他網站不行
    assert (await public_client.post(EXCHANGE, json={"token": "invalid"}, headers={"Origin": "https://evil.example"})).status_code == 403
    exchange = await public_client.post(EXCHANGE, json={"token": token}, headers={"Origin": PUBLIC})
    assert exchange.status_code == 200, exchange.text

    # 後台的寫入不接受官網的 Origin
    denied = await admin_client.patch("/api/website/v1/auth/me", json={"display_name": "測試"}, headers={"origin": PUBLIC})
    assert denied.status_code == 403

    # 家長信裡的改期與重新預約連結指向官網，後台主機不出現
    await process_outbox_batch(
        db_session, recording_mail_adapter, limit=50, admin_origin=ADMIN, public_origin=PUBLIC,
        access_secret=app.state.settings.session_secret,
    )
    parent_mail = [m for m in recording_mail_adapter.sent if m["to"] == "parent@example.com"]
    assert parent_mail, recording_mail_adapter.sent
    body = parent_mail[0]["body"]
    assert f"{PUBLIC}/visit/manage#token=" in body
    assert ADMIN not in body
