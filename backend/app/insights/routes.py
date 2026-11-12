"""後台成效統計的兩個外部數據（docs/specs/2026-11-12-external-integrations-design.md §3、§4）：
Google Search Console 搜尋成效與 CrUX 真實使用者速度。

權限同成效統計其他全站數據：admissions.stats（總管理者）。沒設定回 {configured: false}；
Google 失敗回 {configured: true, error: "<步驟>（HTTP n）"}，只帶步驟與狀態碼，不帶 Google 的回應內容。"""

from __future__ import annotations

import calendar
import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.common.timezones import today_local
from app.insights.crux import CruxHistory
from app.insights.http import GoogleApiError
from app.insights.schemas import CruxOut, SearchInsightsOut
from app.insights.search_console import SearchConsole

logger = logging.getLogger("app.insights")

router = APIRouter(prefix="/api/website/v1", tags=["insights"])

# Search Console 只保留最近 16 個月；更早的日期 Google 會回 400。
RETENTION_MONTHS = 16
DEFAULT_DAYS = 28


def _months_before(day: date, months: int) -> date:
    index = day.year * 12 + (day.month - 1) - months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def _invalid_range(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "INVALID_DATE_RANGE", "message": message}
    )


def resolve_range(start: date | None, end: date | None, today: date) -> tuple[date, date]:
    """沒給結束日＝今天、沒給開始日＝結束日往前 28 天（含）。開始不能晚於結束、結束不能超過今天、開始不能早於 16 個月前。"""
    end = end or today
    start = start or end - timedelta(days=DEFAULT_DAYS - 1)
    if start > end:
        raise _invalid_range("開始日期不能晚於結束日期")
    if end > today:
        raise _invalid_range("結束日期不能是未來")
    if start < _months_before(today, RETENTION_MONTHS):
        raise _invalid_range(f"Google 只保留最近 {RETENTION_MONTHS} 個月的搜尋資料")
    return start, end


def _transport(request: Request):
    # 測試注入 httpx.MockTransport；正式站是 None（真的連 Google）。
    return getattr(request.app.state, "google_transport", None)


@router.get("/admin/search-insights", response_model=SearchInsightsOut, response_model_exclude_unset=True)
async def get_search_insights(
    request: Request,
    start: date | None = Query(None, description="台北日期（含），省略＝結束日往前 28 天"),
    end: date | None = Query(None, description="台北日期（含），省略＝今天；不能是未來"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> SearchInsightsOut:
    """Google 搜尋成效：總計、前 25 個搜尋字詞、前 25 個頁面、裝置別。資料有 2–3 天延遲。"""
    require_scope(current_user, "admissions.stats")
    first, last = resolve_range(start, end, today_local())
    settings = request.app.state.settings
    if not settings.search_console_enabled:
        return SearchInsightsOut(configured=False)
    # 向 Google 要資料最久等數十秒，不能讓登入驗證時開的交易一直占著資料庫連線。
    await db.rollback()
    service: SearchConsole = request.app.state.search_console
    try:
        return await service.insights(settings, first, last, _transport(request))
    except GoogleApiError as exc:
        logger.warning("Search Console 查詢失敗：%s", exc)
        return SearchInsightsOut(configured=True, error=str(exc))


@router.get("/admin/crux", response_model=CruxOut, response_model_exclude_unset=True)
async def get_crux(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> CruxOut:
    """Chrome 真實使用者的 LCP、INP、CLS（官網 origin，手機與電腦各一份，最近 25 週）。"""
    require_scope(current_user, "admissions.stats")
    settings = request.app.state.settings
    if not settings.crux_enabled:
        return CruxOut(configured=False)
    await db.rollback()
    service: CruxHistory = request.app.state.crux
    try:
        return await service.history(settings, _transport(request))
    except GoogleApiError as exc:
        logger.warning("CrUX 查詢失敗：%s", exc)
        return CruxOut(configured=True, error=str(exc))
