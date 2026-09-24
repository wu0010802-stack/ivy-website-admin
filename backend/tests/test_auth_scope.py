from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select

from app.auth.models import Role, User


@pytest.mark.asyncio
async def test_login_logout_roundtrip(app, db_session):
    from tests.conftest import _create_user

    await _create_user(db_session, "roundtrip@ivy.example", "roundtrip-password-123", Role.SUPER_ADMIN)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        login = await client.post(
            "/api/website/v1/auth/login",
            json={"email": "roundtrip@ivy.example", "password": "roundtrip-password-123"},
        )
        assert login.status_code == 200
        csrf = login.json()["csrf_token"]

        me = await client.get("/api/website/v1/auth/me")
        assert me.status_code == 200
        assert me.json()["user"]["email"] == "roundtrip@ivy.example"
        assert me.json()["csrf_token"] == csrf

        logout = await client.post(
            "/api/website/v1/auth/logout", headers={"x-csrf-token": csrf}
        )
        assert logout.status_code == 204

        me_after_logout = await client.get("/api/website/v1/auth/me")
        assert me_after_logout.status_code == 401


@pytest.mark.asyncio
async def test_unauthenticated_request_rejected(public_client):
    response = await public_client.get("/api/website/v1/auth/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_wrong_password_rejected(app, db_session):
    from tests.conftest import _create_user

    await _create_user(db_session, "wrongpw@ivy.example", "correct-password-123", Role.SUPER_ADMIN)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/website/v1/auth/login",
            json={"email": "wrongpw@ivy.example", "password": "wrong-password"},
        )
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_deactivation_invalidates_existing_session_immediately(
    admin_client, minghua_client, db_session
):
    # minghua_client 先確認自己還活著
    me = await minghua_client.get("/api/website/v1/auth/me")
    assert me.status_code == 200
    minghua_user_id = me.json()["user"]["id"]

    # admin 停權 minghua 這個帳號
    resp = await admin_client.patch(
        f"/api/website/v1/admin/users/{minghua_user_id}/active",
        json={"is_active": False},
    )
    assert resp.status_code == 200

    # minghua_client 手上的 session 立即失效，不用等 cookie 過期
    me_after = await minghua_client.get("/api/website/v1/auth/me")
    assert me_after.status_code == 401


@pytest.mark.asyncio
async def test_last_super_admin_cannot_be_deactivated(admin_client, db_session):
    me = await admin_client.get("/api/website/v1/auth/me")
    admin_id = me.json()["user"]["id"]

    resp = await admin_client.patch(
        f"/api/website/v1/admin/users/{admin_id}/active",
        json={"is_active": False},
    )
    assert resp.status_code == 409
    assert "總管理者" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_second_super_admin_can_be_deactivated(admin_client, db_session):
    from tests.conftest import _create_user

    second = await _create_user(
        db_session, "second-admin@ivy.example", "second-admin-password-123", Role.SUPER_ADMIN
    )
    resp = await admin_client.patch(
        f"/api/website/v1/admin/users/{second.id}/active",
        json={"is_active": False},
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


@pytest.mark.asyncio
async def test_minghua_cannot_read_yihua_campus(minghua_client):
    response = await minghua_client.get("/api/website/v1/admin/campuses/yihua")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_super_admin_can_read_any_campus(admin_client):
    response = await admin_client.get("/api/website/v1/admin/campuses/yihua")
    assert response.status_code == 200
    assert response.json()["key"] == "yihua"


@pytest.mark.asyncio
async def test_minghua_can_read_own_campus(minghua_client):
    response = await minghua_client.get("/api/website/v1/admin/campuses/minghua")
    assert response.status_code == 200
    assert response.json()["key"] == "minghua"


@pytest.mark.asyncio
async def test_campus_admin_cannot_manage_users(minghua_client):
    response = await minghua_client.get("/api/website/v1/admin/users")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_non_super_roles_require_campus_scope(admin_client):
    """2026-09-24 起五種角色都能建立；總管理者以外一定要指定校區。"""
    missing = await admin_client.post(
        "/api/website/v1/admin/users",
        json={
            "email": "editor-attempt@ivy.example",
            "password": "editor-attempt-password-123",
            "role": "editor",
            "campus_keys": [],
        },
    )
    assert missing.status_code == 400
    ok = await admin_client.post(
        "/api/website/v1/admin/users",
        json={
            "email": "editor-attempt@ivy.example",
            "password": "editor-attempt-password-123",
            "role": "editor",
            "campus_keys": ["yihua"],
        },
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["role"] == "editor"
    assert ok.json()["campus_keys"] == ["yihua"]


@pytest.mark.asyncio
async def test_csrf_required_for_mutation(app, db_session):
    from tests.conftest import _create_user

    await _create_user(db_session, "csrf-test@ivy.example", "csrf-test-password-123", Role.SUPER_ADMIN)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post(
            "/api/website/v1/auth/login",
            json={"email": "csrf-test@ivy.example", "password": "csrf-test-password-123"},
        )
        # 沒帶 X-CSRF-Token 的變更請求應被拒絕
        response = await client.post(
            "/api/website/v1/admin/users",
            json={
                "email": "no-csrf@ivy.example",
                "password": "no-csrf-password-123",
                "role": "campus_admin",
                "campus_keys": ["renwu"],
            },
        )
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_login_rate_limited_after_repeated_failures(app, db_session):
    from tests.conftest import _create_user

    await _create_user(
        db_session, "ratelimit@ivy.example", "ratelimit-correct-password-123", Role.SUPER_ADMIN
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        last_status = None
        for _ in range(11):
            resp = await client.post(
                "/api/website/v1/auth/login",
                json={"email": "ratelimit@ivy.example", "password": "wrong-password"},
            )
            last_status = resp.status_code
        assert last_status == 429
