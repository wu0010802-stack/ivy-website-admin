"""每週開放規則、休假日例外與依規則產生時段（規格 6.3）。

依規則產生時段有兩個入口：園方按「依規則產生時段」手動補一段日期，以及
定期工作每天依規則補到「最遠開放天數」（extend_from_rules，規格 L221-223）。
兩者都只新增還不存在的場次：同一天已有時段跟新場次時間重疊（含園方關閉或
調過名額的）就不建，所以不會產生重疊的場次，園方關掉的也不會被偷偷重開。

時段是預先補到最遠開放天數的，改規則時要主動把「依規則產生、還沒被使用」
的未來時段對齊新規則（sync_rule_slots，規格 L227「設定規則修改只影響未來
未被使用的時段」），否則舊規則的場次要等幾十天才會消失。

同一校的產生、取消休假、改規則都先鎖該校的 booking_configs 列（官網送單
也鎖同一列），定期工作與園方手動操作同時進行時不會重複建立同一個場次。"""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import slot_service
from app.booking.access_models import RescheduleRequest
from app.booking.models import (
    BookingConfig,
    SlotClosedSource,
    VisitException,
    VisitRequest,
    VisitRule,
    VisitSlot,
)
from app.booking.service import get_or_create_config
from app.campuses.models import Campus
from app.common.timezones import now_utc, slot_start_utc, today_local

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


# (星期幾, 開始, 結束) → 每場名額。同一格被兩條規則涵蓋時以先排的規則為準，
# 與 _create_from_rules 建立時段的順序一致。
RuleWindowMap = dict[tuple[int, time, time], int]


def rule_window_map(rules: list[VisitRule]) -> RuleWindowMap:
    out: RuleWindowMap = {}
    for rule in rules:
        for start, end in rule_windows(rule):
            out.setdefault((rule.weekday, start, end), rule.capacity)
    return out


def _overlaps(start: time, end: time, others: list[tuple[time, time]]) -> bool:
    return any(start < other_end and other_start < end for other_start, other_end in others)


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


