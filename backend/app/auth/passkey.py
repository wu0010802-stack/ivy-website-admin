"""後台 Passkey 登入（WebAuthn；指紋、Face ID、裝置 PIN，2026-11-27）。

規則同 LINE／Google 登入（app/auth/line.py）：
- 只能由已登入的本人在「我的帳號」登記，登記與刪除前要重新驗證（app/auth/reauth.py）。
- 登入不用先打 Email：瀏覽器列出這台裝置上屬於本站的 Passkey，使用者選一把、過指紋或臉部辨識。
- 一律要求使用者驗證（UV）：拿到沒上鎖的裝置還不夠，要過生物辨識或裝置密碼。
- 停權、重設密碼、總管理者「解除綁定並登出」會把 Passkey 一併清掉（service.clear_external_logins）。

挑戰值放簽章過的握手 cookie（同 LINE 的 state），5 分鐘有效、只能用一次。
"""
from __future__ import annotations

import json
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.auth import service
from app.auth.deps import SESSION_COOKIE_NAME, get_current_session, get_current_user, get_db_session
from app.auth.models import PASSKEY_NAME_MAX_LENGTH, Passkey, User
from app.auth.models import Session as AuthSession
from app.auth.oauth_common import private
from app.auth.reauth import login_rate_limited, require_recent_auth
from app.auth.routes import _features, _set_session_cookie, _user_out, login_audit_metadata
from app.auth.schemas import (
    LoginResponse,
    PasskeyLoginOptionsRequest,
    PasskeyLoginVerify,
    PasskeyOptions,
    PasskeyOut,
    PasskeyRegisterVerify,
    ReauthRequest,
)
from app.common.ratelimit import Limit, client_key, limiter
from app.config import Settings
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1/auth", tags=["auth"])

RP_NAME = "常春藤官網管理後台"
HANDSHAKE_COOKIE = "ivy_passkey"
HANDSHAKE_PATH = "/api/website/v1/auth/passkeys"
HANDSHAKE_SALT = "ivy-passkey-handshake"
HANDSHAKE_TTL_SECONDS = 300
# 挑戰值只能用一次：同 LINE 的 state，用過的記在限流表裡，握手有效期內第二次出現就拒絕。
CHALLENGE_MARKER = Limit("passkey_challenge", HANDSHAKE_TTL_SECONDS + 60, 1)
# 一個帳號最多登記幾組（手機、電腦、平板各一組綽綽有餘）。
MAX_PASSKEYS_PER_USER = 10
LOGIN_FAILED_MESSAGE = "沒辦法用這組指紋或臉部辨識登入，請改用密碼登入"


def relying_party(request: Request) -> tuple[str, list[str]] | None:
    """(RP ID, 接受的 origin)；沒辦法決定時回 None（功能視為未啟用）。

    RP ID 是後台網址的主機名（WEBSITE_ADMIN_ORIGIN）：Passkey 綁在這個網域上，換網域要重新登記。
    過渡期的 admin_extra_origins 只有同主機（或其子網域）的才算，其他網域瀏覽器本來就不給用。
    開發與測試沒設 admin_origin 時用請求的 Origin（localhost）；正式環境不這樣做。"""
    settings: Settings = request.app.state.settings
    if settings.admin_origin:
        host = urlsplit(settings.admin_origin).hostname
        if not host:
            return None
        origins = sorted(
            origin for origin in settings.allowed_origins
            if (urlsplit(origin).hostname or "") == host or (urlsplit(origin).hostname or "").endswith(f".{host}")
        )
        return host, origins
    if settings.environment == "production":
        return None
    origin = request.headers.get("origin")
    host = urlsplit(origin).hostname if origin else None
    return (host, [origin]) if origin and host else None


def enabled(request: Request) -> bool:
    settings: Settings = request.app.state.settings
    return bool(settings.admin_origin) or settings.environment != "production"


def _require_rp(request: Request) -> tuple[str, list[str]]:
    rp = relying_party(request)
    if rp is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="這個網址不能使用指紋或臉部辨識登入")
    return rp


def _require_same_origin(request: Request) -> None:
    """登入的兩支端點沒有 session、也就沒有 CSRF token：至少 Origin 要是後台（真正擋偽造的是
    WebAuthn 自己——簽章裡包著瀏覽器填的 origin，驗證時逐字比對）。"""
    if not request.app.state.settings.origin_allowed(request.headers.get("origin")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Origin 不符")


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.session_secret, salt=HANDSHAKE_SALT)


