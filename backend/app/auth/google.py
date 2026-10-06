"""Google 登入（後台管理員）。

2026-10-06 業主裁定：比照 LINE（見 line.py），Google 只能在登入後到「我的帳號」自行
綁定，首次登入不做任何 Email 比對或自動綁定——後台帳號的 Email 是總管理者打的，從沒
驗證過屬於本人，打錯或共用信箱就會讓別人拿到權限。只要 `openid`，以 Google `sub` 識別。
"""
from __future__ import annotations

import time
import uuid

import httpx
from authlib.integrations.base_client import OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from joserfc.errors import JoseError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.sessions import SessionMiddleware

from app.auth import service
from app.auth.deps import SESSION_COOKIE_NAME, get_current_session, get_current_user, get_db_session
from app.auth.models import Session as AuthSession
from app.auth.models import User
from app.auth.oauth_common import OAUTH_TTL_SECONDS, private, safe_admin_path
from app.auth.reauth import require_recent_auth
from app.auth.routes import _set_session_cookie
from app.auth.schemas import GoogleLinkStart, ReauthRequest
from app.common.ratelimit import client_key, limiter
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1/auth", tags=["auth"])


def configure_google_oauth(app) -> None:
    settings = app.state.settings
    app.state.google_oauth = None
    if not settings.google_oauth_enabled:
        return
    # This signed, short-lived cookie holds only the OAuth handshake. The actual
    # admin session remains the existing DB-backed, revocable HttpOnly cookie.
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        session_cookie="ivy_google_oauth",
        max_age=OAUTH_TTL_SECONDS,
        path="/api/website/v1/auth/google",
        same_site="lax",
        https_only=settings.environment == "production",
    )
    app.state.google_oauth = OAuth().register(
        name="google",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid", "code_challenge_method": "S256", "timeout": 10.0},
    )


def _failure(code: str) -> Response:
    return private(RedirectResponse(f"/admin/login?oauth_error={code}", status_code=303))


def _link_result(result: str) -> Response:
    return private(RedirectResponse(f"/admin/account?google_link={result}", status_code=303))


