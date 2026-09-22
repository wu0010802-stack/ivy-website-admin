from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot

MAX_QUERY_RANGE_DAYS = 62

# 占用名額的狀態：只有 confirmed 算「還坐著這個位子」。取消/未到場/完成
# 都不再佔用（completed 代表已經參觀完，時段本身已經過去，不需要再占）。
_OCCUPYING_STATUSES = (VisitRequestStatus.CONFIRMED.value,)


class SlotQueryRangeTooWide(Exception):
    pass


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
