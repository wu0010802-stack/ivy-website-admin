"""把案件明細頁要的幾份資料組成 API 回應：歷程、家長連結狀態。"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.booking import access_service, consent
from app.booking.parent_policy import change_deadline_hours
from app.booking.models import VisitRequest, VisitRequestEvent
from app.booking.schemas import (
    ParentAccessLinkOut,
    VisitHistoryOut,
    VisitRequestDetailOut,
    VisitRequestFullOut,
)


async def visit_history(db: AsyncSession, visit_request_id: uuid.UUID) -> list[VisitHistoryOut]:
    """由舊到新；操作人帶 email 與顯示名稱，帳號刪除後 actor_user_id 會被清成 NULL。"""
    result = await db.execute(
        select(VisitRequestEvent, User.email, User.display_name)
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
            actor_display_name=display_name,
            before=event.before,
            after=event.after,
            reason=event.reason,
            created_at=event.created_at,
        )
        for event, email, display_name in result.all()
    ]


async def full_detail(db: AsyncSession, visit_request: VisitRequest) -> VisitRequestFullOut:
    base = VisitRequestDetailOut.model_validate(visit_request)
    token = await access_service.active_access_token(db, visit_request.id)
    return VisitRequestFullOut(
        **base.model_dump(),
        history=await visit_history(db, visit_request.id),
        access_link=ParentAccessLinkOut(created_at=token.created_at, expires_at=token.expires_at) if token else None,
        parent_change_deadline_hours=await change_deadline_hours(db, visit_request.campus_key),
        consent_revision_version=await consent.revision_version(db, visit_request.consent_revision_id),
    )
