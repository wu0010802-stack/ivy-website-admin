from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import OutboxMessage


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
