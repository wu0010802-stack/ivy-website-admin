from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, require_scope
from app.booking import closure_service, holidays, schedule_service, service
from app.booking.schemas import (
    HolidayApplyCampusOut,
    HolidayApplyIn,
    HolidayApplyOut,
    HolidayCalendarFetchIn,
    HolidayCalendarOut,
    HolidayOut,
    VisitClosureCampusOut,
    VisitClosureIn,
    VisitClosureOut,
    VisitExceptionCreatedOut,
    VisitExceptionIn,
    VisitExceptionOut,
    VisitExceptionRemovedOut,
    VisitRuleOut,
    VisitScheduleOut,
    VisitScheduleSlotSyncOut,
    VisitScheduleUpdate,
    has_control_chars,
)
from app.campuses.models import Campus
from app.common.timezones import today_local
from app.operations import audit_service

logger = logging.getLogger("app.booking")

router = APIRouter(prefix="/api/website/v1", tags=["booking"])

# 停班停課最遠設到幾天後：與官網最遠開放天數的上限同一個量級，更遠的用月曆設休假。
CLOSURE_MAX_DAYS_AHEAD = 60


async def _campus_or_404(db: AsyncSession, campus_key: str) -> None:
    # 含控制字元（例如網址上的 %00）的 key 不可能是校區；不擋的話 PostgreSQL 拒收 NUL，變成 500。
    if has_control_chars(campus_key) or await db.get(Campus, campus_key) is None:
        raise ScopeDenied()


async def _schedule_out(db: AsyncSession, campus_key: str) -> VisitScheduleOut:
    config = await service.get_or_create_config(db, campus_key)
    rules = await schedule_service.list_rules(db, campus_key)
    exceptions = await schedule_service.list_exceptions(db, campus_key, since=today_local())
    return VisitScheduleOut(
        campus_key=campus_key,
        min_lead_hours=config.min_lead_hours,
        max_advance_days=config.max_advance_days,
        rules=[VisitRuleOut.model_validate(r) for r in rules],
        exceptions=[VisitExceptionOut.model_validate(e) for e in exceptions],
        rules_extended_on=config.rules_extended_on,
        version=config.schedule_version,
    )


@router.get("/admin/visit-schedule/{campus_key}", response_model=VisitScheduleOut)
async def get_visit_schedule(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitScheduleOut:
    require_scope(current_user, "booking.read", campus_keys=[campus_key])
    await _campus_or_404(db, campus_key)
    out = await _schedule_out(db, campus_key)
    await db.commit()
    return out


@router.put("/admin/visit-schedule/{campus_key}", response_model=VisitScheduleOut)
async def update_visit_schedule(
    campus_key: str,
    payload: VisitScheduleUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitScheduleOut:
    require_scope(current_user, "booking.manage", campus_keys=[campus_key])
    await _campus_or_404(db, campus_key)
    config = await service.get_or_create_config(db, campus_key, for_update=True)
    # 整份規則一次替換：兩個人同時編輯時，後存的一方如果沒擋下來，會把前
    # 一個人加的規則整批蓋掉。
    if config.schedule_version != payload.expected_version:
        current = config.schedule_version
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "VISIT_SCHEDULE_VERSION_CONFLICT",
                "message": "開放規則剛被其他人修改，請重新載入後再編輯",
                "current_version": current,
            },
        )
    before = {"min_lead_hours": config.min_lead_hours, "max_advance_days": config.max_advance_days}
    old_windows = schedule_service.rule_window_map(await schedule_service.list_rules(db, campus_key))
    config.schedule_version += 1
    config.min_lead_hours = payload.min_lead_hours
    config.max_advance_days = payload.max_advance_days
    # 規則或最遠開放天數變了：讓定期工作下一輪（約一分鐘內）就依新設定補
    # 時段，不必等到明天。
    config.rules_extended_on = None
    await schedule_service.replace_rules(
        db, campus_key, [r.model_dump() for r in payload.rules], current_user.id
    )
    # 時段是預先補好的：還沒被使用的舊規則場次在同一把鎖內對齊新規則，
    # 不然要等最遠開放天數過完才會消失，新場次還會跟它們重疊。
    slot_sync = await schedule_service.sync_rule_slots(db, campus_key, old_windows)
    # 存檔當下就把新規則的場次補到最遠開放天數，不等下一輪定期工作
    # （config.rules_extended_on 上面已清空，所以這裡一定會補）。
    slot_sync["created"] = await schedule_service.extend_from_rules(db, campus_key)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_schedule.update",
        target_type="visit_schedule",
        target_id=campus_key,
        campus_key=campus_key,
        metadata={
            "before": before,
            "after": {"min_lead_hours": payload.min_lead_hours, "max_advance_days": payload.max_advance_days},
            "rule_count": len(payload.rules),
            "slot_sync": slot_sync,
        },
    )
    out = await _schedule_out(db, campus_key)
    out.slot_sync = VisitScheduleSlotSyncOut(**slot_sync)
    await db.commit()
    return out


