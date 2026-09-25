"""寄送失敗通知的查詢與重新排入（規格 L271、L331）。

worker 對同一筆通知重試 `lease_service.MAX_ATTEMPTS` 次仍失敗就標成 failed、
不再自動處理。這裡讓後台（API）與維運（CLI）看得到是哪幾則、卡在哪裡、哪些
管道已經送到，並把它們重新排入；重送只補還沒送到的管道與收件人（見
lease_service.requeue）。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import OutboxMessage, OutboxStatus, VisitRequest
from app.common.timezones import now_utc
from app.notifications.models import NotificationDelivery
from app.operations import audit_service
from app.workers import lease_service

LIST_LIMIT = 200


def _failed_stmt(campus_keys: set[str] | None):
    # outbox 本身沒有校區欄位，要經案件取得，跟總覽的失敗數同一個算法。
    stmt = (
        select(OutboxMessage, VisitRequest.campus_key)
        .join(VisitRequest, OutboxMessage.visit_request_id == VisitRequest.id)
        .where(OutboxMessage.status == OutboxStatus.FAILED.value)
    )
    if campus_keys is not None:
        stmt = stmt.where(VisitRequest.campus_key.in_(campus_keys))
    return stmt


async def _delivery_summary(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    summary = {message_id: {"inbox": False, "line": False, "email": 0} for message_id in ids}
    if not ids:
        return summary
    rows = await db.execute(
        select(NotificationDelivery.outbox_message_id, NotificationDelivery.channel, func.count())
        .where(NotificationDelivery.outbox_message_id.in_(ids))
        .group_by(NotificationDelivery.outbox_message_id, NotificationDelivery.channel)
    )
    for message_id, channel, count in rows.all():
        if channel == "email":
            summary[message_id]["email"] = count
        elif channel in ("inbox", "line"):
            summary[message_id][channel] = count > 0
    return summary


def _out(message: OutboxMessage, campus_key: str, delivered: dict) -> dict:
    payload = message.payload or {}
    return {
        "id": message.id,
        "campus_key": campus_key,
        "visit_request_id": message.visit_request_id,
        "kind": message.kind,
        "reason": payload.get("reason") if isinstance(payload.get("reason"), str) else None,
        "status": message.status,
        "attempts": message.attempts,
        "error_code": message.error_code,
        "created_at": message.created_at,
        "next_attempt_at": message.next_attempt_at,
        "requeued_at": message.requeued_at,
        "delivered": delivered,
    }


async def list_failed(
    db: AsyncSession, campus_keys: set[str] | None, *, limit: int = LIST_LIMIT
) -> list[dict]:
    """寄送失敗的通知，最新的在前。campus_keys 為 None 代表不限校區。"""
    rows = (
        await db.execute(_failed_stmt(campus_keys).order_by(OutboxMessage.created_at.desc()).limit(limit))
    ).all()
    delivered = await _delivery_summary(db, [message.id for message, _ in rows])
    return [_out(message, campus_key, delivered[message.id]) for message, campus_key in rows]


async def count_failed(db: AsyncSession, campus_keys: set[str] | None) -> int:
    """範圍內寄送失敗的總則數，不受列表上限影響（和總覽的失敗數同一個數字）。"""
    stmt = select(func.count()).select_from(_failed_stmt(campus_keys).subquery())
    return (await db.execute(stmt)).scalar_one()


async def describe(db: AsyncSession, message: OutboxMessage, campus_key: str) -> dict:
    return _out(message, campus_key, (await _delivery_summary(db, [message.id]))[message.id])


async def load_for_update(db: AsyncSession, message_id: uuid.UUID) -> tuple[OutboxMessage, str] | None:
    """鎖住這筆通知（與 worker 認領互斥），回傳 (通知, 校區)。"""
    row = (
        await db.execute(
            select(OutboxMessage, VisitRequest.campus_key)
            .join(VisitRequest, OutboxMessage.visit_request_id == VisitRequest.id)
            .where(OutboxMessage.id == message_id)
            .with_for_update(of=OutboxMessage)
        )
    ).first()
    return (row[0], row[1]) if row is not None else None


async def requeue_with_audit(
    db: AsyncSession,
    message: OutboxMessage,
    campus_key: str,
    *,
    actor_user_id: uuid.UUID | None,
    source: str,
    now: datetime | None = None,
) -> None:
    """重新排入並寫稽核：記下重排前的重試次數與最後錯誤碼（重排後會歸零）。"""
    previous = {"attempts": message.attempts, "error_code": message.error_code}
    lease_service.requeue(message, now or now_utc())
    await audit_service.log_action(
        db,
        actor_user_id=actor_user_id,
        action="notification_outbox.retry",
        target_type="notification_outbox",
        target_id=str(message.id),
        campus_key=campus_key,
        metadata={
            "kind": message.kind,
            "visit_request_id": str(message.visit_request_id),
            "previous_attempts": previous["attempts"],
            "previous_error_code": previous["error_code"],
            "source": source,
        },
    )


async def requeue_all_failed(
    db: AsyncSession, campus_keys: set[str] | None, *, actor_user_id: uuid.UUID | None, source: str
) -> int:
    """把範圍內所有寄送失敗的通知重新排入（CLI 用）。呼叫端負責 commit。"""
    rows = (
        await db.execute(
            _failed_stmt(campus_keys).order_by(OutboxMessage.created_at).with_for_update(of=OutboxMessage)
        )
    ).all()
    now = now_utc()
    for message, campus_key in rows:
        await requeue_with_audit(db, message, campus_key, actor_user_id=actor_user_id, source=source, now=now)
    return len(rows)
