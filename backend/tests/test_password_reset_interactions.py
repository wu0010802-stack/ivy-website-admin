"""重設密碼連結跟既有帳號操作的互動（2026-10-03）：停用、本人改密碼、總管理者直接
設新密碼，都會讓還沒用的連結作廢；直接設新密碼也解除密碼登入暫停。"""
from __future__ import annotations

import re

import httpx
import pytest

from app.auth import password_reset
from app.auth.models import Role
from tests.conftest import _create_user, _logged_in_client, freeze_rate_limit_clock

API = "/api/website/v1"
STAFF = "staff@ivy.example"
STAFF_PW = "staff-password-123"
NEW_PW = "brand-new-password-456"
LOGIN = f"{API}/auth/login"
COMPLETE = f"{API}/auth/password-reset/complete"


@pytest.fixture
def mailer(app, monkeypatch, recording_mail_adapter):
    app.state.settings = app.state.settings.model_copy(update={"admin_origin": "http://test"})
    monkeypatch.setattr(password_reset, "mail_adapter", lambda settings: recording_mail_adapter)
    return recording_mail_adapter


async def _send(admin_client, user_id, mailer) -> str:
    response = await admin_client.post(f"{API}/admin/users/{user_id}/password-reset-link")
    assert response.status_code == 200, response.text
    match = re.search(r"#token=([A-Za-z0-9_\-]+)", mailer.sent[-1]["body"])
    assert match
    return match.group(1)


async def _complete(app, token: str) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        return await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW})


async def test_deactivating_account_revokes_links(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    assert (await admin_client.patch(f"{API}/admin/users/{target.id}/active", json={"is_active": False})).status_code == 200
    assert (await admin_client.patch(f"{API}/admin/users/{target.id}/active", json={"is_active": True})).status_code == 200
    # 恢復帳號後，停用前寄的連結也不會復活。
    response = await _complete(app, token)
    assert response.status_code == 410
    assert response.json()["detail"]["reason"] == "link_revoked"


async def test_changing_own_password_revokes_links(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    me = await _logged_in_client(app, STAFF, STAFF_PW)
    try:
        changed = await me.post(f"{API}/auth/change-password", json={"current_password": STAFF_PW, "new_password": "my-own-new-password-1"})
        assert changed.status_code == 204, changed.text
    finally:
        await me.aclose()
    response = await _complete(app, token)
    assert response.json()["detail"]["reason"] == "link_revoked"


async def test_direct_reset_revokes_links_and_lifts_the_lock(app, admin_client, db_session, mailer):
    freeze_rate_limit_clock(app)
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        for _ in range(10):
            await anon.post(LOGIN, json={"email": STAFF, "password": "wrong-password-xx"})
        assert (await anon.post(LOGIN, json={"email": STAFF, "password": STAFF_PW})).status_code == 429
        reset = await admin_client.post(f"{API}/admin/users/{target.id}/password", json={"password": "admin-set-password-1"})
        assert reset.status_code == 204, reset.text
        assert (await anon.post(LOGIN, json={"email": STAFF, "password": "admin-set-password-1"})).status_code == 200
    response = await _complete(app, token)
    assert response.json()["detail"]["reason"] == "link_revoked"