async def sync_rule_slots(
    db: AsyncSession,
    campus_key: str,
    old_windows: RuleWindowMap,
    *,
    now: datetime | None = None,
) -> dict:
    """改每週規則後，把依規則產生、還沒被使用的未來時段對齊新規則（規格 L227）。

    呼叫端要先鎖住該校的 booking_configs 列並寫好新規則；old_windows 是改之前
    的規則（rule_window_map），用來判斷名額是不是園方調過的。

    不動：已開始的場次、園方在時段頁手動新增的、園方手動關閉的（含分不出來源
    的舊資料），以及有家長占名額（待確認、已確認）或有待核准改期申請的。

    其餘時段：
    - 不符合新規則（星期幾或起訖時間對不上）：沒有任何案件或改期申請指著就
      刪除；有歷史紀錄（例如已取消的案件）刪不掉，改成關閉並記 rule。
    - 符合新規則：之前因規則變更停用的重新打開；名額還是舊規則的值（園方沒
      調過）就改成新規則的名額。休假日關閉的維持關閉，取消休假時照常重開。

    新規則多出來的場次不在這裡建，交給下一輪定期工作（呼叫端清掉
    rules_extended_on）。回傳各類處理的場次數；kept_booked 是不符合新規則、
    但已有家長排入所以維持原樣的場次，後台要提醒園方自行處理。"""
    current = now or now_utc()
    counts = {"removed": 0, "closed": 0, "reopened": 0, "capacity_updated": 0, "kept_booked": 0}
    new_windows = rule_window_map(await list_rules(db, campus_key))
    result = await db.execute(
        select(VisitSlot)
        .where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.from_rule.is_(True),
            VisitSlot.slot_date >= today_local(current),
            or_(
                VisitSlot.closed.is_(False),
                VisitSlot.closed_source.in_([SlotClosedSource.EXCEPTION.value, SlotClosedSource.RULE.value]),
            ),
        )
        .order_by(VisitSlot.id)
        .with_for_update()
    )
    slots = [s for s in result.scalars() if slot_start_utc(s.slot_date, s.start_time) > current]
    if not slots:
        return counts

    # 先鎖住時段再查引用：後台同時把案件排進這一場的交易會先鎖同一列，
    # 等它提交後這裡才看得到那筆案件，不會把剛被排入的時段刪掉。
    ids = [s.id for s in slots]
    in_use = set(
        (
            await db.execute(
                select(VisitRequest.slot_id).where(
                    VisitRequest.slot_id.in_(ids), slot_service.occupying_condition(current)
                )
            )
        ).scalars()
    )
    in_use |= set(
        (
            await db.execute(
                select(RescheduleRequest.requested_slot_id).where(
                    RescheduleRequest.requested_slot_id.in_(ids), RescheduleRequest.status == "pending"
                )
            )
        ).scalars()
    )
    # 外鍵是 RESTRICT：已取消的案件、已處理的改期申請也還指著時段，刪不掉。
    referenced = set(
        (await db.execute(select(VisitRequest.slot_id).where(VisitRequest.slot_id.in_(ids)))).scalars()
    )
    referenced |= set(
        (
            await db.execute(
                select(RescheduleRequest.requested_slot_id).where(RescheduleRequest.requested_slot_id.in_(ids))
            )
        ).scalars()
    )

    to_delete: list[uuid.UUID] = []
    for slot in slots:
        key = (slot.slot_date.weekday(), slot.start_time, slot.end_time)
        capacity = new_windows.get(key)
        if slot.id in in_use:
            if capacity is None:
                counts["kept_booked"] += 1
            continue
        if capacity is None:
            if slot.id not in referenced:
                to_delete.append(slot.id)
            elif slot.closed_source != SlotClosedSource.RULE.value:
                slot.closed = True
                slot.closed_source = SlotClosedSource.RULE.value
                slot.version += 1
                counts["closed"] += 1
            continue
        changed = False
        if slot.closed_source == SlotClosedSource.RULE.value:
            slot.closed = False
            slot.closed_source = None
            counts["reopened"] += 1
            changed = True
            # 停用期間的名額是更早那一版規則的，一律換成新規則的。
            if slot.capacity != capacity:
                slot.capacity = capacity
                counts["capacity_updated"] += 1
        elif old_windows.get(key) == slot.capacity and slot.capacity != capacity:
            slot.capacity = capacity
            counts["capacity_updated"] += 1
            changed = True
        if changed:
            # 園方開著的時段頁拿舊版本存檔時會被擋下重新載入。
            slot.version += 1
    if to_delete:
        await db.execute(delete(VisitSlot).where(VisitSlot.id.in_(to_delete)))
        counts["removed"] = len(to_delete)
    await db.flush()
    return counts


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
    # 先鎖設定列，與定期工作的自動補時段互斥：否則它可能在這裡關完當天時段
    # 之後，又依規則補出一個開放中的場次。
    await get_or_create_config(db, campus_key, for_update=True)
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
        # 已經關著的（園方手動關的）維持原來源，取消休假時才不會被打開。
        if not slot.closed:
            slot.closed = True
            slot.closed_source = SlotClosedSource.EXCEPTION.value
            # 園方開著的時段頁若拿舊版本存檔，不能把休假日關掉的時段又打開。
            slot.version += 1
            closed += 1
    affected = await db.execute(
        select(func.count())
        .select_from(VisitRequest)
        .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
        .where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date == exception_date,
            # 只算還要來參觀、需要聯絡改期的；已完成／未到場不用再聯絡。
            slot_service.awaiting_visit_condition(),
        )
    )
    await db.flush()
    return record, closed, affected.scalar_one()


