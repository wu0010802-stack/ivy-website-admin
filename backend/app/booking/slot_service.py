from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.exceptions import SlotClosed, SlotFull, SlotNotFound
from app.booking.models import SlotClosedSource, VisitRequest, VisitRequestStatus, VisitSlot
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
            f"目前已有 {booked_count} 組占用名額（含已確認、已完成與未到場），容量不能低於這個數字"
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


# 規格 225：completed／no_show 保留已使用名額，防止對歷史時段重新出售。
_USED_STATUSES = (
    VisitRequestStatus.CONFIRMED.value,
    VisitRequestStatus.COMPLETED.value,
    VisitRequestStatus.NO_SHOW.value,
)


def occupying_condition():
    """占名額的條件：已確認、已完成、未到場（只有已取消不占）。

    規格 225：completed／no_show 保留已使用的名額，家長來過或沒來，這一格
    都已經用掉了，不能再排別人進去；月曆的已排數與「容量不得低於已占數」
    也因此跟實際接待數一致。舊流程的人工待確認占位已在 2026-10-06 拿掉。"""
    return VisitRequest.status.in_(_USED_STATUSES)


def awaiting_visit_condition():
    """還在等參觀日的案件（已確認）。休假日要另外聯絡改期的是這些；已完成／
    未到場雖然占名額，但不需要再聯絡。"""
    return VisitRequest.status == VisitRequestStatus.CONFIRMED.value


async def count_booked(db: AsyncSession, slot_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(VisitRequest)
        .where(VisitRequest.slot_id == slot_id, occupying_condition())
    )
    return result.scalar_one()


async def count_booked_by_slot(db: AsyncSession, slot_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """多個時段的已占名額一次查完（沒有占用的時段不在結果裡）。公開時段查詢
    原本每個時段各查一次，匿名者一個請求就能換到上百次查詢。"""
    if not slot_ids:
        return {}
    result = await db.execute(
        select(VisitRequest.slot_id, func.count())
        .where(VisitRequest.slot_id.in_(slot_ids), occupying_condition())
        .group_by(VisitRequest.slot_id)
    )
    return dict(result.all())


async def count_bookable_slots(db: AsyncSession, campus_key: str, config, now: datetime | None = None) -> int:
    """官網現在列得出來、訂得到的場次數：與公開時段查詢同一個判斷（開放中、
    在該校的最短提前與最遠開放區間內、還有名額）。啟用 slots 的條件與總覽的
    「開放選時段卻沒有場次」都用這個數字。"""
    current = now or now_utc()
    window = window_for(config)
    max_days = window.get("max_advance_days", MAX_ADVANCE_DAYS)
    today = today_local(current)
    booked = (
        select(func.count())
        .select_from(VisitRequest)
        .where(VisitRequest.slot_id == VisitSlot.id, occupying_condition())
        .correlate(VisitSlot)
        .scalar_subquery()
    )
    result = await db.execute(
        select(VisitSlot, booked).where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.closed.is_(False),
            VisitSlot.slot_date >= today,
            VisitSlot.slot_date <= today + timedelta(days=max_days),
        )
    )
    return sum(
        1
        for slot, booked_count in result.all()
        if slot.capacity > booked_count and is_publicly_bookable(slot, current, **window)
    )


async def get_slot_for_update(db: AsyncSession, slot_id: uuid.UUID) -> VisitSlot | None:
    """鎖住時段列並以資料庫為準重讀。同一個 session 可能在上鎖前就讀過這個時段
    （例如家長改期先不上鎖檢查），identity map 裡的舊值不能沿用：等鎖期間別的
    交易可能剛停止申請或降了名額。"""
    result = await db.execute(
        select(VisitSlot)
        .where(VisitSlot.id == slot_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def lock_for_staff_booking(
    db: AsyncSession, campus_key: str, slot_id: uuid.UUID, now: datetime | None = None
) -> VisitSlot:
    """後台補登排入場次前鎖住時段並檢查。不受公開的最短提前時間限制（電話裡
    約明天也行），但不能排進已關閉、已經開始（規格 225：不對歷史時段重新
    出售）或已額滿的場次。"""
    slot = await get_slot_for_update(db, slot_id)
    if slot is None or slot.campus_key != campus_key:
        raise SlotNotFound()
    if slot.closed:
        raise SlotClosed()
    if has_started(slot, now or now_utc()):
        raise SlotNotBookable(SLOT_STARTED_MESSAGE)
    if await count_booked(db, slot.id) >= slot.capacity:
        raise SlotFull()
    return slot


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


class SlotVersionConflict(Exception):
    def __init__(self, current_version: int) -> None:
        self.current_version = current_version
        super().__init__(current_version)


async def update_slot(
    db: AsyncSession,
    slot: VisitSlot,
    *,
    capacity: int | None,
    closed: bool | None,
    expected_version: int | None = None,
) -> VisitSlot:
    """降低容量時，若已低於目前確認案件數則拒絕——不自動取消任何案件。

    slot 必須是 get_slot_for_update 鎖住的列；expected_version 不符丟
    SlotVersionConflict（別人剛改過容量或開關、或休假日剛關掉它）。"""
    if expected_version is not None and slot.version != expected_version:
        raise SlotVersionConflict(slot.version)
    if capacity is not None and capacity < slot.capacity:
        booked = await count_booked(db, slot.id)
        if capacity < booked:
            raise SlotCapacityBelowBooked(booked)
    changed = False
    if capacity is not None and capacity != slot.capacity:
        slot.capacity = capacity
        changed = True
    if closed is not None and closed != slot.closed:
        slot.closed = closed
        # 記下是園方手動關的：取消休假日時不會把它重新打開。
        slot.closed_source = SlotClosedSource.MANUAL.value if closed else None
        changed = True
    if changed:
        slot.version += 1
    await db.flush()
    return slot
