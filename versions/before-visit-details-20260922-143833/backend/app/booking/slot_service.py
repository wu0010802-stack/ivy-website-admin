from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.common.timezones import now_utc, slot_start_utc, today_local

MAX_QUERY_RANGE_DAYS = 62

# 規格 225-226 的時間窗初始規則：最短提前 24 小時、最遠開放 60 天。
MIN_LEAD_TIME = timedelta(hours=24)
MAX_ADVANCE_DAYS = 60

# 占用名額的狀態。規格 221：new/contacting 不占名額；
# pending_confirmation／confirmed 占名額——人工待確認期間必須先卡住位子，
# 否則同一個名額會被賣給多個家長，等園方逐一確認時才發現超收。
_OCCUPYING_STATUSES = (
    VisitRequestStatus.PENDING_CONFIRMATION.value,
    VisitRequestStatus.CONFIRMED.value,
)


class SlotQueryRangeTooWide(Exception):
    pass


class SlotNotBookable(Exception):
    """時段存在但目前不可被公開預約：已過去、未達最短提前時間、
    或超過最遠開放天數。"""

    def __init__(self, message: str = "這個時段目前無法預約") -> None:
        self.message = message
        super().__init__(message)


def is_publicly_bookable(slot: VisitSlot, now: datetime | None = None) -> bool:
    """公開查詢與公開送單共用同一份判斷（規格 404：server 是唯一判斷
    來源）。原本兩邊都沒有檢查日期，導致已經過去的時段仍然可以被查到、
    被預約，名額從此永久被佔住、也永遠不會有人來。"""
    if slot.closed:
        return False
    current = now or now_utc()
    starts_at = slot_start_utc(slot.slot_date, slot.start_time)
    if starts_at - current < MIN_LEAD_TIME:
        return False
    if (slot.slot_date - today_local(current)).days > MAX_ADVANCE_DAYS:
        return False
    return True


class SlotCapacityBelowBooked(Exception):
    def __init__(self, booked_count: int) -> None:
        self.booked_count = booked_count
        super().__init__(f"目前已有 {booked_count} 筆確認案件，容量不能低於這個數字")


async def create_slot(
    db: AsyncSession,
    *,
    campus_key: str,
    slot_date: date,
    start_time: time,
    end_time: time,
    capacity: int,
    created_by: uuid.UUID,
) -> VisitSlot:
    slot = VisitSlot(
        id=uuid.uuid4(),
        campus_key=campus_key,
        slot_date=slot_date,
        start_time=start_time,
        end_time=end_time,
        capacity=capacity,
        closed=False,
        created_by=created_by,
        created_at=datetime.now(timezone.utc),
    )
    db.add(slot)
    await db.flush()
    return slot


async def count_booked(db: AsyncSession, slot_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(VisitRequest)
        .where(VisitRequest.slot_id == slot_id, VisitRequest.status.in_(_OCCUPYING_STATUSES))
    )
    return result.scalar_one()


async def get_slot_for_update(db: AsyncSession, slot_id: uuid.UUID) -> VisitSlot | None:
    result = await db.execute(select(VisitSlot).where(VisitSlot.id == slot_id).with_for_update())
    return result.scalar_one_or_none()


async def list_slots(
    db: AsyncSession, campus_key: str, date_from: date, date_to: date
) -> list[VisitSlot]:
    if (date_to - date_from).days > MAX_QUERY_RANGE_DAYS:
        raise SlotQueryRangeTooWide()
    result = await db.execute(
        select(VisitSlot)
        .where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date >= date_from,
            VisitSlot.slot_date <= date_to,
        )
        .order_by(VisitSlot.slot_date, VisitSlot.start_time)
    )
    return list(result.scalars())


async def update_slot(
    db: AsyncSession, slot: VisitSlot, *, capacity: int | None, closed: bool | None
) -> VisitSlot:
    """降低容量時，若已低於目前確認案件數則拒絕——不自動取消任何案件。"""
    if capacity is not None and capacity < slot.capacity:
        booked = await count_booked(db, slot.id)
        if capacity < booked:
            raise SlotCapacityBelowBooked(booked)
    if capacity is not None:
        slot.capacity = capacity
    if closed is not None:
        slot.closed = closed
    await db.flush()
    return slot
