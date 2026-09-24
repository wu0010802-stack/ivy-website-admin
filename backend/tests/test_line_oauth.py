from __future__ import annotations

import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
import pytest_asyncio
from itsdangerous import TimestampSigner, URLSafeTimedSerializer
from joserfc import jwt
from joserfc.jwk import ECKey, OctKey
from sqlalchemy import select

from app.auth import line as line_module
from app.auth import service
from app.auth.models import Role, User
from app.common import ratelimit
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user

ROOT = "/api/website/v1/auth"
CALLBACK = f"http://test{ROOT}/line/callback"
CHANNEL_ID = "1234567890"
CHANNEL_SECRET = "line-test-channel-secret-000000000"
SUB = "U" + "0123456789abcdef" * 2
ACCOUNT = "/admin/account?line_link="


async def test_line_disabled_by_default(public_client, admin_client):
    response = await public_client.get(f"{ROOT}/providers")
    assert response.status_code == 200
    assert response.json() == {"google": False, "line": False}
    response = await public_client.get(f"{ROOT}/line/login")
    assert response.status_code == 303
    assert response.headers["location"] == "/admin/login?oauth_error=line_unavailable"
    assert (await admin_client.post(f"{ROOT}/line/link")).status_code == 404


@pytest.fixture
def line_provider():
    """Only LINE's network is mocked; the app verifies real HS256/ES256 signatures."""
    ec_key = ECKey.generate_key("P-256", parameters={"kid": "line-test-kid"})
    provider = {
        "nonce": "", "challenge": "", "overrides": {}, "requests": [], "alg": "HS256",
        "secret": CHANNEL_SECRET, "ec_key": ec_key, "kid": "line-test-kid",
    }

    def handle(request):
        provider["requests"].append(request)
        assert request.url.host == "api.line.me"
        if request.url.path == "/oauth2/v2.1/certs":
            return httpx.Response(200, json={"keys": [ec_key.as_dict(private=False)]})
        assert request.url.path == "/oauth2/v2.1/token"
        form = parse_qs(request.content.decode())
        assert form["grant_type"] == ["authorization_code"]
        assert form["redirect_uri"] == [CALLBACK]
        assert form["client_id"] == [CHANNEL_ID]
        assert form["client_secret"] == [CHANNEL_SECRET]
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(form["code_verifier"][0].encode()).digest()
        ).rstrip(b"=").decode()
        assert challenge == provider["challenge"]
        if provider.get("network_error"):
            raise httpx.ConnectError("test network failure", request=request)
        if provider.get("token_status"):
            return httpx.Response(provider["token_status"], json={"error": "invalid_grant"})
        now = int(time.time())
        claims = {
            "iss": "https://access.line.me", "aud": CHANNEL_ID, "sub": SUB,
            "nonce": provider["nonce"], "iat": now, "exp": now + 3600, "amr": ["linesso"],
            **provider["overrides"],
        }
        claims = {key: value for key, value in claims.items() if value is not None}
        if provider["alg"] == "HS256":
            id_token = jwt.encode({"alg": "HS256"}, claims, OctKey.import_key(provider["secret"]))
        else:
            id_token = jwt.encode({"alg": "ES256", "kid": provider["kid"]}, claims, provider["ec_key"])
        return httpx.Response(200, json={
            "access_token": "line-access-token", "token_type": "Bearer", "expires_in": 2592000,
            "refresh_token": "line-refresh-token", "scope": "openid",
            "id_token": provider.get("raw_id_token", id_token),
        })

    provider["transport"] = httpx.MockTransport(handle)
    return provider


def _line_settings(app, **extra):
    return app.state.settings.model_copy(update={
        "line_channel_id": CHANNEL_ID,
        "line_channel_secret": CHANNEL_SECRET,
        "line_redirect_uri": CALLBACK,
        **extra,
    })


@pytest_asyncio.fixture
async def line_app(app, line_provider):
    oauth_app = create_app(_line_settings(app))
    oauth_app.state.line_oauth.transport = line_provider["transport"]
    yield oauth_app
    await oauth_app.state.engine.dispose()


@pytest_asyncio.fixture
async def line_client(line_app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=line_app), base_url="http://test") as client:
        yield client


