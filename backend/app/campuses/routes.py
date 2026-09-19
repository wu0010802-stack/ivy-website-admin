from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, require_scope
from app.campuses.models import Campus
from app.campuses.schemas import CampusOut

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
