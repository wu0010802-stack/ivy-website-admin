from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import OutboxMessage, OutboxStatus

DEFAULT_LEASE_SECONDS = 60
MAX_ATTEMPTS = 5
_BACKOFF_SECONDS = [10, 30, 60, 300, 900]  # 每次重試間隔，超出表長度就用最後一個


async def claim_next(db: AsyncSession, worker_id: str) -> OutboxMessage | None:
    """認領一筆該處理的工作：本來就是 pending 且到了 next_attempt_at，
    或者是被別的 worker 租走但租約已過期（worker crash 沒 ack，租約
    到期後視為可以被重新認領——這是 worker crash 後恢復的機制）。"""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(OutboxMessage)
        .where(
            OutboxMessage.next_attempt_at <= now,
            (
                (OutboxMessage.status == OutboxStatus.PENDING.value)
                | (
                    (OutboxMessage.status == OutboxStatus.LEASED.value)
                    & (OutboxMessage.leased_until < now)
                )
            ),
        )
        .order_by(OutboxMessage.next_attempt_at)
        .limit(1)
        .with_for_update(skip_locked=True)
        # 同一個 session 裡先前載入過的舊值（例如後台剛重新排入、重試次數
        # 已歸零）不能沿用，認領時一律以資料庫為準。
        .execution_options(populate_existing=True)
    )
    message = result.scalar_one_or_none()
    if message is None:
        return None

    message.status = OutboxStatus.LEASED.value
    message.leased_by = worker_id
    message.leased_until = now + timedelta(seconds=DEFAULT_LEASE_SECONDS)
    await db.flush()
    return message


async def ack(db: AsyncSession, message: OutboxMessage) -> None:
    message.status = OutboxStatus.SENT.value
    message.sent_at = datetime.now(timezone.utc)
    message.leased_by = None
    message.leased_until = None
    message.error_code = None
    await db.flush()


async def fail(db: AsyncSession, message: OutboxMessage, error_code: str) -> None:
    message.attempts += 1
    message.error_code = error_code
    message.leased_by = None
    message.leased_until = None
    if message.attempts >= MAX_ATTEMPTS:
        message.status = OutboxStatus.FAILED.value
    else:
        message.status = OutboxStatus.PENDING.value
        backoff_index = min(message.attempts - 1, len(_BACKOFF_SECONDS) - 1)
        message.next_attempt_at = datetime.now(timezone.utc) + timedelta(
            seconds=_BACKOFF_SECONDS[backoff_index]
        )
    await db.flush()


async def skip(db: AsyncSession, message: OutboxMessage) -> None:
    """提醒到寄送當下已不適用（例如已改期、已取消）：不寄、不算失敗。"""
    message.status = OutboxStatus.SKIPPED.value
    message.leased_by = None
    message.leased_until = None
    message.error_code = None
    await db.flush()


def requeue(message: OutboxMessage, now: datetime | None = None) -> None:
    """把寄送失敗（達重試上限）的訊息重新排入：重試次數歸零、清錯誤碼，
    下一輪定期工作就會認領。已送達的管道與收件人記在
    notification_deliveries，重送時會略過——站內通知不會多一則、LINE 群組
    不會再推一次，只補寄還沒寄成功的信。"""
    now = now or datetime.now(timezone.utc)
    message.status = OutboxStatus.PENDING.value
    message.attempts = 0
    message.error_code = None
    message.next_attempt_at = now
    message.requeued_at = now
    message.leased_by = None
    message.leased_until = None