def _remember(provider, location: str) -> dict[str, list[str]]:
    url = urlsplit(location)
    assert f"{url.scheme}://{url.netloc}{url.path}" == "https://access.line.me/oauth2/v2.1/authorize"
    query = parse_qs(url.query)
    assert query["response_type"] == ["code"]
    assert query["client_id"] == [CHANNEL_ID]
    assert query["redirect_uri"] == [CALLBACK]
    # Identity is the LINE subject only; email/profile permission is never requested.
    assert query["scope"] == ["openid"]
    assert query["code_challenge_method"] == ["S256"]
    assert len(query["state"][0]) >= 32 and len(query["nonce"][0]) >= 32
    provider["nonce"] = query["nonce"][0]
    provider["challenge"] = query["code_challenge"][0]
    return query


def _assert_handshake_cookie(response):
    cookie = response.headers["set-cookie"].lower()
    assert cookie.startswith("ivy_line_oauth=")
    assert "; httponly" in cookie
    assert "path=/api/website/v1/auth/line" in cookie
    assert "max-age=600" in cookie
    assert "samesite=lax" in cookie


async def start_login(client, provider, redirect="/visit-requests?status=pending"):
    response = await client.get(f"{ROOT}/line/login", params={"redirect": redirect})
    assert response.status_code == 302
    assert response.headers["cache-control"] == "no-store"
    _assert_handshake_cookie(response)
    return _remember(provider, response.headers["location"])["state"][0]


async def password_login(client, email="staff@ivy.example", password="test-password-123"):
    response = await client.post(f"{ROOT}/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    client.headers["x-csrf-token"] = response.json()["csrf_token"]


async def start_link(client, provider):
    response = await client.post(f"{ROOT}/line/link")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    _assert_handshake_cookie(response)
    return _remember(provider, response.json()["authorize_url"])["state"][0]


async def finish(client, state, **params):
    return await client.get(f"{ROOT}/line/callback", params={"state": state, "code": "test-code", **params})


def token_requests(provider) -> int:
    return sum(req.url.path == "/oauth2/v2.1/token" for req in provider["requests"])


async def _audit_actions(db_session) -> list[str]:
    return list((await db_session.execute(select(AuditLogEntry.action))).scalars())


# ---------------------------------------------------------------- login


@pytest.mark.parametrize("alg", ["HS256", "ES256"])
async def test_line_login_keeps_role_scope_csrf_and_logout(line_client, line_provider, db_session, alg):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.CAMPUS_ADMIN, ["minghua"])
    user.line_sub = SUB
    await db_session.commit()
    line_provider["alg"] = alg
    state = await start_login(line_client, line_provider)
    response = await finish(line_client, state)
    assert response.status_code == 303
    assert response.headers["location"] == "/admin/visit-requests?status=pending"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert line_client.cookies.get("ivy_line_oauth") is None
    me = await line_client.get(f"{ROOT}/me")
    assert me.status_code == 200
    assert me.json()["user"]["id"] == str(user.id)
    assert me.json()["user"]["campus_keys"] == ["minghua"]
    assert me.json()["user"]["line_linked"] is True
    assert (await line_client.patch(f"/api/website/v1/admin/users/{user.id}/active", json={"is_active": False})).status_code == 403
    assert (await line_client.get("/api/website/v1/admin/campuses/yihua")).status_code == 404
    assert (await line_client.get("/api/website/v1/admin/campuses/minghua")).status_code == 200
    await line_client.post(f"{ROOT}/logout", headers={"x-csrf-token": me.json()["csrf_token"]})
    assert (await line_client.get(f"{ROOT}/me")).status_code == 401


@pytest.mark.parametrize("linked", ["nobody", "inactive"])
async def test_line_login_requires_linked_active_admin(line_client, line_provider, db_session, linked):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    if linked == "inactive":
        user.line_sub = SUB
        user.is_active = False
        await db_session.commit()
    state = await start_login(line_client, line_provider)
    response = await finish(line_client, state)
    assert response.headers["location"] == "/admin/login?oauth_error=line_not_allowed"
    assert line_client.cookies.get("ivy_admin_session") is None
    assert line_client.cookies.get("ivy_line_oauth") is None


