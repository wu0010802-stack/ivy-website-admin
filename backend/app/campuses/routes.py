from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import Role, User
from app.auth.permissions import CapabilityDenied, ScopeDenied, require_scope
from app.booking.models import VisitRequest, VisitRequestStatus
from app.campuses.models import Campus
from app.campuses.schemas import CampusOut, CampusStatusOut, CampusStatusUpdate
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["campuses"])


@router.get("/admin/campuses", response_model=list[CampusOut])
async def list_admin_campuses(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[CampusOut]:
    require_scope(current_user, "campuses.read")
    result = await db.execute(select(Campus))
    campuses = list(result.scalars())
    owned = {s.campus_key for s in current_user.campus_scopes}
    if current_user.role.value != "super_admin":
        campuses = [c for c in campuses if c.key in owned]
    return [CampusOut.model_validate(c) for c in campuses]


@router.get("/admin/campuses/{key}", response_model=CampusOut)
async def get_admin_campus(
    key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> CampusOut:
    require_scope(current_user, "campuses.read", campus_keys=[key])
    result = await db.execute(select(Campus).where(Campus.key == key))
    campus = result.scalar_one_or_none()
    if campus is None:
        raise ScopeDenied()
    return CampusOut.model_validate(campus)


_OPEN_STATUSES = [
    VisitRequestStatus.NEW.value,
    VisitRequestStatus.CONTACTING.value,
    VisitRequestStatus.PENDING_CONFIRMATION.value,
    VisitRequestStatus.CONFIRMED.value,
]


@router.patch("/admin/campuses/{key}/status", response_model=CampusStatusOut)
async def update_campus_status(
    key: str,
    payload: CampusStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> CampusStatusOut:
    """停用／重新啟用分校（規格 3.2）。只有總管理者可以做：這是機構層級的
    決定。停用後公開預約立即停止（公開端點只認 active 的分校），既有案件
    一律不動，回傳仍在進行中的件數讓園方人工處理。"""
    require_scope(current_user, "campuses.read")
    if current_user.role != Role.SUPER_ADMIN:
        raise CapabilityDenied()
    result = await db.execute(select(Campus).where(Campus.key == key).with_for_update())
    campus = result.scalar_one_or_none()
    if campus is None:
        raise ScopeDenied()
    before = campus.active
    campus.active = payload.active
    if payload.active:
        campus.deactivated_at = None
        campus.deactivated_reason = None
    elif before:
        campus.deactivated_at = datetime.now(timezone.utc)
        campus.deactivated_reason = payload.reason
    else:
        campus.deactivated_reason = payload.reason
    open_count = (
        await db.execute(
            select(func.count())
            .select_from(VisitRequest)
            .where(VisitRequest.campus_key == key, VisitRequest.status.in_(_OPEN_STATUSES))
        )
    ).scalar_one()
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="campus.activate" if payload.active else "campus.deactivate",
        target_type="campus",
        target_id=key,
        campus_key=key,
        metadata={"before": before, "after": payload.active, "reason": payload.reason, "open_requests": open_count},
    )
    await db.commit()
    return CampusStatusOut(
        key=campus.key,
        name=campus.name,
        active=campus.active,
        deactivated_at=campus.deactivated_at,
        deactivated_reason=campus.deactivated_reason,
        open_requests=open_count,
    )
