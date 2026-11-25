"""後台讀商家檔案與搜尋需求、維護搜尋需求關鍵字的 API
（2026-11-25，docs/specs/2026-11-25-business-profile-keyword-planner-design.md §4.4、§5.4）。

資料由背景同步（app/workers/google_loop.py）寫進資料庫，這裡只讀資料庫、不向 Google 要。權限同招生統計與成效統計的
外部數據：admissions.stats（總管理者）。稽核的 action、target_type 與 metadata 鍵寫字面值（labelCoverage 會掃）。"""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.campuses.models import CAMPUS_NAMES
from app.common.timezones import now_utc, today_local
from app.insights import google_sync_status as sync_status
from app.insights.business_profile import add_months, month_start, status_key
from app.insights.models import (
    SEARCH_DEMAND_GEOS,
    SEARCH_KEYWORD_LIMIT,
    SEARCH_KEYWORD_MAX_LENGTH,
    GbpDailyMetric,
    GbpKeywordMonth,
    GbpMonthlyKeyword,
    GoogleSyncStatus,
    SearchKeyword,
    SearchKeywordVolume,
)
from app.insights.schemas import (
    BusinessProfileOut,
    GbpKeywordOut,
    GbpLocationOut,
    GbpMonthOut,
    SearchDemandGeoOut,
    SearchDemandOut,
    SearchKeywordIn,
    SearchKeywordOut,
    SearchKeywordVolumesOut,
    SearchVolumeCellOut,
)
from app.insights.search_demand import GEO_LABELS, STATUS_KEY, normalize
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["insights"])

MONTHS_SHOWN = 13
KEYWORDS_SHOWN = 25
DEMAND_MONTHS = 12
# 一個關鍵字最多 10 個詞（Google Keyword Planner 的限制）。
SEARCH_KEYWORD_MAX_WORDS = 10
SEARCH_KEYWORD_LOCK = "search_keywords"


def _month_label(day: date) -> str:
    return day.strftime("%Y-%m")


def _rejected(code: str, message: str, status_code: int = status.HTTP_422_UNPROCESSABLE_CONTENT) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


async def _location(db: AsyncSession, campus_key: str, today: date) -> GbpLocationOut:
    sync = await db.get(GoogleSyncStatus, status_key(campus_key))
    first_month = add_months(month_start(today), -(MONTHS_SHOWN - 1))
    month = func.date_trunc("month", GbpDailyMetric.day).cast(GbpDailyMetric.day.type)
    rows = (
        await db.execute(
            select(month, GbpDailyMetric.metric, func.sum(GbpDailyMetric.value), func.count(func.distinct(GbpDailyMetric.day)),
                   func.max(GbpDailyMetric.day))
            .where(GbpDailyMetric.campus_key == campus_key, GbpDailyMetric.day >= first_month)
            .group_by(month, GbpDailyMetric.metric)
        )
    ).all()
    by_month: dict[date, dict] = {}
    for month_day, metric, total, days, last in rows:
        entry = by_month.setdefault(month_day, {"days": 0, "last_day": last})
        entry[metric] = int(total)
        entry["days"] = max(entry["days"], int(days))
        entry["last_day"] = max(entry["last_day"], last)
    months = [
        GbpMonthOut(
            month=_month_label(month_day),
            days=entry["days"],
            last_day=entry["last_day"],
            **{code: entry.get(code, 0) for code in (
                "desktop_search", "mobile_search", "desktop_maps", "mobile_maps", "calls", "directions", "website", "messages",
            )},
        )
        for month_day, entry in sorted(by_month.items(), reverse=True)
    ]
    last_day = (
        await db.execute(select(func.max(GbpDailyMetric.day)).where(GbpDailyMetric.campus_key == campus_key))
    ).scalar_one_or_none()

    keywords_month = (
        await db.execute(select(func.max(GbpKeywordMonth.month)).where(GbpKeywordMonth.campus_key == campus_key))
    ).scalar_one_or_none()
    keywords: list[GbpKeywordOut] = []
    total = 0
    if keywords_month is not None:
        where = (GbpMonthlyKeyword.campus_key == campus_key, GbpMonthlyKeyword.month == keywords_month)
        total = (await db.execute(select(func.count()).select_from(GbpMonthlyKeyword).where(*where))).scalar_one()
        keywords = [
            GbpKeywordOut(keyword=row.keyword, impressions=row.impressions, below=row.below)
            for row in (
                await db.execute(
                    select(GbpMonthlyKeyword).where(*where).order_by(
                        GbpMonthlyKeyword.impressions.desc().nulls_last(), GbpMonthlyKeyword.below.desc().nulls_last(),
                        GbpMonthlyKeyword.keyword,
                    ).limit(KEYWORDS_SHOWN)
                )
            ).scalars()
        ]
    return GbpLocationOut(
        campus_key=campus_key,
        campus_name=CAMPUS_NAMES.get(campus_key, campus_key),
        last_success_at=sync.last_success_at if sync else None,
        last_attempt_at=sync.last_attempt_at if sync else None,
        failed=sync_status.failed_last_time(sync),
        error=sync.last_error if sync else None,
        last_day=last_day,
        months=months,
        keywords_month=_month_label(keywords_month) if keywords_month else None,
        keywords=keywords,
        keyword_total=total,
    )