@pytest.mark.parametrize("attack", [
    {"overrides": {"iss": "https://evil.example"}},
    {"overrides": {"aud": "another-channel"}},
    {"overrides": {"nonce": "wrong-nonce"}},
    {"overrides": {"nonce": None}},
    {"overrides": {"exp": 1}},
    {"overrides": {"sub": ""}},
    {"overrides": {"sub": None}},
    {"overrides": {"sub": 12345}},
    {"overrides": {"sub": "U" * 256}},
    {"secret": "attacker-controlled-secret-0000000"},
    {"alg": "ES256", "kid": "unknown-kid"},
    {"alg": "ES256", "ec_key": ECKey.generate_key("P-256", parameters={"kid": "line-test-kid"})},
    {"raw_id_token": "not-a-jwt"},
    {"raw_id_token": None},
    {"raw_id_token": "none-alg"},
])
async def test_line_rejects_untrusted_id_token(line_client, line_provider, db_session, attack):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    user.line_sub = SUB
    await db_session.commit()
    line_provider.update(attack)
    if attack.get("raw_id_token") == "none-alg":
        header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
        payload = base64.urlsafe_b64encode(json.dumps({
            "iss": "https://access.line.me", "aud": CHANNEL_ID, "sub": SUB, "exp": int(time.time()) + 60,
        }).encode()).rstrip(b"=").decode()
        line_provider["raw_id_token"] = f"{header}.{payload}."
    state = await start_login(line_client, line_provider)
    response = await finish(line_client, state)
    assert response.status_code == 303
    assert response.headers["location"] == "/admin/login?oauth_error=line_failed"
    assert line_client.cookies.get("ivy_admin_session") is None
    assert line_client.cookies.get("ivy_line_oauth") is None


@pytest.mark.parametrize("scenario", [
    "missing_cookie", "wrong_state", "missing_code", "cancelled", "cancelled_upper",
    "provider_error", "network", "token_rejected",
])
async def test_line_callback_errors_are_safe(line_client, line_provider, scenario):
    state = await start_login(line_client, line_provider)
    params = {}
    if scenario == "missing_cookie":
        line_client.cookies.clear()
    if scenario == "wrong_state":
        state = "wrong-state"
    if scenario == "cancelled":
        params = {"error": "access_denied", "error_description": "secret-do-not-echo"}
    if scenario == "cancelled_upper":
        params = {"error": "ACCESS_DENIED", "error_description": "secret-do-not-echo"}
    if scenario == "provider_error":
        params = {"error": "server_error"}
    if scenario == "network":
        line_provider["network_error"] = True
    if scenario == "token_rejected":
        line_provider["token_status"] = 400
    if scenario == "missing_code":
        response = await line_client.get(f"{ROOT}/line/callback", params={"state": state})
    else:
        response = await finish(line_client, state, **params)
    assert response.status_code == 303
    expected = "line_cancelled" if scenario.startswith("cancelled") else "line_failed"
    assert response.headers["location"] == f"/admin/login?oauth_error={expected}"
    assert "secret-do-not-echo" not in str(response.headers)
    assert line_client.cookies.get("ivy_admin_session") is None
    assert line_client.cookies.get("ivy_line_oauth") is None
    if scenario not in {"network", "token_rejected"}:
        assert token_requests(line_provider) == 0


@pytest.mark.parametrize("redirect", ["//evil.example", "https://evil.example", "/../outside", "/%2e%2e/outside", "/\\evil.example", "/login"])
async def test_line_redirect_cannot_escape_admin(line_client, line_provider, db_session, redirect):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    user.line_sub = SUB
    await db_session.commit()
    state = await start_login(line_client, line_provider, redirect)
    assert (await finish(line_client, state)).headers["location"] == "/admin/"


async def test_line_callback_cannot_replay_after_completion(line_client, line_provider, db_session):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    user.line_sub = SUB
    await db_session.commit()
    state = await start_login(line_client, line_provider)
    await finish(line_client, state)
    count = token_requests(line_provider)
    assert (await finish(line_client, state)).headers["location"] == "/admin/login?oauth_error=line_failed"
    assert token_requests(line_provider) == count


class _PastSigner(TimestampSigner):
    def get_timestamp(self) -> int:
        return int(time.time()) - 601


@pytest.mark.parametrize("mode", ["tampered", "expired", "other_secret"])
async def test_line_rejects_tampered_and_expired_handshake(line_client, line_provider, mode):
    state = await start_login(line_client, line_provider)
    cookie = line_client.cookies.get("ivy_line_oauth")
    serializer = URLSafeTimedSerializer("test-only-secret-please-rotate", salt=line_module.HANDSHAKE_SALT)
    data = serializer.loads(cookie)
    if mode == "tampered":
        cookie += "invalid-signature"
    elif mode == "expired":
        cookie = URLSafeTimedSerializer(
            "test-only-secret-please-rotate", salt=line_module.HANDSHAKE_SALT, signer=_PastSigner
        ).dumps(data)
    else:
        cookie = URLSafeTimedSerializer("another-secret", salt=line_module.HANDSHAKE_SALT).dumps(data)
    line_client.cookies.clear()
    line_client.cookies.set("ivy_line_oauth", cookie, path="/api/website/v1/auth/line")
    assert (await finish(line_client, state)).headers["location"] == "/admin/login?oauth_error=line_failed"
    assert token_requests(line_provider) == 0