def _cookie_options(settings: Settings) -> dict:
    return {
        "path": HANDSHAKE_PATH, "httponly": True, "samesite": "strict",
        "secure": settings.environment == "production",
    }


def _set_handshake(response: Response, settings: Settings, **payload: str) -> None:
    sealed = _serializer(settings).dumps(payload)
    response.set_cookie(HANDSHAKE_COOKIE, sealed, max_age=HANDSHAKE_TTL_SECONDS, **_cookie_options(settings))


def _load_handshake(request: Request, mode: str) -> dict | None:
    raw = request.cookies.get(HANDSHAKE_COOKIE)
    if not raw:
        return None
    try:
        data = _serializer(request.app.state.settings).loads(raw, max_age=HANDSHAKE_TTL_SECONDS)
    except BadSignature:
        return None
    if not isinstance(data, dict) or data.get("mode") != mode or not isinstance(data.get("challenge"), str):
        return None
    return data


async def _consume_challenge(request: Request, response: Response, mode: str) -> dict | None:
    """取出這次的握手並作廢（cookie 清掉、挑戰值記成用過）；沒有、過期或重送都回 None。"""
    handshake = _load_handshake(request, mode)
    response.delete_cookie(HANDSHAKE_COOKIE, **_cookie_options(request.app.state.settings))
    if handshake is None or not await limiter(request).consume_marker(CHALLENGE_MARKER, handshake["challenge"]):
        return None
    return handshake


def default_name(user_agent: str | None) -> str:
    """登記時的預設名稱：從瀏覽器看得出的裝置種類，讓清單裡分得出是哪一台。"""
    agent = user_agent or ""
    for needle, name in (
        ("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android 手機"),
        ("Macintosh", "Mac"), ("Windows", "Windows 電腦"), ("CrOS", "Chromebook"), ("Linux", "Linux 電腦"),
    ):
        if needle in agent:
            return name
    return "這台裝置"


def _clean_name(value: str | None, user_agent: str | None) -> str:
    text = " ".join((value or "").split())
    return (text or default_name(user_agent))[:PASSKEY_NAME_MAX_LENGTH]


def _out(passkey: Passkey) -> PasskeyOut:
    return PasskeyOut(
        id=passkey.id, name=passkey.name, backed_up=passkey.backed_up,
        created_at=passkey.created_at, last_used_at=passkey.last_used_at,
    )


async def _own_passkeys(db: AsyncSession, user_id: uuid.UUID) -> list[Passkey]:
    result = await db.execute(
        select(Passkey).where(Passkey.user_id == user_id).order_by(Passkey.created_at, Passkey.id)
    )
    return list(result.scalars())


def _options_payload(options: Any) -> PasskeyOptions:
    return PasskeyOptions(public_key=json.loads(options_to_json(options)))


# ---- 我的帳號：登記與刪除 ----


@router.get("/passkeys", response_model=list[PasskeyOut])
async def list_passkeys(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[PasskeyOut]:
    private(response)
    return [_out(passkey) for passkey in await _own_passkeys(db, current_user.id)]


@router.post("/passkeys/register/options", response_model=PasskeyOptions)
async def register_options(
    request: Request,
    response: Response,
    payload: ReauthRequest | None = None,
    current_user: User = Depends(get_current_user),
    session: AuthSession = Depends(get_current_session),
    db: AsyncSession = Depends(get_db_session),
) -> PasskeyOptions:
    """開始登記：回 WebAuthn 的建立參數。新增一條登入管道，要重新驗證（見 app/auth/reauth.py）。"""
    private(response)
    rp_id, _ = _require_rp(request)
    existing = await _own_passkeys(db, current_user.id)
    if len(existing) >= MAX_PASSKEYS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "PASSKEY_LIMIT", "message": f"最多登記 {MAX_PASSKEYS_PER_USER} 組，請先刪掉用不到的"},
        )
    await require_recent_auth(
        request, db, current_user, session, payload.current_password if payload else None, purpose="新增登入方式"
    )
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=RP_NAME,
        user_id=current_user.id.bytes,
        user_name=current_user.email,
        user_display_name=current_user.display_name or current_user.email,
        # 要能不打 Email 直接登入，憑證得存在裝置上（discoverable）；一律要過生物辨識或裝置密碼。
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED, user_verification=UserVerificationRequirement.REQUIRED
        ),
        # 同一台裝置已經登記過就不再登記一次。
        exclude_credentials=[PublicKeyCredentialDescriptor(id=passkey.credential_id) for passkey in existing],
    )
    _set_handshake(
        response, request.app.state.settings,
        mode="register", user_id=str(current_user.id), challenge=bytes_to_base64url(options.challenge),
    )
    return _options_payload(options)


