"""後台列表的四組顯示狀態（2026-09-30 業主裁定，參考義華舊後台）：
待處理（只剩上線前的舊案）／預約正常／時間已過／已取消。資料庫的 7 種狀態不變，
只在這裡歸組；場次開始的那一刻起算「時間已過」。"""

from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import and_, or_, select

from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.common.timezones import OPERATING_TZ, now_utc, slot_start_utc

GROUPS = ("pending", "upcoming", "past", "cancelled")
PENDING_STATUSES = (
    VisitRequestStatus.NEW.value,
    VisitRequestStatus.CONTACTING.value,
    VisitRequestStatus.PENDING_CONFIRMATION.value,
)
_DONE_STATUSES = (VisitRequestStatus.COMPLETED.value, VisitRequestStatus.NO_SHOW.value)


def display_status(status: str, slot_date: date | None, start_time: time | None, now: datetime | None = None) -> str:
    if status in PENDING_STATUSES:
        return "pending"
    if status == VisitRequestStatus.CANCELLED.value:
        return "cancelled"
    if status in _DONE_STATUSES:
        return "past"
    if slot_date is None or start_time is None:
        return "pending"
    return "upcoming" if slot_start_utc(slot_date, start_time) > (now or now_utc()) else "past"


def _started_slot_ids(now: datetime):
    local = now.astimezone(OPERATING_TZ)
    return select(VisitSlot.id).where(
        or_(
            VisitSlot.slot_date < local.date(),
            and_(VisitSlot.slot_date == local.date(), VisitSlot.start_time <= local.time().replace(tzinfo=None)),
        )
    )


def group_condition(group: str, now: datetime | None = None):
    current = now or now_utc()
    if group == "pending":
        return VisitRequest.status.in_(PENDING_STATUSES)
    if group == "cancelled":
        return VisitRequest.status == VisitRequestStatus.CANCELLED.value
    confirmed = VisitRequest.status == VisitRequestStatus.CONFIRMED.value
    started = _started_slot_ids(current)
    if group == "upcoming":
        return and_(confirmed, VisitRequest.slot_id.is_not(None), VisitRequest.slot_id.not_in(started))
    if group == "past":
        return or_(and_(confirmed, VisitRequest.slot_id.in_(started)), VisitRequest.status.in_(_DONE_STATUSES))
    raise ValueError(group)
