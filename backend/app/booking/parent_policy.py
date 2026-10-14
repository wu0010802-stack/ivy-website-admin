"""家長用管理連結線上取消／改期的期限（規格 L238）。

期限是各校設定（BookingConfig.parent_change_deadline_hours），預設參觀前
24 小時。家長頁顯示的截止時間與 API 擋下的時間點共用這裡的算法。

停課日（2026-10-14 規格 §3.4）：場次那天園方設了休假（含停班停課），原本的參觀
不會進行，期限是讓園方來得及反應的，對停課日沒有意義；這時家長隨時可以線上改約
或取消，直到那一天過完。"""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import BookingConfig, VisitException, VisitRequest
from app.common.timezones import now_utc, slot_start_utc, today_local

DEFAULT_CHANGE_DEADLINE_HOURS = 24
# 至少 1 小時：0 等於讓家長在參觀開始當下取消，園方來不及反應。
# 最多 14 天，與「最短提前時間」的上限一致。
MIN_CHANGE_DEADLINE_HOURS = 1
MAX_CHANGE_DEADLINE_HOURS = 24 * 14


def parent_change_deadline(
    visit: VisitRequest, hours: int = DEFAULT_CHANGE_DEADLINE_HOURS, *, day_closed: bool = False
) -> datetime | None:
    """停課日沒有期限（None）。"""
    if visit.slot is None or day_closed:
        return None
    return slot_start_utc(visit.slot.slot_date, visit.slot.start_time) - timedelta(hours=hours)


def parent_change_open(
    visit: VisitRequest, hours: int = DEFAULT_CHANGE_DEADLINE_HOURS, *, day_closed: bool = False
) -> bool:
    deadline = parent_change_deadline(visit, hours, day_closed=day_closed)
    return deadline is None or now_utc() < deadline


async def day_closed(db: AsyncSession, visit: VisitRequest) -> bool:
    """預約排在園方休假（含停班停課）的那一天，而且那天還沒過（台北日期）。

    場次是關閉的、而且那一天有休假日；不看關閉來源：先手動「停止申請」、之後整天休假的
    場次仍記 manual，已約的家長一樣不能來。休假日之後又特地加開的場次（開著）不算。
    與 attention.needs_attention_condition 同一個定義。呼叫端要先載入 visit.slot。"""
    slot = visit.slot
    if slot is None or not slot.closed or slot.slot_date < today_local():
        return False
    found = await db.scalar(
        select(VisitException.id)
        .where(VisitException.campus_key == slot.campus_key, VisitException.exception_date == slot.slot_date)
        .limit(1)
    )
    return found is not None


async def change_deadline_hours(db: AsyncSession, campus_key: str) -> int:
    """該校設定的期限；還沒有設定列的校區用預設值。"""
    config = await db.get(BookingConfig, campus_key)
    return config.parent_change_deadline_hours if config is not None else DEFAULT_CHANGE_DEADLINE_HOURS
