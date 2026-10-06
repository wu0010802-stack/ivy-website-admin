"""成效統計測試用：直接寫庫建場次與任意狀態、任意送出時間的案件。

API 建不出已結案、也不能指定送出時間的案件；這裡繞過 API，不產生 outbox、歷程或統計事件。只 flush，呼叫端自己 commit。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import VisitRequest, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local


def taipei(day: date, hour: int = 12, minute: int = 0) -> datetime:
    """台北牆上時間 → aware UTC。"""
    return datetime.combine(day, time(hour, minute), tzinfo=OPERATING_TZ).astimezone(timezone.utc)


async def add_slot(
    db: AsyncSession,
    *,
    campus_key: str = "yihua",
    days_from_today: int = 0,
    start: time = time(10, 0),
    capacity: int = 5,
) -> uuid.UUID:
    slot = VisitSlot(
        id=uuid.uuid4(),
        campus_key=campus_key,
        slot_date=today_local() + timedelta(days=days_from_today),
        start_time=start,
        end_time=time(start.hour + 1, start.minute),
        capacity=capacity,
        closed=False,
        created_at=datetime.now(timezone.utc),
    )
    db.add(slot)
    await db.flush()
    return slot.id


async def add_case(
    db: AsyncSession,
    *,
    campus_key: str = "yihua",
    status: str = "confirmed",
    created_at: datetime | None = None,
    slot_id: uuid.UUID | None = None,
    source: str = "web",
    cancel_reason: str | None = None,
    follow_up_at: datetime | None = None,
    child_birthdate: date | None = None,
    anonymized: bool = False,
) -> uuid.UUID:
    if status == "confirmed" and slot_id is None:
        # 資料庫要求已確認一定有場次（ck_visit_requests_confirmed_slot）：沒指定就開一個未來場次。
        slot_id = await add_slot(db, campus_key=campus_key, days_from_today=30, start=time(7, 0), capacity=99)
    case = VisitRequest(
        id=uuid.uuid4(),
        campus_key=campus_key,
        idempotency_key=f"report-{uuid.uuid4().hex}",
        payload_hash="0" * 64,
        config_version=0,
        parent_name="測試家長",
        phone="0911000222",
        referral_sources=[],
        consent_given=True,
        status=status,
        source=source,
        slot_id=slot_id,
        cancel_reason=cancel_reason,
        follow_up_at=follow_up_at,
        child_birthdate=child_birthdate,
        anonymized_at=datetime.now(timezone.utc) if anonymized else None,
        created_at=created_at or datetime.now(timezone.utc),
    )
    db.add(case)
    await db.flush()
    return case.id
