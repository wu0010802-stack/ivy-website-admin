"""定期工作產生的提醒通知：即將參觀、逾期未處理（規格 L268、L272）。

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
  不另外提醒——「已確認」「已改期」那則通知就是提醒。改期不會更新
  confirmed_at，換到這個時段的時間看最後一筆 `rescheduled` 歷程。
- 逾期未處理，兩種情形共用一個 kind，payload.reason 區分：
  - `new_unhandled`：官網送來的新需求超過 `NEW_REQUEST_OVERDUE_AFTER`（24
    小時）仍是「待處理」、也還沒有人記過聯絡紀錄。人工補登不算（登錄的人
    自己就是承辦人，建立時也不發新案通知）；記過聯絡紀錄（含設定下次聯絡
    時間）就是已經有人在處理，只是狀態沒改成聯絡中。只補最近
    `NEW_REQUEST_CATCH_UP`（72 小時）內到點的，功能第一次上線時不會把幾週前
    的舊案一次全推出去（總覽本來就列得到）。
  - `hold_expiring`：待園方確認的時段占位 `HOLD_EXPIRING_WITHIN`（6 小時，
    與後台列表的紅字提醒同一個門檻）內到期，逾期會自動取消並釋出名額。占位
    本來就不到 6 小時的（場次很近）不另外提醒，送出當下的通知已經夠急。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import (
    OutboxMessage,
    OutboxStatus,
    VisitContactNote,
    VisitRequest,
    VisitRequestEvent,
    VisitRequestSource,
    VisitRequestStatus,
    VisitSlot,
)
from app.common.timezones import now_utc, slot_start_utc, today_local

UPCOMING_VISIT_KIND = "visit_upcoming"
OVERDUE_KIND = "visit_request_overdue"
REMINDER_KINDS = frozenset({UPCOMING_VISIT_KIND, OVERDUE_KIND})

UPCOMING_VISIT_LEAD = timedelta(hours=24)
NEW_REQUEST_OVERDUE_AFTER = timedelta(hours=24)
NEW_REQUEST_CATCH_UP = timedelta(hours=72)
HOLD_EXPIRING_WITHIN = timedelta(hours=6)

REASON_NEW_UNHANDLED = "new_unhandled"
REASON_HOLD_EXPIRING = "hold_expiring"


def whole_hours(delta: timedelta) -> int:
    return int(delta.total_seconds() // 3600)


# 逾期未處理的細分原因；信件主旨、LINE 與後台站內通知都用這組文字。
REASON_LABELS = {
    REASON_NEW_UNHANDLED: f"新的參觀需求超過 {whole_hours(NEW_REQUEST_OVERDUE_AFTER)} 小時尚未處理",
    REASON_HOLD_EXPIRING: f"待確認的時段申請 {whole_hours(HOLD_EXPIRING_WITHIN)} 小時內到期，逾期會自動釋出名額",
}


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


def _unhandled_new_request() -> tuple:
    """「新需求放太久沒人處理」的條件，掃描與寄送前重新判斷共用同一組：
    官網送來、仍是待處理、沒有任何聯絡紀錄（下次聯絡時間也只能隨聯絡紀錄設定）。
    承辦人不算：指派了但還沒人聯絡家長，一樣是尚未處理。"""
    return (
        VisitRequest.status == VisitRequestStatus.NEW.value,
        VisitRequest.source == VisitRequestSource.WEB.value,
        VisitRequest.anonymized_at.is_(None),
        ~exists().where(VisitContactNote.visit_request_id == VisitRequest.id),
    )


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


def overdue_key(visit_request_id: uuid.UUID, reason: str, hold_expires_at: datetime | None = None) -> str:
    # 占位到期的鍵含到期時間：案件之後若重新申請時段、有了新的占位，會再提醒一次。
    suffix = f":{hold_expires_at.isoformat()}" if hold_expires_at is not None else ""
    return f"{OVERDUE_KIND}:{visit_request_id}:{reason}{suffix}"


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

    # 官網送來的新需求放太久沒人處理。
    overdue_new = await db.execute(
        select(VisitRequest.id, VisitRequest.campus_key).where(
            *_unhandled_new_request(),
            VisitRequest.created_at <= now - NEW_REQUEST_OVERDUE_AFTER,
            VisitRequest.created_at > now - NEW_REQUEST_OVERDUE_AFTER - NEW_REQUEST_CATCH_UP,
        )
    )
    for visit_id, campus_key in overdue_new.all():
        payload = {"campus_key": campus_key, "receipt_id": str(visit_id), "reason": REASON_NEW_UNHANDLED}
        key = overdue_key(visit_id, REASON_NEW_UNHANDLED)
        created += await _enqueue(db, visit_id, OVERDUE_KIND, payload, key)

    # 待確認的占位快到期。
    expiring = await db.execute(
        select(VisitRequest.id, VisitRequest.campus_key, VisitRequest.hold_expires_at).where(
            VisitRequest.status == VisitRequestStatus.PENDING_CONFIRMATION.value,
            VisitRequest.hold_expires_at.is_not(None),
            VisitRequest.hold_expires_at > now,
            VisitRequest.hold_expires_at <= now + HOLD_EXPIRING_WITHIN,
            VisitRequest.created_at < VisitRequest.hold_expires_at - HOLD_EXPIRING_WITHIN,
        )
    )
    for visit_id, campus_key, hold_expires_at in expiring.all():
        payload = {
            "campus_key": campus_key,
            "receipt_id": str(visit_id),
            "reason": REASON_HOLD_EXPIRING,
            "hold_expires_at": hold_expires_at.isoformat(),
        }
        key = overdue_key(visit_id, REASON_HOLD_EXPIRING, hold_expires_at)
        created += await _enqueue(db, visit_id, OVERDUE_KIND, payload, key)

    return created


def _parse_uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


def _parse_datetime(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


async def still_applies(db: AsyncSession, kind: str, payload: dict, now: datetime | None = None) -> bool:
    """寄送當下再判斷一次提醒是否仍然成立（規格 L272「更動時段後尚未發送的
    提醒需重新判斷」）：改期、取消、已經有人處理（改了狀態或記了聯絡紀錄）、
    占位已確認或已換過的，都不再送。人工重新寄送失敗的提醒時也走這裡，已經過去的參觀不會補寄。"""
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

    if kind == OVERDUE_KIND:
        reason = payload.get("reason")
        if reason == REASON_NEW_UNHANDLED:
            still_new = await db.execute(
                select(VisitRequest.id).where(VisitRequest.id == visit.id, *_unhandled_new_request())
            )
            return still_new.scalar_one_or_none() is not None
        if reason == REASON_HOLD_EXPIRING:
            expected = _parse_datetime(payload.get("hold_expires_at"))
            return (
                visit.status == VisitRequestStatus.PENDING_CONFIRMATION.value
                and visit.hold_expires_at is not None
                and expected is not None
                and visit.hold_expires_at == expected
                and visit.hold_expires_at > now
            )
        return False

    return True