async def remove_exception(
    db: AsyncSession, campus_key: str, exception_id: uuid.UUID, actor_id: uuid.UUID
) -> dict | None:
    """取消休假日：重開「因這個休假日而關閉」的時段（園方手動關的不動），
    並依每週規則補上休假期間沒產生的場次（只補最遠開放天數內、還沒開始的）。
    找不到回 None。"""
    # 鎖的順序與設休假、產生時段相同：設定列 → 休假日 → 時段。
    config = await get_or_create_config(db, campus_key, for_update=True)
    record = (
        await db.execute(
            select(VisitException)
            .where(VisitException.id == exception_id, VisitException.campus_key == campus_key)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if record is None:
        return None
    day = record.exception_date
    await db.execute(delete(VisitException).where(VisitException.id == record.id))

    slots = await db.execute(
        select(VisitSlot)
        .where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date == day,
            VisitSlot.closed.is_(True),
            VisitSlot.closed_source == SlotClosedSource.EXCEPTION.value,
        )
        .with_for_update()
    )
    reopened = 0
    for slot in slots.scalars():
        slot.closed = False
        slot.closed_source = None
        slot.version += 1
        reopened += 1

    created = 0
    today = today_local()
    if today <= day <= today + timedelta(days=config.max_advance_days):
        result = await _create_from_rules(db, campus_key, day, day, created_by=actor_id, skip_started=True)
        created = result["created"]
    await db.flush()
    return {"reopened_slots": reopened, "created_slots": created}


async def generate_slots(
    db: AsyncSession,
    campus_key: str,
    date_from: date,
    date_to: date,
    created_by: uuid.UUID,
) -> dict:
    """依每週規則產生時段。跳過：今天以前、休假日、同一天已有時間重疊的時段
    （含已關閉的——園方關掉的不要被規則偷偷重開）。可重複執行。"""
    if date_to < date_from:
        raise GenerateRangeInvalid("結束日期不能早於開始日期")
    if (date_to - date_from).days > MAX_GENERATE_DAYS:
        raise GenerateRangeInvalid(f"一次最多產生 {MAX_GENERATE_DAYS} 天")
    await get_or_create_config(db, campus_key, for_update=True)
    return await _create_from_rules(db, campus_key, date_from, date_to, created_by=created_by)


async def campuses_due_for_extension(db: AsyncSession, today: date) -> list[str]:
    """有每週規則、分校啟用中、今天還沒自動補過時段的校區。"""
    result = await db.execute(
        select(Campus.key)
        .outerjoin(BookingConfig, BookingConfig.campus_key == Campus.key)
        .where(
            Campus.active.is_(True),
            Campus.key.in_(select(VisitRule.campus_key)),
            or_(BookingConfig.rules_extended_on.is_(None), BookingConfig.rules_extended_on < today),
        )
        .order_by(Campus.key)
    )
    return list(result.scalars())


async def extend_from_rules(db: AsyncSession, campus_key: str, *, now: datetime | None = None) -> int:
    """定期工作：依每週規則把時段補到「最遠開放天數」為止，回傳新建的場次數。

    一天只做一次（rules_extended_on 記台灣日期），冪等：已存在的場次、休假
    日、已經開始的場次都不建。系統產生的時段沒有建立人（created_by 為 NULL）。"""
    current = now or now_utc()
    today = today_local(current)
    config = await get_or_create_config(db, campus_key, for_update=True)
    if config.rules_extended_on is not None and config.rules_extended_on >= today:
        return 0  # 同一天另一個副本或手動 CLI 已經補過
    result = await _create_from_rules(
        db,
        campus_key,
        today,
        today + timedelta(days=config.max_advance_days),
        created_by=None,
        skip_started=True,
        now=current,
    )
    config.rules_extended_on = today
    await db.flush()
    return result["created"]


async def _create_from_rules(
    db: AsyncSession,
    campus_key: str,
    date_from: date,
    date_to: date,
    *,
    created_by: uuid.UUID | None,
    skip_started: bool = False,
    now: datetime | None = None,
) -> dict:
    """產生時段的共用核心。呼叫端要先鎖住該校的 booking_configs 列。"""
    current = now or now_utc()
    today = today_local(current)
    start = max(date_from, today)
    rules = await list_rules(db, campus_key)
    if not rules:
        return {"created": 0, "skipped_existing": 0, "skipped_exception_days": 0}

    exception_days = {
        e.exception_date for e in await list_exceptions(db, campus_key, since=start)
    }
    existing = await db.execute(
        select(VisitSlot.slot_date, VisitSlot.start_time, VisitSlot.end_time).where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date >= start,
            VisitSlot.slot_date <= date_to,
            # 改規則後停用的舊規則時段不佔時間，新規則的場次照樣建立。
            VisitSlot.closed_source.is_distinct_from(SlotClosedSource.RULE.value),
        )
    )
    # 每天已經有的時間區間：新場次跟任何一個重疊就不建（只比開始時間的話，
    # 每場長度從 30 分鐘改成 45 分鐘後會多出 09:45 這種跟舊場次重疊的場次）。
    taken: dict[date, list[tuple[time, time]]] = {}
    for d, t_start, t_end in existing.all():
        taken.setdefault(d, []).append((t_start, t_end))

    created = skipped_existing = 0
    skipped_days: set[date] = set()
    created_at = datetime.now(timezone.utc)
    day = start
    while day <= date_to:
        todays = [r for r in rules if r.weekday == day.weekday()]
        if todays and day in exception_days:
            skipped_days.add(day)
        elif todays:
            day_taken = taken.setdefault(day, [])
            for rule in todays:
                for slot_start, slot_end in rule_windows(rule):
                    if _overlaps(slot_start, slot_end, day_taken):
                        skipped_existing += 1
                        continue
                    if skip_started and slot_start_utc(day, slot_start) <= current:
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
                            from_rule=True,
                            created_by=created_by,
                            created_at=created_at,
                        )
                    )
                    day_taken.append((slot_start, slot_end))
                    created += 1
        day += timedelta(days=1)
    await db.flush()
    return {
        "created": created,
        "skipped_existing": skipped_existing,
        "skipped_exception_days": len(skipped_days),
    }
