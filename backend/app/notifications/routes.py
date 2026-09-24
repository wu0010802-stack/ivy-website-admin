from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import campus_scope, require_scope
from app.notifications.models import NotificationInboxItem

router = APIRouter(prefix="/api/website/v1", tags=["notifications"])


@router.get("/admin/notifications", response_model=list[dict])
async def list_notifications(
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    require_scope(current_user, "booking.read")
    stmt = select(NotificationInboxItem)
    if campus_key:
        require_scope(current_user, "booking.read", campus_keys=[campus_key])
        stmt = stmt.where(NotificationInboxItem.campus_key == campus_key)
    elif (scope := campus_scope(current_user)) is not None:
        stmt = stmt.where(NotificationInboxItem.campus_key.in_(scope))
    stmt = stmt.order_by(NotificationInboxItem.created_at.desc()).limit(100)
    result = await db.execute(stmt)
    return [
        {
            "id": str(item.id),
            "campus_key": item.campus_key,
            "kind": item.kind,
            "payload": item.payload,
            "created_at": item.created_at.isoformat(),
            "read_at": item.read_at.isoformat() if item.read_at else None,
        }
        for item in result.scalars()
    ]


@router.post("/admin/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    result = await db.execute(
        select(NotificationInboxItem).where(NotificationInboxItem.id == notification_id)
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")
    # read_at 是全校共用的處理狀態，不是個人已讀；改寫它要能處理案件
    # （booking.handle，含接待人員——新案通知本來就是櫃台在接），唯讀與
    # 編輯本來就看不到通知。
    require_scope(current_user, "booking.handle", campus_keys=[item.campus_key])
    item.read_at = datetime.now(timezone.utc)
    await db.commit()
    return {"id": str(item.id), "read_at": item.read_at.isoformat()}
