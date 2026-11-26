from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import OutboxMessage, OutboxStatus
from app.notifications.models import LinePnpMessage, NotificationDelivery


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


# 寄給家長的確認信（Email；家長綁了 LINE 通知時也推到他的 LINE，2026-11-16）。不寫站內通知、
# 不推園方群組。payload 只放 id，修改連結在寄件當下才重算，原始 token 不進 DB。
PARENT_VISIT_BOOKED = "parent_visit_booked"
PARENT_VISIT_CHANGED = "parent_visit_changed"
PARENT_VISIT_CANCELLED = "parent_visit_cancelled"
# 停班停課通知（2026-10-14 規格 §3.3）：那天園方停課，請家長用修改連結改約或取消。
# 只由 enqueue_day_closed_email 排（帶去重鍵與原因），不走 enqueue_parent_email。
PARENT_VISIT_DAY_CLOSED = "parent_visit_day_closed"
# 參觀前 24 小時提醒家長（2026-10-15 規格 docs/specs/2026-10-15-parent-visit-reminder-design.md）。
# 只由 notifications/reminders.enqueue_due_parent_reminders 排（帶去重鍵與場次），不走 enqueue_parent_email。
PARENT_VISIT_REMINDER = "parent_visit_reminder"
# 家長自己把 Email 改掉時，寄到「舊」信箱的變更通知（2026-10-22 資安稽核）：外流的修改連結
# 能把 Email 改成別人的，原家長要知道。不含連結與個資，只由 enqueue_email_changed_notice 排。
# 這是唯一在 payload 放 Email 的家長信：寄出或略過就從 payload 拿掉，案件匿名化時也清。
PARENT_EMAIL_CHANGED = "parent_email_changed"
PARENT_KINDS = frozenset(
    {
        PARENT_VISIT_BOOKED,
        PARENT_VISIT_CHANGED,
        PARENT_VISIT_CANCELLED,
        PARENT_VISIT_DAY_CLOSED,
        PARENT_VISIT_REMINDER,
        PARENT_EMAIL_CHANGED,
    }
)


async def enqueue_parent_email(db: AsyncSession, visit_request, kind: str, *, by_parent: bool = False) -> None:
    """排一封家長信（沒有 Email、沒綁 LINE 通知、這校也沒開通知型訊息就不排；2026-11-16 起綁了 LINE 的同一則
    也推 LINE，2026-11-25 起沒 Email 也沒綁的家長改送通知型訊息；哪些管道真的送由 notifications.service
    在送出當下決定）。

    變更信不重複排：同案已有一封還沒被認領（pending）的變更信時就不再新增——內容在
    寄件當下才依案件最新狀態組成，連續改好幾次也只需要寄一封，家長端灌不爆寄信管線。
    已被認領（leased）的不算：worker 可能已經讀完案件、組好內容，這次的變更要另外寄。
    已有管道送出、其他管道失敗而回到 pending 等重試的也不算（2026-11-26）：重試只補沒送成的管道
    （notification_deliveries／line_pnp_messages），併進去的話已送出的 Email 或 LINE 永遠收不到這次的變更，
    園方重新產生或更正 Email 換的新連結也寄不出去。

    by_parent：家長自己在官網送出、改資料、改期或取消觸發的通知。payload 記下來，送出當下
    notifications.service 據此套「通知型訊息每案每日上限」（line_pnp.PARENT_DAILY_CAP，2026-11-26 資安檢查）；
    園方或系統觸發的不受上限影響。變更信去重只併同一種來源，園方的變更不會被併進一封要套上限的信。"""
    if kind not in PARENT_KINDS or kind in (PARENT_VISIT_DAY_CLOSED, PARENT_VISIT_REMINDER, PARENT_EMAIL_CHANGED):
        raise ValueError(kind)
    if not visit_request.email:
        from app.notifications import line_parent, line_pnp

        if not await line_parent.has_active_link(db, visit_request.id) and not line_pnp.reachable(
            visit_request, await line_pnp.enabled_campuses(db)
        ):
            return
    if kind == PARENT_VISIT_CHANGED:
        queued = (
            await db.scalars(
                select(OutboxMessage.payload).where(
                    OutboxMessage.visit_request_id == visit_request.id,
                    OutboxMessage.kind == kind,
                    OutboxMessage.status == OutboxStatus.PENDING.value,
                    ~exists().where(NotificationDelivery.outbox_message_id == OutboxMessage.id),
                    ~exists().where(LinePnpMessage.outbox_message_id == OutboxMessage.id),
                )
            )
        ).all()
        if any(is_by_parent(payload) == by_parent for payload in queued):
            return
    payload = {"campus_key": visit_request.campus_key, "receipt_id": str(visit_request.id)}
    if by_parent:
        payload["by_parent"] = True
    enqueue_outbox(db, visit_request.id, kind, payload)


def is_by_parent(payload: object) -> bool:
    """這則家長通知是不是家長自己的動作觸發的（見 enqueue_parent_email 的 by_parent）。"""
    return isinstance(payload, dict) and payload.get("by_parent") is True


def enqueue_email_changed_notice(db: AsyncSession, visit_request, old_email: str) -> None:
    """家長自己改了 Email：通知舊信箱（呼叫端已確認舊值有值、和新值不同）。舊信箱只能在排入
    當下記下來，寄件當下案件上已經是新的。"""
    enqueue_outbox(
        db,
        visit_request.id,
        PARENT_EMAIL_CHANGED,
        {"campus_key": visit_request.campus_key, "receipt_id": str(visit_request.id), "old_email": old_email},
    )


def without_old_email(payload: dict) -> dict:
    """變更通知寄出、略過或案件匿名化後，payload 不再留舊信箱。"""
    return {key: value for key, value in payload.items() if key != "old_email"}


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
