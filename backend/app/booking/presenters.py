"""把案件明細頁要的幾份資料組成 API 回應：歷程、待核准的改期申請、家長
連結狀態。routes（案件明細）與 access_routes（改期申請清單）共用，兩邊
顯示的改期申請才會是同一種寫法。"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.booking import access_service, consent, history, slot_service
from app.booking.parent_policy import change_deadline_hours
from app.booking.access_models import RescheduleRequest
from app.booking.models import VisitRequest, VisitRequestEvent, VisitSlot
from app.booking.schemas import (
    ParentAccessLinkOut,
    RescheduleRequestOut,
    VisitHistoryOut,
    VisitRequestDetailOut,
    VisitRequestFullOut,
    VisitSlotBriefOut,
)


def _brief(slot: VisitSlot | None) -> VisitSlotBriefOut | None:
    return VisitSlotBriefOut.model_validate(slot) if slot is not None else None


async def reschedule_request_outs(
    db: AsyncSession, rows: list[tuple[RescheduleRequest, VisitRequest]]
) -> list[RescheduleRequestOut]:
    out: list[RescheduleRequestOut] = []
    for record, visit_request in rows:
        requested = await history.load_slot(db, record.requested_slot_id)
        if requested is None:  # FK 是 RESTRICT，理論上不會發生
            continue
        booked = await slot_service.count_booked(db, requested.id)
        remaining = max(requested.capacity - booked, 0)
        out.append(
            RescheduleRequestOut(
                id=record.id,
                visit_request_id=visit_request.id,
                campus_key=visit_request.campus_key,
                status=record.status,
                parent_name=visit_request.parent_name,
                current_slot=_brief(await history.load_slot(db, visit_request.slot_id)),
                requested_slot=VisitSlotBriefOut.model_validate(requested),
                requested_slot_remaining=remaining,
                requested_slot_available=(
                    not requested.closed and not slot_service.has_started(requested) and remaining > 0
                ),
                created_at=record.created_at,
            )
        )
    return out


async def visit_history(db: AsyncSession, visit_request_id: uuid.UUID) -> list[VisitHistoryOut]:
    """由舊到新；操作人帶 email，帳號刪除後 actor_user_id 會被清成 NULL。"""
    result = await db.execute(
        select(VisitRequestEvent, User.email)
        .outerjoin(User, User.id == VisitRequestEvent.actor_user_id)
        .where(VisitRequestEvent.visit_request_id == visit_request_id)
        .order_by(VisitRequestEvent.created_at, VisitRequestEvent.id)
    )
    return [
        VisitHistoryOut(
            id=event.id,
            event_type=event.event_type,
            source=event.source,
            actor_user_id=event.actor_user_id,
            actor_email=email,
            before=event.before,
            after=event.after,
            reason=event.reason,
            created_at=event.created_at,
        )
        for event, email in result.all()
    ]


async def full_detail(db: AsyncSession, visit_request: VisitRequest) -> VisitRequestFullOut:
    base = VisitRequestDetailOut.model_validate(visit_request)
    pending = (
        await db.execute(
            select(RescheduleRequest)
            .where(
                RescheduleRequest.visit_request_id == visit_request.id,
                RescheduleRequest.status == "pending",
            )
            .order_by(RescheduleRequest.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    pending_out = (await reschedule_request_outs(db, [(pending, visit_request)]))[0] if pending else None
    token = await access_service.active_access_token(db, visit_request.id)
    return VisitRequestFullOut(
        **base.model_dump(),
        history=await visit_history(db, visit_request.id),
        pending_reschedule=pending_out,
        access_link=ParentAccessLinkOut(created_at=token.created_at, expires_at=token.expires_at) if token else None,
        parent_change_deadline_hours=await change_deadline_hours(db, visit_request.campus_key),
        consent_revision_version=await consent.revision_version(db, visit_request.consent_revision_id),
    )