@router.post("/passkeys/register/verify", response_model=PasskeyOut, status_code=status.HTTP_201_CREATED)
async def register_verify(
    payload: PasskeyRegisterVerify,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    session: AuthSession = Depends(get_current_session),
    db: AsyncSession = Depends(get_db_session),
) -> PasskeyOut:
    private(response)
    rp_id, origins = _require_rp(request)
    failed = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"code": "PASSKEY_REGISTER_FAILED", "message": "沒有登記成功，請再試一次"},
    )
    handshake = await _consume_challenge(request, response, "register")
    # 握手必須是同一位管理員發起的（共用電腦上換了人登入，舊握手不能拿來用）。
    if handshake is None or handshake.get("user_id") != str(current_user.id):
        raise failed
    try:
        verified = verify_registration_response(
            credential=payload.credential,
            expected_challenge=base64url_to_bytes(handshake["challenge"]),
            expected_rp_id=rp_id,
            expected_origin=origins,
            require_user_verification=True,
        )
    except (WebAuthnException, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise failed from exc
    # 鎖住帳號列後重驗 session（同 LINE 綁定）：等鎖期間被停權或撤銷，就不能再多一條登入管道。
    user = await service.lock_user_for_session(db, session)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登入")
    if len(await _own_passkeys(db, user.id)) >= MAX_PASSKEYS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "PASSKEY_LIMIT", "message": f"最多登記 {MAX_PASSKEYS_PER_USER} 組，請先刪掉用不到的"},
        )
    transports = payload.credential.get("response", {}).get("transports")
    passkey = Passkey(
        user_id=user.id,
        credential_id=verified.credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        transports=[item for item in transports if isinstance(item, str)][:8] if isinstance(transports, list) else [],
        name=_clean_name(payload.name, request.headers.get("user-agent")),
        backed_up=bool(verified.credential_backed_up),
        created_at=datetime.now(timezone.utc),
    )
    try:
        db.add(passkey)
        user.passkey_count = (user.passkey_count or 0) + 1
        await db.flush()
        await audit_service.log_action(
            db, actor_user_id=user.id, action="user.add_passkey", target_type="user", target_id=str(user.id),
            metadata={"passkey_name": passkey.name},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "PASSKEY_IN_USE", "message": "這台裝置的 Passkey 已經登記過了"},
        ) from exc
    return _out(passkey)


