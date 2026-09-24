"""每週開放規則、休假日例外與依規則產生時段（規格 6.3）。

規則本身不對外開放任何東西；園方按「產生時段」才建立 VisitSlot。這樣
「改規則只影響未來未被使用的時段」自然成立：已存在的時段一律不動。"""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import slot_service
from app.booking.models import VisitException, VisitRequest, VisitRule, VisitSlot
from app.common.timezones import today_local

MAX_GENERATE_DAYS = 92


class GenerateRangeInvalid(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def rule_windows(rule: VisitRule) -> list[tuple[time, time]]:
    """把一條規則切成每格 [start, end)；最後一格放不下完整長度就不產生。"""
    out: list[tuple[time, time]] = []
    anchor = date(2000, 1, 1)
    cursor = datetime.combine(anchor, rule.start_time)
    end = datetime.combine(anchor, rule.end_time)
    step = timedelta(minutes=rule.slot_minutes)
    while cursor + step <= end:
        out.append((cursor.time(), (cursor + step).time()))
        cursor += step
    return out


async def list_rules(db: AsyncSession, campus_key: str) -> list[VisitRule]:
    result = await db.execute(
        select(VisitRule)
        .where(VisitRule.campus_key == campus_key)
        .order_by(VisitRule.weekday, VisitRule.start_time)
    )
    return list(result.scalars())


async def replace_rules(
    db: AsyncSession, campus_key: str, rules: list[dict], created_by: uuid.UUID
) -> list[VisitRule]:
    """整份替換：後台一次送出該校全部規則，避免逐條增刪時中途半套。"""
    await db.execute(delete(VisitRule).where(VisitRule.campus_key == campus_key))
    now = datetime.now(timezone.utc)
    for rule in rules:
        db.add(
            VisitRule(
                id=uuid.uuid4(),
                campus_key=campus_key,
                weekday=rule["weekday"],
                start_time=rule["start_time"],
                end_time=rule["end_time"],
                slot_minutes=rule["slot_minutes"],
                capacity=rule["capacity"],
                created_by=created_by,
                created_at=now,
            )
        )
    await db.flush()
    return await list_rules(db, campus_key)


async def list_exceptions(db: AsyncSession, campus_key: str, *, since: date | None = None) -> list[VisitException]:
    stmt = select(VisitException).where(VisitException.campus_key == campus_key)
    if since is not None:
        stmt = stmt.where(VisitException.exception_date >= since)
    result = await db.execute(stmt.order_by(VisitException.exception_date))
    return list(result.scalars())


async def add_exception(
    db: AsyncSession, campus_key: str, exception_date: date, reason: str | None, created_by: uuid.UUID
) -> tuple[VisitException, int, int]:
    """建立休假日並關閉當天時段。回傳 (例外, 關閉的時段數, 仍占位的案件數)；
    占位案件不自動取消（規格 6.3：既有案件另列待處理）。"""
    existing = await db.execute(
        select(VisitException).where(
            VisitException.campus_key == campus_key, VisitException.exception_date == exception_date
        )
    )
    record = existing.scalar_one_or_none()
    if record is None:
        record = VisitException(
            id=uuid.uuid4(),
            campus_key=campus_key,
            exception_date=exception_date,
            reason=reason,
            created_by=created_by,
            created_at=datetime.now(timezone.utc),
        )
        db.add(record)
    else:
        record.reason = reason

    slots = await db.execute(
        select(VisitSlot)
        .where(VisitSlot.campus_key == campus_key, VisitSlot.slot_date == exception_date)
        .with_for_update()
    )
    closed = 0
    for slot in slots.scalars():
        if not slot.closed:
            slot.closed = True
            closed += 1
    affected = await db.execute(
        select(func.count())
        .select_from(VisitRequest)
        .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
        .where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date == exception_date,
            slot_service.occupying_condition(),
        )
    )
    await db.flush()
    return record, closed, affected.scalar_one()


async def remove_exception(db: AsyncSession, campus_key: str, exception_id: uuid.UUID) -> bool:
    """移除休假日不會自動重開當天時段；需要的話由園方在時段頁逐一打開。"""
    result = await db.execute(
        delete(VisitException).where(
            VisitException.id == exception_id, VisitException.campus_key == campus_key
        )
    )
    return result.rowcount > 0


async def generate_slots(
    db: AsyncSession,
    campus_key: str,
    date_from: date,
    date_to: date,
    created_by: uuid.UUID,
) -> dict:
    """依每週規則產生時段。跳過：今天以前、休假日、同日同開始時間已有時段
    （含已關閉的——園方關掉的不要被規則偷偷重開）。可重複執行。"""
    if date_to < date_from:
        raise GenerateRangeInvalid("結束日期不能早於開始日期")
    if (date_to - date_from).days > MAX_GENERATE_DAYS:
        raise GenerateRangeInvalid(f"一次最多產生 {MAX_GENERATE_DAYS} 天")
    today = today_local()
    start = max(date_from, today)
    rules = await list_rules(db, campus_key)
    if not rules:
        return {"created": 0, "skipped_existing": 0, "skipped_exception_days": 0}

    exception_days = {
        e.exception_date for e in await list_exceptions(db, campus_key, since=start)
    }
    existing = await db.execute(
        select(VisitSlot.slot_date, VisitSlot.start_time).where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date >= start,
            VisitSlot.slot_date <= date_to,
        )
    )
    taken = {(d, t) for d, t in existing.all()}

    created = skipped_existing = 0
    skipped_days: set[date] = set()
    now = datetime.now(timezone.utc)
    day = start
    while day <= date_to:
        todays = [r for r in rules if r.weekday == day.weekday()]
        if todays and day in exception_days:
            skipped_days.add(day)
        elif todays:
            for rule in todays:
                for slot_start, slot_end in rule_windows(rule):
                    if (day, slot_start) in taken:
                        skipped_existing += 1
                        continue
                    db.add(
                        VisitSlot(
                            id=uuid.uuid4(),
                            campus_key=campus_key,
                            slot_date=day,
                            start_time=slot_start,
                            end_time=slot_end,
                            capacity=rule.capacity,
                            closed=False,
                            created_by=created_by,
                            created_at=now,
                        )
                    )
                    taken.add((day, slot_start))
                    created += 1
        day += timedelta(days=1)
    await db.flush()
    return {
        "created": created,
        "skipped_existing": skipped_existing,
        "skipped_exception_days": len(skipped_days),
    }
