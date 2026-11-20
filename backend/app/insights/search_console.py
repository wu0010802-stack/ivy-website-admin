"""Google Search Console 搜尋成效（docs/specs/2026-11-12-external-integrations-design.md §3）。

驗證：服務帳戶 access token（scope 唯讀）由 google_token.ServiceAccountToken 處理。查詢：searchAnalytics.query 四次（總計、搜尋字詞、頁面、裝置），
每次只問一個維度、最多 25 列（搜尋字詞 500 列，2026-11-20 分群用）；結果依「資源＋期間＋維度」快取 6 小時，同一份同時只向 Google 要一次。

access token、assertion、私鑰都只在記憶體與 Authorization 標頭／POST 本文，不進網址、log、例外、回應。"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Callable
from datetime import date, timezone
from urllib.parse import quote, urlsplit

import httpx

from app.config import GoogleServiceAccount, Settings
from app.insights.cache import Cached, TtlCache
from app.insights.google_token import ServiceAccountToken
from app.insights.http import SEARCH_CONSOLE_USER_AGENT, GoogleApiError, new_client, post_json
from app.insights.schemas import (
    SearchDeviceRowOut,
    SearchInsightsOut,
    SearchMetricsOut,
    SearchPageRowOut,
    SearchQueryGroupOut,
    SearchQueryRowOut,
)

logger = logging.getLogger("app.insights")

SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
QUERY_URL = "https://searchconsole.googleapis.com/webmasters/v3/sites/{site}/searchAnalytics/query"
ROW_LIMIT = 25
# 搜尋字詞多抓一些（2026-11-20 §5）：分群與「曝光多、點擊少」要看前 25 個以外的；表格照樣只列前 25 個。
QUERY_ROW_LIMIT = 500
MISSED_MIN_IMPRESSIONS = 20
MISSED_MAX_CTR = 0.02
MISSED_LIMIT = 10
QUERY_GROUPS = ("brand", "local", "category", "other")
_BRAND = re.compile(r"常春藤|ivy|(義華|明華|崇德).*幼|幼.*(義華|明華|崇德)", re.IGNORECASE)
# 高雄市 38 區（去掉「區」字）與「高雄」。
_LOCAL = re.compile(
    "高雄|楠梓|左營|鼓山|三民|鹽埕|前金|新興|苓雅|前鎮|旗津|小港|鳳山|林園|大寮|大樹|大社|仁武|鳥松|岡山|橋頭|燕巢|"
    "田寮|阿蓮|路竹|湖內|茄萣|永安|彌陀|梓官|旗山|美濃|六龜|甲仙|杉林|內門|茂林|桃源|那瑪夏"
)
_CATEGORY = re.compile("幼兒園|幼稚園|托嬰|托兒|幼幼班|小班|中班|大班|學前|課後|安親|雙語|美語|蒙特梭利|準公共|私幼|公幼|招生|學費|補助|入園|插班")


def query_group(text: str) -> str:
    """搜尋字詞分四群：brand＝找我們（常春藤、ivy、校名＋幼）、local＝帶高雄地名、category＝找園所但沒帶地名、other＝其他。"""
    if _BRAND.search(text):
        return "brand"
    if _LOCAL.search(text):
        return "local"
    if _CATEGORY.search(text):
        return "category"
    return "other"
RESULT_TTL_SECONDS = 6 * 3600
_QUERY_TEXT_LIMIT = 200
_DEVICES = {"MOBILE": "mobile", "DESKTOP": "desktop", "TABLET": "tablet"}

STEP_QUERY = "查詢 Search Console"


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
        self._auth = ServiceAccountToken(SCOPE, clock=lambda: self.clock())
        self._results: TtlCache[list[dict]] = TtlCache(RESULT_TTL_SECONDS, clock=lambda: self.clock())

    # ---- 查詢 ----

    async def _query(
        self, client: httpx.AsyncClient, settings: Settings, account: GoogleServiceAccount,
        start: date, end: date, dimension: str | None,
    ) -> Cached[list[dict]]:
        assert settings.google_sc_property
        prop = settings.google_sc_property
        key = (prop, start, end, dimension)

        async def fetch() -> list[dict]:
            token = await self._auth.get(client, account)
            limit = QUERY_ROW_LIMIT if dimension == "query" else ROW_LIMIT
            body = {"startDate": start.isoformat(), "endDate": end.isoformat(), "rowLimit": limit, "type": "web"}
            if dimension:
                body["dimensions"] = [dimension]
            status, data = await post_json(
                client, STEP_QUERY, QUERY_URL.format(site=quote(prop, safe="")),
                json=body, headers={"Authorization": f"Bearer {token}"},
            )
            if status == 401:
                # 權杖被撤銷或提早失效：丟掉它，下一次請求重新簽。
                self._auth.drop()
            if status != 200 or not isinstance(data, dict):
                raise GoogleApiError(STEP_QUERY, status=status)
            rows = data.get("rows", [])
            if not isinstance(rows, list):
                raise GoogleApiError(STEP_QUERY, status=status, reason="回應格式不對")
            return [row for row in rows if isinstance(row, dict)][:limit]

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
        all_queries = [
            SearchQueryRowOut(query=text[:_QUERY_TEXT_LIMIT], group=query_group(text), **_row_metrics(row))
            for row in query_rows.value if (text := _first_key(row))
        ]
        queries = all_queries[:ROW_LIMIT]
        missed = sorted(
            (row for row in all_queries if row.impressions >= MISSED_MIN_IMPRESSIONS and row.ctr < MISSED_MAX_CTR),
            key=lambda row: (-row.impressions, row.position, row.query),
        )[:MISSED_LIMIT]
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
            queries_seen=len(all_queries), query_groups=_group_totals(all_queries), missed_queries=missed,
        )


def _group_totals(rows: list[SearchQueryRowOut]) -> list[SearchQueryGroupOut]:
    """各群加總；排名用曝光加權平均（Google 自己算總排名也是這樣）。Google 不公開少數人搜的字詞，加總會比總數少。"""
    result = []
    for group in QUERY_GROUPS:
        members = [row for row in rows if row.group == group]
        clicks = sum(row.clicks for row in members)
        impressions = sum(row.impressions for row in members)
        result.append(SearchQueryGroupOut(
            group=group, queries=len(members), clicks=clicks, impressions=impressions,
            ctr=round(clicks / impressions, 4) if impressions else None,
            position=round(sum(row.position * row.impressions for row in members) / impressions, 1) if impressions else None,
        ))
    return result
