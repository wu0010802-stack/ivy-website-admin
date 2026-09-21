from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import slot_service
from app.booking.models import VisitContactNote, VisitRequest, VisitRequestEvent, VisitRequestStatus


class SlotFull(Exception):
    pass


class InvalidTransition(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def _add_event(db: AsyncSession, visit_request_id: uuid.UUID, event_type: str) -> None:
    db.add(
        VisitRequestEvent(
            id=uuid.uuid4(),
            visit_request_id=visit_request_id,
            event_type=event_type,
            created_at=datetime.now(timezone.utc),
        )
    )


async def confirm_with_slot(
    db: AsyncSession, visit_request: VisitRequest, slot_id: uuid.UUID, staff_id: uuid.UUID
) -> VisitRequest:
    """人工把一筆 inquiry 案件確認進某個時段；confirmed 必須有 slot，
    這裡是唯一能把狀態變成 confirmed 的路徑（slots 模式直接送出時，
    submit_visit_request 走的是同一份容量檢查邏輯）。"""
    if visit_request.status not in (VisitRequestStatus.NEW.value,):
        raise InvalidTransition(f"狀態 {visit_request.status} 不能確認")

    slot = await slot_service.get_slot_for_update(db, slot_id)
    if slot is None or slot.campus_key != visit_request.campus_key or slot.closed:
        raise SlotFull()
    booked = await slot_service.count_booked(db, slot.id)
    if booked >= slot.capacity:
        raise SlotFull()

    visit_request.slot_id = slot.id
    visit_request.status = VisitRequestStatus.CONFIRMED.value
    visit_request.assigned_staff_id = staff_id
    visit_request.confirmed_at = datetime.now(timezone.utc)
    _add_event(db, visit_request.id, "confirmed")
    await db.flush()
    return visit_request


async def cancel(db: AsyncSession, visit_request: VisitRequest) -> VisitRequest:
    """取消是冪等的：已經是 cancelled 就直接回傳，不重複寫事件、
    不會因為重試而「重複釋放」名額（名額本來就是即時算出來的，
    不是可變計數器）。"""
    if visit_request.status == VisitRequestStatus.CANCELLED.value:
        return visit_request
    if visit_request.status in (VisitRequestStatus.NO_SHOW.value, VisitRequestStatus.COMPLETED.value):
        raise InvalidTransition(f"狀態 {visit_request.status} 不能取消")

    visit_request.status = VisitRequestStatus.CANCELLED.value
    visit_request.cancelled_at = datetime.now(timezone.utc)
    _add_event(db, visit_request.id, "cancelled")
    await db.flush()
    return visit_request


async def mark_no_show(db: AsyncSession, visit_request: VisitRequest) -> VisitRequest:
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        raise InvalidTransition("只有已確認的案件可以標記未到場")
    visit_request.status = VisitRequestStatus.NO_SHOW.value
    _add_event(db, visit_request.id, "no_show")
    await db.flush()
    return visit_request


async def mark_completed(db: AsyncSession, visit_request: VisitRequest) -> VisitRequest:
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        raise InvalidTransition("只有已確認的案件可以標記完成")
    visit_request.status = VisitRequestStatus.COMPLETED.value
    _add_event(db, visit_request.id, "completed")
    await db.flush()
    return visit_request


async def reschedule(
    db: AsyncSession, visit_request: VisitRequest, new_slot_id: uuid.UUID
) -> VisitRequest:
    """固定次序鎖住新舊時段避免 deadlock：一律先鎖 id 字串較小的那個。
    新時段名額不足時整筆回滾，舊時段的占用完全不受影響。"""
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        raise InvalidTransition("只有已確認的案件可以改期")
    if visit_request.slot_id is None:
        raise InvalidTransition("這筆案件沒有時段可以改")
    if new_slot_id == visit_request.slot_id:
        return visit_request

    old_slot_id = visit_request.slot_id
    # 固定用字串排序決定鎖定順序，兩個併發的改期請求就算新舊時段
    # 互換，也會用同一個順序搶鎖，不會互相等待造成 deadlock。
    ordered_ids = sorted([old_slot_id, new_slot_id], key=str)
    locked_slots = {}
    for sid in ordered_ids:
        locked_slots[sid] = await slot_service.get_slot_for_update(db, sid)
    new_slot = locked_slots[new_slot_id]

    if new_slot is None or new_slot.campus_key != visit_request.campus_key or new_slot.closed:
        raise SlotFull()

    booked = await slot_service.count_booked(db, new_slot.id)
    if booked >= new_slot.capacity:
        raise SlotFull()

    visit_request.slot_id = new_slot.id
    _add_event(db, visit_request.id, "rescheduled")
    await db.flush()
    return visit_request


async def add_contact_note(
    db: AsyncSession,
    visit_request: VisitRequest,
    *,
    note: str,
    follow_up_at: datetime | None,
    created_by: uuid.UUID,
) -> VisitContactNote:
    record = VisitContactNote(
        id=uuid.uuid4(),
        visit_request_id=visit_request.id,
        note=note,
        created_by=created_by,
        created_at=datetime.now(timezone.utc),
    )
    db.add(record)
    if follow_up_at is not None:
        visit_request.follow_up_at = follow_up_at
    _add_event(db, visit_request.id, "contact_logged")
    await db.flush()
    return record