@router.post(
    "/admin/visit-schedule/{campus_key}/exceptions",
    response_model=VisitExceptionCreatedOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_visit_exception(
    campus_key: str,
    payload: VisitExceptionIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitExceptionCreatedOut:
    require_scope(current_user, "booking.manage", campus_keys=[campus_key])
    await _campus_or_404(db, campus_key)
    record, closed, affected = await schedule_service.add_exception(
        db, campus_key, payload.exception_date, payload.reason, current_user.id
    )
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_exception.create",
        target_type="visit_exception",
        target_id=str(record.id),
        campus_key=campus_key,
        metadata={"date": payload.exception_date.isoformat(), "closed_slots": closed, "affected_requests": affected},
    )
    await db.commit()
    return VisitExceptionCreatedOut(
        id=record.id,
        exception_date=record.exception_date,
        reason=record.reason,
        closed_slots=closed,
        affected_requests=affected,
    )


@router.delete(
    "/admin/visit-schedule/{campus_key}/exceptions/{exception_id}",
    response_model=VisitExceptionRemovedOut,
)
async def remove_visit_exception(
    campus_key: str,
    exception_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitExceptionRemovedOut:
    """取消休假：重開因休假關閉的時段、依規則補上當天場次；手動關閉的不動。"""
    require_scope(current_user, "booking.manage", campus_keys=[campus_key])
    await _campus_or_404(db, campus_key)
    result = await schedule_service.remove_exception(db, campus_key, exception_id, current_user.id)
    if result is None:
        raise ScopeDenied()
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_exception.delete",
        target_type="visit_exception",
        target_id=str(exception_id),
        campus_key=campus_key,
        metadata=result,
    )
    await db.commit()
    return VisitExceptionRemovedOut(**result)


# ---------------------------------------------------------------------------
# 國定假日匯入（2026-10-14 規格 §2）
# ---------------------------------------------------------------------------


def _calendar_out(calendar: holidays.HolidayCalendar, source: str) -> HolidayCalendarOut:
    return HolidayCalendarOut(
        source=source,
        source_label=calendar.source_label,
        years=calendar.years,
        holidays=[HolidayOut(date=h.day, name=h.name, weekday=h.day.weekday()) for h in calendar.holidays],
    )


def _calendar_invalid(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "HOLIDAY_CSV_INVALID", "message": str(exc)},
    )


@router.post("/admin/holiday-calendar/fetch", response_model=HolidayCalendarOut)
async def fetch_holiday_calendar(
    payload: HolidayCalendarFetchIn,
    current_user: User = Depends(get_current_user),
) -> HolidayCalendarOut:
    """從政府資料開放平台下載某一年的辦公日曆並解析，給後台預覽；不寫任何資料。"""
    require_scope(current_user, "booking.manage")
    this_year = today_local().year
    if payload.year not in (this_year, this_year + 1):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_YEAR", "message": f"只能匯入 {this_year} 或 {this_year + 1} 年"},
        )
    try:
        calendar = await holidays.fetch_calendar(payload.year)
    except holidays.HolidayYearNotPublished as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "HOLIDAY_YEAR_NOT_PUBLISHED", "message": str(exc)},
        ) from exc
    except holidays.HolidaySourceUnavailable as exc:
        logger.warning("下載辦公日曆失敗：%s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "HOLIDAY_SOURCE_UNAVAILABLE", "message": "連不到政府資料開放平台，請改用上傳檔案"},
        ) from exc
    except holidays.HolidayCalendarError as exc:
        raise _calendar_invalid(exc) from exc
    return _calendar_out(calendar, "open_data")


@router.post("/admin/holiday-calendar/parse", response_model=HolidayCalendarOut)
async def parse_holiday_calendar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> HolidayCalendarOut:
    """解析上傳的辦公日曆 CSV（連不到政府資料開放平台時用），給後台預覽；不寫任何資料。"""
    require_scope(current_user, "booking.manage")
    raw = await file.read(holidays.MAX_FILE_BYTES + 1)
    label = (file.filename or "").strip()[:120] or "上傳的檔案"
    try:
        calendar = holidays.parse_calendar(raw, source_label=label)
    except holidays.HolidayCalendarError as exc:
        raise _calendar_invalid(exc) from exc
    return _calendar_out(calendar, "upload")


