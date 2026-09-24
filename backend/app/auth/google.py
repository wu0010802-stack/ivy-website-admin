from __future__ import annotations

import time

import httpx
from authlib.integrations.base_client import OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from joserfc.errors import JoseError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.sessions import SessionMiddleware

from app.auth import service
from app.auth.deps import SESSION_COOKIE_NAME, get_db_session
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
        raise service.InvalidCredentials()

    user = (await db.execute(select(User).where(User.google_sub == sub).with_for_update())).scalar_one_or_none()
    if user is None:
        # Google is authoritative for Gmail and verified Workspace identities.
        # A third-party Google account's email_verified alone is not sufficient
        # proof of current mailbox ownership for automatic account linking.
        email = email.strip().lower()
        if email.rsplit("@", 1)[1] != "gmail.com" and not claims.get("hd"):
            raise service.InvalidCredentials()
        user = (await db.execute(
            select(User).where(func.lower(User.email) == email).with_for_update()
        )).scalar_one_or_none()
        if user is None or not user.is_active or user.google_sub is not None:
            raise service.InvalidCredentials()
        user.google_sub = sub
        await db.flush()
        await audit_service.log_action(
            db, actor_user_id=user.id, action="user.link_google", target_type="user", target_id=str(user.id)
        )
    if not user.is_active:
        raise service.AccountInactive()
    return user


@router.get("/google/callback", response_class=RedirectResponse, status_code=303)
async def google_callback(request: Request, db: AsyncSession = Depends(get_db_session)) -> Response:
    client = request.app.state.google_oauth
    if client is None:
        return _failure("unavailable")
    try:
        started = request.session.get("started_at", 0)
        state = request.query_params.get("state")
        state_data = request.session.get(f"_state_google_{state}") if state else None
        if not state_data or not 0 <= time.time() - started <= OAUTH_TTL_SECONDS:
            return _failure("failed")
        if request.query_params.get("error"):
            return _failure("cancelled" if request.query_params["error"] == "access_denied" else "failed")
        if not request.query_params.get("code"):
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
            return _failure("failed")
        user = await _authorized_user(db, claims)
        previous = request.cookies.get(SESSION_COOKIE_NAME)
        if previous:
            await service.revoke_session(db, previous)
        raw_token, _ = await service.create_session(db, user)
        await db.commit()
        response = RedirectResponse("/admin" + return_to, status_code=303)
        _set_session_cookie(response, request.app.state.settings, raw_token)
        return private(response)
    except (service.InvalidCredentials, service.AccountInactive, IntegrityError):
        await db.rollback()
        return _failure("not_allowed")
    except (OAuthError, JoseError, httpx.HTTPError, ValueError, KeyError):
        await db.rollback()
        return _failure("failed")
    finally:
        request.session.clear()
