from datetime import datetime, timedelta

from app.booking.models import VisitRequest
from app.common.timezones import now_utc, slot_start_utc


def parent_change_deadline(visit: VisitRequest) -> datetime | None:
    if visit.slot is None:
        return None
    return slot_start_utc(visit.slot.slot_date, visit.slot.start_time) - timedelta(hours=24)


def parent_change_open(visit: VisitRequest) -> bool:
    deadline = parent_change_deadline(visit)
    return deadline is None or now_utc() < deadline