async def test_line_login_rotates_previous_session(line_client, line_provider, db_session):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    user.line_sub = SUB
    await db_session.commit()
    await password_login(line_client)
    previous = line_client.cookies.get("ivy_admin_session")
    state = await start_login(line_client, line_provider)
    await finish(line_client, state)
    assert line_client.cookies.get("ivy_admin_session") != previous
    assert await service.get_session_by_token(db_session, previous) is None


async def test_line_login_is_source_rate_limited(line_client, line_provider, monkeypatch):
    monkeypatch.setattr(
        service, "_LOGIN_SOURCE_ATTEMPTS", ratelimit.SlidingWindowLimiter(window_seconds=300, max_per_window=1)
    )
    await start_login(line_client, line_provider)
    response = await line_client.get(f"{ROOT}/line/login")
    assert response.headers["location"] == "/admin/login?oauth_error=rate_limited"
    assert "ivy_line_oauth" not in response.headers.get("set-cookie", "")


async def test_line_production_handshake_cookie_is_secure(app, line_provider):
    origin = "https://admin.example.org"
    settings = _line_settings(
        app, environment="production", database_url=app.state.settings.test_database_url,
        admin_origin=origin, line_redirect_uri=origin + ROOT + "/line/callback",
    )
    oauth_app = create_app(settings)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=oauth_app), base_url=origin) as client:
        response = await client.get(f"{ROOT}/line/login")
        assert response.status_code == 302
        cookie = response.headers["set-cookie"].lower()
        assert "; secure" in cookie
        assert "; httponly" in cookie
    await oauth_app.state.engine.dispose()


# ---------------------------------------------------------------- linking


async def test_line_link_then_login_with_line(line_client, line_provider, db_session):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.CAMPUS_ADMIN, ["renwu"])
    await password_login(line_client)
    assert (await line_client.get(f"{ROOT}/me")).json()["user"]["line_linked"] is False
    state = await start_link(line_client, line_provider)
    response = await finish(line_client, state)
    assert response.status_code == 303
    assert response.headers["location"] == ACCOUNT + "linked"
    assert line_client.cookies.get("ivy_line_oauth") is None
    await db_session.refresh(user)
    assert user.line_sub == SUB
    assert await _audit_actions(db_session) == ["user.link_line"]
    assert (await line_client.get(f"{ROOT}/me")).json()["user"]["line_linked"] is True

    await line_client.post(f"{ROOT}/logout")
    line_client.headers.pop("x-csrf-token")
    state = await start_login(line_client, line_provider)
    assert (await finish(line_client, state)).headers["location"] == "/admin/visit-requests?status=pending"
    me = (await line_client.get(f"{ROOT}/me")).json()["user"]
    assert me["id"] == str(user.id)
    assert me["campus_keys"] == ["renwu"]


async def test_line_link_start_requires_login_and_csrf(line_client, db_session):
    assert (await line_client.post(f"{ROOT}/line/link")).status_code == 401
    await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    await password_login(line_client)
    csrf = line_client.headers.pop("x-csrf-token")
    response = await line_client.post(f"{ROOT}/line/link")
    assert response.status_code == 403
    assert "ivy_line_oauth" not in response.headers.get("set-cookie", "")
    response = await line_client.post(f"{ROOT}/line/link", headers={"x-csrf-token": csrf + "x"})
    assert response.status_code == 403


async def test_line_link_start_rejects_already_linked(line_client, db_session):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    user.line_sub = "U" + "f" * 32
    await db_session.commit()
    await password_login(line_client)
    response = await line_client.post(f"{ROOT}/line/link")
    assert response.status_code == 409
    assert "ivy_line_oauth" not in response.headers.get("set-cookie", "")


async def test_line_link_rejects_subject_owned_by_another_admin(line_client, line_provider, db_session):
    owner = await _create_user(db_session, "owner@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    owner.line_sub = SUB
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.EDITOR)
    await password_login(line_client)
    state = await start_link(line_client, line_provider)
    assert (await finish(line_client, state)).headers["location"] == ACCOUNT + "in_use"
    await db_session.refresh(user)
    await db_session.refresh(owner)
    assert user.line_sub is None
    assert owner.line_sub == SUB
    assert await _audit_actions(db_session) == []


