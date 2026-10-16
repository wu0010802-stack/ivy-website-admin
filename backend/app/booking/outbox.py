from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import OutboxMessage, OutboxStatus


def enqueue_outbox(db: AsyncSession, visit_request_id: uuid.UUID, kind: str, payload: dict) -> None:
    now = datetime.now(timezone.utc)
    db.add(
        OutboxMessage(
            id=uuid.uuid4(),
            visit_request_id=visit_request_id,
            kind=kind,
            payload=payload,
            created_at=now,
            next_attempt_at=now,
        )
    )


# 寄給家長的確認信（只走 Email，不寫站內通知、不推 LINE）。payload 只放 id，
# 修改連結在寄件當下才重算，原始 token 不進 DB。
PARENT_VISIT_BOOKED = "parent_visit_booked"
PARENT_VISIT_CHANGED = "parent_visit_changed"
PARENT_VISIT_CANCELLED = "parent_visit_cancelled"
# 停班停課通知（2026-10-14 規格 §3.3）：那天園方停課，請家長用修改連結改約或取消。
# 只由 enqueue_day_closed_email 排（帶去重鍵與原因），不走 enqueue_parent_email。
PARENT_VISIT_DAY_CLOSED = "parent_visit_day_closed"
# 參觀前 24 小時提醒家長（2026-10-15 規格 docs/specs/2026-10-15-parent-visit-reminder-design.md）。
# 只由 notifications/reminders.enqueue_due_parent_reminders 排（帶去重鍵與場次），不走 enqueue_parent_email。
PARENT_VISIT_REMINDER = "parent_visit_reminder"
PARENT_KINDS = frozenset(
    {PARENT_VISIT_BOOKED, PARENT_VISIT_CHANGED, PARENT_VISIT_CANCELLED, PARENT_VISIT_DAY_CLOSED, PARENT_VISIT_REMINDER}
)


async def enqueue_parent_email(db: AsyncSession, visit_request, kind: str) -> None:
    """排一封家長信（沒有 Email 就不排）。

    變更信不重複排：同案已有一封還沒被認領（pending）的變更信時就不再新增——內容在
    寄件當下才依案件最新狀態組成，連續改好幾次也只需要寄一封，家長端灌不爆寄信管線。
    已被認領（leased）的不算：worker 可能已經讀完案件、組好內容，這次的變更要另外寄。"""
    if kind not in PARENT_KINDS or kind in (PARENT_VISIT_DAY_CLOSED, PARENT_VISIT_REMINDER):
        raise ValueError(kind)
    if not visit_request.email:
        return
    if kind == PARENT_VISIT_CHANGED:
        queued = await db.scalar(
            select(OutboxMessage.id)
            .where(
                OutboxMessage.visit_request_id == visit_request.id,
                OutboxMessage.kind == kind,
                OutboxMessage.status == OutboxStatus.PENDING.value,
            )
            .limit(1)
        )
        if queued is not None:
            return
    enqueue_outbox(
        db, visit_request.id, kind, {"campus_key": visit_request.campus_key, "receipt_id": str(visit_request.id)}
    )


def day_closed_dedupe_key(visit_request_id: uuid.UUID, day: date) -> str:
    """同一筆預約、同一個停課日只寄一次：再按一次「停班停課」不會重寄。"""
    return f"day_closed:{visit_request_id}:{day.isoformat()}"


async def enqueue_day_closed_email(db: AsyncSession, visit_request, *, day: date, reason: str) -> bool:
    """排一封停課通知（呼叫端已確認有 Email）。同一個去重鍵已經排過就不再排，回傳是否新排入。

    原因是園方填給家長看的文字，放在 payload；寄出當下才組內容、重算修改連結。"""
    now = datetime.now(timezone.utc)
    stmt = (
        pg_insert(OutboxMessage)
        .values(
            id=uuid.uuid4(),
            visit_request_id=visit_request.id,
            kind=PARENT_VISIT_DAY_CLOSED,
            payload={
                "campus_key": visit_request.campus_key,
                "receipt_id": str(visit_request.id),
                "closure_date": day.isoformat(),
                "reason": reason,
            },
            created_at=now,
            next_attempt_at=now,
            status=OutboxStatus.PENDING.value,
            attempts=0,
            dedupe_key=day_closed_dedupe_key(visit_request.id, day),
        )
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
        .returning(OutboxMessage.id)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None
