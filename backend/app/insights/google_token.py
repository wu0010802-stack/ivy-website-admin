"""Google access token。

- ServiceAccountToken：服務帳戶（Search Console 與 GA4 共用；docs/specs/2026-11-16-ad-roi-design.md §6.1）。
  金鑰簽 RS256 JWT，向 oauth2.googleapis.com/token 換 access token；每個物件對應一個 scope。
- RefreshTokenAuth：Google 帳號的 OAuth refresh token（商家檔案、Keyword Planner；
  docs/specs/2026-11-25-business-profile-keyword-planner-design.md §3）。scope 在授權時就定了，這裡只換 access token。

兩者的 token 都放程序記憶體、過期前 5 分鐘就換新。access token、assertion、私鑰、refresh token、用戶端密鑰
都只在記憶體與 Authorization 標頭／POST 本文，不進網址、log、例外、回應。"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx
from joserfc import jwt
from joserfc.jwk import RSAKey

from app.config import GoogleServiceAccount, OAuthClient
from app.insights.http import GoogleApiError, post_json

TOKEN_URL = "https://oauth2.googleapis.com/token"
# access token 通常 1 小時；過期前 5 分鐘就換，免得查到一半過期。
TOKEN_REFRESH_MARGIN_SECONDS = 300
_JWT_LIFETIME_SECONDS = 3600

STEP_TOKEN = "取得 Google 權杖"
STEP_SIGN = "簽署服務帳戶憑證"


@dataclass
class _Token:
    value: str
    client_email: str
    refresh_at: float


def _number(value: object, default: float = 0.0) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else default


class ServiceAccountToken:
    """一個 scope 一份。clock 可由測試換成假時鐘。"""

    def __init__(self, scope: str, clock: Callable[[], float] = time.monotonic):
        self.scope = scope
        self.clock = clock
        self._token: _Token | None = None
        self._lock = asyncio.Lock()

    async def get(self, client: httpx.AsyncClient, account: GoogleServiceAccount) -> str:
        async with self._lock:
            token = self._token
            if token and token.client_email == account.client_email and self.clock() < token.refresh_at:
                return token.value
            value, lifetime = await self._exchange(client, account)
            self._token = _Token(value, account.client_email, self.clock() + max(0.0, lifetime - TOKEN_REFRESH_MARGIN_SECONDS))
            return value

    def drop(self) -> None:
        self._token = None

    async def _exchange(self, client: httpx.AsyncClient, account: GoogleServiceAccount) -> tuple[str, float]:
        issued = int(time.time())
        claims = {
            "iss": account.client_email,
            "scope": self.scope,
            "aud": TOKEN_URL,
            "iat": issued,
            "exp": issued + _JWT_LIFETIME_SECONDS,
        }
        header = {"alg": "RS256", "typ": "JWT", **({"kid": account.private_key_id} if account.private_key_id else {})}
        try:
            assertion = jwt.encode(header, claims, RSAKey.import_key(account.private_key), algorithms=["RS256"])
        except Exception:  # noqa: BLE001 — 金鑰格式不對的各種例外都可能帶出金鑰片段，一律只報固定字串。
            raise GoogleApiError(STEP_SIGN, reason="金鑰無法使用") from None
        status, data = await post_json(
            client, STEP_TOKEN, TOKEN_URL,
            data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        )
        if status != 200 or not isinstance(data, dict):
            raise GoogleApiError(STEP_TOKEN, status=status)
        token = data.get("access_token")
        if not isinstance(token, str) or not token:
            raise GoogleApiError(STEP_TOKEN, status=status, reason="回應格式不對")
        return token, _number(data.get("expires_in"), 3600.0)


STEP_REFRESH = "以 refresh token 取得 Google 權杖"


class RefreshTokenAuth:
    """一把 refresh token 一份。Google 回 400 invalid_grant（被撤銷、過期、OAuth 同意畫面還在「測試」時 7 天到期）
    只報「HTTP 400」，原因寫在後台說明與 deploy/README.md，不把 Google 的錯誤描述帶出來。"""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self.clock = clock
        self._token: tuple[str, str, float] | None = None  # (指紋, access token, 換新時間)
        self._lock = asyncio.Lock()

    async def get(self, client: httpx.AsyncClient, oauth: OAuthClient) -> str:
        async with self._lock:
            token = self._token
            if token and token[0] == oauth.fingerprint and self.clock() < token[2]:
                return token[1]
            status, data = await post_json(
                client, STEP_REFRESH, TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "client_id": oauth.client_id,
                    "client_secret": oauth.client_secret,
                    "refresh_token": oauth.refresh_token,
                },
            )
            if status != 200 or not isinstance(data, dict):
                raise GoogleApiError(STEP_REFRESH, status=status)
            value = data.get("access_token")
            if not isinstance(value, str) or not value:
                raise GoogleApiError(STEP_REFRESH, status=status, reason="回應格式不對")
            lifetime = _number(data.get("expires_in"), 3600.0)
            self._token = (oauth.fingerprint, value, self.clock() + max(0.0, lifetime - TOKEN_REFRESH_MARGIN_SECONDS))
            return value

    def drop(self) -> None:
        self._token = None