@router.post("/admin/holiday-calendar/apply", response_model=HolidayApplyOut)
async def apply_holiday_calendar(
    payload: HolidayApplyIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> HolidayApplyOut:
    """把假日套用成各校的休假日。dry_run 只算數字；套用時每一校寫一筆操作紀錄。"""
    require_scope(current_user, "booking.manage", campus_keys=payload.campus_keys)
    for campus_key in payload.campus_keys:
        await _campus_or_404(db, campus_key)
    today = today_local()
    upcoming = [
        holidays.Holiday(day=h.date, name=h.name)
        for h in sorted(payload.holidays, key=lambda h: h.date)
        if h.date >= today
    ]
    results: list[HolidayApplyCampusOut] = []
    # 依校區 key 排序取設定列鎖，和停班停課同一個順序，多校操作不會互鎖成死結。
    for campus_key in sorted(payload.campus_keys):
        result = await holidays.apply_holidays(
            db, campus_key, upcoming, actor_id=current_user.id, dry_run=payload.dry_run
        )
        if not payload.dry_run:
            await audit_service.log_action(
                db,
                actor_user_id=current_user.id,
                action="visit_exception.import_holidays",
                target_type="visit_schedule",
                target_id=campus_key,
                campus_key=campus_key,
                metadata={
                    "created": result.created,
                    "skipped_existing": result.skipped_existing,
                    "skipped_weekend": result.skipped_weekend,
                    "affected_requests": result.affected_requests,
                    "date_from": upcoming[0].day.isoformat() if upcoming else None,
                    "date_to": upcoming[-1].day.isoformat() if upcoming else None,
                },
            )
        results.append(
            HolidayApplyCampusOut(
                campus_key=campus_key,
                created=result.created,
                skipped_existing=result.skipped_existing,
                skipped_weekend=result.skipped_weekend,
                affected_requests=result.affected_requests,
                affected_dates=result.affected_dates,
            )
        )
    if payload.dry_run:
        await db.rollback()
    else:
        await db.commit()
    return HolidayApplyOut(
        dry_run=payload.dry_run, skipped_past=len(payload.holidays) - len(upcoming), campuses=results
    )


# ---------------------------------------------------------------------------
# 停班停課（2026-10-14 規格 §3）
# ---------------------------------------------------------------------------


@router.post("/admin/visit-closures", response_model=VisitClosureOut)
async def create_visit_closure(
    payload: VisitClosureIn,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitClosureOut:
    """一天停課（可多校）：設成休假日、關閉當天場次，有 Email 的家長寄停課通知。

    dry_run 只回每校的數字，不寫任何資料；正式執行時每一校寫一筆操作紀錄。"""
    require_scope(current_user, "booking.manage", campus_keys=payload.campus_keys)
    for campus_key in payload.campus_keys:
        await _campus_or_404(db, campus_key)
    today = today_local()
    if not today <= payload.closure_date <= today + timedelta(days=CLOSURE_MAX_DAYS_AHEAD):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "INVALID_CLOSURE_DATE",
                "message": f"停課日期要在今天到 {CLOSURE_MAX_DAYS_AHEAD} 天內",
            },
        )
    settings = request.app.state.settings
    # 與公開預約設定的 parent_email_enabled 同一個判斷：沒設 SMTP 就不會真的寄給家長，
    # 也就不排信（排了只會被標成略過，還會佔住去重鍵）。
    email_enabled = bool(settings.smtp_host)
    notify = payload.notify_parents and email_enabled
    results: list[VisitClosureCampusOut] = []
    for campus_key in sorted(payload.campus_keys):
        result = await closure_service.close_day(
            db,
            campus_key,
            payload.closure_date,
            payload.reason,
            actor_id=current_user.id,
            notify=notify,
            secret=settings.session_secret,
            dry_run=payload.dry_run,
        )
        if not payload.dry_run:
            await audit_service.log_action(
                db,
                actor_user_id=current_user.id,
                action="visit_closure.create",
                target_type="visit_schedule",
                target_id=campus_key,
                campus_key=campus_key,
                metadata={
                    "date": payload.closure_date.isoformat(),
                    "reason": payload.reason,
                    "already_closed": result.already_closed,
                    "closed_slots": result.closed_slots,
                    "affected_requests": result.confirmed_requests,
                    "notified": result.notified,
                    "no_email": result.no_email,
                },
            )
        results.append(VisitClosureCampusOut(**result.__dict__))
    if payload.dry_run:
        await db.rollback()
    else:
        await db.commit()
    return VisitClosureOut(
        dry_run=payload.dry_run,
        closure_date=payload.closure_date,
        parent_email_enabled=email_enabled,
        campuses=results,
    )
