"""後台 LINE 登入。

LINE 的 ID token 沒有 email_verified，email 也要另外向 LINE 申請，所以只要
`openid`，身分一律以 LINE `sub` 認定。綁定只能在既有後台 session 內由本人
發起；首次登入不做任何 email 比對或自動綁定。
"""
from __future__ import annotations

import secrets
from urllib.parse import urlencode

import httpx
from authlib.oauth2.rfc7636 import create_s256_code_challenge
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from joserfc import jws, jwt
from joserfc.errors import JoseError
from joserfc.jwk import KeySet, OctKey
from joserfc.jwt import JWTClaimsRegistry
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.deps import SESSION_COOKIE_NAME, get_current_user, get_db_session
from app.auth.models import User
from app.auth.oauth_common import OAUTH_TTL_SECONDS, private, safe_admin_path
from app.auth.routes import _set_session_cookie
from app.auth.schemas import LineLinkStart
from app.common.ratelimit import client_key
from app.config import Settings
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1/auth", tags=["auth"])

AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize"
TOKEN_URL = "https://api.line.me/oauth2/v2.1/token"
JWKS_URL = "https://api.line.me/oauth2/v2.1/certs"
ISSUER = "https://access.line.me"
HANDSHAKE_COOKIE = "ivy_line_oauth"
HANDSHAKE_PATH = "/api/website/v1/auth/line"
HANDSHAKE_SALT = "ivy-line-oauth-handshake"


class LineOAuthError(Exception):
    """LINE 回應不完整或不可信；一律當登入失敗，不回顯細節。"""


class LineOAuth:
    def __init__(self, channel_id: str, channel_secret: str, redirect_uri: str) -> None:
        self.channel_id = channel_id
        self.channel_secret = channel_secret
        self.redirect_uri = redirect_uri
        # 測試注入 httpx.MockTransport；正式環境走預設網路。
        self.transport: httpx.AsyncBaseTransport | None = None

    def authorize_url(self, state: str, nonce: str, code_verifier: str) -> str:
        return AUTHORIZE_URL + "?" + urlencode({
            "response_type": "code",
            "client_id": self.channel_id,
            "redirect_uri": self.redirect_uri,
            "state": state,
            "scope": "openid",
            "nonce": nonce,
            "code_challenge": create_s256_code_challenge(code_verifier),
            "code_challenge_method": "S256",
        })

    async def fetch_subject(self, code: str, code_verifier: str, nonce: str) -> str:
        async with httpx.AsyncClient(transport=self.transport, timeout=10.0) as client:
            response = await client.post(TOKEN_URL, data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.redirect_uri,
                "client_id": self.channel_id,
                "client_secret": self.channel_secret,
                "code_verifier": code_verifier,
            })
            if response.status_code != 200:
                raise LineOAuthError()
            id_token = response.json().get("id_token")
            if not isinstance(id_token, str):
                raise LineOAuthError()
            key = await self._verification_key(client, id_token)
        token = jwt.decode(id_token, key, algorithms=["HS256", "ES256"])
        JWTClaimsRegistry(
            iss={"essential": True, "value": ISSUER},
            aud={"essential": True, "value": self.channel_id},
            exp={"essential": True},
            iat={"essential": True},
            nonce={"essential": True, "value": nonce},
        ).validate(token.claims)
        sub = token.claims.get("sub")
        if not isinstance(sub, str) or not sub or len(sub) > 255:
            raise LineOAuthError()
        return sub

    async def _verification_key(self, client: httpx.AsyncClient, id_token: str) -> OctKey | KeySet:
        # Web login 用 channel secret 簽 HS256；若 LINE 改發 ES256 就用公開 JWKS
        # 依 kid 驗。金鑰種類跟著演算法走，HMAC secret 不會被拿去驗非對稱簽章。
        alg = jws.extract_compact(id_token.encode()).headers().get("alg")
        if alg == "HS256":
            return OctKey.import_key(self.channel_secret)
        if alg == "ES256":
            response = await client.get(JWKS_URL)
            if response.status_code != 200:
                raise LineOAuthError()
            return KeySet.import_key_set(response.json())
        raise LineOAuthError()


def configure_line_oauth(app) -> None:
    settings: Settings = app.state.settings
    app.state.line_oauth = None
    if settings.line_oauth_enabled:
        app.state.line_oauth = LineOAuth(
            settings.line_channel_id, settings.line_channel_secret, settings.line_redirect_uri
        )


# 握手 cookie 只放 state／nonce／PKCE 與模式，簽章後 10 分鐘有效；真正的
# 後台登入仍是既有 DB session cookie。不用 SessionMiddleware，免得和 Google
# 的握手共用 scope["session"] 互相覆寫。
def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.session_secret, salt=HANDSHAKE_SALT)


def _cookie_options(settings: Settings) -> dict:
    return {
        "path": HANDSHAKE_PATH, "httponly": True, "samesite": "lax",
        "secure": settings.environment == "production",
    }


def _begin(request: Request, **handshake: str) -> tuple[str, str]:
    """回傳 (LINE 授權網址, 簽章後的握手 cookie 值)。"""
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    payload = {**handshake, "state": state, "nonce": nonce, "verifier": verifier}
    sealed = _serializer(request.app.state.settings).dumps(payload)
    return request.app.state.line_oauth.authorize_url(state, nonce, verifier), sealed


def _set_handshake(response: Response, settings: Settings, sealed: str) -> None:
    response.set_cookie(HANDSHAKE_COOKIE, sealed, max_age=OAUTH_TTL_SECONDS, **_cookie_options(settings))