async def test_line_link_callback_race_with_other_subject(line_client, line_provider, db_session):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    await password_login(line_client)
    state = await start_link(line_client, line_provider)
    user.line_sub = "U" + "f" * 32
    await db_session.commit()
    assert (await finish(line_client, state)).headers["location"] == ACCOUNT + "already"
    await db_session.refresh(user)
    assert user.line_sub == "U" + "f" * 32


async def test_line_link_same_subject_is_idempotent(line_client, line_provider, db_session):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    await password_login(line_client)
    state = await start_link(line_client, line_provider)
    user.line_sub = SUB
    await db_session.commit()
    assert (await finish(line_client, state)).headers["location"] == ACCOUNT + "linked"
    assert await _audit_actions(db_session) == []


@pytest.mark.parametrize("change", ["logged_out", "switched_user", "deactivated"])
async def test_line_link_requires_the_same_active_admin_session(line_client, line_provider, db_session, change):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    other = await _create_user(db_session, "other@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    await password_login(line_client)
    state = await start_link(line_client, line_provider)
    if change == "logged_out":
        await line_client.post(f"{ROOT}/logout")
    elif change == "switched_user":
        await password_login(line_client, "other@ivy.example")
    else:
        await service.set_user_active(db_session, user, False)
        await db_session.commit()
    response = await finish(line_client, state)
    assert response.headers["location"] == ACCOUNT + "failed"
    await db_session.refresh(user)
    await db_session.refresh(other)
    assert user.line_sub is None and other.line_sub is None


async def test_line_link_cancelled_and_invalid_token_stay_on_account_page(line_client, line_provider, db_session):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    await password_login(line_client)
    state = await start_link(line_client, line_provider)
    response = await finish(line_client, state, error="access_denied")
    assert response.headers["location"] == ACCOUNT + "cancelled"
    assert token_requests(line_provider) == 0
    line_provider["overrides"] = {"aud": "another-channel"}
    state = await start_link(line_client, line_provider)
    assert (await finish(line_client, state)).headers["location"] == ACCOUNT + "failed"
    await db_session.refresh(user)
    assert user.line_sub is None
    # The admin session survives a failed link attempt.
    assert (await line_client.get(f"{ROOT}/me")).status_code == 200


async def test_line_login_handshake_cannot_complete_a_link(line_client, line_provider, db_session):
    """A handshake started as login never binds, even if an admin session exists."""
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    await password_login(line_client)
    state = await start_login(line_client, line_provider)
    assert (await finish(line_client, state)).headers["location"] == "/admin/login?oauth_error=line_not_allowed"
    await db_session.refresh(user)
    assert user.line_sub is None


async def test_line_unlink(line_client, line_provider, db_session):
    user = await _create_user(db_session, "staff@ivy.example", "test-password-123", Role.SUPER_ADMIN)
    user.line_sub = SUB
    await db_session.commit()
    await password_login(line_client)
    csrf = line_client.headers.pop("x-csrf-token")
    assert (await line_client.delete(f"{ROOT}/line/link")).status_code == 403
    response = await line_client.delete(f"{ROOT}/line/link", headers={"x-csrf-token": csrf})
    assert response.status_code == 204
    await db_session.refresh(user)
    assert user.line_sub is None
    assert await _audit_actions(db_session) == ["user.unlink_line"]
    # Idempotent: nothing left to unlink, nothing more to audit.
    assert (await line_client.delete(f"{ROOT}/line/link", headers={"x-csrf-token": csrf})).status_code == 204
    assert await _audit_actions(db_session) == ["user.unlink_line"]
    line_client.headers["x-csrf-token"] = csrf
    assert (await line_client.get(f"{ROOT}/me")).json()["user"]["line_linked"] is False

    await line_client.post(f"{ROOT}/logout")
    state = await start_login(line_client, line_provider)
    assert (await finish(line_client, state)).headers["location"] == "/admin/login?oauth_error=line_not_allowed"


async def test_line_unlink_works_when_line_is_disabled(admin_client, db_session):
    user = (await db_session.execute(select(User))).scalar_one()
    user.line_sub = SUB
    await db_session.commit()
    assert (await admin_client.delete(f"{ROOT}/line/link")).status_code == 204
    await db_session.refresh(user)
    assert user.line_sub is None
