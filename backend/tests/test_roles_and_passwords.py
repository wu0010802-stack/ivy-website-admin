"""角色開放、改角色、重設密碼、本人改密碼。"""
from __future__ import annotations

import httpx
import pytest

from app.auth.models import Role
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