class GoogleLoginRejected(Exception):
    """Google 身分驗證通過，但不能用它登入後台。`reason` 寫進稽核（不含
    email 或 Google sub），知道是哪個帳號時帶 `user_id`。"""

    def __init__(self, reason: str, user_id: uuid.UUID | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.user_id = user_id


async def _audit_login_failure(db: AsyncSession, reason: str, user_id: uuid.UUID | None = None) -> None:
    # 只記已走過 /google/login 握手的嘗試（那一步有來源限流），隨手打
    # callback 的請求不寫，免得稽核表被灌爆。
    await audit_service.log_action(
        db,
        actor_user_id=user_id,
        action="user.login_google_failed",
        target_type="user",
        target_id=str(user_id) if user_id else "unknown",
        metadata={"reason": reason},
    )
    await db.commit()


@router.get("/google/login", response_class=RedirectResponse, status_code=302)
async def google_login(request: Request, redirect: str | None = None) -> Response:
    client = request.app.state.google_oauth
    if client is None:
        return _failure("unavailable")
    request.session.clear()
    try:
        await service.check_login_source_rate_limit(limiter(request), client_key(request))
        request.session["mode"] = "login"
        request.session["return_to"] = safe_admin_path(redirect)
        request.session["started_at"] = time.time()
        response = await client.authorize_redirect(
            request, request.app.state.settings.google_redirect_uri, prompt="select_account"
        )
        return private(response)
    except service.LoginRateLimited:
        request.session.clear()
        return _failure("rate_limited")
    except (OAuthError, httpx.HTTPError, ValueError):
        request.session.clear()
        return _failure("failed")


def _subject(claims: dict) -> str | None:
    sub = claims.get("sub")
    return sub if isinstance(sub, str) and sub and len(sub) <= 255 else None


async def _authorized_user(db: AsyncSession, sub: str) -> User:
    """只認已綁定的 Google sub；沒有綁定就拒絕（不看 Email）。鎖住帳號列再建 session：
    總管理者同時「解除綁定並登出」時，要嘛這裡讀到已解除，要嘛那邊等這裡提交後撤銷得到。"""
    user = (await db.execute(select(User).where(User.google_sub == sub).with_for_update())).scalar_one_or_none()
    if user is None:
        raise GoogleLoginRejected("not_linked")
    if not user.is_active:
        raise GoogleLoginRejected("inactive", user.id)
    return user


@router.get("/google/callback", response_class=RedirectResponse, status_code=303)
async def google_callback(request: Request, db: AsyncSession = Depends(get_db_session)) -> Response:
    client = request.app.state.google_oauth
    if client is None:
        return _failure("unavailable")
    state = request.query_params.get("state")
    state_data = request.session.get(f"_state_google_{state}") if state else None
    # 綁定的結果回「我的帳號」、不寫登入失敗稽核；只有握手對得上 state 才算綁定流程。
    linking = bool(state_data) and request.session.get("mode") == "link"
    try:
        # callback 也算一次登入嘗試：握手 cookie 在有效期內可以重送，不計入
        # 來源限流的話，一個握手就能無限次打 Google、寫失敗稽核。
        await service.check_login_source_rate_limit(limiter(request), client_key(request))
    except service.LoginRateLimited:
        request.session.clear()
        return _link_result("failed") if linking else _failure("rate_limited")
    handshake_ok = False
    try:
        started = request.session.get("started_at", 0)
        if not state_data or not 0 <= time.time() - started <= OAUTH_TTL_SECONDS:
            return _link_result("failed") if linking else _failure("failed")
        handshake_ok = True
        if request.query_params.get("error"):
            cancelled = request.query_params["error"] == "access_denied"
            if linking:
                return _link_result("cancelled" if cancelled else "failed")
            await _audit_login_failure(db, "cancelled" if cancelled else "provider_error")
            return _failure("cancelled" if cancelled else "failed")
        if not request.query_params.get("code"):
            if linking:
                return _link_result("failed")
            await _audit_login_failure(db, "failed")
            return _failure("failed")

        return_to = safe_admin_path(request.session.get("return_to"))
        token = await client.authorize_access_token(
            request,
            claims_options={
                "iss": {"essential": True, "values": ["https://accounts.google.com", "accounts.google.com"]},
                # azp identifies the authorized party, not the token audience.
                # Require our client explicitly even when azp already matches.
                "aud": {"essential": True, "value": request.app.state.settings.google_client_id},
            },
        )
        claims = token.get("userinfo") or {}
        # Authlib checks signature/issuer/audience/expiry. Require nonce even if
        # a token claims nonce_supported=false; Google always supports nonce.
        sub = _subject(claims)
        if claims.get("nonce") != state_data.get("data", {}).get("nonce") or sub is None:
            if linking:
                return _link_result("failed")
            await _audit_login_failure(db, "failed")
            return _failure("failed")
        if linking:
            return await _finish_link(request, db, sub)
        user = await _authorized_user(db, sub)
        previous = request.cookies.get(SESSION_COOKIE_NAME)
        if previous:
            await service.revoke_session(db, previous)
        raw_token, _ = await service.create_session(
            db, user, idle=service.session_idle(request.app.state.settings)
        )
        await audit_service.log_action(
            db, actor_user_id=user.id, action="user.login_google", target_type="user", target_id=str(user.id)
        )
        await db.commit()
        response = RedirectResponse("/admin" + return_to, status_code=303)
        _set_session_cookie(response, request.app.state.settings, raw_token)
        return private(response)
    except GoogleLoginRejected as exc:
        await db.rollback()
        await _audit_login_failure(db, exc.reason, exc.user_id)
        return _failure("not_allowed")
    except (OAuthError, JoseError, httpx.HTTPError, ValueError, KeyError):
        await db.rollback()
        if linking:
            return _link_result("failed")
        if handshake_ok:
            await _audit_login_failure(db, "failed")
        return _failure("failed")
    finally:
        request.session.clear()


async def _finish_link(request: Request, db: AsyncSession, sub: str) -> Response:
    """綁定必須落在發起綁定的同一位、仍有效的管理員 session 上（同 LINE 的 _finish_link）。"""
    raw_session = request.cookies.get(SESSION_COOKIE_NAME)
    session = await service.get_session_by_token(db, raw_session) if raw_session else None
    if session is None or str(session.user_id) != request.session.get("user_id"):
        return _link_result("failed")
    user = (
        await db.execute(select(User).where(User.id == session.user_id).with_for_update())
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        return _link_result("failed")
    if user.google_sub == sub:
        return _link_result("linked")
    if user.google_sub is not None:
        return _link_result("already")
    if (await db.execute(select(User.id).where(User.google_sub == sub))).scalar_one_or_none():
        return _link_result("in_use")
    try:
        user.google_sub = sub
        await db.flush()
        await audit_service.log_action(
            db, actor_user_id=user.id, action="user.link_google", target_type="user", target_id=str(user.id)
        )
        await db.commit()
    except IntegrityError:
        # 兩個人同時把同一個 Google 帳號綁到自己身上，DB 唯一鍵擋下。
        await db.rollback()
        return _link_result("in_use")
    return _link_result("linked")


@router.post("/google/link", response_model=GoogleLinkStart)
async def google_link_start(
    request: Request,
    response: Response,
    payload: ReauthRequest | None = None,
    current_user: User = Depends(get_current_user),
    session: AuthSession = Depends(get_current_session),
    db: AsyncSession = Depends(get_db_session),
) -> GoogleLinkStart:
    """開始綁定：寫握手 cookie、回 Google 授權網址，真正綁定在 callback（記 user.link_google）。
    變更自己的登入方式要重新驗證（見 app/auth/reauth.py）。"""
    private(response)
    client = request.app.state.google_oauth
    if client is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Google 登入尚未啟用")
    if current_user.google_sub is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="此帳號已綁定 Google，請先解除綁定")
    await require_recent_auth(request, db, current_user, session, payload.current_password if payload else None)
    redirect_uri = request.app.state.settings.google_redirect_uri
    request.session.clear()
    request.session["mode"] = "link"
    request.session["user_id"] = str(current_user.id)
    request.session["started_at"] = time.time()
    try:
        authorization = await client.create_authorization_url(redirect_uri, prompt="select_account")
    except (OAuthError, httpx.HTTPError, ValueError) as exc:
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="暫時無法連到 Google，請稍後再試") from exc
    await client.save_authorize_data(request, redirect_uri=redirect_uri, **authorization)
    return GoogleLinkStart(authorize_url=authorization["url"])


@router.delete("/google/link", status_code=status.HTTP_204_NO_CONTENT)
async def google_unlink(
    request: Request,
    payload: ReauthRequest | None = None,
    current_user: User = Depends(get_current_user),
    session: AuthSession = Depends(get_current_session),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """本人解除 Google 綁定（例如 Google 帳號重建過、要改綁另一個）；之後要用 Google
    登入得再到「我的帳號」綁定一次。解除綁定不看 Google 登入是否啟用：關掉設定後仍要能清掉舊綁定。
    變更自己的登入方式要重新驗證（見 app/auth/reauth.py）；沒東西可解除時不用。"""
    if current_user.google_sub is not None:
        await require_recent_auth(
            request, db, current_user, session, payload.current_password if payload else None
        )
        current_user.google_sub = None
        await db.flush()
        # 用那個 Google 帳號登入的其他裝置一併登出；目前這個分頁保留。
        await service.revoke_user_sessions(db, current_user.id, keep_session_id=session.id)
        await audit_service.log_action(
            db, actor_user_id=current_user.id, action="user.unlink_google",
            target_type="user", target_id=str(current_user.id),
        )
        await db.commit()
    return private(Response(status_code=status.HTTP_204_NO_CONTENT))
