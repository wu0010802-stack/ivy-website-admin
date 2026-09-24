from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications import service as notification_service
from app.notifications.email_adapter import EmailAdapter
from app.workers import lease_service


async def process_outbox_batch(
    db: AsyncSession, adapter: EmailAdapter | None, *, worker_id: str = "worker-1", limit: int = 10
) -> dict[str, int]:
    """認領並處理最多 `limit` 筆到期的 outbox 工作。每筆工作獨立
    commit/rollback，一筆失敗不影響其他筆繼續處理。`adapter` 為 None 時
    只寫站內通知（部署環境沒設定寄信）。"""
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
                outbox_message_id=message.id,
                campus_key=message.payload.get("campus_key", ""),
                kind=message.kind,
                payload=message.payload,
                adapter=adapter,
                created_at=message.created_at,
            )
        except Exception as exc:  # noqa: BLE001 - 任何寄送/處理失敗都走重試路徑
            # 先丟掉這一輪還沒提交的工作，再記錄失敗。少了這個 rollback，
            # dispatch 半途寫進去的站內通知會跟著 fail() 一起被 commit，
            # 每重試一次就多一筆重複通知。
            await db.rollback()
            # rollback 會把 message 實例 expire 掉，async 下直接碰屬性會
            # 觸發 lazy load（MissingGreenlet），所以先明確重新載入。
            await db.refresh(message)
            await lease_service.fail(db, message, error_code=type(exc).__name__)
            await db.commit()
            failed += 1
            continue

        await lease_service.ack(db, message)
        await db.commit()
        sent += 1

    return {"sent": sent, "failed": failed}
