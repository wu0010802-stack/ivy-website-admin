from __future__ import annotations

import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
import pytest_asyncio
from joserfc import jwt
from joserfc.jwk import RSAKey
from itsdangerous import TimestampSigner
from sqlalchemy import select

from app.auth import service
from app.auth.models import Role, User
from app.main import create_app
from tests.conftest import _create_user

ROOT = "/api/website/v1/auth"
CALLBACK = f"http://test{ROOT}/google/callback"


async def test_google_disabled_by_default(public_client):
    response = await public_client.get(f"{ROOT}/providers")
    assert response.status_code == 200
    assert response.json() == {"google": False}
    response = await public_client.get(f"{ROOT}/google/login")
    assert response.status_code == 303
    assert response.headers["location"] == "/admin/login?oauth_error=unavailable"


@pytest.fixture
def google_provider():
    """Only Google's network is mocked; Authlib verifies real RSA signatures/claims."""
    key = RSAKey.generate_key(2048, parameters={"kid": "oauth-test-key"})
    provider = {"nonce": "", "overrides": {}, "requests": [], "key": key}

    def handle(request):
        provider["requests"].append(request)
        if request.url.path.endswith("openid-configuration"):
            return httpx.Response(200, json={
                "issuer": "https://accounts.google.com",
                "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
                "token_endpoint": "https://oauth2.googleapis.com/token",
                "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
                "id_token_signing_alg_values_supported": ["RS256"],
            })
        if request.url.path.endswith("/certs"):
            return httpx.Response(200, json={"keys": [key.as_dict(private=False)]})
        assert request.url.path == "/token"
        form = parse_qs(request.content.decode())
        assert form["redirect_uri"] == [CALLBACK]
        assert form["code_verifier"][0]
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(form["code_verifier"][0].encode()).digest()
        ).rstrip(b"=").decode()
        assert challenge == provider["challenge"]
        if provider.get("network_error"):
            raise httpx.ConnectError("test network failure", request=request)
        claims = {
            "iss": "https://accounts.google.com", "aud": "oauth-test-client",
            "sub": "google-person-123", "email": "staff@gmail.com",
            "email_verified": True, "nonce": provider["nonce"],
            "iat": int(time.time()), "exp": int(time.time()) + 3600,
            **provider["overrides"],
        }
        id_token = jwt.encode({"alg": "RS256", "kid": "oauth-test-key"}, claims, provider["key"])
        return httpx.Response(200, json={
            "access_token": "test-access-token", "token_type": "Bearer",
            "expires_in": 3600, "id_token": id_token,
        })

    provider["transport"] = httpx.MockTransport(handle)
    return provider


@pytest_asyncio.fixture
async def google_client(app, google_provider):
    settings = app.state.settings.model_copy(update={
        "google_client_id": "oauth-test-client",
        "google_client_secret": "oauth-test-secret",
        "google_redirect_uri": CALLBACK,
    })
    oauth_app = create_app(settings)
    oauth_app.state.google_oauth.client_kwargs["transport"] = google_provider["transport"]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=oauth_app), base_url="http://test"
    ) as client:
        yield client
    await oauth_app.state.engine.dispose()


