"""家長用管理連結線上取消／申請改期的期限（規格 L238）。

期限是各校設定（BookingConfig.parent_change_deadline_hours），預設參觀前
24 小時。家長頁顯示的截止時間與 API 擋下的時間點共用這裡的算法。"""
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import BookingConfig, VisitRequest
from app.common.timezones import now_utc, slot_start_utc

DEFAULT_CHANGE_DEADLINE_HOURS = 24
# 至少 1 小時：0 等於讓家長在參觀開始當下取消，園方來不及反應。
# 最多 14 天，與「最短提前時間」的上限一致。
MIN_CHANGE_DEADLINE_HOURS = 1
MAX_CHANGE_DEADLINE_HOURS = 24 * 14


def parent_change_deadline(
    visit: VisitRequest, hours: int = DEFAULT_CHANGE_DEADLINE_HOURS
) -> datetime | None:
    if visit.slot is None:
        return None
    return slot_start_utc(visit.slot.slot_date, visit.slot.start_time) - timedelta(hours=hours)


def parent_change_open(visit: VisitRequest, hours: int = DEFAULT_CHANGE_DEADLINE_HOURS) -> bool:
    deadline = parent_change_deadline(visit, hours)
    return deadline is None or now_utc() < deadline


async def change_deadline_hours(db: AsyncSession, campus_key: str) -> int:
    """該校設定的期限；還沒有設定列的校區用預設值。"""
    config = await db.get(BookingConfig, campus_key)
    return config.parent_change_deadline_hours if config is not None else DEFAULT_CHANGE_DEADLINE_HOURS