def _load_handshake(request: Request) -> dict | None:
    raw = request.cookies.get(HANDSHAKE_COOKIE)
    if not raw:
        return None
    try:
        data = _serializer(request.app.state.settings).loads(raw, max_age=OAUTH_TTL_SECONDS)
    except BadSignature:
        return None
    if not isinstance(data, dict) or data.get("mode") not in {"login", "link"}:
        return None
    return data


def _login_failure(code: str) -> Response:
    return private(RedirectResponse(f"/admin/login?oauth_error={code}", status_code=303))


def _link_result(result: str) -> Response:
    return private(RedirectResponse(f"/admin/account?line_link={result}", status_code=303))


@router.get("/line/login", response_class=RedirectResponse, status_code=302)
async def line_login(request: Request, redirect: str | None = None) -> Response:
    if request.app.state.line_oauth is None:
        return _login_failure("line_unavailable")
    try:
        service.check_login_source_rate_limit(client_key(request))
    except service.LoginRateLimited:
        return _login_failure("rate_limited")
    url, sealed = _begin(request, mode="login", return_to=safe_admin_path(redirect))
    response = RedirectResponse(url, status_code=302)
    _set_handshake(response, request.app.state.settings, sealed)
    return private(response)


@router.post("/line/link", response_model=LineLinkStart)
async def line_link_start(
    request: Request, response: Response, current_user: User = Depends(get_current_user)
) -> LineLinkStart:
    private(response)
    if request.app.state.line_oauth is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LINE 登入尚未啟用")
    if current_user.line_sub is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="此帳號已綁定 LINE，請先解除綁定")
    url, sealed = _begin(request, mode="link", user_id=str(current_user.id))
    _set_handshake(response, request.app.state.settings, sealed)
    return LineLinkStart(authorize_url=url)


@router.delete("/line/link", status_code=status.HTTP_204_NO_CONTENT)
async def line_unlink(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)
) -> Response:
    # 解除綁定不看 LINE 是否啟用：關掉 LINE 設定後仍要能清掉舊綁定。
    if current_user.line_sub is not None:
        current_user.line_sub = None
        await db.flush()
        await audit_service.log_action(
            db, actor_user_id=current_user.id, action="user.unlink_line",
            target_type="user", target_id=str(current_user.id),
        )
        await db.commit()
    return private(Response(status_code=status.HTTP_204_NO_CONTENT))


@router.get("/line/callback", response_class=RedirectResponse, status_code=303)
async def line_callback(request: Request, db: AsyncSession = Depends(get_db_session)) -> Response:
    handshake = _load_handshake(request)
    response = await _complete(request, db, handshake)
    response.delete_cookie(HANDSHAKE_COOKIE, **_cookie_options(request.app.state.settings))
    return private(response)


async def _complete(request: Request, db: AsyncSession, handshake: dict | None) -> Response:
    linking = handshake is not None and handshake["mode"] == "link"

    def fail(kind: str) -> Response:
        return _link_result(kind) if linking else _login_failure(f"line_{kind}")

    client: LineOAuth | None = request.app.state.line_oauth
    if client is None:
        return fail("unavailable")
    state = request.query_params.get("state") or ""
    if handshake is None or not secrets.compare_digest(state.encode(), handshake["state"].encode()):
        return fail("failed")
    error = request.query_params.get("error")
    if error:
        return fail("cancelled" if error.lower() == "access_denied" else "failed")
    code = request.query_params.get("code")
    if not code:
        return fail("failed")
    try:
        sub = await client.fetch_subject(code, handshake["verifier"], handshake["nonce"])
    except (LineOAuthError, JoseError, httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        return fail("failed")
    if linking:
        return await _finish_link(request, db, handshake, sub)
    return await _finish_login(request, db, handshake, sub)


async def _finish_login(request: Request, db: AsyncSession, handshake: dict, sub: str) -> Response:
    user = (await db.execute(select(User).where(User.line_sub == sub))).scalar_one_or_none()
    if user is None or not user.is_active:
        return _login_failure("line_not_allowed")
    previous = request.cookies.get(SESSION_COOKIE_NAME)
    if previous:
        await service.revoke_session(db, previous)
    raw_token, _ = await service.create_session(db, user)
    await db.commit()
    response = RedirectResponse("/admin" + safe_admin_path(handshake.get("return_to")), status_code=303)
    _set_session_cookie(response, request.app.state.settings, raw_token)
    return response


async def _finish_link(request: Request, db: AsyncSession, handshake: dict, sub: str) -> Response:
    # 綁定必須落在發起綁定的同一位、仍有效的管理員 session 上。
    raw_session = request.cookies.get(SESSION_COOKIE_NAME)
    session = await service.get_session_by_token(db, raw_session) if raw_session else None
    if session is None or str(session.user_id) != handshake.get("user_id"):
        return _link_result("failed")
    user = (
        await db.execute(select(User).where(User.id == session.user_id).with_for_update())
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        return _link_result("failed")
    if user.line_sub == sub:
        return _link_result("linked")
    if user.line_sub is not None:
        return _link_result("already")
    if (await db.execute(select(User.id).where(User.line_sub == sub))).scalar_one_or_none():
        return _link_result("in_use")
    try:
        user.line_sub = sub
        await db.flush()
        await audit_service.log_action(
            db, actor_user_id=user.id, action="user.link_line", target_type="user", target_id=str(user.id)
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return _link_result("in_use")
    return _link_result("linked")
