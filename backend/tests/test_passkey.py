"""後台 Passkey 登入（指紋／Face ID，2026-11-27）：用軟體模擬的驗證器跑完整的登記與登入。"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import cbor2
import httpx
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import func, select, update
from webauthn.helpers import bytes_to_base64url

from app.auth import passkey as passkey_module
from app.auth import service
from app.auth.models import Passkey, Role, User
from app.auth.models import Session as AuthSession
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client

ROOT = "/api/website/v1/auth"
ORIGIN = "http://localhost"
PASSWORD = "test-password-123"


class SoftAuthenticator:
    """只做測試需要的部分：ES256 金鑰、none attestation、UP／UV 旗標、使用次數。"""

    def __init__(self, rp_id: str = "localhost", origin: str = ORIGIN) -> None:
        self.rp_id = rp_id
        self.origin = origin
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = os.urandom(32)
        self.sign_count = 0

    def _auth_data(self, flags: int, *, attested: bool = False) -> bytes:
        data = hashlib.sha256(self.rp_id.encode()).digest() + bytes([flags]) + self.sign_count.to_bytes(4, "big")
        if attested:
            numbers = self.key.public_key().public_numbers()
            cose = {1: 2, 3: -7, -1: 1, -2: numbers.x.to_bytes(32, "big"), -3: numbers.y.to_bytes(32, "big")}
            data += bytes(16) + len(self.credential_id).to_bytes(2, "big") + self.credential_id + cbor2.dumps(cose)
        return data

    def _client_data(self, kind: str, options: dict) -> bytes:
        return json.dumps(
            {"type": kind, "challenge": options["challenge"], "origin": self.origin, "crossOrigin": False}
        ).encode()

    def _envelope(self, response: dict) -> dict:
        encoded = bytes_to_base64url(self.credential_id)
        return {
            "id": encoded, "rawId": encoded, "type": "public-key", "response": response,
            "clientExtensionResults": {}, "authenticatorAttachment": "platform",
        }

    def create(self, options: dict, *, uv: bool = True) -> dict:
        auth_data = self._auth_data(0x41 | (0x04 if uv else 0), attested=True)
        return self._envelope({
            "clientDataJSON": bytes_to_base64url(self._client_data("webauthn.create", options)),
            "attestationObject": bytes_to_base64url(cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})),
            "transports": ["internal"],
        })

    def get(self, options: dict, *, uv: bool = True) -> dict:
        self.sign_count += 1
        auth_data = self._auth_data(0x01 | (0x04 if uv else 0))
        client_data = self._client_data("webauthn.get", options)
        signature = self.key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        return self._envelope({
            "clientDataJSON": bytes_to_base64url(client_data),
            "authenticatorData": bytes_to_base64url(auth_data),
            "signature": bytes_to_base64url(signature),
        })


def _anonymous(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"origin": ORIGIN})


async def _staff(app, db, email: str = "staff@ivy.example", role: Role = Role.SUPER_ADMIN):
    user = await _create_user(db, email, PASSWORD, role, None if role == Role.SUPER_ADMIN else ["yihua"])
    client = await _logged_in_client(app, email, PASSWORD)
    client.headers["origin"] = ORIGIN
    return user, client


async def _register(client: httpx.AsyncClient, device: SoftAuthenticator, **verify_extra) -> httpx.Response:
    options = await client.post(f"{ROOT}/passkeys/register/options")
    assert options.status_code == 200, options.text
    return await client.post(
        f"{ROOT}/passkeys/register/verify",
        json={"credential": device.create(options.json()["public_key"]), **verify_extra},
    )


async def _login(client: httpx.AsyncClient, device: SoftAuthenticator, *, remember: bool = False, **get_kwargs):
    options = await client.post(f"{ROOT}/passkeys/login/options", json={"remember": remember})
    assert options.status_code == 200, options.text
    return await client.post(
        f"{ROOT}/passkeys/login/verify", json={"credential": device.get(options.json()["public_key"], **get_kwargs)}
    )


async def _audits(db, action: str) -> list[AuditLogEntry]:
    result = await db.execute(select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at))
    return list(result.scalars())


async def _age_session(db, user_id, minutes: int = 11) -> None:
    await db.execute(
        update(AuthSession).where(AuthSession.user_id == user_id)
        .values(created_at=datetime.now(timezone.utc) - timedelta(minutes=minutes))
    )
    await db.commit()


@pytest.mark.asyncio
async def test_register_then_login_without_email(app, db_session):
    user, client = await _staff(app, db_session)
    device = SoftAuthenticator()
    try:
        providers = await client.get(f"{ROOT}/providers")
        assert providers.json()["passkey"] is True

        options = await client.post(f"{ROOT}/passkeys/register/options")
        public_key = options.json()["public_key"]
        # 要能不打 Email 登入：憑證存在裝置上，而且一定要過生物辨識或裝置密碼。
        assert public_key["authenticatorSelection"]["residentKey"] == "required"
        assert public_key["authenticatorSelection"]["userVerification"] == "required"
        assert public_key["rp"] == {"id": "localhost", "name": passkey_module.RP_NAME}
        created = await client.post(
            f"{ROOT}/passkeys/register/verify",
            json={"credential": device.create(public_key)},
            headers={"user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)"},
        )
        assert created.status_code == 201, created.text
        assert created.json()["name"] == "iPhone"

        listed = await client.get(f"{ROOT}/passkeys")
        assert [item["name"] for item in listed.json()] == ["iPhone"]
        assert (await client.get(f"{ROOT}/me")).json()["user"]["passkey_count"] == 1
        [added] = await _audits(db_session, "user.add_passkey")
        assert added.actor_user_id == user.id and added.metadata_json == {"passkey_name": "iPhone"}
    finally:
        await client.aclose()

    async with _anonymous(app) as fresh:
        login_options = await fresh.post(f"{ROOT}/passkeys/login/options", json={"remember": True})
        request_options = login_options.json()["public_key"]
        assert request_options["userVerification"] == "required"
        assert request_options.get("allowCredentials", []) == []
        logged_in = await fresh.post(f"{ROOT}/passkeys/login/verify", json={"credential": device.get(request_options)})
        assert logged_in.status_code == 200, logged_in.text
        body = logged_in.json()
        assert body["user"]["email"] == "staff@ivy.example" and body["csrf_token"]
        assert "Max-Age=2592000" in logged_in.headers["set-cookie"]
        me = await fresh.get(f"{ROOT}/me")
        assert me.status_code == 200 and me.json()["user"]["id"] == str(user.id)

    [entry] = await _audits(db_session, "user.login_passkey")
    assert entry.actor_user_id == user.id and entry.metadata_json == {"remember": True}
    stored = (await db_session.execute(select(Passkey))).scalar_one()
    assert stored.sign_count == 1 and stored.last_used_at is not None


@pytest.mark.asyncio
async def test_register_needs_recent_login_or_password(app, db_session):
    user, client = await _staff(app, db_session)
    try:
        await _age_session(db_session, user.id)
        denied = await client.post(f"{ROOT}/passkeys/register/options")
        assert denied.status_code == 403 and denied.json()["detail"]["code"] == "REAUTH_REQUIRED"
        wrong = await client.post(f"{ROOT}/passkeys/register/options", json={"current_password": "not-my-password"})
        assert wrong.status_code == 403
        ok = await client.post(f"{ROOT}/passkeys/register/options", json={"current_password": PASSWORD})
        assert ok.status_code == 200
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_register_rejects_replay_wrong_origin_missing_uv_and_duplicates(app, db_session):
    _, client = await _staff(app, db_session)
    device = SoftAuthenticator()
    try:
        options = (await client.post(f"{ROOT}/passkeys/register/options")).json()["public_key"]
        credential = device.create(options)
        assert (await client.post(f"{ROOT}/passkeys/register/verify", json={"credential": credential})).status_code == 201
        # 同一份回應重送：握手已經用掉。
        replay = await client.post(f"{ROOT}/passkeys/register/verify", json={"credential": credential})
        assert replay.status_code == 400 and replay.json()["detail"]["code"] == "PASSKEY_REGISTER_FAILED"
        # 同一把憑證再登記一次（瀏覽器的 excludeCredentials 被繞過時）。
        again = await _register(client, device)
        assert again.status_code == 409 and again.json()["detail"]["code"] == "PASSKEY_IN_USE"

        phishing = SoftAuthenticator(origin="https://evil.example")
        assert (await _register(client, phishing)).status_code == 400

        no_uv = SoftAuthenticator()
        options = (await client.post(f"{ROOT}/passkeys/register/options")).json()["public_key"]
        rejected = await client.post(f"{ROOT}/passkeys/register/verify", json={"credential": no_uv.create(options, uv=False)})
        assert rejected.status_code == 400
        assert (await db_session.execute(select(func.count()).select_from(Passkey))).scalar_one() == 1
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_login_rejects_replay_unknown_missing_uv_and_wrong_origin(app, db_session):
    _, client = await _staff(app, db_session)
    device = SoftAuthenticator()
    assert (await _register(client, device)).status_code == 201
    await client.aclose()

    async with _anonymous(app) as fresh:
        options = (await fresh.post(f"{ROOT}/passkeys/login/options")).json()["public_key"]
        assertion = device.get(options)
        assert (await fresh.post(f"{ROOT}/passkeys/login/verify", json={"credential": assertion})).status_code == 200
    async with _anonymous(app) as fresh:
        # 沒有握手就直接送（或把別次的回應拿來重送）。
        assert (await fresh.post(f"{ROOT}/passkeys/login/verify", json={"credential": assertion})).status_code == 401
        assert (await _login(fresh, SoftAuthenticator())).status_code == 401
        assert (await _login(fresh, device, uv=False)).status_code == 401
        device.origin = "https://evil.example"
        assert (await _login(fresh, device)).status_code == 401
        assert (await fresh.get(f"{ROOT}/me")).status_code == 401

    reasons = [entry.metadata_json["reason"] for entry in await _audits(db_session, "user.login_passkey_failed")]
    assert reasons == ["unknown_credential", "invalid", "invalid"]


@pytest.mark.asyncio
async def test_login_endpoints_check_origin_when_admin_origin_is_set(app, db_session, monkeypatch):
    monkeypatch.setattr(app.state, "settings", app.state.settings.model_copy(update={"admin_origin": "https://admin.example.com"}))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as outsider:
        denied = await outsider.post(f"{ROOT}/passkeys/login/options", headers={"origin": "https://evil.example"})
        assert denied.status_code == 403
        allowed = await outsider.post(f"{ROOT}/passkeys/login/options", headers={"origin": "https://admin.example.com"})
        assert allowed.status_code == 200 and allowed.json()["public_key"]["rpId"] == "admin.example.com"


@pytest.mark.asyncio
async def test_delete_own_passkey_needs_reauth_and_stops_login(app, db_session):
    user, client = await _staff(app, db_session)
    _, other = await _staff(app, db_session, "other@ivy.example", Role.RECEPTION)
    device = SoftAuthenticator()
    try:
        passkey_id = (await _register(client, device)).json()["id"]
        assert (await other.request("DELETE", f"{ROOT}/passkeys/{passkey_id}")).status_code == 404
        await _age_session(db_session, user.id)
        denied = await client.request("DELETE", f"{ROOT}/passkeys/{passkey_id}")
        assert denied.status_code == 403 and denied.json()["detail"]["code"] == "REAUTH_REQUIRED"
        removed = await client.request("DELETE", f"{ROOT}/passkeys/{passkey_id}", json={"current_password": PASSWORD})
        assert removed.status_code == 204
        assert (await client.get(f"{ROOT}/me")).json()["user"]["passkey_count"] == 0
        [entry] = await _audits(db_session, "user.remove_passkey")
        assert entry.actor_user_id == user.id
    finally:
        await client.aclose()
        await other.aclose()
    async with _anonymous(app) as fresh:
        assert (await _login(fresh, device)).status_code == 401


@pytest.mark.asyncio
async def test_deactivate_and_admin_clear_remove_passkeys(app, db_session):
    _, admin = await _staff(app, db_session, "boss@ivy.example")
    staff, client = await _staff(app, db_session, "desk@ivy.example", Role.RECEPTION)
    first, second = SoftAuthenticator(), SoftAuthenticator()
    try:
        assert (await _register(client, first)).status_code == 201
        cleared = await admin.post(f"/api/website/v1/admin/users/{staff.id}/clear-external-logins")
        assert cleared.status_code == 200 and cleared.json()["passkey_count"] == 0
        [entry] = await _audits(db_session, "user.clear_external_logins")
        assert entry.metadata_json["passkeys_removed"] is True
        async with _anonymous(app) as fresh:
            assert (await _login(fresh, first)).status_code == 401

        relogged = await _logged_in_client(app, "desk@ivy.example", PASSWORD)
        relogged.headers["origin"] = ORIGIN
        assert (await _register(relogged, second)).status_code == 201
        await relogged.aclose()
        fresh_user = (await db_session.execute(select(User).where(User.id == staff.id))).scalar_one()
        await service.set_user_active(db_session, fresh_user, False)
        await db_session.commit()
        assert (await db_session.execute(select(func.count()).select_from(Passkey))).scalar_one() == 0
        async with _anonymous(app) as fresh:
            assert (await _login(fresh, second)).status_code == 401
    finally:
        await client.aclose()
        await admin.aclose()


@pytest.mark.asyncio
async def test_inactive_user_cannot_login_even_if_passkey_row_survives(app, db_session):
    staff, client = await _staff(app, db_session, "desk@ivy.example", Role.RECEPTION)
    device = SoftAuthenticator()
    assert (await _register(client, device)).status_code == 201
    await client.aclose()
    # 直接改欄位（不走 set_user_active）：就算憑證還在，停權的帳號也不能登入。
    await db_session.execute(update(User).where(User.id == staff.id).values(is_active=False))
    await db_session.commit()
    async with _anonymous(app) as fresh:
        assert (await _login(fresh, device)).status_code == 401
    [entry] = await _audits(db_session, "user.login_passkey_failed")
    assert entry.metadata_json == {"reason": "inactive"} and entry.actor_user_id == staff.id


def _request(settings, origin: str | None = None):
    headers = {"origin": origin} if origin else {}
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(settings=settings)), headers=headers)


def test_relying_party_follows_admin_origin(isolated_settings):
    production = isolated_settings.model_copy(update={
        "admin_origin": "https://admin.example.com",
        "admin_extra_origins": "https://old.example.net,https://beta.admin.example.com",
    })
    assert passkey_module.relying_party(_request(production)) == (
        "admin.example.com", ["https://admin.example.com", "https://beta.admin.example.com"]
    )
    # 正式環境沒設後台網址：不拿請求帶的 Origin 當 RP（那是對方說了算）。
    bare = isolated_settings.model_copy(update={"environment": "production"})
    assert passkey_module.relying_party(_request(bare, "https://evil.example")) is None
    assert passkey_module.relying_party(_request(isolated_settings, "http://localhost:5173")) == (
        "localhost", ["http://localhost:5173"]
    )


def test_default_name_from_user_agent():
    assert passkey_module.default_name("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)") == "Mac"
    assert passkey_module.default_name("Mozilla/5.0 (Linux; Android 15; Pixel 9)") == "Android 手機"
    assert passkey_module.default_name(None) == "這台裝置"
