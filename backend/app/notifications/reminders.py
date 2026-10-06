"""定期工作產生的提醒通知：即將參觀（規格 L268、L272）。

案件的一般通知（新案、確認、取消、改期…）是案件交易裡直接寫 outbox；這裡的
提醒沒有觸發的動作，只能由定期工作（workers/maintenance.py）每一輪掃描、
到點時寫進 outbox，之後跟其他通知一樣由 worker 寫站內通知、推 LINE 群組、
寄信給能處理這校案件的人員。

去重：每則提醒帶 `dedupe_key`（outbox_messages 唯一索引），同一案件同一種
提醒只寫一次，重跑、兩個程序同時掃都不會重複。即將參觀的鍵含時段 id——
改期到另一個時段就是新的鍵，依新時段重新判斷；舊時段那則如果還沒送出，寄送
當下 `still_applies` 會發現時段已經不是這個，標成 skipped 不寄。

閾值（都是常數，改這裡即可；信件與 LINE 文案從這裡帶出數字，後台 labels.ts 寫死
同樣的數字，admin 的 labelCoverage.test.ts 會解析這裡的常數比對，改了會提醒）：
- 即將參觀：已確認的參觀在開始前 `UPCOMING_VISIT_LEAD`（24 小時）內提醒一次。
  確認或改期到這個時段時就已經在這個範圍內的（例如當天才確認、改到明天上午）
  不另外提醒——「新的參觀預約」「已確認」「已改期」那則通知就是提醒。改期不會更新
  confirmed_at，換到這個時段的時間看最後一筆 `rescheduled` 歷程。
- 逾期未處理（visit_request_overdue：新需求放太久、待確認占位快到期）是舊流程的
  提醒，2026-10-06 隨舊狀態一起拿掉。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import (
    OutboxMessage,
    OutboxStatus,
    VisitRequest,
    VisitRequestEvent,
    VisitRequestStatus,
    VisitSlot,
)
from app.common.timezones import now_utc, slot_start_utc, today_local

UPCOMING_VISIT_KIND = "visit_upcoming"
REMINDER_KINDS = frozenset({UPCOMING_VISIT_KIND})

UPCOMING_VISIT_LEAD = timedelta(hours=24)


def whole_hours(delta: timedelta) -> int:
    return int(delta.total_seconds() // 3600)


async def _enqueue(
    db: AsyncSession, visit_request_id: uuid.UUID, kind: str, payload: dict, dedupe_key: str
) -> bool:
    """寫一則提醒；同一個 dedupe_key 已經寫過就什麼都不做。回傳是否新寫入。
    寫入時間一律用真正的現在（不是掃描用的 now），worker 才會立刻認領。"""
    now = now_utc()
    stmt = (
        pg_insert(OutboxMessage)
        .values(
            id=uuid.uuid4(),
            visit_request_id=visit_request_id,
            kind=kind,
            payload=payload,
            created_at=now,
            next_attempt_at=now,
            status=OutboxStatus.PENDING.value,
            attempts=0,
            dedupe_key=dedupe_key,
        )
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
        .returning(OutboxMessage.id)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


def _last_rescheduled_at():
    # 改期不動 confirmed_at；最後一筆改期歷程就是換到目前這個時段的時間。
    return (
        select(func.max(VisitRequestEvent.created_at))
        .where(
            VisitRequestEvent.visit_request_id == VisitRequest.id,
            VisitRequestEvent.event_type == "rescheduled",
        )
        .scalar_subquery()
    )


def upcoming_key(visit_request_id: uuid.UUID, slot_id: uuid.UUID) -> str:
    return f"{UPCOMING_VISIT_KIND}:{visit_request_id}:{slot_id}"


async def enqueue_due_reminders(db: AsyncSession, now: datetime | None = None) -> int:
    """掃描到點的提醒寫進 outbox，回傳新寫入的則數。呼叫端負責 commit。
    `now` 是判斷「到點了沒」的時間點，預設現在（測試可以指定）。"""
    now = now or now_utc()
    created = 0

    # 即將參觀。slot_date 是營運時區的日期，先用日期粗篩再逐筆算開始時間。
    today = today_local(now)
    upcoming = await db.execute(
        select(
            VisitRequest.id,
            VisitRequest.campus_key,
            VisitRequest.confirmed_at,
            _last_rescheduled_at(),
            VisitSlot,
        )
        .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
        .where(
            VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
            VisitRequest.anonymized_at.is_(None),
            VisitSlot.slot_date >= today,
            VisitSlot.slot_date <= today + timedelta(days=2),
        )
    )
    for visit_id, campus_key, confirmed_at, rescheduled_at, slot in upcoming.all():
        starts = slot_start_utc(slot.slot_date, slot.start_time)
        remind_at = starts - UPCOMING_VISIT_LEAD
        if not remind_at <= now < starts:
            continue
        # 確認或改期到這個時段時已經在提醒範圍內：那則通知就是提醒。
        on_this_slot_since = max((t for t in (confirmed_at, rescheduled_at) if t is not None), default=None)
        if on_this_slot_since is not None and on_this_slot_since > remind_at:
            continue
        payload = {"campus_key": campus_key, "receipt_id": str(visit_id), "slot_id": str(slot.id)}
        created += await _enqueue(db, visit_id, UPCOMING_VISIT_KIND, payload, upcoming_key(visit_id, slot.id))

    return created


def _parse_uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


async def still_applies(db: AsyncSession, kind: str, payload: dict, now: datetime | None = None) -> bool:
    """寄送當下再判斷一次提醒是否仍然成立（規格 L272「更動時段後尚未發送的
    提醒需重新判斷」）：改期、取消的都不再送。人工重新寄送失敗的提醒時也走這裡，
    已經過去的參觀不會補寄。"""
    now = now or now_utc()
    visit_id = _parse_uuid(payload.get("receipt_id"))
    if visit_id is None:
        return False
    visit = (
        await db.execute(
            select(VisitRequest).where(VisitRequest.id == visit_id).execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if visit is None or visit.anonymized_at is not None:
        return False

    if kind == UPCOMING_VISIT_KIND:
        if visit.status != VisitRequestStatus.CONFIRMED.value or visit.slot_id is None:
            return False
        if str(visit.slot_id) != str(payload.get("slot_id")):
            return False
        slot = await db.get(VisitSlot, visit.slot_id)
        return slot is not None and slot_start_utc(slot.slot_date, slot.start_time) > now

    return True
