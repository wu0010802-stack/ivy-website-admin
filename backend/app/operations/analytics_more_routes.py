"""成效統計補強的端點（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md）。

讀取（後台）：每月比較、統計健康檢查、找不到的網址、爬蟲、電話與 LINE 的點擊時段。和其他成效統計一樣是全站匿名彙總，
登入的後台帳號都看得到；只有「實際預約數」比照招生統計要 admissions.stats 且在校區範圍內。
寫入（只給官網伺服器內部轉送，代理 web/server/routes/api/website/v1/[...].ts 擋掉直接打的）：
訪客瀏覽器回報的 404、官網伺服器每分鐘彙總的爬蟲次數。"""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import covers_campus, has_capability
from app.campuses.models import CAMPUS_KEYS
from app.common import ratelimit
from app.common.timezones import now_utc
from app.operations import contact_hours_service, crawler_service, monthly_service, public_caps, stats_health
from app.operations.models import NOT_FOUND_PATH_MAX
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/api/website/v1", tags=["operations"])

Days = Annotated[int, Query(ge=7, le=90)]


def _booking_campuses(user: User) -> frozenset[str]:
    return frozenset(key for key in CAMPUS_KEYS if has_capability(user, "admissions.stats") and covers_campus(user, key))


# ---------------------------------------------------------------------------------------------- 寫入

NOT_FOUND_LIMIT = ratelimit.Limit("not_found", window_seconds=60, max_per_window=30)


class NotFoundIn(BaseModel):
    """與 web/shared/telemetry.ts 的 validateNotFound 同一套規則。"""

    model_config = ConfigDict(extra="forbid")

    event: Literal["not_found"]
    path: Annotated[str, StringConstraints(min_length=1, max_length=NOT_FOUND_PATH_MAX, pattern=r"^/[^\x00-\x1f\x7f?#]*$")]
    ref: Literal["none", "internal", "search", "external"]


@router.post("/public/not-found", status_code=status.HTTP_204_NO_CONTENT)
async def record_not_found(
    payload: NotFoundIn,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    # 和瀏覽量共用全站／每來源每日上限（滿了安靜丟棄），另有單一來源每分鐘 30 筆。
    trusted = ratelimit.client_key(request) if ratelimit.trusted_client_ip(request) else None
    try:
        admitted = await public_caps.admit(
            ratelimit.limiter(request), public_caps.telemetry_limits(request.app.state.settings, trusted),
            gate=(NOT_FOUND_LIMIT, ratelimit.client_key(request)),
        )
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="請求太頻繁",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    if not admitted:
        return
    await crawler_service.record_not_found(db, [(payload.path, payload.ref, 1)])
    await db.commit()


CrawlerBot = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,32}$")]
CrawlerPage = Annotated[str, StringConstraints(pattern=r"^[a-z]{1,16}$")]


class CrawlerHitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bot: CrawlerBot
    page: CrawlerPage
    status: Literal["2xx", "3xx", "4xx", "5xx"]
    hits: int = Field(ge=1, le=100_000)


class CrawlerNotFoundIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: Annotated[str, StringConstraints(min_length=1, max_length=NOT_FOUND_PATH_MAX, pattern=r"^/[^\x00-\x1f\x7f?#]*$")]
    hits: int = Field(ge=1, le=100_000)


class CrawlerBatchIn(BaseModel):
    """官網伺服器一分鐘的彙總（web/server/plugins/crawler-hits.ts）。"""

    model_config = ConfigDict(extra="forbid")

    hits: list[CrawlerHitIn] = Field(max_length=500)
    not_found: list[CrawlerNotFoundIn] = Field(default_factory=list, max_length=200)


CRAWLER_BATCH_LIMIT = ratelimit.Limit("crawler_batch", window_seconds=60, max_per_window=10)


