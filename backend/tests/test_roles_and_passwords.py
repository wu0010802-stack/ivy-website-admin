"""角色開放、改角色、重設密碼、本人改密碼。"""
from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import select, update

from app.auth.models import Role, User
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["reception", "readonly", "campus_admin"])
async def test_create_each_scoped_role(admin_client, role):
    resp = await admin_client.post(
        f"{API}/admin/users",
        json={"email": f"{role}@ivy.example", "password": "a-long-enough-password", "role": role, "campus_keys": ["minghua"]},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["role"] == role


@pytest.mark.asyncio
async def test_change_role_and_scope(admin_client, db_session):
    user = await _create_user(db_session, "staff@ivy.example", "staff-password-123", Role.CAMPUS_ADMIN, ["yihua"])
    resp = await admin_client.patch(
        f"{API}/admin/users/{user.id}/role", json={"role": "reception", "campus_keys": ["yihua", "renwu"]}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "reception"
    assert sorted(resp.json()["campus_keys"]) == ["renwu", "yihua"]

    promoted = await admin_client.patch(f"{API}/admin/users/{user.id}/role", json={"role": "super_admin"})
    assert promoted.json()["campus_keys"] == []

    no_scope = await admin_client.patch(f"{API}/admin/users/{user.id}/role", json={"role": "editor", "campus_keys": []})
    assert no_scope.status_code == 400


@pytest.mark.asyncio
async def test_cannot_demote_last_super_admin(admin_client):
    me = (await admin_client.get(f"{API}/auth/me")).json()["user"]
    resp = await admin_client.patch(
        f"{API}/admin/users/{me['id']}/role", json={"role": "campus_admin", "campus_keys": ["yihua"]}
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_reset_password_logs_out_everywhere(app, admin_client, db_session):
    user = await _create_user(db_session, "forgot@ivy.example", "old-password-12345", Role.CAMPUS_ADMIN, ["yihua"])
    victim = await _logged_in_client(app, "forgot@ivy.example", "old-password-12345")
    try:
        assert (await victim.get(f"{API}/auth/me")).status_code == 200
        reset = await admin_client.post(f"{API}/admin/users/{user.id}/password", json={"password": "new-password-67890"})
        assert reset.status_code == 204, reset.text
        assert (await victim.get(f"{API}/auth/me")).status_code == 401
    finally:
        await victim.aclose()

    fresh = await _logged_in_client(app, "forgot@ivy.example", "new-password-67890")
    await fresh.aclose()
    short = await admin_client.post(f"{API}/admin/users/{user.id}/password", json={"password": "short"})
    assert short.status_code == 422


@pytest.mark.asyncio
async def test_direct_reset_also_unlinks_line_and_google(app, admin_client, db_session):
    """2026-11-12：總管理者直接設新密碼要跟重設連結一樣解除 LINE／Google 綁定。只換密碼的話，
    攻擊者先前綁上的 LINE／Google 換完密碼照樣能登入。稽核跟重設連結記同一組旗標（不記 sub）。"""
    user = await _create_user(db_session, "stolen@ivy.example", "old-password-12345", Role.CAMPUS_ADMIN, ["yihua"])
    plain = await _create_user(db_session, "plain@ivy.example", "plain-password-123", Role.EDITOR, ["yihua"])
    user_id, plain_id = user.id, plain.id
    await db_session.execute(
        update(User).where(User.id == user_id).values(line_sub="U" + "c" * 32, google_sub="google-attacker")
    )
    await db_session.commit()
    victim = await _logged_in_client(app, "stolen@ivy.example", "old-password-12345")
    try:
        reset = await admin_client.post(f"{API}/admin/users/{user_id}/password", json={"password": "new-password-67890"})
        assert reset.status_code == 204, reset.text
        assert (await victim.get(f"{API}/auth/me")).status_code == 401
    finally:
        await victim.aclose()
    assert (await admin_client.post(f"{API}/admin/users/{plain_id}/password", json={"password": "new-password-67890"})).status_code == 204

    db_session.expire_all()
    stored = await db_session.get(User, user_id)
    assert stored.line_sub is None and stored.google_sub is None and stored.is_active
    listed = {row["id"]: row for row in (await admin_client.get(f"{API}/admin/users")).json()}
    assert listed[str(user_id)]["line_linked"] is False and listed[str(user_id)]["google_linked"] is False
    entries = (
        await db_session.execute(
            select(AuditLogEntry).where(AuditLogEntry.action == "user.reset_password").order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    assert [(entry.target_id, entry.metadata_json) for entry in entries] == [
        (str(user_id), {"revoked_sessions": 1, "line_unlinked": True, "google_unlinked": True}),
        (str(plain_id), {"revoked_sessions": 0, "line_unlinked": False, "google_unlinked": False}),
    ]
    assert "google-attacker" not in json.dumps([entry.metadata_json for entry in entries])
    # 新密碼照常可以登入；本人要用 LINE／Google 再到「我的帳號」重新綁定。
    fresh = await _logged_in_client(app, "stolen@ivy.example", "new-password-67890")
    await fresh.aclose()


@pytest.mark.asyncio
async def test_campus_admin_cannot_reset_passwords(admin_client, minghua_client, db_session):
    user = await _create_user(db_session, "other@ivy.example", "other-password-123", Role.CAMPUS_ADMIN, ["minghua"])
    denied = await minghua_client.post(f"{API}/admin/users/{user.id}/password", json={"password": "new-password-67890"})
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_change_own_password_keeps_current_session(app, db_session):
    await _create_user(db_session, "self@ivy.example", "self-password-123", Role.CAMPUS_ADMIN, ["yihua"])
    tab_a = await _logged_in_client(app, "self@ivy.example", "self-password-123")
    tab_b = await _logged_in_client(app, "self@ivy.example", "self-password-123")
    try:
        wrong = await tab_a.post(
            f"{API}/auth/change-password",
            json={"current_password": "not-my-password", "new_password": "brand-new-password-1"},
        )
        assert wrong.status_code == 400
        ok = await tab_a.post(
            f"{API}/auth/change-password",
            json={"current_password": "self-password-123", "new_password": "brand-new-password-1"},
        )
        assert ok.status_code == 204, ok.text
        assert (await tab_a.get(f"{API}/auth/me")).status_code == 200
        assert (await tab_b.get(f"{API}/auth/me")).status_code == 401
    finally:
        await tab_a.aclose()
        await tab_b.aclose()
    again = await _logged_in_client(app, "self@ivy.example", "brand-new-password-1")
    await again.aclose()
