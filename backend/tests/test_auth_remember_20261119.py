"""後台「記住這台裝置」30 天（2026-11-19）。

沒勾：照舊是瀏覽器 session cookie（關掉瀏覽器就沒了），閒置 120 分鐘、最長 12 小時。
有勾：cookie 帶 Max-Age 30 天，伺服器端最長 30 天；閒置也是 30 天（使用者 11-19 裁定），30 天內不會因為沒用而登出。帳密、Google、LINE
三種登入都一樣；OAuth 用 /auth/<provider>/login?remember=1 把選擇帶進握手。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import select, update

from app.auth import service
from app.auth.models import Role
from app.auth.models import Session as AuthSession
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user
from tests.test_google_oauth import SUB as GOOGLE_SUB
from tests.test_google_oauth import finish as google_finish
from tests.test_google_oauth import google_client, google_provider  # noqa: F401（fixture）
from tests.test_line_oauth import SUB as LINE_SUB
from tests.test_line_oauth import _remember as line_remember
from tests.test_line_oauth import finish as line_finish
from tests.test_line_oauth import line_app, line_client, line_provider  # noqa: F401（fixture）

ROOT = "/api/website/v1/auth"
EMAIL = "staff@ivy.example"
PASSWORD = "test-password-123"
THIRTY_DAYS = 30 * 24 * 60 * 60


def _session_cookie(response) -> str:
    [cookie] = [c for c in response.headers.get_list("set-cookie") if c.startswith("ivy_admin_session=")]
    return cookie.lower()


async def _only_session(db_session) -> AuthSession:
    db_session.expire_all()
    return (await db_session.execute(select(AuthSession).where(AuthSession.revoked_at.is_(None)))).scalars().one()


async def _login(client, remember: bool | None):
    body = {"email": EMAIL, "password": PASSWORD}
    if remember is not None:
        body["remember"] = remember
    response = await client.post(f"{ROOT}/login", json=body)
    assert response.status_code == 200, response.text
    return response


async def _shift(db_session, *, created_ago: timedelta, expires_in: timedelta) -> None:
    now = datetime.now(timezone.utc)
    await db_session.execute(update(AuthSession).values(created_at=now - created_ago, expires_at=now + expires_in))
    await db_session.commit()


@pytest.mark.parametrize("remember", [None, False])
async def test_password_login_without_remember_keeps_browser_session_cookie(public_client, db_session, remember):
    await _create_user(db_session, EMAIL, PASSWORD, Role.CAMPUS_ADMIN, ["minghua"])
    response = await _login(public_client, remember)
    cookie = _session_cookie(response)
    assert "max-age" not in cookie and "expires" not in cookie
    session = await _only_session(db_session)
    assert session.remember is False
    me = (await public_client.get(f"{ROOT}/me")).json()
    reported = datetime.fromisoformat(me["session_max_expires_at"].replace("Z", "+00:00"))
    assert reported == session.created_at + timedelta(hours=12)


async def test_password_login_with_remember_sets_thirty_day_cookie_and_limit(public_client, db_session):
    await _create_user(db_session, EMAIL, PASSWORD, Role.CAMPUS_ADMIN, ["minghua"])
    response = await _login(public_client, True)
    assert f"max-age={THIRTY_DAYS}" in _session_cookie(response)
    session = await _only_session(db_session)
    assert session.remember is True
    # 閒置不再是 120 分鐘：30 天內沒用也不會登出，最長 30 天。
    assert session.expires_at == session.created_at + timedelta(days=30)
    me = (await public_client.get(f"{ROOT}/me")).json()
    reported = datetime.fromisoformat(me["session_max_expires_at"].replace("Z", "+00:00"))
    assert reported == session.created_at + timedelta(days=30)


@pytest.mark.parametrize(("remember", "status"), [(False, 401), (True, 200)])
async def test_only_remembered_sessions_outlive_twelve_hours(public_client, db_session, remember, status):
    await _create_user(db_session, EMAIL, PASSWORD, Role.CAMPUS_ADMIN, ["minghua"])
    await _login(public_client, remember)
    await _shift(db_session, created_ago=timedelta(hours=13), expires_in=timedelta(hours=1))
    assert (await public_client.get(f"{ROOT}/me")).status_code == status


async def test_remembered_session_ends_after_thirty_days(public_client, db_session):
    await _create_user(db_session, EMAIL, PASSWORD, Role.CAMPUS_ADMIN, ["minghua"])
    await _login(public_client, True)
    await _shift(db_session, created_ago=timedelta(days=30, minutes=1), expires_in=timedelta(days=1))
    assert (await public_client.get(f"{ROOT}/me")).status_code == 401


async def test_remembered_session_survives_long_idle_until_thirty_days(public_client, db_session):
    """登入後 29 天都沒開後台，第 29 天回來照樣是登入狀態（到期時間就是登入滿 30 天）。"""
    await _create_user(db_session, EMAIL, PASSWORD, Role.CAMPUS_ADMIN, ["minghua"])
    await _login(public_client, True)
    session = await _only_session(db_session)
    created = datetime.now(timezone.utc) - timedelta(days=29)
    await db_session.execute(update(AuthSession).values(created_at=created, expires_at=created + (session.expires_at - session.created_at)))
    await db_session.commit()
    assert (await public_client.get(f"{ROOT}/me")).status_code == 200


async def test_remembered_session_activity_never_extends_past_thirty_days(public_client, db_session):
    await _create_user(db_session, EMAIL, PASSWORD, Role.CAMPUS_ADMIN, ["minghua"])
    await _login(public_client, True)
    await _shift(db_session, created_ago=timedelta(days=2), expires_in=timedelta(hours=1))
    assert (await public_client.get(f"{ROOT}/me")).status_code == 200
    session = await _only_session(db_session)
    assert session.expires_at == session.created_at + timedelta(days=30)


async def test_remembered_login_is_audited(public_client, db_session):
    await _create_user(db_session, EMAIL, PASSWORD, Role.CAMPUS_ADMIN, ["minghua"])
    await _login(public_client, True)
    await public_client.post(f"{ROOT}/logout", headers={"x-csrf-token": (await public_client.get(f"{ROOT}/me")).json()["csrf_token"]})
    await _login(public_client, False)
    rows = (
        await db_session.execute(
            select(AuditLogEntry).where(AuditLogEntry.action == "user.login_password").order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    assert [row.metadata_json for row in rows] == [{"remember": True}, {}]


async def test_remembered_session_still_needs_recent_auth_to_link_line(line_client, db_session):
    """30 天的 session 不能拿來免密碼新增登入方式：重新驗證看的是登入時間，不是 session 還在不在。"""
    await _create_user(db_session, EMAIL, PASSWORD, Role.CAMPUS_ADMIN, ["minghua"])
    response = await _login(line_client, True)
    line_client.headers["x-csrf-token"] = response.json()["csrf_token"]
    await _shift(db_session, created_ago=timedelta(days=3), expires_in=timedelta(days=4))
    assert (await line_client.get(f"{ROOT}/me")).status_code == 200
    link = await line_client.post(f"{ROOT}/line/link")
    assert link.status_code == 403, link.text
    assert "目前的密碼" in link.text


# ---------------------------------------------------------------- LINE


@pytest.mark.parametrize("remember", [False, True])
async def test_line_login_carries_remember_through_the_handshake(line_client, line_provider, db_session, remember):
    user = await _create_user(db_session, EMAIL, PASSWORD, Role.CAMPUS_ADMIN, ["minghua"])
    user.line_sub = LINE_SUB
    await db_session.commit()
    params = {"redirect": "/"}
    if remember:
        params["remember"] = "1"
    start = await line_client.get(f"{ROOT}/line/login", params=params)
    assert start.status_code == 302
    state = line_remember(line_provider, start.headers["location"])["state"][0]
    response = await line_finish(line_client, state)
    assert response.status_code == 303 and response.headers["location"] == "/admin/"
    cookie = _session_cookie(response)
    assert (f"max-age={THIRTY_DAYS}" in cookie) is remember
    session = await _only_session(db_session)
    assert session.remember is remember
    [entry] = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "user.login_line"))
    ).scalars().all()
    assert entry.metadata_json == ({"remember": True} if remember else {})


# ---------------------------------------------------------------- Google


@pytest.mark.parametrize("remember", [False, True])
async def test_google_login_carries_remember_through_the_handshake(google_client, google_provider, db_session, remember):
    user = await _create_user(db_session, EMAIL, PASSWORD, Role.CAMPUS_ADMIN, ["minghua"])
    user.google_sub = GOOGLE_SUB
    await db_session.commit()
    params = {"redirect": "/"}
    if remember:
        params["remember"] = "1"
    start = await google_client.get(f"{ROOT}/google/login", params=params)
    assert start.status_code == 302
    query = parse_qs(urlsplit(start.headers["location"]).query)
    google_provider["nonce"] = query["nonce"][0]
    google_provider["challenge"] = query["code_challenge"][0]
    response = await google_finish(google_client, query["state"][0])
    assert response.status_code == 303 and response.headers["location"] == "/admin/"
    cookie = _session_cookie(response)
    assert (f"max-age={THIRTY_DAYS}" in cookie) is remember
    session = await _only_session(db_session)
    assert session.remember is remember
    [entry] = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "user.login_google"))
    ).scalars().all()
    assert entry.metadata_json == ({"remember": True} if remember else {})


def test_remember_limits_are_thirty_days_including_idle():
    assert service.REMEMBER_TTL == timedelta(days=30)
    assert service.REMEMBER_IDLE == timedelta(days=30)
