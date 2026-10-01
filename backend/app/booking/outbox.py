from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
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
PARENT_KINDS = frozenset({PARENT_VISIT_BOOKED, PARENT_VISIT_CHANGED, PARENT_VISIT_CANCELLED})


async def enqueue_parent_email(db: AsyncSession, visit_request, kind: str) -> None:
    """排一封家長信（沒有 Email 就不排）。

    變更信不重複排：同案已有一封還沒被認領（pending）的變更信時就不再新增——內容在
    寄件當下才依案件最新狀態組成，連續改好幾次也只需要寄一封，家長端灌不爆寄信管線。
    已被認領（leased）的不算：worker 可能已經讀完案件、組好內容，這次的變更要另外寄。"""
    if kind not in PARENT_KINDS:
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
