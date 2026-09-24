from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.common.timezones import now_utc, slot_start_utc, today_local

MAX_QUERY_RANGE_DAYS = 62

# 規格 225-226 的時間窗初始規則：最短提前 24 小時、最遠開放 60 天。
MIN_LEAD_TIME = timedelta(hours=24)
MAX_ADVANCE_DAYS = 60


class SlotQueryRangeTooWide(Exception):
    pass


class SlotNotBookable(Exception):
    """時段存在但目前不可被公開預約：已過去、未達最短提前時間、
    或超過最遠開放天數。"""

    def __init__(self, message: str = "這個時段目前無法預約") -> None:
        self.message = message
        super().__init__(message)


def is_publicly_bookable(
    slot: VisitSlot,
    now: datetime | None = None,
    *,
    min_lead: timedelta = MIN_LEAD_TIME,
    max_advance_days: int = MAX_ADVANCE_DAYS,
) -> bool:
    """公開查詢與公開送單共用同一份判斷（規格 404：server 是唯一判斷
    來源）。原本兩邊都沒有檢查日期，導致已經過去的時段仍然可以被查到、
    被預約，名額從此永久被佔住、也永遠不會有人來。

    時間窗由各校設定（BookingConfig.min_lead_hours／max_advance_days），
    呼叫端用 `window_for(config)` 取得。"""
    if slot.closed:
        return False
    current = now or now_utc()
    starts_at = slot_start_utc(slot.slot_date, slot.start_time)
    if starts_at - current < min_lead:
        return False
    if (slot.slot_date - today_local(current)).days > max_advance_days:
        return False
    return True


def window_for(config) -> dict:
    """把該校設定轉成 is_publicly_bookable 的關鍵字參數；沒有設定列時用預設。"""
    if config is None:
        return {}
    return {
        "min_lead": timedelta(hours=config.min_lead_hours),
        "max_advance_days": config.max_advance_days,
    }


def has_started(slot: VisitSlot, now: datetime | None = None) -> bool:
    """時段已經開始（或結束）。後台人工排入與改期不受公開的最短提前時間
    限制，但不能排進已經過去的場次——那等於把歷史時段重新賣出去。"""
    return slot_start_utc(slot.slot_date, slot.start_time) <= (now or now_utc())


SLOT_STARTED_MESSAGE = "這個時段已經開始或結束，請選擇其他時段"


class SlotCapacityBelowBooked(Exception):
    def __init__(self, booked_count: int) -> None:
        self.booked_count = booked_count
        super().__init__(
            f"目前已有 {booked_count} 組占用名額（含待確認、已確認、已完成與未到場），容量不能低於這個數字"
        )


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


def _live_hold(current: datetime):
    return and_(
        VisitRequest.status == VisitRequestStatus.PENDING_CONFIRMATION.value,
        or_(VisitRequest.hold_expires_at.is_(None), VisitRequest.hold_expires_at > current),
    )


# 規格 225：completed／no_show 保留已使用名額，防止對歷史時段重新出售。
_USED_STATUSES = (
    VisitRequestStatus.CONFIRMED.value,
    VisitRequestStatus.COMPLETED.value,
    VisitRequestStatus.NO_SHOW.value,
)


def occupying_condition(now: datetime | None = None):
    """占名額的條件：已確認、已完成、未到場，或人工待確認且占位尚未到期。

    規格 221：new/contacting 不占名額；pending_confirmation／confirmed
    占名額——人工待確認期間必須先卡住位子，否則同一個名額會被賣給多個
    家長，等園方逐一確認時才發現超收。規格 225：completed／no_show 保留
    已使用的名額，家長來過或沒來，這一格都已經用掉了，不能再排別人進去；
    月曆的已排數與「容量不得低於已占數」也因此跟實際接待數一致。

    到期的 pending_confirmation 在清理排程把它轉成 cancelled 之前仍是
    同一個狀態；若只看狀態計數，排程沒跑（或沒設定）時名額會被永久
    佔住。所以容量計算自己排除已到期的占位，不依賴排程。"""
    current = now or now_utc()
    return or_(VisitRequest.status.in_(_USED_STATUSES), _live_hold(current))


def awaiting_visit_condition(now: datetime | None = None):
    """還在等參觀日的案件：已確認，或待確認且占位未到期。休假日要另外聯絡
    改期的是這些；已完成／未到場雖然占名額，但不需要再聯絡。"""
    current = now or now_utc()
    return or_(VisitRequest.status == VisitRequestStatus.CONFIRMED.value, _live_hold(current))


async def count_booked(db: AsyncSession, slot_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(VisitRequest)
        .where(VisitRequest.slot_id == slot_id, occupying_condition())
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
