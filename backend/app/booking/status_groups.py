"""後台列表的三組顯示狀態（2026-09-30 業主裁定，參考義華舊後台）：
預約正常／時間已過／已取消。資料庫的 7 種狀態不變，只在這裡歸組；場次開始的
那一刻起算「時間已過」。原本的「待處理」只剩自選場次上線前的舊案，2026-10-05
拿掉分組、舊案由 migration 1e5612e187ff 刪除。"""

from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import and_, or_, select

from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.common.timezones import OPERATING_TZ, now_utc, slot_start_utc

GROUPS = ("upcoming", "past", "cancelled")
_DONE_STATUSES = (VisitRequestStatus.COMPLETED.value, VisitRequestStatus.NO_SHOW.value)

# 還沒結案：預約正常（含時間已過還沒標記到場）。舊流程的 new／contacting／
# pending_confirmation 已不會產生，仍算還沒結案，免得萬一出現時從清單消失。
# 總覽「我承辦的案件」「承辦人已停用」與清單的 open=true 用同一個定義。
OPEN_STATUSES = (
    VisitRequestStatus.NEW.value,
    VisitRequestStatus.CONTACTING.value,
    VisitRequestStatus.PENDING_CONFIRMATION.value,
    VisitRequestStatus.CONFIRMED.value,
)


def open_condition():
    return VisitRequest.status.in_(OPEN_STATUSES)


def display_status(status: str, slot_date: date | None, start_time: time | None, now: datetime | None = None) -> str:
    if status == VisitRequestStatus.CANCELLED.value:
        return "cancelled"
    if status in _DONE_STATUSES:
        return "past"
    # 沒有場次的只剩舊流程資料（成效統計的 unscheduled），還沒結案就當預約正常。
    if slot_date is None or start_time is None:
        return "upcoming"
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
    if group == "cancelled":
        return VisitRequest.status == VisitRequestStatus.CANCELLED.value
    # 和 display_status 同一個判準，每筆剛好落在一組：還沒結案的依場次分，沒有場次的算預約正常。
    started = _started_slot_ids(current)
    if group == "upcoming":
        return and_(open_condition(), or_(VisitRequest.slot_id.is_(None), VisitRequest.slot_id.not_in(started)))
    if group == "past":
        return or_(and_(open_condition(), VisitRequest.slot_id.in_(started)), VisitRequest.status.in_(_DONE_STATUSES))
    raise ValueError(group)
