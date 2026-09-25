from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, require_scope
from app.booking import schedule_service, service
from app.booking.schemas import (
    VisitExceptionCreatedOut,
    VisitExceptionIn,
    VisitExceptionOut,
    VisitExceptionRemovedOut,
    VisitRuleOut,
    VisitScheduleOut,
    VisitScheduleUpdate,
    VisitSlotGenerateOut,
    VisitSlotGenerateRequest,
)
from app.campuses.models import Campus
from app.common.timezones import today_local
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["booking"])


async def _campus_or_404(db: AsyncSession, campus_key: str) -> None:
    if await db.get(Campus, campus_key) is None:
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
    before = {"min_lead_hours": config.min_lead_hours, "max_advance_days": config.max_advance_days}
    config.min_lead_hours = payload.min_lead_hours
    config.max_advance_days = payload.max_advance_days
    # 規則或最遠開放天數變了：讓定期工作下一輪（約一分鐘內）就依新設定補
    # 時段，不必等到明天。已存在的時段一律不動。
    config.rules_extended_on = None
    await schedule_service.replace_rules(
        db, campus_key, [r.model_dump() for r in payload.rules], current_user.id
    )
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
        },
    )
    out = await _schedule_out(db, campus_key)
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


@router.post("/admin/visit-schedule/{campus_key}/generate", response_model=VisitSlotGenerateOut)
async def generate_visit_slots(
    campus_key: str,
    payload: VisitSlotGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitSlotGenerateOut:
    require_scope(current_user, "booking.manage", campus_keys=[campus_key])
    await _campus_or_404(db, campus_key)
    try:
        result = await schedule_service.generate_slots(
            db, campus_key, payload.date_from, payload.date_to, current_user.id
        )
    except schedule_service.GenerateRangeInvalid as exc:
        raise HTTPException(status_code=422, detail=exc.message) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_slots.generate",
        target_type="visit_schedule",
        target_id=campus_key,
        campus_key=campus_key,
        metadata={"date_from": payload.date_from.isoformat(), "date_to": payload.date_to.isoformat(), **result},
    )
    await db.commit()
    return VisitSlotGenerateOut(**result)
