"""各時段過去坐了幾成（場次使用情況，2026-10-13 規格 §3）。

只讀 visit_slots 與 visit_requests，不改資料表。場次＝校區相符、日期在 [今天−週數×7, 昨天]、
沒有關閉；已約＝排在該場次、占名額的案件數（已確認、已完成、未到場，取消不算，沿用
slot_service.occupying_condition；標記排除的測試／重複案件不算，筆數另放 excluded_cases）。
excluded_cases 只數占名額的排除案件（已取消的本來就不在已約裡，不重複算進去）。
依（星期, 開始時間, 結束時間）分組，規則改過後新舊時段各成一列。"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import exclusion, slot_service
from app.booking.models import VisitRequest, VisitSlot

WEEK_CHOICES = (4, 12, 26)
# 判讀門檻（規格 U10）：描述性門檻，不做統計檢定——場次數少，檢定沒有偵測力。
MIN_SLOTS = 4
OFTEN_FULL_SHARE = 0.5
RARELY_BOOKED_RATE = 0.2


def signal_for(slot_count: int, full_count: int, fill_rate: float) -> str:
    """too_few（不到 MIN_SLOTS 場，還不判斷）／often_full／rarely_booked／normal。兩個條件都成立時常額滿優先。"""
    if slot_count < MIN_SLOTS:
        return "too_few"
    if full_count / slot_count >= OFTEN_FULL_SHARE:
        return "often_full"
    if fill_rate <= RARELY_BOOKED_RATE:
        return "rarely_booked"
    return "normal"


async def slot_rows(db: AsyncSession, campus_key: str, weeks: int, today: date) -> dict:
    date_from = today - timedelta(weeks=weeks)
    date_to = today - timedelta(days=1)
    booked = (
        select(VisitRequest.slot_id.label("slot_id"), func.count().label("n"))
        .where(slot_service.occupying_condition(), exclusion.not_excluded())
        .group_by(VisitRequest.slot_id)
        .subquery()
    )
    booked_n = func.coalesce(booked.c.n, 0)
    # 排除的測試／重複案件不算家長需求（2026-10-15）；另回筆數給說明。名額占用本身不變（送單容量照算）。
    excluded_cases = await db.scalar(
        select(func.count())
        .select_from(VisitRequest)
        .join(VisitSlot, VisitSlot.id == VisitRequest.slot_id)
        .where(
            slot_service.occupying_condition(),
            exclusion.excluded(),
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date >= date_from,
            VisitSlot.slot_date <= date_to,
            VisitSlot.closed.is_(False),
        )
    )
    result = await db.execute(
        select(VisitSlot.slot_date, VisitSlot.start_time, VisitSlot.end_time, VisitSlot.capacity, booked_n)
        .select_from(VisitSlot)
        .outerjoin(booked, booked.c.slot_id == VisitSlot.id)
        .where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date >= date_from,
            VisitSlot.slot_date <= date_to,
            VisitSlot.closed.is_(False),
        )
    )
    groups: dict[tuple[int, object, object], dict] = {}
    for slot_date, start, end, capacity, n in result.all():
        key = (slot_date.weekday(), start, end)
        group = groups.setdefault(key, {"slot_count": 0, "capacity_total": 0, "booked": 0, "full_count": 0})
        group["slot_count"] += 1
        group["capacity_total"] += capacity
        group["booked"] += n
        if n >= capacity:
            group["full_count"] += 1
    rows = []
    for (weekday, start, end), group in sorted(groups.items(), key=lambda item: (item[0][0], item[0][1], item[0][2])):
        fill_rate = min(group["booked"] / group["capacity_total"], 1.0) if group["capacity_total"] else 0.0
        rows.append(
            {
                "weekday": weekday,
                "start_time": start,
                "end_time": end,
                **group,
                "fill_rate": round(fill_rate, 3),
                "signal": signal_for(group["slot_count"], group["full_count"], fill_rate),
            }
        )
    return {
        "weeks": weeks,
        "date_from": date_from,
        "date_to": date_to,
        "thresholds": {"min_slots": MIN_SLOTS, "often_full_share": OFTEN_FULL_SHARE, "rarely_booked_rate": RARELY_BOOKED_RATE},
        "rows": rows,
        "excluded_cases": int(excluded_cases or 0),
    }
