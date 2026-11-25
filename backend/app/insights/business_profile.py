"""Google 商家檔案（Business Profile Performance API v1）每日指標與每月搜尋字詞的同步
（2026-11-25，docs/specs/2026-11-25-business-profile-keyword-planner-design.md §4）。

- 驗證：管理員 Google 帳號的 OAuth refresh token（scope business.manage；Google 文件只寫了使用者授權，服務帳戶
  加成管理員的做法沒有官方說明），由 google_token.RefreshTokenAuth 換 access token。
- 每日指標：fetchMultiDailyMetricsTimeSeries 一次要全部指標。第一次往回抓約 18 個月（Google 沒寫保留多久：每 3 個月
  一段、由新到舊，較舊的段落回 400 就當作已經到頭）；之後每天從已存的最後一天往前 7 天重抓到昨天（晚到的數字會補上）。
  Google 沒給值的日子是 0（文件：「值為 0 時不會出現」）。
- 搜尋字詞：searchkeywords/impressions/monthly 的期間是「整段加總」，所以一個月叫一次。最近兩個整月每天重抓，更早的
  抓過就不再抓（記在 gbp_keyword_months）。
- 地點、權杖、Google 回應內容都不進 log、例外、回應；錯誤只有「哪一步、HTTP 幾號」。"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from urllib.parse import quote

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.common.timezones import now_utc, today_local
from app.insights import google_sync_status as sync_status
from app.insights.google_token import RefreshTokenAuth
from app.insights.http import BUSINESS_PROFILE_USER_AGENT, GoogleApiError, get_json, new_client
from app.insights.models import (
    GBP_KEYWORD_MAX,
    GBP_METRICS,
    GbpDailyMetric,
    GbpKeywordMonth,
    GbpMonthlyKeyword,
    GoogleSyncStatus,
)

logger = logging.getLogger("app.insights.business_profile")

BASE_URL = "https://businessprofileperformance.googleapis.com/v1/locations/{location}"
DAILY_URL = BASE_URL + ":fetchMultiDailyMetricsTimeSeries"
KEYWORDS_URL = BASE_URL + "/searchkeywords/impressions/monthly"

HISTORY_MONTHS = 18
CHUNK_MONTHS = 3
REFETCH_DAYS = 7
KEYWORD_REFETCH_MONTHS = 2
KEYWORD_PAGE_SIZE = 100  # Google 的上限
KEYWORD_MAX_PAGES = 10
_INT_MAX = 2**31 - 1

STEP_DAILY = "查詢商家檔案每日指標"
STEP_KEYWORDS = "查詢商家檔案搜尋字詞"
_MALFORMED = "回應格式不對"


def status_key(campus_key: str) -> str:
    return f"gbp:{campus_key}"


def month_start(day: date) -> date:
    return day.replace(day=1)


def add_months(month: date, delta: int) -> date:
    index = month.year * 12 + month.month - 1 + delta
    return date(index // 12, index % 12 + 1, 1)


def _int(value: object, step: str, status: int) -> int:
    """Google 的 int64 在 JSON 裡是字串；超出 32 位元或負數都當成回應異常。"""
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise GoogleApiError(step, status=status, reason=_MALFORMED) from None
    if isinstance(value, bool) or number < 0 or number > _INT_MAX:
        raise GoogleApiError(step, status=status, reason=_MALFORMED)
    return number


def parse_daily(data: object, status: int = 200) -> dict[tuple[date, str], int]:
    """fetchMultiDailyMetricsTimeSeries 的回應 → {(日, 指標代碼): 值}。不認得的指標略過；沒有 value 的日子是 0。"""
    if not isinstance(data, dict):
        raise GoogleApiError(STEP_DAILY, status=status, reason=_MALFORMED)
    out: dict[tuple[date, str], int] = {}
    blocks = data.get("multiDailyMetricTimeSeries", [])
    if not isinstance(blocks, list):
        raise GoogleApiError(STEP_DAILY, status=status, reason=_MALFORMED)
    try:
        for block in blocks:
            for item in block.get("dailyMetricTimeSeries", []):
                metric = GBP_METRICS.get(item.get("dailyMetric"))
                if metric is None:
                    continue
                for point in (item.get("timeSeries") or {}).get("datedValues") or []:
                    raw = point["date"]
                    day = date(int(raw["year"]), int(raw["month"]), int(raw["day"]))
                    out[(day, metric)] = _int(point.get("value", "0"), STEP_DAILY, status)
    except (AttributeError, KeyError, TypeError, ValueError):
        raise GoogleApiError(STEP_DAILY, status=status, reason=_MALFORMED) from None
    return out


@dataclass(frozen=True)
class KeywordCount:
    keyword: str
    impressions: int | None  # 確切的曝光次數
    below: int | None  # Google 只說「少於 N」


def parse_keywords(data: object, status: int = 200) -> tuple[list[KeywordCount], str | None]:
    """一頁搜尋字詞 → (字詞清單, 下一頁的 token)。同一個字詞（截斷後）出現兩次時留數字大的。"""
    if not isinstance(data, dict):
        raise GoogleApiError(STEP_KEYWORDS, status=status, reason=_MALFORMED)
    rows = data.get("searchKeywordsCounts", [])
    token = data.get("nextPageToken")
    if not isinstance(rows, list) or (token is not None and not isinstance(token, str)):
        raise GoogleApiError(STEP_KEYWORDS, status=status, reason=_MALFORMED)
    out: list[KeywordCount] = []
    try:
        for row in rows:
            text = " ".join(str(row["searchKeyword"]).split())[:GBP_KEYWORD_MAX]
            if not text:
                continue
            value = row.get("insightsValue") or {}
            if "value" in value:
                out.append(KeywordCount(text, _int(value["value"], STEP_KEYWORDS, status), None))
            elif "threshold" in value:
                out.append(KeywordCount(text, None, _int(value["threshold"], STEP_KEYWORDS, status)))
    except (AttributeError, KeyError, TypeError):
        raise GoogleApiError(STEP_KEYWORDS, status=status, reason=_MALFORMED) from None
    return out, token or None


def merge_keywords(rows: list[KeywordCount]) -> list[KeywordCount]:
    """截斷或空白正規化後可能撞名：確切值優先、數字大的優先。"""
    best: dict[str, KeywordCount] = {}
    for row in rows:
        previous = best.get(row.keyword)
        if previous is None or _rank(row) > _rank(previous):
            best[row.keyword] = row
    return list(best.values())


def _rank(row: KeywordCount) -> tuple[int, int]:
    return (1, row.impressions or 0) if row.impressions is not None else (0, row.below or 0)


def _date_params(prefix: str, day: date) -> list[tuple[str, str]]:
    return [(f"{prefix}.year", str(day.year)), (f"{prefix}.month", str(day.month)), (f"{prefix}.day", str(day.day))]


async def _get(client: httpx.AsyncClient, auth: RefreshTokenAuth, step: str, url: str, params: list[tuple[str, str]],
               token: str) -> tuple[int, object]:
    status, data = await get_json(client, step, url, params=params, headers={"Authorization": f"Bearer {token}"})
    if status == 401:
        auth.drop()
    return status, data


async def fetch_daily(
    client: httpx.AsyncClient, auth: RefreshTokenAuth, token: str, location: str, start: date, end: date
) -> dict[tuple[date, str], int]:
    params = [("dailyMetrics", name) for name in GBP_METRICS]
    params += _date_params("dailyRange.startDate", start) + _date_params("dailyRange.endDate", end)
    status, data = await _get(client, auth, STEP_DAILY, DAILY_URL.format(location=quote(location, safe="")), params, token)
    if status != 200:
        raise GoogleApiError(STEP_DAILY, status=status)
    return parse_daily(data, status)


async def fetch_keywords(
    client: httpx.AsyncClient, auth: RefreshTokenAuth, token: str, location: str, month: date
) -> list[KeywordCount]:
    base = [
        ("monthlyRange.startMonth.year", str(month.year)), ("monthlyRange.startMonth.month", str(month.month)),
        ("monthlyRange.endMonth.year", str(month.year)), ("monthlyRange.endMonth.month", str(month.month)),
        ("pageSize", str(KEYWORD_PAGE_SIZE)),
    ]
    rows: list[KeywordCount] = []
    page_token: str | None = None
    for _ in range(KEYWORD_MAX_PAGES):
        params = base + ([("pageToken", page_token)] if page_token else [])
        url = KEYWORDS_URL.format(location=quote(location, safe=""))
        status, data = await _get(client, auth, STEP_KEYWORDS, url, params, token)
        if status != 200:
            raise GoogleApiError(STEP_KEYWORDS, status=status)
        page, page_token = parse_keywords(data, status)
        rows.extend(page)
        if not page_token:
            break
    return merge_keywords(rows)


@dataclass
class _Plan:
    daily_start: date
    daily_end: date
    backfill: bool
    keyword_months: list[date]
    recent_months: set[date]


@dataclass
class _Fetched:
    daily: dict[tuple[date, str], int] = field(default_factory=dict)
    keywords: dict[date, list[KeywordCount]] = field(default_factory=dict)


@dataclass(frozen=True)
class LocationSyncResult:
    campus_key: str
    outcome: str  # synced／skipped／failed
    days: int = 0
    keyword_months: int = 0
    error: str | None = None


async def _plan(db: AsyncSession, campus_key: str, today: date) -> _Plan | None:
    yesterday = today - timedelta(days=1)
    latest = (
        await db.execute(select(func.max(GbpDailyMetric.day)).where(GbpDailyMetric.campus_key == campus_key))
    ).scalar_one_or_none()
    history_start = add_months(month_start(today), -HISTORY_MONTHS)
    backfill = latest is None
    start = history_start if backfill else max(history_start, latest - timedelta(days=REFETCH_DAYS - 1))
    if start > yesterday:
        return None
    last_complete = add_months(month_start(today), -1)
    fetched = set(
        (await db.execute(select(GbpKeywordMonth.month).where(GbpKeywordMonth.campus_key == campus_key))).scalars()
    )
    recent = {add_months(last_complete, -offset) for offset in range(KEYWORD_REFETCH_MONTHS)}
    months = []
    month = history_start
    while month <= last_complete:
        if month in recent or month not in fetched:
            months.append(month)
        month = add_months(month, 1)
    return _Plan(start, yesterday, backfill, months, recent)


async def _fetch(
    client: httpx.AsyncClient, auth: RefreshTokenAuth, token: str, location: str, plan: _Plan
) -> _Fetched:
    fetched = _Fetched()
    # 每日指標：每段最多 3 個月，由新到舊。第一次往回補時，較舊的一段回 400 就當作 Google 只有到那裡，停在這裡。
    chunk_end = plan.daily_end
    newest = True
    while chunk_end >= plan.daily_start:
        chunk_start = max(plan.daily_start, add_months(month_start(chunk_end), -(CHUNK_MONTHS - 1)))
        try:
            fetched.daily.update(await fetch_daily(client, auth, token, location, chunk_start, chunk_end))
        except GoogleApiError as exc:
            if plan.backfill and not newest and exc.status == 400:
                break
            raise
        newest = False
        chunk_end = chunk_start - timedelta(days=1)
    # 搜尋字詞：一個月一次，由新到舊；比最近兩個整月舊的月份回 400 也當作超出範圍（記成抓過、沒有字詞）。
    for month in sorted(plan.keyword_months, reverse=True):
        try:
            fetched.keywords[month] = await fetch_keywords(client, auth, token, location, month)
        except GoogleApiError as exc:
            if month not in plan.recent_months and exc.status == 400:
                fetched.keywords[month] = []
                continue
            raise
    return fetched


async def _store(db: AsyncSession, campus_key: str, fetched: _Fetched, now: datetime) -> None:
    if fetched.daily:
        rows = [
            {"campus_key": campus_key, "day": day, "metric": metric, "value": value}
            for (day, metric), value in sorted(fetched.daily.items())
        ]
        for offset in range(0, len(rows), 2000):
            stmt = pg_insert(GbpDailyMetric).values(rows[offset:offset + 2000])
            await db.execute(stmt.on_conflict_do_update(
                index_elements=["campus_key", "day", "metric"], set_={"value": stmt.excluded.value}
            ))
    for month, keywords in fetched.keywords.items():
        await db.execute(
            delete(GbpMonthlyKeyword).where(GbpMonthlyKeyword.campus_key == campus_key, GbpMonthlyKeyword.month == month)
        )
        if keywords:
            await db.execute(pg_insert(GbpMonthlyKeyword).values([
                {"campus_key": campus_key, "month": month, "keyword": row.keyword, "impressions": row.impressions,
                 "below": row.below}
                for row in keywords
            ]))
        stmt = pg_insert(GbpKeywordMonth).values(campus_key=campus_key, month=month, fetched_at=now)
        await db.execute(stmt.on_conflict_do_update(
            index_elements=["campus_key", "month"], set_={"fetched_at": stmt.excluded.fetched_at}
        ))


def _due(status: GoogleSyncStatus | None, now: datetime) -> bool:
    if sync_status.waiting_to_retry(status, now):
        return False
    if status is None or status.last_success_at is None:
        return True
    return today_local(status.last_success_at) < today_local(now)


async def sync_business_profile(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    auth: RefreshTokenAuth,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    now: datetime | None = None,
    force: bool = False,
    campus_keys: list[str] | None = None,
) -> list[LocationSyncResult]:
    """每個設定的地點各自同步、各自記狀態（一校失敗不影響別校）。force＝不看「今天同步過沒」與失敗後的等待（CLI 用）。"""
    oauth = settings.gbp_oauth
    if oauth is None:
        return []
    now = now or now_utc()
    today = today_local(now)
    results: list[LocationSyncResult] = []
    for campus_key, location in settings.gbp_location_ids.items():
        if campus_keys is not None and campus_key not in campus_keys:
            continue
        key = status_key(campus_key)
        async with session_factory() as db:
            status = await db.get(GoogleSyncStatus, key)
            if not force and not _due(status, now):
                results.append(LocationSyncResult(campus_key, "skipped"))
                continue
            plan = await _plan(db, campus_key, today)
            await sync_status.mark_attempt(db, key, now)
            await db.commit()
        try:
            if plan is None:
                fetched = _Fetched()
            else:
                async with new_client(BUSINESS_PROFILE_USER_AGENT, transport) as client:
                    token = await auth.get(client, oauth)
                    fetched = await _fetch(client, auth, token, location, plan)
        except GoogleApiError as exc:
            logger.warning("商家檔案同步失敗（%s）：%s", campus_key, exc)
            async with session_factory() as db:
                await sync_status.mark_failure(db, key, str(exc))
                await db.commit()
            results.append(LocationSyncResult(campus_key, "failed", error=str(exc)))
            continue
        async with session_factory() as db:
            await _store(db, campus_key, fetched, now)
            await sync_status.mark_success(db, key, now)
            await db.commit()
        days = len({day for day, _ in fetched.daily})
        results.append(LocationSyncResult(campus_key, "synced", days=days, keyword_months=len(fetched.keywords)))
    return results
