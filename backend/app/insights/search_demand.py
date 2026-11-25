"""Keyword Planner 每月搜尋量（Google Ads API KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics）的同步
（2026-11-25，docs/specs/2026-11-25-business-profile-keyword-planner-design.md §5）。

- 驗證：可讀廣告帳戶的 Google 帳號的 OAuth refresh token（scope adwords）。存取等級綁在 OAuth 用戶端所屬的 Google Cloud
  專案（要 Basic 以上，Explorer 不能用 Keyword Planner）；開發者權杖 Google 已不看，設了才帶。
- 一個地區一次請求（後台的關鍵字最多 50 個，一次全送），請求之間隔 1.1 秒（Google：每個帳戶每秒 1 次）。語言繁體中文、
  只算 Google 搜尋，期間是最近 48 個整月（Google：「過去 4 年」）。
- Google 會把近似的字詞併成一列（closeVariants），所以回來的列數可能少於送出的關鍵字；比對時兩邊都轉小寫、空白合併。
  某月 monthlySearches 沒有值＝那個月量太少，存 NULL、不補 0；整個字詞沒有 keywordMetrics 就不存任何月份。
- 第一個地區（高雄市）失敗整輪算失敗；後面的區失敗只記在 last_error，已經成功的地區照寫。
- 權杖與 Google 回應內容都不進 log、例外、回應。"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.common.timezones import now_utc, today_local
from app.config import Settings
from app.insights import google_sync_status as sync_status
from app.insights.business_profile import add_months, month_start
from app.insights.google_token import RefreshTokenAuth
from app.insights.http import GOOGLE_ADS_USER_AGENT, GoogleApiError, new_client, post_json
from app.insights.models import (
    SEARCH_DEMAND_GEOS,
    SEARCH_DEMAND_LANGUAGE,
    GoogleSyncStatus,
    SearchKeyword,
    SearchKeywordVolume,
)

logger = logging.getLogger("app.insights.search_demand")

STATUS_KEY = "search_demand"
URL = "https://googleads.googleapis.com/{version}/customers/{customer}:generateKeywordHistoricalMetrics"
HISTORY_MONTHS = 48
REFRESH_EVERY = timedelta(days=7)
REQUEST_GAP_SECONDS = 1.1
STEP = "查詢 Keyword Planner"
_MALFORMED = "回應格式不對"
_MONTHS = (
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
)
_INT_MAX = 2**31 - 1

GEO_LABELS = {"kaohsiung": "高雄市", "sanmin": "三民區", "zuoying": "左營區"}


def normalize(text: str) -> str:
    """後台存的關鍵字與 Google 回來的字詞都這樣比：小寫、空白合併。"""
    return " ".join(text.lower().split())


def month_range(today: date) -> tuple[date, date]:
    """最近 48 個整月（不含本月）。"""
    end = add_months(month_start(today), -1)
    return add_months(end, -(HISTORY_MONTHS - 1)), end


def _year_month(day: date) -> dict[str, str]:
    return {"year": str(day.year), "month": _MONTHS[day.month - 1]}


def request_body(keywords: list[str], geo: str, start: date, end: date) -> dict:
    return {
        "keywords": keywords,
        "language": SEARCH_DEMAND_LANGUAGE,
        "geoTargetConstants": [geo],
        "keywordPlanNetwork": "GOOGLE_SEARCH",
        "historicalMetricsOptions": {"yearMonthRange": {"start": _year_month(start), "end": _year_month(end)}},
    }


def _searches(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(value)
    number = int(value)  # type: ignore[arg-type]
    if number < 0 or number > _INT_MAX:
        raise ValueError(value)
    return number


def parse_results(data: object, status: int = 200) -> dict[str, dict[date, int | None]]:
    """回應 → {正規化的字詞: {月: 搜尋量或 None}}。closeVariants 裡的字詞也對到同一份數字。沒有 keywordMetrics 的字詞
    對到空 dict（Google 有回這個字，但沒有任何月份的數字）。"""
    if not isinstance(data, dict):
        raise GoogleApiError(STEP, status=status, reason=_MALFORMED)
    results = data.get("results", [])
    if not isinstance(results, list):
        raise GoogleApiError(STEP, status=status, reason=_MALFORMED)
    out: dict[str, dict[date, int | None]] = {}
    try:
        for result in results:
            months: dict[date, int | None] = {}
            metrics = result.get("keywordMetrics") or {}
            for item in metrics.get("monthlySearchVolumes") or []:
                month_name = item["month"]
                if month_name not in _MONTHS:
                    continue
                months[date(int(item["year"]), _MONTHS.index(month_name) + 1, 1)] = _searches(item.get("monthlySearches"))
            for text in [result.get("text"), *(result.get("closeVariants") or [])]:
                if isinstance(text, str) and text.strip():
                    out.setdefault(normalize(text), months)
    except (AttributeError, KeyError, TypeError, ValueError):
        raise GoogleApiError(STEP, status=status, reason=_MALFORMED) from None
    return out


@dataclass
class SearchDemandResult:
    outcome: str  # synced／skipped／failed
    keywords: int = 0
    geos: list[str] = field(default_factory=list)
    error: str | None = None


def _due(status: GoogleSyncStatus | None, pending: bool, now: datetime) -> bool:
    if sync_status.waiting_to_retry(status, now):
        return False
    if pending or status is None or status.last_success_at is None:
        return True
    return now - status.last_success_at >= REFRESH_EVERY


async def _query(
    client: httpx.AsyncClient, auth: RefreshTokenAuth, settings: Settings, keywords: list[str], geo: str,
    start: date, end: date,
) -> dict[str, dict[date, int | None]]:
    oauth = settings.google_ads_oauth
    assert oauth is not None and settings.google_ads_customer_id
    token = await auth.get(client, oauth)
    headers = {"Authorization": f"Bearer {token}"}
    if settings.google_ads_login_customer_id:
        headers["login-customer-id"] = settings.google_ads_login_customer_id
    if settings.google_ads_developer_token:
        headers["developer-token"] = settings.google_ads_developer_token
    url = URL.format(version=settings.google_ads_api_version, customer=settings.google_ads_customer_id)
    status, data = await post_json(client, STEP, url, json=request_body(keywords, geo, start, end), headers=headers)
    if status == 401:
        auth.drop()
    if status != 200:
        raise GoogleApiError(STEP, status=status)
    return parse_results(data, status)


async def sync_search_demand(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    auth: RefreshTokenAuth,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    now: datetime | None = None,
    force: bool = False,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> SearchDemandResult:
    """有關鍵字、而且到期（從沒成功、超過 7 天、或有還沒同步過的新關鍵字）才向 Google 要。"""
    if not settings.google_ads_enabled:
        return SearchDemandResult("skipped")
    now = now or now_utc()
    async with session_factory() as db:
        keywords = list((await db.execute(select(SearchKeyword).order_by(SearchKeyword.created_at))).scalars())
        if not keywords:
            return SearchDemandResult("skipped")
        status = await db.get(GoogleSyncStatus, STATUS_KEY)
        pending = any(keyword.synced_at is None for keyword in keywords)
        if not force and not _due(status, pending, now):
            return SearchDemandResult("skipped")
        await sync_status.mark_attempt(db, STATUS_KEY, now)
        await db.commit()
    texts = [keyword.text for keyword in keywords]
    ids = {keyword.id: normalize(keyword.text) for keyword in keywords}
    start, end = month_range(today_local(now))

    by_geo: dict[str, dict[str, dict[date, int | None]]] = {}
    geo_errors: list[str] = []
    try:
        async with new_client(GOOGLE_ADS_USER_AGENT, transport) as client:
            for index, (geo_key, geo) in enumerate(SEARCH_DEMAND_GEOS.items()):
                if index:
                    await sleep(REQUEST_GAP_SECONDS)
                try:
                    by_geo[geo_key] = await _query(client, auth, settings, texts, geo, start, end)
                except GoogleApiError as exc:
                    if index == 0:
                        raise
                    geo_errors.append(f"{GEO_LABELS.get(geo_key, geo_key)}：{exc}")
    except GoogleApiError as exc:
        logger.warning("Keyword Planner 同步失敗：%s", exc)
        async with session_factory() as db:
            await sync_status.mark_failure(db, STATUS_KEY, str(exc))
            await db.commit()
        return SearchDemandResult("failed", error=str(exc))

    async with session_factory() as db:
        # 同步期間被刪掉的關鍵字不再寫（外鍵會擋）；只寫現在還在的。
        alive = set((await db.execute(select(SearchKeyword.id).where(SearchKeyword.id.in_(list(ids))))).scalars())
        for geo_key, results in by_geo.items():
            await db.execute(delete(SearchKeywordVolume).where(
                SearchKeywordVolume.keyword_id.in_(list(alive)), SearchKeywordVolume.geo == geo_key,
                SearchKeywordVolume.month >= start, SearchKeywordVolume.month <= end,
            ))
            rows = [
                {"keyword_id": keyword_id, "geo": geo_key, "month": month, "searches": searches}
                for keyword_id, text in ids.items() if keyword_id in alive
                for month, searches in sorted((results.get(text) or {}).items())
                if start <= month <= end
            ]
            for offset in range(0, len(rows), 2000):
                stmt = pg_insert(SearchKeywordVolume).values(rows[offset:offset + 2000])
                await db.execute(stmt.on_conflict_do_update(
                    index_elements=["keyword_id", "geo", "month"], set_={"searches": stmt.excluded.searches}
                ))
        await db.execute(update(SearchKeyword).where(SearchKeyword.id.in_(list(alive))).values(synced_at=now))
        await sync_status.mark_success(db, STATUS_KEY, now, note="；".join(geo_errors) or None)
        await db.commit()
    return SearchDemandResult("synced", keywords=len(alive), geos=list(by_geo), error="；".join(geo_errors) or None)
