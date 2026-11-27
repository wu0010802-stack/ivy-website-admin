"""廣告花費（手填）與成效 API（2026-11-16 docs/specs/2026-11-16-ad-roi-design.md §6.2）。

全站數字，沒有校區可以限：admissions.stats_site（總管理者；不跟著招生統計授權出去）。稽核的 action、target_type 與 metadata 鍵寫字面值（labelCoverage 會掃）。"""

from __future__ import annotations

import calendar
import logging
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad_conversions.models import EVENTS as AD_CONVERSION_EVENTS
from app.ad_conversions.models import PLATFORMS as AD_CONVERSION_PLATFORMS
from app.ad_conversions.models import STATUSES as AD_CONVERSION_STATUSES
from app.ad_conversions.models import AdConversionJob
from app.admissions.import_routes import NoEchoValidationRoute
from app.admissions import ad_roi
from app.admissions.models import MANUAL_SPEND_PLATFORMS, AdSpendEntry
from app.admissions.schemas import AdConversionStatusOut, AdRoiOut, AdSpendEntryOut, AdSpendIn, AdSpendListOut
from app.booking import exclusion
from app.booking.attribution import PLATFORM_KEYS
from app.booking.models import VisitRequest, VisitRequestSource
from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import covers_campus, require_scope
from app.campuses.models import CAMPUS_KEYS
from app.common.timezones import now_utc, today_local
from app.insights.ga4_ads import Ga4Ads
from app.insights.http import GoogleApiError
from app.operations import audit_service

logger = logging.getLogger("app.admissions.ad_roi")

class AdSpendValidationRoute(NoEchoValidationRoute):
    error_code = "INVALID_AD_SPEND"
    error_message = "花費資料格式不對"


router = APIRouter(prefix="/api/website/v1", tags=["admissions"], route_class=AdSpendValidationRoute)

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class InvalidMonth(ValueError):
    pass


def parse_month(value: str, *, today: date) -> date:
    """「YYYY-MM」轉該月 1 號；格式不對或晚於本月（營運時區）丟 InvalidMonth。"""
    if not _MONTH_RE.fullmatch(value):
        raise InvalidMonth(value)
    year, month = int(value[:4]), int(value[5:])
    if year < 2000:
        raise InvalidMonth(value)
    parsed = date(year, month, 1)
    if parsed > today.replace(day=1):
        raise InvalidMonth(value)
    return parsed


def ad_spend_lock_key(month_day: date, platform: str) -> str:
    return f"ad_spend:{month_day.isoformat()}:{platform}"


def _rejected(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail={"code": code, "message": message})


def _month_or_422(value: str) -> date:
    try:
        return parse_month(value, today=today_local())
    except InvalidMonth:
        raise _rejected("INVALID_MONTH", "月份格式要是 YYYY-MM，且不能晚於本月") from None


def _range_month_or_422(value: str, this_month: date) -> date:
    try:
        return min(parse_month(value, today=date.max), this_month)
    except InvalidMonth:
        raise _rejected("INVALID_MONTH", "月份格式要是 YYYY-MM") from None


def _platform_or_422(value: str) -> str:
    if value not in MANUAL_SPEND_PLATFORMS:
        raise _rejected("INVALID_PLATFORM", "這個平台不能手填花費")
    return value


def _out(entry: AdSpendEntry) -> AdSpendEntryOut:
    return AdSpendEntryOut(
        month=entry.month.strftime("%Y-%m"),
        platform=entry.platform,
        amount=entry.amount,
        note=entry.note,
        updated_at=entry.updated_at,
    )


