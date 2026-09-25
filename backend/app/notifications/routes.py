from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import campus_scope, covers_campus, require_scope
from app.booking.models import OutboxStatus
from app.notifications import outbox_admin
from app.notifications.models import NotificationInboxItem, UserNotification

router = APIRouter(prefix="/api/website/v1", tags=["notifications"])


class OutboxDeliveredOut(BaseModel):
    """這則通知已經送到的管道：站內通知、LINE 群組、已寄出的 Email 人數。
    重新寄送時這些都會略過，只補還沒送到的。"""

    inbox: bool
    line: bool
    email: int


class NotificationOutboxOut(BaseModel):
    id: uuid.UUID
    campus_key: str
    visit_request_id: uuid.UUID
    kind: str
    # 逾期未處理提醒的細分原因（new_unhandled／hold_expiring），其他通知為 null。
    reason: str | None
    status: str
    attempts: int
    # 最後一次失敗的例外類別名稱（例如 SMTPServerDisconnected），不含訊息內容。
    error_code: str | None
    created_at: datetime
    next_attempt_at: datetime
    requeued_at: datetime | None
    delivered: OutboxDeliveredOut


class NotificationRetryBatchRequest(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=outbox_admin.LIST_LIMIT)


class NotificationRetryBatchOut(BaseModel):
    requeued: int
    # 已經不是寄送失敗（別人先重送了、或已送出）、找不到或不在你的校區範圍。
    skipped: int


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


class UserNotificationOut(BaseModel):
    """給自己的站內通知（內容送審、核准或退回、排程發布沒有執行）。"""

    id: uuid.UUID
    kind: str
    campus_key: str | None
    # 哪一種內容（home_about、campus_faq…），後台用它連到編輯頁。
    content_kind: str | None
    revision_version: int | None
    # 退回原因或核准備註。
    note: str | None
    # 排程沒有執行的原因。
    error: str | None
    publish_at: datetime | None
    # 做這個動作的人（送審者、審核者）；排程由系統執行時為 null。
    actor_email: str | None
    created_at: datetime
    read_at: datetime | None


class UserNotificationReadAllOut(BaseModel):
    updated: int


# 個人通知只列最近這麼多則。
MY_NOTIFICATIONS_LIMIT = 100


def _user_notification_out(item: UserNotification) -> UserNotificationOut:
    payload = item.payload or {}
    publish_at = payload.get("publish_at")
    return UserNotificationOut(
        id=item.id,
        kind=item.kind,
        campus_key=item.campus_key,
        content_kind=payload.get("content_kind"),
        revision_version=payload.get("revision_version"),
        note=payload.get("note"),
        error=payload.get("error"),
        publish_at=datetime.fromisoformat(publish_at) if isinstance(publish_at, str) else None,
        actor_email=payload.get("actor_email"),
        created_at=item.created_at,
        read_at=item.read_at,
    )


@router.get("/admin/my-notifications", response_model=list[UserNotificationOut])
async def list_my_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[UserNotificationOut]:
    """給目前登入者自己的通知，新的在前。每個登入者都能看自己的，不需要案件權限。"""
    result = await db.execute(
        select(UserNotification)
        .where(UserNotification.recipient_user_id == current_user.id)
        .order_by(UserNotification.created_at.desc())
        .limit(MY_NOTIFICATIONS_LIMIT)
    )
    return [_user_notification_out(item) for item in result.scalars()]


@router.post("/admin/my-notifications/{notification_id}/read", response_model=UserNotificationOut)
async def mark_my_notification_read(
    notification_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> UserNotificationOut:
    item = await db.get(UserNotification, notification_id)
    # 別人的通知當作不存在。
    if item is None or item.recipient_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")
    if item.read_at is None:
        item.read_at = datetime.now(timezone.utc)
        await db.commit()
    return _user_notification_out(item)


@router.post("/admin/my-notifications/read-all", response_model=UserNotificationReadAllOut)
async def mark_all_my_notifications_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> UserNotificationReadAllOut:
    result = await db.execute(
        update(UserNotification)
        .where(UserNotification.recipient_user_id == current_user.id, UserNotification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return UserNotificationReadAllOut(updated=result.rowcount or 0)


@router.get("/admin/notification-outbox", response_model=list[NotificationOutboxOut])
async def list_failed_notifications(
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    """寄送失敗（已達自動重試上限）的通知，最新的在前，最多 200 則。沒指定
    校區時列出你負責的所有校區。"""
    require_scope(current_user, "booking.read")
    if campus_key:
        require_scope(current_user, "booking.read", campus_keys=[campus_key])
        scope: set[str] | None = {campus_key}
    else:
        scope = campus_scope(current_user)
    return await outbox_admin.list_failed(db, scope)


@router.post("/admin/notification-outbox/{message_id}/retry", response_model=NotificationOutboxOut)
async def retry_failed_notification(
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """把一則寄送失敗的通知重新排入，下一輪定期工作（約一分鐘內）重送。
    已送到的管道與收件人不會重複送。"""
    require_scope(current_user, "booking.handle")
    loaded = await outbox_admin.load_for_update(db, message_id)
    if loaded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")
    message, campus_key = loaded
    require_scope(current_user, "booking.handle", campus_keys=[campus_key])
    if message.status != OutboxStatus.FAILED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": "這則通知已經不是寄送失敗狀態，請重新整理"},
        )
    await outbox_admin.requeue_with_audit(db, message, campus_key, actor_user_id=current_user.id, source="admin")
    await db.commit()
    return await outbox_admin.describe(db, message, campus_key)


@router.post("/admin/notification-outbox/retry", response_model=NotificationRetryBatchOut)
async def retry_failed_notifications(
    body: NotificationRetryBatchRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """批次重新排入。只處理仍是寄送失敗、且在你校區範圍內的；其他的算
    skipped，不整批失敗（清單可能已經被別人處理過）。"""
    require_scope(current_user, "booking.handle")
    requeued = skipped = 0
    for message_id in dict.fromkeys(body.ids):
        loaded = await outbox_admin.load_for_update(db, message_id)
        if loaded is None or not covers_campus(current_user, loaded[1]) or loaded[0].status != OutboxStatus.FAILED.value:
            skipped += 1
            continue
        await outbox_admin.requeue_with_audit(
            db, loaded[0], loaded[1], actor_user_id=current_user.id, source="admin"
        )
        requeued += 1
    await db.commit()
    return {"requeued": requeued, "skipped": skipped}
