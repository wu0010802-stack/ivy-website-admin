from __future__ import annotations

import time
import uuid

import httpx
from authlib.integrations.base_client import OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import RedirectResponse
from joserfc.errors import JoseError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.sessions import SessionMiddleware

from app.auth import service
from app.auth.deps import SESSION_COOKIE_NAME, get_current_user, get_db_session
from app.auth.models import User
from app.auth.oauth_common import OAUTH_TTL_SECONDS, private, safe_admin_path
from app.auth.routes import _set_session_cookie
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
        client_kwargs={"scope": "openid email", "code_challenge_method": "S256", "timeout": 10.0},
    )


def _failure(code: str) -> Response:
    return private(RedirectResponse(f"/admin/login?oauth_error={code}", status_code=303))


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


async def _authorized_user(db: AsyncSession, claims: dict) -> User:
    sub = claims.get("sub")
    email = claims.get("email")
    if (
        not isinstance(sub, str) or not sub or len(sub) > 255
        or claims.get("email_verified") is not True
        or not isinstance(email, str) or "@" not in email
    ):
        raise GoogleLoginRejected("unverified_email")

    user = (await db.execute(select(User).where(User.google_sub == sub).with_for_update())).scalar_one_or_none()
    if user is None:
        # Google is authoritative for Gmail and verified Workspace identities.
        # A third-party Google account's email_verified alone is not sufficient
        # proof of current mailbox ownership for automatic account linking.
        email = email.strip().lower()
        if email.rsplit("@", 1)[1] != "gmail.com" and not claims.get("hd"):
            raise GoogleLoginRejected("unsupported_account")
        user = (await db.execute(
            select(User).where(func.lower(User.email) == email).with_for_update()
        )).scalar_one_or_none()
        if user is None:
            raise GoogleLoginRejected("no_matching_account")
        if not user.is_active:
            raise GoogleLoginRejected("inactive", user.id)
        if user.google_sub is not None:
            # 已綁定另一個 Google 帳號（例如 Workspace 帳號重建過）：本人
            # 用密碼登入後在「我的帳號」解除綁定，再用 Google 登入即可。
            raise GoogleLoginRejected("linked_to_other_google", user.id)
        user.google_sub = sub
        await db.flush()
        await audit_service.log_action(
            db, actor_user_id=user.id, action="user.link_google", target_type="user", target_id=str(user.id)
        )
    if not user.is_active:
        raise GoogleLoginRejected("inactive", user.id)
    return user


@router.get("/google/callback", response_class=RedirectResponse, status_code=303)
async def google_callback(request: Request, db: AsyncSession = Depends(get_db_session)) -> Response:
    client = request.app.state.google_oauth
    if client is None:
        return _failure("unavailable")
    try:
        # callback 也算一次登入嘗試：握手 cookie 在有效期內可以重送，不計入
        # 來源限流的話，一個握手就能無限次打 Google、寫失敗稽核。
        await service.check_login_source_rate_limit(limiter(request), client_key(request))
    except service.LoginRateLimited:
        request.session.clear()
        return _failure("rate_limited")
    handshake_ok = False
    try:
        started = request.session.get("started_at", 0)
        state = request.query_params.get("state")
        state_data = request.session.get(f"_state_google_{state}") if state else None
        if not state_data or not 0 <= time.time() - started <= OAUTH_TTL_SECONDS:
            return _failure("failed")
        handshake_ok = True
        if request.query_params.get("error"):
            cancelled = request.query_params["error"] == "access_denied"
            await _audit_login_failure(db, "cancelled" if cancelled else "provider_error")
            return _failure("cancelled" if cancelled else "failed")
        if not request.query_params.get("code"):
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
        if claims.get("nonce") != state_data.get("data", {}).get("nonce"):
            await _audit_login_failure(db, "failed")
            return _failure("failed")
        user = await _authorized_user(db, claims)
        previous = request.cookies.get(SESSION_COOKIE_NAME)
        if previous:
            await service.revoke_session(db, previous)
        raw_token, _ = await service.create_session(db, user)
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
    except IntegrityError:
        # 兩個請求同時把同一個 Google 帳號綁到不同人，DB 唯一鍵擋下。
        await db.rollback()
        await _audit_login_failure(db, "not_allowed")
        return _failure("not_allowed")
    except (OAuthError, JoseError, httpx.HTTPError, ValueError, KeyError):
        await db.rollback()
        if handshake_ok:
            await _audit_login_failure(db, "failed")
        return _failure("failed")
    finally:
        request.session.clear()


@router.delete("/google/link", status_code=status.HTTP_204_NO_CONTENT)
async def google_unlink(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)
) -> Response:
    """本人解除 Google 綁定。之後用同 Email 的 Gmail／Workspace 帳號登入會
    重新綁定——這支主要給「Google 帳號重建過、舊綁定擋住新帳號」時用。
    解除綁定不看 Google 登入是否啟用：關掉設定後仍要能清掉舊綁定。"""
    if current_user.google_sub is not None:
        current_user.google_sub = None
        await db.flush()
        await audit_service.log_action(
            db, actor_user_id=current_user.id, action="user.unlink_google",
            target_type="user", target_id=str(current_user.id),
        )
        await db.commit()
    return private(Response(status_code=status.HTTP_204_NO_CONTENT))
