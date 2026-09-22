from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications import service as notification_service
from app.notifications.email_adapter import EmailAdapter
from app.workers import lease_service


async def process_outbox_batch(
    db: AsyncSession, adapter: EmailAdapter, *, worker_id: str = "worker-1", limit: int = 10
) -> dict[str, int]:
    """認領並處理最多 `limit` 筆到期的 outbox 工作。每筆工作獨立
    commit/rollback，一筆失敗不影響其他筆繼續處理。"""
    sent = 0
    failed = 0
    for _ in range(limit):
        message = await lease_service.claim_next(db, worker_id)
        if message is None:
            break
        await db.commit()  # 先讓 lease 生效，避免同一批裡的下一輪重複認領同一筆

        try:
            await notification_service.dispatch_outbox_message(
                db,
                campus_key=message.payload.get("campus_key", ""),
                kind=message.kind,
                payload=message.payload,
                adapter=adapter,
            )
        except Exception as exc:  # noqa: BLE001 - 任何寄送/處理失敗都走重試路徑
            await lease_service.fail(db, message, error_code=type(exc).__name__)
            await db.commit()
            failed += 1
            continue

        await lease_service.ack(db, message)
        await db.commit()
        sent += 1

    return {"sent": sent, "failed": failed}
