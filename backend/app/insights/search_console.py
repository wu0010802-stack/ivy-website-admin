"""Google Search Console 搜尋成效（docs/specs/2026-11-12-external-integrations-design.md §3）。

驗證：服務帳戶金鑰簽 RS256 JWT，向 oauth2.googleapis.com/token 換 access token（scope 唯讀），
token 放程序記憶體、過期前 5 分鐘就換新。查詢：searchAnalytics.query 四次（總計、搜尋字詞、頁面、裝置），
每次只問一個維度、最多 25 列；結果依「資源＋期間＋維度」快取 6 小時，同一份同時只向 Google 要一次。

access token、assertion、私鑰都只在記憶體與 Authorization 標頭／POST 本文，不進網址、log、例外、回應。"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timezone
from urllib.parse import quote, urlsplit

import httpx
from joserfc import jwt
from joserfc.jwk import RSAKey

from app.config import GoogleServiceAccount, Settings
from app.insights.cache import Cached, TtlCache
from app.insights.http import SEARCH_CONSOLE_USER_AGENT, GoogleApiError, new_client, post_json
from app.insights.schemas import (
    SearchDeviceRowOut,
    SearchInsightsOut,
    SearchMetricsOut,
    SearchPageRowOut,
    SearchQueryRowOut,
)

logger = logging.getLogger("app.insights")

SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
TOKEN_URL = "https://oauth2.googleapis.com/token"
QUERY_URL = "https://searchconsole.googleapis.com/webmasters/v3/sites/{site}/searchAnalytics/query"
ROW_LIMIT = 25
RESULT_TTL_SECONDS = 6 * 3600
# access token 通常 1 小時；過期前 5 分鐘就換，免得查到一半過期。
TOKEN_REFRESH_MARGIN_SECONDS = 300
_JWT_LIFETIME_SECONDS = 3600
_QUERY_TEXT_LIMIT = 200
_DEVICES = {"MOBILE": "mobile", "DESKTOP": "desktop", "TABLET": "tablet"}

STEP_TOKEN = "取得 Google 權杖"
STEP_SIGN = "簽署服務帳戶憑證"
STEP_QUERY = "查詢 Search Console"


@dataclass
class _Token:
    value: str
    client_email: str
    refresh_at: float


def _number(value: object, default: float = 0.0) -> float:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else default


def _row_metrics(row: dict) -> dict:
    return {
        "clicks": int(_number(row.get("clicks"))),
        "impressions": int(_number(row.get("impressions"))),
        "ctr": round(_number(row.get("ctr")), 4),
        "position": round(_number(row.get("position")), 1),
    }


def _first_key(row: dict) -> str | None:
    keys = row.get("keys")
    key = keys[0] if isinstance(keys, list) and keys else None
    return key if isinstance(key, str) else None


def _path_only(url: str) -> str | None:
    """頁面網址只留路徑：網域、查詢字串與 #片段都不回。不像網址的略過。"""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return parts.path or "/"


class SearchConsole:
    """一個程序一份（app.state.search_console）：權杖與結果快取都在這裡。clock 可由測試換成假時鐘。"""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self.clock = clock
        self._token: _Token | None = None
        self._token_lock = asyncio.Lock()
        self._results: TtlCache[list[dict]] = TtlCache(RESULT_TTL_SECONDS, clock=lambda: self.clock())

    # ---- 驗證 ----

    async def _access_token(self, client: httpx.AsyncClient, account: GoogleServiceAccount) -> str:
        async with self._token_lock:
            token = self._token
            if token and token.client_email == account.client_email and self.clock() < token.refresh_at:
                return token.value
            value, lifetime = await self._exchange(client, account)
            self._token = _Token(value, account.client_email, self.clock() + max(0.0, lifetime - TOKEN_REFRESH_MARGIN_SECONDS))
            return value

    def _drop_token(self) -> None:
        self._token = None

    async def _exchange(self, client: httpx.AsyncClient, account: GoogleServiceAccount) -> tuple[str, float]:
        issued = int(time.time())
        claims = {
            "iss": account.client_email,
            "scope": SCOPE,
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

    # ---- 查詢 ----

    async def _query(
        self, client: httpx.AsyncClient, settings: Settings, account: GoogleServiceAccount,
        start: date, end: date, dimension: str | None,
    ) -> Cached[list[dict]]:
        assert settings.google_sc_property
        prop = settings.google_sc_property
        key = (prop, start, end, dimension)

        async def fetch() -> list[dict]:
            token = await self._access_token(client, account)
            body = {"startDate": start.isoformat(), "endDate": end.isoformat(), "rowLimit": ROW_LIMIT, "type": "web"}
            if dimension:
                body["dimensions"] = [dimension]
            status, data = await post_json(
                client, STEP_QUERY, QUERY_URL.format(site=quote(prop, safe="")),
                json=body, headers={"Authorization": f"Bearer {token}"},
            )
            if status == 401:
                # 權杖被撤銷或提早失效：丟掉它，下一次請求重新簽。
                self._drop_token()
            if status != 200 or not isinstance(data, dict):
                raise GoogleApiError(STEP_QUERY, status=status)
            rows = data.get("rows", [])
            if not isinstance(rows, list):
                raise GoogleApiError(STEP_QUERY, status=status, reason="回應格式不對")
            return [row for row in rows if isinstance(row, dict)][:ROW_LIMIT]

        return await self._results.get(key, fetch)

    async def insights(
        self, settings: Settings, start: date, end: date, transport: httpx.AsyncBaseTransport | None = None
    ) -> SearchInsightsOut:
        """四次查詢都成功才回資料；任何一步失敗丟 GoogleApiError（已成功的那幾份仍留在快取）。"""
        account = settings.google_sc_service_account
        if account is None or not settings.google_sc_property:
            return SearchInsightsOut(configured=False)
        async with new_client(SEARCH_CONSOLE_USER_AGENT, transport) as client:
            total_rows = await self._query(client, settings, account, start, end, None)
            query_rows = await self._query(client, settings, account, start, end, "query")
            page_rows = await self._query(client, settings, account, start, end, "page")
            device_rows = await self._query(client, settings, account, start, end, "device")

        total = total_rows.value[0] if total_rows.value else None
        totals = SearchMetricsOut(
            clicks=int(_number(total.get("clicks"))) if total else 0,
            impressions=int(_number(total.get("impressions"))) if total else 0,
            ctr=round(_number(total.get("ctr")), 4) if total and _number(total.get("impressions")) > 0 else None,
            position=round(_number(total.get("position")), 1) if total and _number(total.get("impressions")) > 0 else None,
        )
        queries = [
            SearchQueryRowOut(query=text[:_QUERY_TEXT_LIMIT], **_row_metrics(row))
            for row in query_rows.value if (text := _first_key(row))
        ]
        pages = [
            SearchPageRowOut(page=path, **_row_metrics(row))
            for row in page_rows.value if (url := _first_key(row)) and (path := _path_only(url))
        ]
        devices = [
            SearchDeviceRowOut(device=_DEVICES[name], **_row_metrics(row))
            for row in device_rows.value if (name := _first_key(row)) in _DEVICES
        ]
        oldest = min(part.fetched_at for part in (total_rows, query_rows, page_rows, device_rows))
        return SearchInsightsOut(
            configured=True, start=start, end=end, as_of=oldest.astimezone(timezone.utc),
            totals=totals, queries=queries, pages=pages, devices=devices,
        )
