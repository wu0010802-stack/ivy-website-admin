"""總管理者寄重設密碼連結（2026-10-03）：寄出、確認連結、設定新密碼。"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, update

from app.auth import password_reset
from app.auth.models import PasswordResetToken, Role, User
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client, freeze_rate_limit_clock

API = "/api/website/v1"
STAFF = "staff@ivy.example"
STAFF_PW = "staff-password-123"
NEW_PW = "brand-new-password-456"
LOGIN = f"{API}/auth/login"
VERIFY = f"{API}/auth/password-reset/verify"
COMPLETE = f"{API}/auth/password-reset/complete"


@pytest.fixture
def mailer(app, monkeypatch, recording_mail_adapter):
    """有後台網址、有寄信管道；寄出的信記在 recording_mail_adapter.sent。"""
    app.state.settings = app.state.settings.model_copy(update={"admin_origin": "http://test"})
    monkeypatch.setattr(password_reset, "mail_adapter", lambda settings: recording_mail_adapter)
    return recording_mail_adapter


def _anon(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _token_from(mail: dict) -> str:
    match = re.search(r"/admin/reset-password#token=([A-Za-z0-9_\-]+)", mail["body"])
    assert match, mail["body"]
    return match.group(1)


async def _send(admin_client, user_id, mailer) -> str:
    response = await admin_client.post(f"{API}/admin/users/{user_id}/password-reset-link")
    assert response.status_code == 200, response.text
    return _token_from(mailer.sent[-1])


async def _audits(db_session, action: str) -> list[AuditLogEntry]:
    db_session.expire_all()
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars())


async def _live_tokens(db_session, user_id) -> list[PasswordResetToken]:
    db_session.expire_all()
    result = await db_session.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user_id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.revoked_at.is_(None),
        )
    )
    return list(result.scalars())


# ------------------------------------------------------------ 寄出


async def test_super_admin_sends_link_to_colleague(admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    target_id = target.id  # _audits 會 expire_all，之後不能再讀 target 的屬性
    response = await admin_client.post(f"{API}/admin/users/{target_id}/password-reset-link")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sent_to"] == STAFF
    assert body["replaced_previous"] is False
    expires = datetime.fromisoformat(body["expires_at"])
    assert timedelta(minutes=29) < expires - datetime.now(timezone.utc) <= timedelta(minutes=30)

    assert len(mailer.sent) == 1
    mail = mailer.sent[0]
    assert mail["to"] == STAFF
    assert mail["subject"] == "【常春藤官網後台】重設密碼連結"
    token = _token_from(mail)
    assert "http://test/admin/reset-password#token=" in mail["body"]

    sent = await _audits(db_session, "user.password_reset_link_sent")
    assert len(sent) == 1
    assert sent[0].target_id == str(target_id)
    assert set(sent[0].metadata_json) == {"expires_at", "replaced_previous"}
    assert token not in json.dumps(sent[0].metadata_json)


async def test_sending_again_replaces_previous_link(admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    await _send(admin_client, target.id, mailer)
    again = await admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link")
    assert again.json()["replaced_previous"] is True
    assert len(await _live_tokens(db_session, target.id)) == 1


async def test_only_super_admin_can_send_and_not_to_self(admin_client, minghua_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.CAMPUS_ADMIN, ["minghua"])
    denied = await minghua_client.post(f"{API}/admin/users/{target.id}/password-reset-link")
    assert denied.status_code == 403
    me = (await admin_client.get(f"{API}/auth/me")).json()["user"]
    self_send = await admin_client.post(f"{API}/admin/users/{me['id']}/password-reset-link")
    assert self_send.status_code == 409
    assert self_send.json()["detail"]["code"] == "USE_CHANGE_PASSWORD"
    assert mailer.sent == []


async def test_unknown_or_inactive_account(admin_client, db_session, mailer):
    missing = await admin_client.post(f"{API}/admin/users/00000000-0000-0000-0000-000000000000/password-reset-link")
    assert missing.status_code == 404
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    off = await admin_client.patch(f"{API}/admin/users/{target.id}/active", json={"is_active": False})
    assert off.status_code == 200, off.text
    inactive = await admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link")
    assert inactive.status_code == 409
    assert inactive.json()["detail"]["code"] == "USER_INACTIVE"
    assert mailer.sent == []


async def test_disabled_without_mail_channel_and_reported_in_features(app, admin_client, db_session, mailer):
    on = (await admin_client.get(f"{API}/auth/me")).json()["features"]
    assert on["password_reset_email"] is True
    app.state.settings = app.state.settings.model_copy(update={"notification_email_sink_dir": None, "smtp_host": None})
    off = (await admin_client.get(f"{API}/auth/me")).json()["features"]
    assert off["password_reset_email"] is False
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    response = await admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "RESET_EMAIL_DISABLED"
    assert await _live_tokens(db_session, target.id) == []


async def test_send_failure_revokes_link_and_is_audited(admin_client, db_session, mailer, monkeypatch, failing_mail_adapter):
    monkeypatch.setattr(password_reset, "mail_adapter", lambda settings: failing_mail_adapter)
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    response = await admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link")
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["code"] == "RESET_EMAIL_FAILED"
    assert detail["error_code"] == "RuntimeError"
    assert await _live_tokens(db_session, target.id) == []
    failed = await _audits(db_session, "user.password_reset_link_failed")
    assert [entry.metadata_json for entry in failed] == [{"error_code": "RuntimeError"}]
    assert await _audits(db_session, "user.password_reset_link_sent") == []


async def test_at_most_three_links_per_account_per_15_minutes(app, admin_client, db_session, mailer):
    freeze_rate_limit_clock(app)
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    statuses = [
        (await admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link")).status_code for _ in range(4)
    ]
    assert statuses == [200, 200, 200, 429]
    assert len(mailer.sent) == 3


async def test_two_super_admins_sending_at_once_leave_one_live_link(app, admin_client, db_session, mailer, monkeypatch):
    # 強制兩個請求重疊：第一個請求作廢舊連結後停 0.2 秒才往下提交。
    # 有帳號列鎖時第二個請求會卡在 FOR UPDATE；沒鎖就會在第一個提交前跑完作廢，兩邊都以為沒有舊連結。
    original = password_reset.revoke_outstanding
    calls = {"n": 0}

    async def slow_first(*args, **kwargs):
        result = await original(*args, **kwargs)
        calls["n"] += 1
        if calls["n"] == 1:
            await asyncio.sleep(0.2)
        return result

    monkeypatch.setattr(password_reset, "revoke_outstanding", slow_first)
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    await _create_user(db_session, "boss2@ivy.example", "second-boss-password-1", Role.SUPER_ADMIN)
    second = await _logged_in_client(app, "boss2@ivy.example", "second-boss-password-1")
    try:
        results = await asyncio.gather(
            admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link"),
            second.post(f"{API}/admin/users/{target.id}/password-reset-link"),
        )
    finally:
        await second.aclose()
    assert [r.status_code for r in results] == [200, 200]
    assert sorted(r.json()["replaced_previous"] for r in results) == [False, True]
    assert len(await _live_tokens(db_session, target.id)) == 1


# ------------------------------------------------------------ 確認連結、設定新密碼


async def test_verify_returns_account_and_deadline(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    async with _anon(app) as anon:
        ok = await anon.post(VERIFY, json={"token": token})
    assert ok.status_code == 200, ok.text
    assert ok.json()["email"] == STAFF
    assert "no-store" in ok.headers["cache-control"]
    assert ok.headers["referrer-policy"] == "no-referrer"


async def test_unknown_token_is_410_without_audit(app, db_session):
    async with _anon(app) as anon:
        verify = await anon.post(VERIFY, json={"token": "x" * 43})
        complete = await anon.post(COMPLETE, json={"token": "x" * 43, "new_password": NEW_PW})
    for response in (verify, complete):
        assert response.status_code == 410
        assert response.json()["detail"]["code"] == "RESET_LINK_INVALID"
        assert response.json()["detail"]["reason"] == "link_unknown"
    assert await _audits(db_session, "user.password_reset_link_rejected") == []


async def test_complete_sets_password_logs_out_everywhere_and_is_single_use(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    target_id = target.id
    victim = await _logged_in_client(app, STAFF, STAFF_PW)
    token = await _send(admin_client, target_id, mailer)
    try:
        async with _anon(app) as anon:
            done = await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW})
            assert done.status_code == 204, done.text
            again = await anon.post(COMPLETE, json={"token": token, "new_password": "another-password-789"})
            assert again.status_code == 410
            assert again.json()["detail"]["reason"] == "link_used"
            assert (await victim.get(f"{API}/auth/me")).status_code == 401
            assert (await anon.post(LOGIN, json={"email": STAFF, "password": STAFF_PW})).status_code == 401
            assert (await anon.post(LOGIN, json={"email": STAFF, "password": NEW_PW})).status_code == 200
    finally:
        await victim.aclose()

    completed = await _audits(db_session, "user.password_reset_completed")
    assert len(completed) == 1
    assert completed[0].actor_user_id == target_id
    assert completed[0].metadata_json == {"revoked_sessions": 1}
    rejected = await _audits(db_session, "user.password_reset_link_rejected")
    assert [entry.metadata_json for entry in rejected] == [{"reason": "link_used"}]


async def test_expired_link_is_rejected_and_audited(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    await db_session.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == target.id)
        .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    )
    await db_session.commit()
    async with _anon(app) as anon:
        verify = await anon.post(VERIFY, json={"token": token})
        complete = await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW})
        still_old = await anon.post(LOGIN, json={"email": STAFF, "password": STAFF_PW})
    assert verify.json()["detail"]["reason"] == "link_expired"
    assert complete.status_code == 410
    assert complete.json()["detail"]["reason"] == "link_expired"
    assert still_old.status_code == 200
    rejected = await _audits(db_session, "user.password_reset_link_rejected")
    # 只有送出新密碼才寫稽核；打開連結（verify）不寫。
    assert [entry.metadata_json for entry in rejected] == [{"reason": "link_expired"}]


async def test_rejected_new_password_does_not_use_up_the_link(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    async with _anon(app) as anon:
        short = await anon.post(COMPLETE, json={"token": token, "new_password": "short"})
        too_long = await anon.post(COMPLETE, json={"token": token, "new_password": "常" * 25})
        verify = await anon.post(VERIFY, json={"token": token})
    assert short.status_code == 422
    assert too_long.status_code == 422
    assert verify.status_code == 200
    assert len(await _live_tokens(db_session, target.id)) == 1


async def test_inactive_account_cannot_use_link(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    # 直接改 DB（不走停用端點）：只驗「帳號停用」這一條判斷；停用端點會順便作廢連結，見 Task 5。
    await db_session.execute(update(User).where(User.id == target.id).values(is_active=False))
    await db_session.commit()
    async with _anon(app) as anon:
        verify = await anon.post(VERIFY, json={"token": token})
        complete = await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW})
    assert verify.json()["detail"]["reason"] == "inactive"
    assert complete.json()["detail"]["reason"] == "inactive"


async def test_complete_lifts_the_password_login_lock(app, admin_client, db_session, mailer):
    freeze_rate_limit_clock(app)
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    async with _anon(app) as anon:
        for _ in range(10):
            await anon.post(LOGIN, json={"email": STAFF, "password": "wrong-password-xx"})
        locked = await anon.post(LOGIN, json={"email": STAFF, "password": STAFF_PW})
        assert locked.json()["detail"]["code"] == "LOGIN_LOCKED"
        assert (await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW})).status_code == 204
        assert (await anon.post(LOGIN, json={"email": STAFF, "password": NEW_PW})).status_code == 200


async def test_cross_site_origin_is_refused(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    async with _anon(app) as anon:
        response = await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW}, headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert len(await _live_tokens(db_session, target.id)) == 1


async def test_open_and_submit_share_a_per_source_limit(app):
    freeze_rate_limit_clock(app)
    async with _anon(app) as anon:
        statuses = [(await anon.post(VERIFY, json={"token": "x" * 43})).status_code for _ in range(31)]
    assert statuses[:30] == [410] * 30
    assert statuses[30] == 429
