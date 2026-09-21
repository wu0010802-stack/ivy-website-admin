from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Role, User
from app.notifications.email_adapter import EmailAdapter
from app.notifications.models import NotificationInboxItem

_KIND_LABELS = {
    "visit_request_created": "新的參觀需求",
    "visit_request_confirmed": "參觀預約已確認",
    "visit_request_cancelled": "參觀預約已取消",
    "visit_request_rescheduled": "參觀預約已改期",
}


async def get_notification_recipients(db: AsyncSession, campus_key: str) -> list[User]:
    """依校區通知：只給目前真的還有這個校區權限、且帳號啟用中的人員。
    這裡每次都即時查詢目前的 scope，不在建立通知時就把收件人清單寫死，
    帳號被停權或改 scope 後自然收不到後續通知，不需要額外清理。"""
    result = await db.execute(select(User).where(User.is_active.is_(True)))
    recipients = []
    for user in result.scalars():
        if user.role == Role.SUPER_ADMIN:
            recipients.append(user)
        elif user.role == Role.CAMPUS_ADMIN:
            await db.refresh(user, attribute_names=["campus_scopes"])
            if any(s.campus_key == campus_key for s in user.campus_scopes):
                recipients.append(user)
    return recipients


async def dispatch_outbox_message(
    db: AsyncSession, *, campus_key: str, kind: str, payload: dict, adapter: EmailAdapter
) -> None:
    """處理一筆 outbox 訊息：寫站內通知＋寄信。任何一個收件人寄信失敗
    （含未配置）都讓整筆工作視為失敗，交給 worker 的重試機制處理，
    不會靜默丟失、也不假裝已寄出。"""
    label = _KIND_LABELS.get(kind, kind)
    db.add(
        NotificationInboxItem(
            id=uuid.uuid4(),
            campus_key=campus_key,
            kind=kind,
            payload=payload,
            created_at=datetime.now(timezone.utc),
        )
    )

    recipients = await get_notification_recipients(db, campus_key)
    for user in recipients:
        adapter.send(
            to=user.email,
            subject=f"[常春藤官網] {label}",
            body=f"校區：{campus_key}\n案件：{payload.get('receipt_id')}\n類型：{label}",
        )
