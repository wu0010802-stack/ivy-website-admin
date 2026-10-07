"""後台列表的三組顯示狀態（2026-09-30 業主裁定，參考義華舊後台）：
預約正常／時間已過／已取消，由案件狀態與場次時間決定；場次開始的那一刻起算
「時間已過」。舊流程的「待處理」分組 2026-10-05 拿掉，舊狀態 2026-10-06 拿掉。"""

from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import and_, or_, select

from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.common.timezones import OPERATING_TZ, now_utc, slot_start_utc

GROUPS = ("upcoming", "past", "cancelled")
_DONE_STATUSES = (VisitRequestStatus.COMPLETED.value, VisitRequestStatus.NO_SHOW.value)

# 還沒結案：預約正常（含時間已過還沒標記到場）。清單的 open=true、停用分校的進行中件數
# 與個資保存政策用同一個定義。
OPEN_STATUSES = (VisitRequestStatus.CONFIRMED.value,)


def open_condition():
    return VisitRequest.status.in_(OPEN_STATUSES)


def display_status(status: str, slot_date: date | None, start_time: time | None, now: datetime | None = None) -> str:
    if status == VisitRequestStatus.CANCELLED.value:
        return "cancelled"
    if status in _DONE_STATUSES:
        return "past"
    # 已確認一定有場次；讀不到場次時不猜「時間已過」。
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
    # 和 display_status 同一個判準，每筆剛好落在一組：還沒結案的依場次分。
    started = _started_slot_ids(current)
    if group == "upcoming":
        return and_(open_condition(), VisitRequest.slot_id.not_in(started))
    if group == "past":
        return or_(and_(open_condition(), VisitRequest.slot_id.in_(started)), VisitRequest.status.in_(_DONE_STATUSES))
    raise ValueError(group)


# 案件列表的接待頁籤（2026-10-06 方向 B）。和上面的 GROUPS 不同：接下來以台北「今天」為界，
# 今天整天都留在接下來（總覽「今天的行程板」同一個口徑）；時間已過是場次已開始、還沒到場
# （含未到場）；已到場另一頁。頁籤可以重疊：今天開始了還沒標記的同時在接下來與時間已過，
# 今天到場的同時在接下來與已到場。GROUPS 保留給總覽、成效統計與舊連結。
VIEWS = ("upcoming", "past", "arrived", "cancelled")


def _slots_from_day(day: date):
    return select(VisitSlot.id).where(VisitSlot.slot_date >= day)


def view_condition(view: str, now: datetime | None = None):
    current = now or now_utc()
    if view == "cancelled":
        return VisitRequest.status == VisitRequestStatus.CANCELLED.value
    if view == "arrived":
        return VisitRequest.status == VisitRequestStatus.COMPLETED.value
    if view == "upcoming":
        return and_(
            VisitRequest.status != VisitRequestStatus.CANCELLED.value,
            VisitRequest.slot_id.in_(_slots_from_day(current.astimezone(OPERATING_TZ).date())),
        )
    if view == "past":
        return and_(
            VisitRequest.status.in_((VisitRequestStatus.CONFIRMED.value, VisitRequestStatus.NO_SHOW.value)),
            VisitRequest.slot_id.in_(_started_slot_ids(current)),
        )
    raise ValueError(view)