@router.delete("/passkeys/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_passkey(
    passkey_id: uuid.UUID,
    request: Request,
    payload: ReauthRequest | None = None,
    current_user: User = Depends(get_current_user),
    session: AuthSession = Depends(get_current_session),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """刪掉自己的一組。要重新驗證；用那組登入的其他裝置一併登出（同解除 LINE），目前這個分頁保留。"""
    passkey = (
        await db.execute(select(Passkey).where(Passkey.id == passkey_id, Passkey.user_id == current_user.id))
    ).scalar_one_or_none()
    if passkey is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這組 Passkey")
    await require_recent_auth(request, db, current_user, session, payload.current_password if payload else None)
    user = await service.lock_user_for_session(db, session)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登入")
    name = passkey.name
    await db.delete(passkey)
    await db.flush()
    user.passkey_count = len(await _own_passkeys(db, user.id))
    await service.revoke_user_sessions(db, user.id, keep_session_id=session.id)
    await audit_service.log_action(
        db, actor_user_id=user.id, action="user.remove_passkey", target_type="user", target_id=str(user.id),
        metadata={"passkey_name": name},
    )
    await db.commit()
    return private(Response(status_code=status.HTTP_204_NO_CONTENT))


# ---- 登入 ----


async def _audit_login_failure(db: AsyncSession, reason: str, user_id: uuid.UUID | None = None) -> None:
    await audit_service.log_action(
        db, actor_user_id=user_id, action="user.login_passkey_failed", target_type="user",
        target_id=str(user_id) if user_id else "unknown", metadata={"reason": reason},
    )
    await db.commit()


@router.post("/passkeys/login/options", response_model=PasskeyOptions)
async def login_options(
    request: Request, response: Response, payload: PasskeyLoginOptionsRequest | None = None
) -> PasskeyOptions:
    """開始登入：不指定帳號（allowCredentials 留空），由瀏覽器列出這台裝置上本站的 Passkey。"""
    private(response)
    _require_same_origin(request)
    rp_id, _ = _require_rp(request)
    try:
        await service.check_login_source_rate_limit(limiter(request), client_key(request))
    except service.LoginRateLimited as exc:
        raise login_rate_limited(exc) from exc
    options = generate_authentication_options(rp_id=rp_id, user_verification=UserVerificationRequirement.REQUIRED)
    _set_handshake(
        response, request.app.state.settings, mode="login", challenge=bytes_to_base64url(options.challenge),
        remember="1" if payload and payload.remember else "",
    )
    return _options_payload(options)


@router.post("/passkeys/login/verify", response_model=LoginResponse)
async def login_verify(
    payload: PasskeyLoginVerify,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db_session),
) -> LoginResponse:
    private(response)
    _require_same_origin(request)
    rp_id, origins = _require_rp(request)
    settings: Settings = request.app.state.settings
    try:
        await service.check_login_source_rate_limit(limiter(request), client_key(request))
    except service.LoginRateLimited as exc:
        raise login_rate_limited(exc) from exc
    failed = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=LOGIN_FAILED_MESSAGE)
    handshake = await _consume_challenge(request, response, "login")
    if handshake is None:
        raise failed
    try:
        credential_id = base64url_to_bytes(str(payload.credential.get("id") or ""))
    except (ValueError, TypeError) as exc:
        raise failed from exc
    owner_id = (
        await db.execute(select(Passkey.user_id).where(Passkey.credential_id == credential_id))
    ).scalar_one_or_none()
    if owner_id is None:
        # 裝置上還留著、後台已經刪掉（或被清除登入方式）的 Passkey。
        await _audit_login_failure(db, "unknown_credential")
        raise failed
    # 鎖住帳號列再讀憑證（同 LINE／Google 登入）：總管理者同時「解除綁定並登出」時，要嘛這裡讀到
    # 已清掉，要嘛那邊等這裡提交後撤銷得到這次的 session。
    user = (await db.execute(select(User).where(User.id == owner_id).with_for_update())).scalar_one_or_none()
    passkey = (
        await db.execute(select(Passkey).where(Passkey.credential_id == credential_id, Passkey.user_id == owner_id))
    ).scalar_one_or_none()
    if user is None or passkey is None:
        await db.rollback()
        await _audit_login_failure(db, "unknown_credential")
        raise failed
    try:
        verified = verify_authentication_response(
            credential=payload.credential,
            expected_challenge=base64url_to_bytes(handshake["challenge"]),
            expected_rp_id=rp_id,
            expected_origin=origins,
            credential_public_key=passkey.public_key,
            credential_current_sign_count=passkey.sign_count,
            require_user_verification=True,
        )
    except (WebAuthnException, ValueError, KeyError, TypeError, AttributeError) as exc:
        await db.rollback()
        await _audit_login_failure(db, "invalid")
        raise failed from exc
    if not user.is_active:
        await db.rollback()
        await _audit_login_failure(db, "inactive", owner_id)
        raise failed
    passkey.sign_count = verified.new_sign_count
    passkey.backed_up = bool(verified.credential_backed_up)
    passkey.last_used_at = datetime.now(timezone.utc)
    previous = request.cookies.get(SESSION_COOKIE_NAME)
    if previous:
        await service.revoke_session(db, previous)
    remember = handshake.get("remember") == "1"
    raw_token, csrf_token = await service.create_session(
        db, user, idle=service.session_idle(settings), remember=remember
    )
    await audit_service.log_action(
        db, actor_user_id=user.id, action="user.login_passkey", target_type="user", target_id=str(user.id),
        metadata=login_audit_metadata(remember),
    )
    await db.commit()
    _set_session_cookie(response, settings, raw_token, remember=remember)
    loaded = (
        await db.execute(select(User).options(selectinload(User.campus_scopes)).where(User.id == owner_id))
    ).scalar_one()
    return LoginResponse(csrf_token=csrf_token, user=_user_out(loaded), features=_features(settings))