async def start(client, provider, redirect="/visit-requests?status=pending"):
    response = await client.get(f"{ROOT}/google/login", params={"redirect": redirect})
    assert response.status_code == 302
    assert response.headers["cache-control"] == "no-store"
    query = parse_qs(urlsplit(response.headers["location"]).query)
    assert query["scope"] == ["openid email"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["redirect_uri"] == [CALLBACK]
    assert "httponly" in response.headers["set-cookie"].lower()
    provider["nonce"] = query["nonce"][0]
    provider["challenge"] = query["code_challenge"][0]
    return query["state"][0]


async def finish(client, state, **params):
    return await client.get(f"{ROOT}/google/callback", params={"state": state, "code": "test-code", **params})


async def test_google_login_preserves_scope_csrf_and_logout(google_client, google_provider, db_session):
    user = await _create_user(db_session, "Staff@gmail.com", "test-password-123", Role.CAMPUS_ADMIN, ["minghua"])
    state = await start(google_client, google_provider)
    response = await finish(google_client, state)
    assert response.status_code == 303
    assert response.headers["location"] == "/admin/visit-requests?status=pending"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert google_client.cookies.get("ivy_google_oauth") is None
    me = await google_client.get(f"{ROOT}/me")
    assert me.status_code == 200
    assert me.json()["user"]["campus_keys"] == ["minghua"]
    assert me.json()["user"]["role"] == "campus_admin"
    await db_session.refresh(user)
    assert user.google_sub == "google-person-123"
    # Session is restored through the same /me endpoint, with the same CSRF and campus guards.
    assert (await google_client.patch("/api/website/v1/admin/users/" + str(user.id) + "/active", json={"is_active": False})).status_code == 403
    assert (await google_client.get("/api/website/v1/admin/campuses/yihua")).status_code == 404
    assert (await google_client.get("/api/website/v1/admin/campuses/minghua")).status_code == 200
    await google_client.post(f"{ROOT}/logout", headers={"x-csrf-token": me.json()["csrf_token"]})
    assert (await google_client.get(f"{ROOT}/me")).status_code == 401


@pytest.mark.parametrize("overrides", [
    {"email_verified": False}, {"email_verified": "true"}, {"email": "unknown@gmail.com"},
    {"email": "staff@example.org"}, {"sub": ""},
    {"iss": "https://evil.example"}, {"aud": "another-client"},
    {"nonce": "wrong-nonce"}, {"exp": 1},
    {"nonce": "wrong-nonce", "nonce_supported": False},
    {"aud": "another-client", "azp": "oauth-test-client"},
    {"aud": "", "azp": "oauth-test-client"},
    {"aud": ["another-client"], "azp": "oauth-test-client"},
    {"aud": [], "azp": "oauth-test-client"},
])
async def test_google_rejects_untrusted_identity(google_client, google_provider, db_session, overrides):
    await _create_user(db_session, "staff@gmail.com", "test-password-123", Role.SUPER_ADMIN)
    await _create_user(db_session, "staff@example.org", "test-password-123", Role.SUPER_ADMIN)
    google_provider["overrides"] = overrides
    state = await start(google_client, google_provider)
    response = await finish(google_client, state)
    assert response.status_code == 303
    assert response.headers["location"].startswith("/admin/login?oauth_error=")
    assert google_client.cookies.get("ivy_admin_session") is None
    assert google_client.cookies.get("ivy_google_oauth") is None
    users = (await db_session.execute(select(User))).scalars().all()
    assert all(user.google_sub is None for user in users)


async def test_google_accepts_client_in_multiple_audiences(google_client, google_provider, db_session):
    await _create_user(db_session, "staff@gmail.com", "test-password-123", Role.SUPER_ADMIN)
    google_provider["overrides"] = {
        "aud": ["oauth-test-client", "another-client"], "azp": "oauth-test-client",
    }
    state = await start(google_client, google_provider)
    response = await finish(google_client, state)
    assert response.status_code == 303
    assert response.headers["location"].startswith("/admin/visit-requests")
    assert (await google_client.get(f"{ROOT}/me")).status_code == 200


async def test_google_rejects_bad_signature(google_client, google_provider, db_session):
    await _create_user(db_session, "staff@gmail.com", "test-password-123", Role.SUPER_ADMIN)
    google_provider["key"] = RSAKey.generate_key(2048, parameters={"kid": "oauth-test-key"})
    state = await start(google_client, google_provider)
    response = await finish(google_client, state)
    assert "oauth_error=failed" in response.headers["location"]
    assert google_client.cookies.get("ivy_admin_session") is None


async def test_google_workspace_email_can_bind(google_client, google_provider, db_session):
    await _create_user(db_session, "staff@example.org", "test-password-123", Role.SUPER_ADMIN)
    google_provider["overrides"] = {"email": "staff@example.org", "hd": "example.org"}
    state = await start(google_client, google_provider)
    assert (await finish(google_client, state)).headers["location"].startswith("/admin/visit-requests")


async def test_google_inactive_and_different_subject_rejected(google_client, google_provider, db_session):
    user = await _create_user(db_session, "staff@gmail.com", "test-password-123", Role.SUPER_ADMIN)
    user.is_active = False
    await db_session.commit()
    state = await start(google_client, google_provider)
    assert "oauth_error=not_allowed" in (await finish(google_client, state)).headers["location"]
    user.is_active = True
    user.google_sub = "another-google-person"
    await db_session.commit()
    state = await start(google_client, google_provider)
    assert "oauth_error=not_allowed" in (await finish(google_client, state)).headers["location"]


async def test_google_subject_survives_email_change_and_deactivation(google_client, google_provider, db_session):
    user = await _create_user(db_session, "old@example.org", "test-password-123", Role.CAMPUS_ADMIN, ["minghua"])
    user.google_sub = "google-person-123"
    await db_session.commit()
    state = await start(google_client, google_provider)
    await finish(google_client, state)
    assert (await google_client.get(f"{ROOT}/me")).json()["user"]["id"] == str(user.id)
    await service.set_user_active(db_session, user, False)
    await db_session.commit()
    assert (await google_client.get(f"{ROOT}/me")).status_code == 401


@pytest.mark.parametrize("scenario", ["missing_cookie", "wrong_state", "cancelled", "network"])
async def test_google_callback_errors_are_safe(google_client, google_provider, scenario):
    state = await start(google_client, google_provider)
    if scenario == "missing_cookie":
        google_client.cookies.clear()
    if scenario == "wrong_state":
        state = "wrong-state"
    if scenario == "network":
        google_provider["network_error"] = True
    response = await finish(google_client, state, **({"error": "access_denied", "error_description": "secret-do-not-echo"} if scenario == "cancelled" else {}))
    assert response.status_code == 303
    assert response.headers["location"].startswith("/admin/login?oauth_error=")
    assert "secret-do-not-echo" not in str(response.headers)
    assert google_client.cookies.get("ivy_admin_session") is None
    assert google_client.cookies.get("ivy_google_oauth") is None
    if scenario != "network":
        assert not any(req.url.path == "/token" for req in google_provider["requests"])


@pytest.mark.parametrize("redirect", ["//evil.example", "https://evil.example", "/../outside", "/%2e%2e/outside", "/\\evil.example", "/login"])
async def test_google_redirect_cannot_escape_admin(google_client, google_provider, db_session, redirect):
    await _create_user(db_session, "staff@gmail.com", "test-password-123", Role.SUPER_ADMIN)
    state = await start(google_client, google_provider, redirect)
    assert (await finish(google_client, state)).headers["location"] == "/admin/"


async def test_google_callback_cannot_replay_after_completion(google_client, google_provider, db_session):
    await _create_user(db_session, "staff@gmail.com", "test-password-123", Role.SUPER_ADMIN)
    state = await start(google_client, google_provider)
    await finish(google_client, state)
    token_requests = sum(req.url.path == "/token" for req in google_provider["requests"])
    response = await finish(google_client, state)
    assert "oauth_error=failed" in response.headers["location"]
    assert sum(req.url.path == "/token" for req in google_provider["requests"]) == token_requests


@pytest.mark.parametrize("mode", ["tampered", "expired"])
async def test_google_rejects_tampered_and_expired_handshake(google_client, google_provider, mode):
    state = await start(google_client, google_provider)
    cookie = google_client.cookies.get("ivy_google_oauth")
    if mode == "tampered":
        cookie += "invalid-signature"
    else:
        signer = TimestampSigner("test-only-secret-please-rotate")
        data = json.loads(base64.b64decode(signer.unsign(cookie)))
        data["started_at"] = time.time() - 601
        cookie = signer.sign(base64.b64encode(json.dumps(data).encode())).decode()
    google_client.cookies.clear()
    google_client.cookies.set("ivy_google_oauth", cookie)
    assert "oauth_error=failed" in (await finish(google_client, state)).headers["location"]
    assert not any(req.url.path == "/token" for req in google_provider["requests"])


async def test_google_rotates_previous_session(google_client, google_provider, db_session):
    await _create_user(db_session, "staff@gmail.com", "test-password-123", Role.SUPER_ADMIN)
    await google_client.post(f"{ROOT}/login", json={"email": "staff@gmail.com", "password": "test-password-123"})
    previous = google_client.cookies.get("ivy_admin_session")
    state = await start(google_client, google_provider)
    await finish(google_client, state)
    assert google_client.cookies.get("ivy_admin_session") != previous
    assert await service.get_session_by_token(db_session, previous) is None


async def test_google_production_handshake_cookie_is_secure(app, google_provider):
    settings = app.state.settings.model_copy(update={
        "environment": "production",
        "database_url": app.state.settings.test_database_url,
        "google_client_id": "oauth-test-client", "google_client_secret": "oauth-test-secret",
        "google_redirect_uri": "https://admin.example.org" + ROOT + "/google/callback",
    })
    oauth_app = create_app(settings)
    oauth_app.state.google_oauth.client_kwargs["transport"] = google_provider["transport"]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=oauth_app), base_url="https://admin.example.org") as client:
        response = await client.get(f"{ROOT}/google/login")
        assert response.status_code == 302
        cookie = response.headers["set-cookie"].lower()
        assert "; secure" in cookie
        assert "; httponly" in cookie
        assert "max-age=600" in cookie
        assert "samesite=lax" in cookie
    await oauth_app.state.engine.dispose()
