from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import campus_scope, covers_campus, require_scope
from app.booking.models import OutboxStatus, VisitRequest, VisitSlot
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
    # 舊流程逾期未處理提醒（visit_request_overdue）的細分原因，其他通知為 null。
    reason: str | None
    status: str
    attempts: int
    # 最後一次失敗的例外類別名稱（例如 SMTPServerDisconnected），不含訊息內容。
    error_code: str | None
    created_at: datetime
    next_attempt_at: datetime
    requeued_at: datetime | None
    delivered: OutboxDeliveredOut
    # 案件的家長稱呼（讀取時查，2026-10-05 業主裁定通知顯示家長姓名）；匿名化後為 null。
    parent_name: str | None = None


class NotificationOutboxPageOut(BaseModel):
    # 最新的 outbox_admin.LIST_LIMIT 則。
    items: list[NotificationOutboxOut]
    # 範圍內寄送失敗的總則數，可能比 items 多；和總覽的失敗數同一個數字。
    total: int


class NotificationRetryBatchRequest(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=outbox_admin.LIST_LIMIT)


class NotificationRetryBatchOut(BaseModel):
    requeued: int
    # 已經不是寄送失敗（別人先重送了、或已送出）、找不到或不在你的校區範圍。
    skipped: int


class NotificationSlotOut(BaseModel):
    slot_date: date
    start_time: time
    end_time: time


class NotificationInboxItemOut(BaseModel):
    """依校區共用的案件通知（新的參觀預約、已確認、已改期、已取消、逾期提醒…）。"""

    id: uuid.UUID
    campus_key: str
    kind: str
    # outbox 排入時的內容：receipt_id（案件編號）與少數摘要欄位，不放家長個資。
    payload: dict
    # 案件目前的參觀場次，讀取時依 payload.receipt_id 查，不寫進 payload；
    # 只有日期時段。案件還沒排場次、已匿名化或已刪除時為 null。
    slot: NotificationSlotOut | None = None
    # 案件的家長稱呼，同樣讀取時查、不寫進 payload（2026-10-05 業主裁定通知顯示
    # 家長姓名；電話、Email、孩子資料照舊不放）。已匿名化或已刪除時為 null。
    parent_name: str | None = None
    created_at: datetime
    read_at: datetime | None


def _receipt_uuid(payload: dict | None) -> uuid.UUID | None:
    value = (payload or {}).get("receipt_id")
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