@router.post("/public/crawler-hits", status_code=status.HTTP_204_NO_CONTENT)
async def record_crawler_hits(
    payload: CrawlerBatchIn,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    # 正常一分鐘一批；被直接灌的話每分鐘最多 10 批（來源都是官網伺服器）。
    try:
        await ratelimit.limiter(request).check(CRAWLER_BATCH_LIMIT, "web")
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="請求太頻繁",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    await crawler_service.record_crawler_hits(db, [(row.bot, row.page, row.status, row.hits) for row in payload.hits])
    if payload.not_found:
        await crawler_service.record_not_found(db, [(row.path, "crawler", row.hits) for row in payload.not_found])
    await db.commit()


# ---------------------------------------------------------------------------------------------- 每月比較

class MonthlyRowOut(BaseModel):
    key: str
    sessions: int
    visits: int
    booked_sessions: int
    median_ms: int | None


class MonthlyOut(BaseModel):
    month: str
    first_day: date | None
    last_day: date | None
    complete: bool
    page_views: int
    # 沒有招生統計權限（或範圍內沒有任何一校）時是 None。
    bookings: int | None
    # 這個月沒有內容興趣彙總（例如內容興趣開始記錄前）時下面幾欄是 None／空的。
    sessions: int | None
    visits: int | None
    booked_sessions: int | None
    median_session_ms: int | None
    devices: list[MonthlyRowOut]
    sources: list[MonthlyRowOut]
    returning: list[MonthlyRowOut]
    pages: list[MonthlyRowOut]
    form: list[MonthlyRowOut]
    computed_at: datetime | None


class MonthlySummaryOut(BaseModel):
    months: list[MonthlyOut]
    stats_start: date | None
    as_of: datetime


@router.get("/admin/analytics/monthly", response_model=MonthlySummaryOut)
async def get_monthly(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    stats_start = request.app.state.settings.analytics_stats_start
    summary = await monthly_service.get_monthly(db, _booking_campuses(current_user), stats_start)
    return {**summary, "stats_start": stats_start, "as_of": now_utc()}


# ---------------------------------------------------------------------------------------------- 健康檢查

class HealthIssueOut(BaseModel):
    key: Literal["traffic_zero", "engagement_low", "attribution_missing", "ga4_silent"]
    day: date
    message: str


class StatsHealthOut(BaseModel):
    day: date
    issues: list[HealthIssueOut]
    as_of: datetime


@router.get("/admin/analytics/health", response_model=StatsHealthOut)
async def get_stats_health(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    day, issues = await stats_health.check(db, request.app.state.settings, ga4=request.app.state.ga4_ads)
    return {
        "day": day,
        "issues": [{"key": issue.key, "day": issue.day, "message": issue.message} for issue in issues],
        "as_of": now_utc(),
    }


# ---------------------------------------------------------------------------------------------- 404 與爬蟲

NotFoundRef = Literal["none", "internal", "search", "external", "crawler"]


class NotFoundRefOut(BaseModel):
    ref: NotFoundRef
    hits: int


class NotFoundPathOut(BaseModel):
    path: str
    hits: int
    visitor_hits: int
    refs: list[NotFoundRefOut]
    last_day: date


class NotFoundSummaryOut(BaseModel):
    days: int
    since: date
    until: date
    paths_total: int
    totals: list[NotFoundRefOut]
    paths: list[NotFoundPathOut]
    as_of: datetime


@router.get("/admin/analytics/not-found", response_model=NotFoundSummaryOut)
async def get_not_found(
    request: Request,
    days: Days = 28,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    summary = await crawler_service.get_not_found(db, days, request.app.state.settings.analytics_stats_start)
    return {**summary, "as_of": now_utc()}


CrawlerGroup = Literal["ai_user", "ai_search", "ai_train", "search", "social", "seo", "monitor", "other"]


class CrawlerPageOut(BaseModel):
    page: str
    hits: int


class CrawlerBotOut(BaseModel):
    bot: str
    group: CrawlerGroup
    hits: int
    errors: int
    pages: list[CrawlerPageOut]
    last_day: date


class CrawlerGroupOut(BaseModel):
    group: CrawlerGroup
    hits: int
    bots: list[CrawlerBotOut]
    pages: list[CrawlerPageOut]


class CrawlerSummaryOut(BaseModel):
    days: int
    since: date
    until: date
    hits: int
    groups: list[CrawlerGroupOut]
    as_of: datetime


@router.get("/admin/analytics/crawlers", response_model=CrawlerSummaryOut)
async def get_crawlers(
    request: Request,
    days: Days = 28,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    summary = await crawler_service.get_crawlers(db, days, request.app.state.settings.analytics_stats_start)
    return {**summary, "as_of": now_utc()}


# ---------------------------------------------------------------------------------------------- 電話與 LINE 的時段

class ContactChannelOut(BaseModel):
    channel: Literal["phone", "line"]
    clicks: int
    office: int


class ContactCampusOut(BaseModel):
    campus_key: str | None
    phone: int
    line: int
    clicks: int
    office: int


class ContactCellOut(BaseModel):
    weekday: int
    hour: int
    phone: int
    line: int


class OfficeHoursOut(BaseModel):
    weekdays: list[int]
    hours: list[int]


class ContactHoursOut(BaseModel):
    days: int
    since: date
    until: date
    office_hours: OfficeHoursOut
    clicks: int
    office: int
    channels: list[ContactChannelOut]
    campuses: list[ContactCampusOut]
    cells: list[ContactCellOut]
    as_of: datetime


@router.get("/admin/analytics/contact-hours", response_model=ContactHoursOut)
async def get_contact_hours(
    request: Request,
    days: Days = 28,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    summary = await contact_hours_service.get_contact_hours(db, days, request.app.state.settings.analytics_stats_start)
    return {**summary, "as_of": now_utc()}