@router.get("/admin/admissions/ad-spend", response_model=AdSpendListOut)
async def list_ad_spend(
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AdSpendListOut:
    """列出區間內手填的花費（含頭尾月份），依月份、平台排序。只讀，不寫稽核。"""
    require_scope(current_user, "admissions.stats_site")
    query = select(AdSpendEntry).order_by(AdSpendEntry.month, AdSpendEntry.platform)
    this_month = today_local().replace(day=1)
    # 區間可以晚於本月（截到本月）；格式不對才 422。
    if from_ is not None:
        query = query.where(AdSpendEntry.month >= _range_month_or_422(from_, this_month))
    if to is not None:
        query = query.where(AdSpendEntry.month <= _range_month_or_422(to, this_month))
    return AdSpendListOut(entries=[_out(row) for row in (await db.execute(query)).scalars()])


@router.put("/admin/admissions/ad-spend/{month}/{platform}", response_model=AdSpendEntryOut)
async def put_ad_spend(
    month: str,
    platform: str,
    payload: AdSpendIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AdSpendEntryOut:
    """新增或覆寫該月該平台的花費（upsert）。先鎖住既有列（沒有就靠唯一鍵的 ON CONFLICT 擋並發），
    稽核帶更新前的金額。"""
    require_scope(current_user, "admissions.stats_site")
    month_day = _month_or_422(month)
    platform = _platform_or_422(platform)
    # 列還不存在時鎖不到東西：用 (月份, 平台) 的 advisory lock 讓並發的 PUT 排隊，
    # 後到的才讀得到先到的金額當 before_amount（§6.2）。交易結束自動放鎖。
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": ad_spend_lock_key(month_day, platform)})
    before = (
        await db.execute(
            select(AdSpendEntry.amount)
            .where(AdSpendEntry.month == month_day, AdSpendEntry.platform == platform)
        )
    ).scalar_one_or_none()
    now = now_utc()
    stmt = pg_insert(AdSpendEntry).values(
        id=uuid.uuid4(),
        month=month_day,
        platform=platform,
        amount=payload.amount,
        note=payload.note,
        updated_by=current_user.id,
        created_at=now,
        updated_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_ad_spend_entries_month_platform",
        set_={"amount": stmt.excluded.amount, "note": stmt.excluded.note, "updated_by": stmt.excluded.updated_by, "updated_at": now},
    ).returning(AdSpendEntry)
    entry = (await db.execute(stmt.execution_options(populate_existing=True))).scalar_one()
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="ad_spend.upsert",
        target_type="ad_spend",
        target_id=f"{month}:{platform}",
        campus_key=None,
        metadata={"month": month, "platform": platform, "amount": payload.amount, "before_amount": before},
    )
    await db.commit()
    return _out(entry)


@router.delete("/admin/admissions/ad-spend/{month}/{platform}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ad_spend(
    month: str,
    platform: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    require_scope(current_user, "admissions.stats_site")
    month_day = _month_or_422(month)
    platform = _platform_or_422(platform)
    removed = (
        await db.execute(
            delete(AdSpendEntry)
            .where(AdSpendEntry.month == month_day, AdSpendEntry.platform == platform)
            .returning(AdSpendEntry.amount)
        )
    ).scalar_one_or_none()
    if removed is None:
        raise HTTPException(status_code=404, detail={"code": "AD_SPEND_NOT_FOUND", "message": "找不到這筆花費"})
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="ad_spend.delete",
        target_type="ad_spend",
        target_id=f"{month}:{platform}",
        campus_key=None,
        metadata={"month": month, "platform": platform, "amount": removed},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/admissions/ad-roi", response_model=AdRoiOut)
async def get_ad_roi(
    request: Request,
    from_: str = Query(alias="from"),
    to: str = Query(),
    touch: Literal["last", "first"] = "last",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AdRoiOut:
    """各廣告平台的花費對照預約、到場、預繳（docs/specs/2026-11-16-ad-roi-design.md §7）。
    只讀，不寫稽核；先查完資料庫再放掉交易，才向 GA4 要花費（可能等數十秒）。"""
    require_scope(current_user, "admissions.stats_site")
    today = today_local()
    try:
        months = ad_roi.parse_month_range(from_, to, today)
    except ValueError as exc:
        raise _rejected("INVALID_MONTH_RANGE", str(exc)) from None
    now = now_utc()
    campus_keys = [key for key in CAMPUS_KEYS if covers_campus(current_user, key)]
    buckets = await ad_roi.query_buckets(db, campus_keys, months, touch, now)
    entries = (
        await db.execute(
            select(AdSpendEntry).where(
                AdSpendEntry.month >= date(int(months[0][:4]), int(months[0][5:]), 1),
                AdSpendEntry.month <= date(int(months[-1][:4]), int(months[-1][5:]), 1),
            )
        )
    ).scalars().all()
    spend = [ad_roi.SpendRow(entry.month.strftime("%Y-%m"), entry.platform, entry.amount) for entry in entries]
    await db.rollback()

    settings = request.app.state.settings
    google = ad_roi.GoogleState(configured=False)
    if settings.ga4_ads_enabled:
        first = date(int(months[0][:4]), int(months[0][5:]), 1)
        last_year, last_month = int(months[-1][:4]), int(months[-1][5:])
        last = min(date(last_year, last_month, calendar.monthrange(last_year, last_month)[1]), today)
        service: Ga4Ads = request.app.state.ga4_ads
        try:
            report = await service.report(settings, first, last, getattr(request.app.state, "google_transport", None))
            google = ad_roi.GoogleState(configured=True, report=report)
        except GoogleApiError as exc:
            logger.warning("GA4 廣告花費查詢失敗：%s", exc)
            google = ad_roi.GoogleState(configured=True, error=str(exc))
    result = ad_roi.compute_ad_roi(months, buckets, spend, google)
    return AdRoiOut.model_validate({"as_of": now, "touch": touch, **result})


@router.get("/admin/admissions/ad-conversions", response_model=AdConversionStatusOut)
async def get_ad_conversion_status(
    request: Request,
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AdConversionStatusOut:
    """回傳廣告平台的狀態（2026-11-19 docs/specs/2026-11-19-cookie-stats-design.md §8）：近 N 天排入的工作依平台 ×
    事件 × 狀態計數、最近一次送出與最近的問題，以及同期官網預約帶到各平台識別碼的件數。只讀、校區範圍內的案件。"""
    require_scope(current_user, "admissions.stats_site")
    now = now_utc()
    since = now - timedelta(days=days)
    campus_keys = [key for key in CAMPUS_KEYS if covers_campus(current_user, key)]
    configured = set(request.app.state.settings.ad_conversion_platforms)
    J = AdConversionJob
    in_scope = (J.visit_request_id == VisitRequest.id) & VisitRequest.campus_key.in_(campus_keys)
    counts: dict[tuple[str, str], dict[str, int]] = {}
    last_sent: dict[str, datetime] = {}
    for platform, event, job_status, total, sent_at in (await db.execute(
        select(J.platform, J.event, J.status, func.count(), func.max(J.finished_at).filter(J.status == "sent"))
        .join(VisitRequest, in_scope).where(J.created_at >= since)
        .group_by(J.platform, J.event, J.status)
    )).all():
        counts.setdefault((platform, event), dict.fromkeys(AD_CONVERSION_STATUSES, 0))[job_status] = int(total)
        if sent_at is not None and (platform not in last_sent or sent_at > last_sent[platform]):
            last_sent[platform] = sent_at
    problems: dict[str, tuple[str | None, datetime | None]] = {}
    for platform, error, finished in (await db.execute(
        select(J.platform, J.last_error, J.finished_at)
        .join(VisitRequest, in_scope)
        .where(J.created_at >= since, J.status.in_(("failed", "skipped")))
        .order_by(J.platform, J.finished_at.desc().nulls_last())
        .distinct(J.platform)
    )).all():
        problems[platform] = (error, finished)
    ids_rows = (await db.execute(
        select(VisitRequest.ad_click_ids).where(
            VisitRequest.campus_key.in_(campus_keys),
            VisitRequest.source == VisitRequestSource.WEB.value,
            VisitRequest.created_at >= since,
            exclusion.not_excluded(),
        )
    )).scalars().all()
    with_ids = dict.fromkeys(AD_CONVERSION_PLATFORMS, 0)
    for ids in ids_rows:
        for platform, keys in PLATFORM_KEYS.items():
            if ids and any(ids.get(key) for key in keys):
                with_ids[platform] += 1
    platforms = []
    for platform in AD_CONVERSION_PLATFORMS:
        problem, problem_at = problems.get(platform, (None, None))
        platforms.append({
            "platform": platform,
            "configured": platform in configured,
            "events": [
                {"event": event, **counts.get((platform, event), dict.fromkeys(AD_CONVERSION_STATUSES, 0))}
                for event in AD_CONVERSION_EVENTS
            ],
            "last_sent_at": last_sent.get(platform),
            "last_problem": problem,
            "last_problem_at": problem_at,
            "cases_with_ids": with_ids[platform],
        })
    return AdConversionStatusOut.model_validate(
        {"as_of": now, "days": days, "cases": len(ids_rows), "platforms": platforms}
    )