async def _visit_details(
    db: AsyncSession, items: list[NotificationInboxItem]
) -> dict[uuid.UUID, tuple[NotificationSlotOut | None, str]]:
    """一次 IN 查詢把整頁通知對應案件的場次與家長稱呼查出來，不逐筆查。"""
    ids = {visit_id for item in items if (visit_id := _receipt_uuid(item.payload)) is not None}
    if not ids:
        return {}
    result = await db.execute(
        select(VisitRequest.id, VisitRequest.parent_name, VisitSlot.slot_date, VisitSlot.start_time, VisitSlot.end_time)
        .outerjoin(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
        # 匿名化後的案件不再對應到任何一天的參觀，也不再有家長稱呼。
        .where(VisitRequest.id.in_(ids), VisitRequest.anonymized_at.is_(None))
    )
    return {
        visit_id: (
            NotificationSlotOut(slot_date=slot_date, start_time=start_time, end_time=end_time)
            if slot_date is not None
            else None,
            parent_name,
        )
        for visit_id, parent_name, slot_date, start_time, end_time in result.all()
    }


@router.get("/admin/notifications", response_model=list[NotificationInboxItemOut])
async def list_notifications(
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[NotificationInboxItemOut]:
    require_scope(current_user, "booking.read")
    stmt = select(NotificationInboxItem)
    if campus_key:
        require_scope(current_user, "booking.read", campus_keys=[campus_key])
        stmt = stmt.where(NotificationInboxItem.campus_key == campus_key)
    elif (scope := campus_scope(current_user)) is not None:
        stmt = stmt.where(NotificationInboxItem.campus_key.in_(scope))
    stmt = stmt.order_by(NotificationInboxItem.created_at.desc()).limit(100)
    items = list((await db.execute(stmt)).scalars())
    details = await _visit_details(db, items)
    out: list[NotificationInboxItemOut] = []
    for item in items:
        visit_id = _receipt_uuid(item.payload)
        slot, parent_name = details.get(visit_id, (None, None)) if visit_id else (None, None)
        out.append(
            NotificationInboxItemOut(
                id=item.id,
                campus_key=item.campus_key,
                kind=item.kind,
                payload=item.payload or {},
                slot=slot,
                parent_name=parent_name,
                created_at=item.created_at,
                read_at=item.read_at,
            )
        )
    return out


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
    # read_at 是全校共用的處理狀態，不是個人已讀：有人標了，同校其他人就
    # 看不到未讀提示。2026-09-25 業主裁定開放給櫃台的處理項目沒有列這一項，
    # 業主確認前維持 booking.manage（總管理者、分校管理者），櫃台只看。
    require_scope(current_user, "booking.manage", campus_keys=[item.campus_key])
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
    # 那個人現在的顯示名稱（讀取時依 actor_email 查）；沒填或帳號已刪除時為 null。
    actor_display_name: str | None = None
    created_at: datetime
    read_at: datetime | None


class UserNotificationReadAllOut(BaseModel):
    updated: int


# 個人通知只列最近這麼多則。
MY_NOTIFICATIONS_LIMIT = 100


def _actor_email(item: UserNotification) -> str | None:
    value = (item.payload or {}).get("actor_email")
    return value if isinstance(value, str) else None


async def _actor_names(db: AsyncSession, items: list[UserNotification]) -> dict[str, str | None]:
    """通知裡只記當時操作者的 email；顯示名稱讀取時再查（lower(email) 有唯一
    索引），同事改名後舊通知也跟著顯示新名字。key 是小寫 email。"""
    emails = {email.lower() for item in items if (email := _actor_email(item))}
    if not emails:
        return {}
    result = await db.execute(
        select(func.lower(User.email), User.display_name).where(func.lower(User.email).in_(emails))
    )
    return dict(result.all())


def _user_notification_out(item: UserNotification, names: dict[str, str | None]) -> UserNotificationOut:
    payload = item.payload or {}
    publish_at = payload.get("publish_at")
    actor_email = _actor_email(item)
    return UserNotificationOut(
        id=item.id,
        kind=item.kind,
        campus_key=item.campus_key,
        content_kind=payload.get("content_kind"),
        revision_version=payload.get("revision_version"),
        note=payload.get("note"),
        error=payload.get("error"),
        publish_at=datetime.fromisoformat(publish_at) if isinstance(publish_at, str) else None,
        actor_email=actor_email,
        actor_display_name=names.get(actor_email.lower()) if actor_email else None,
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
    items = list(result.scalars())
    names = await _actor_names(db, items)
    return [_user_notification_out(item, names) for item in items]


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
    return _user_notification_out(item, await _actor_names(db, [item]))


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


@router.get("/admin/notification-outbox", response_model=NotificationOutboxPageOut)
async def list_failed_notifications(
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """寄送失敗（已達自動重試上限）的通知，最新的在前，最多 200 則；total 是
    全部的則數，超過 200 則時後台提示重新寄送後再按一次。沒指定校區時列出你
    負責的所有校區。"""
    require_scope(current_user, "booking.read")
    if campus_key:
        require_scope(current_user, "booking.read", campus_keys=[campus_key])
        scope: set[str] | None = {campus_key}
    else:
        scope = campus_scope(current_user)
    return {
        "items": await outbox_admin.list_failed(db, scope, limit=outbox_admin.LIST_LIMIT),
        "total": await outbox_admin.count_failed(db, scope),
    }


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