@router.get("/admin/business-profile", response_model=BusinessProfileOut)
async def get_business_profile(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> BusinessProfileOut:
    """Google 商家檔案：各地點按月的曝光、電話、路線、網站點擊、訊息，與最近一個整月的前 25 個搜尋字詞。
    不隨成效統計的期間變動；資料由背景每天同步一次。"""
    require_scope(current_user, "admissions.stats")
    settings = request.app.state.settings
    if not settings.gbp_enabled:
        return BusinessProfileOut(configured=False, locations=[])
    today = today_local()
    return BusinessProfileOut(
        configured=True,
        locations=[await _location(db, campus_key, today) for campus_key in settings.gbp_location_ids],
    )


def _demand_months(today: date) -> list[date]:
    last = add_months(month_start(today), -1)
    return [add_months(last, -offset) for offset in range(DEMAND_MONTHS - 1, -1, -1)]


def _keyword_out(keyword: SearchKeyword, volumes: dict[tuple[str, date], int | None], months: list[date]) -> SearchKeywordOut:
    return SearchKeywordOut(
        id=str(keyword.id),
        text=keyword.text,
        created_at=keyword.created_at,
        synced_at=keyword.synced_at,
        volumes=[
            SearchKeywordVolumesOut(
                geo=geo,
                cells=[
                    SearchVolumeCellOut(
                        month=_month_label(month), available=(geo, month) in volumes, searches=volumes.get((geo, month))
                    )
                    for month in months
                ],
            )
            for geo in SEARCH_DEMAND_GEOS
        ],
    )


@router.get("/admin/search-demand", response_model=SearchDemandOut)
async def get_search_demand(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> SearchDemandOut:
    """搜尋需求：後台維護的關鍵字在高雄市與五校所在區最近 12 個整月的 Google 搜尋量。沒設定 Keyword Planner 時照樣列出
    關鍵字（可以先加好），數字都是空的。"""
    require_scope(current_user, "admissions.stats")
    settings = request.app.state.settings
    months = _demand_months(today_local())
    keywords = list((await db.execute(select(SearchKeyword).order_by(SearchKeyword.created_at, SearchKeyword.text))).scalars())
    volumes: dict[uuid.UUID, dict[tuple[str, date], int | None]] = {}
    if keywords:
        for row in (
            await db.execute(select(SearchKeywordVolume).where(
                SearchKeywordVolume.keyword_id.in_([keyword.id for keyword in keywords]),
                SearchKeywordVolume.month >= months[0], SearchKeywordVolume.month <= months[-1],
            ))
        ).scalars():
            volumes.setdefault(row.keyword_id, {})[(row.geo, row.month)] = row.searches
    sync = await db.get(GoogleSyncStatus, STATUS_KEY)
    return SearchDemandOut(
        configured=settings.google_ads_enabled,
        geos=[SearchDemandGeoOut(key=key, label=GEO_LABELS.get(key, key)) for key in SEARCH_DEMAND_GEOS],
        months=[_month_label(month) for month in months],
        keywords=[_keyword_out(keyword, volumes.get(keyword.id, {}), months) for keyword in keywords],
        keyword_limit=SEARCH_KEYWORD_LIMIT,
        last_success_at=sync.last_success_at if sync else None,
        last_attempt_at=sync.last_attempt_at if sync else None,
        failed=sync_status.failed_last_time(sync),
        error=sync.last_error if sync else None,
    )


def clean_keyword(raw: str) -> str:
    """空白合併、頭尾去掉；空的、超過 80 字或 10 個詞丟 422。大小寫照使用者打的存，比重複時不分大小寫。"""
    text_value = " ".join(raw.split())
    if not text_value:
        raise _rejected("INVALID_SEARCH_KEYWORD", "請輸入關鍵字")
    if len(text_value) > SEARCH_KEYWORD_MAX_LENGTH:
        raise _rejected("INVALID_SEARCH_KEYWORD", f"關鍵字最多 {SEARCH_KEYWORD_MAX_LENGTH} 個字")
    if len(text_value.split(" ")) > SEARCH_KEYWORD_MAX_WORDS:
        raise _rejected("INVALID_SEARCH_KEYWORD", f"關鍵字最多 {SEARCH_KEYWORD_MAX_WORDS} 個詞（以空格分開）")
    return text_value


@router.post("/admin/search-demand/keywords", response_model=SearchKeywordOut, status_code=status.HTTP_201_CREATED)
async def create_search_keyword(
    payload: SearchKeywordIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> SearchKeywordOut:
    """新增一個關鍵字（最多 50 個、不分大小寫不能重複）。下一輪背景同步（一小時內）就會抓它的搜尋量。"""
    require_scope(current_user, "admissions.stats")
    value = clean_keyword(payload.text)
    # 數量上限與重複要在同一個交易裡排隊檢查，兩個人同時新增時才不會超過 50 個或各加一個大小寫不同的同一個字。
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": SEARCH_KEYWORD_LOCK})
    existing = list((await db.execute(select(SearchKeyword.text))).scalars())
    if any(normalize(item) == normalize(value) for item in existing):
        raise _rejected("SEARCH_KEYWORD_EXISTS", "這個關鍵字已經在清單裡", status.HTTP_409_CONFLICT)
    if len(existing) >= SEARCH_KEYWORD_LIMIT:
        raise _rejected("SEARCH_KEYWORD_LIMIT", f"關鍵字最多 {SEARCH_KEYWORD_LIMIT} 個，請先刪掉用不到的")
    keyword = SearchKeyword(id=uuid.uuid4(), text=value, created_by=current_user.id, created_at=now_utc())
    db.add(keyword)
    await db.flush()
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="search_keyword.create",
        target_type="search_keyword",
        target_id=str(keyword.id),
        campus_key=None,
        metadata={"text": value},
    )
    await db.commit()
    return _keyword_out(keyword, {}, _demand_months(today_local()))


@router.delete("/admin/search-demand/keywords/{keyword_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_search_keyword(
    keyword_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """刪掉關鍵字與它存過的搜尋量。"""
    require_scope(current_user, "admissions.stats")
    keyword = await db.get(SearchKeyword, keyword_id)
    if keyword is None:
        raise HTTPException(status_code=404, detail={"code": "SEARCH_KEYWORD_NOT_FOUND", "message": "找不到這個關鍵字"})
    value = keyword.text
    await db.delete(keyword)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="search_keyword.delete",
        target_type="search_keyword",
        target_id=str(keyword_id),
        campus_key=None,
        metadata={"text": value},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
