"""群組指令的報表類回覆（2026-11-25，docs/specs/2026-11-25-line-group-commands-design.md §2–§7）：
待追蹤的名單、名額、休假日、待辦、統計、額度。

全是唯讀查詢，條件一律取自後台已有的那一份（待標記、待追蹤、待人工處理、預約結果、名額占用），
群組看到的數字才會和後台相同。回覆只有數字、校名、日期與家長稱呼；不放電話、Email、孩子資料。
呼叫端（line_group_commands）負責授權（群組服務哪些校區、是不是總部群組）與限流。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import follow_up
from app.admissions.models import RecruitmentVisit
from app.booking import exclusion, pending_kinds, slot_service
from app.booking.attention import needs_attention_condition
from app.booking.models import BookingConfig, VisitException, VisitRequest, VisitRequestStatus, VisitSlot
from app.campuses.models import CAMPUS_KEYS, Campus
from app.common.timezones import OPERATING_TZ, now_utc, today_local
from app.config import Settings
from app.notifications import line_accounts
from app.notifications.line_flex import FollowUpRow
from app.operations import booking_outcomes_service
from app.operations.analytics_service import FunnelRange

_WEEKDAYS = "一二三四五六日"
# LINE 文字訊息上限 5000 字；留一點空間給結尾的提示。
TEXT_MAX = 4800
TOO_LONG_HINT = "\n…（內容太長，請在指令前加校名，例如「義華 本週名額」）"
CLOSURE_DAYS = 14
REASON_MAX = 30
MODE_LABELS = {"line": "LINE 預約", "phone": "電話預約", "external": "外部網站預約", "paused": "暫停預約"}
STATS_PERIODS = ("week", "last_week", "month", "last_month")
_STATS_TITLES = {"week": "本週統計", "last_week": "上週統計", "month": "本月統計", "last_month": "上月統計"}
_TODAY_STATUSES = (
    VisitRequestStatus.CONFIRMED.value,
    VisitRequestStatus.COMPLETED.value,
    VisitRequestStatus.NO_SHOW.value,
)
_URLISH_RE = re.compile(r"(?i)(?:[a-z][a-z0-9+.-]*://|www\.)\S*|[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:/\S*)?")


def ordered(keys: list[str]) -> list[str]:
    """照五校固定的順序（義華、明華、崇德、國際、仁武）；不在表上的排後面。"""
    return [key for key in CAMPUS_KEYS if key in keys] + [key for key in keys if key not in CAMPUS_KEYS]


async def campus_names(db: AsyncSession) -> dict[str, str]:
    return {key: name for key, name in (await db.execute(select(Campus.key, Campus.name))).all()}


def _md(day: date) -> str:
    return f"{day.month}/{day.day}"


def _day(day: date) -> str:
    return f"{_md(day)}（{_WEEKDAYS[day.weekday()]}）"


def _capped(lines: list[str]) -> str:
    text = "\n".join(lines)
    return text if len(text) <= TEXT_MAX else text[:TEXT_MAX].rsplit("\n", 1)[0] + TOO_LONG_HINT


def _clean(value: str | None, limit: int) -> str:
    """自由文字放進群組前：拿掉網址（LINE 會變成可點的連結）、收成一行、限長度。"""
    return " ".join(_URLISH_RE.sub(" ", value or "").split())[:limit].strip()


async def _grouped(db: AsyncSession, stmt) -> dict[str, int]:
    return {key: int(count) for key, count in (await db.execute(stmt)).all()}


# ---- 待追蹤（§2）----


async def follow_up_rows(
    db: AsyncSession, campuses: list[str], names: dict[str, str], now: datetime | None = None
) -> list[FollowUpRow]:
    """下次聯絡時間已到的招生訪視（同後台待追蹤的「到期」），依應聯絡時間舊到新。只取聯絡人稱呼，不取孩子姓名與電話。"""
    if not campuses:
        return []
    current = now or now_utc()
    today = today_local(current)
    visit = RecruitmentVisit
    rows = (
        await db.execute(
            select(visit.id, visit.campus_key, visit.contact_name, visit.visit_date, visit.follow_up_at, visit.visit_request_id)
            .where(visit.campus_key.in_(campuses), follow_up.condition("due", current))
            .order_by(visit.follow_up_at, visit.created_at, visit.id)
        )
    ).all()
    result = []
    for visit_id, campus_key, contact_name, visit_date, due_at, visit_request_id in rows:
        local = due_at.astimezone(OPERATING_TZ)
        overdue = (today - local.date()).days
        result.append(
            FollowUpRow(
                visit_id=str(visit_id),
                campus_name=names.get(campus_key, campus_key),
                contact=_clean(contact_name, 20) or None,
                visited=_day(visit_date),
                due=f"{_day(local.date())}{local:%H:%M}" + (f"（逾 {overdue} 天）" if overdue > 0 else "（今天）"),
                receipt_id=str(visit_request_id) if visit_request_id else None,
            )
        )
    return result


# ---- 名額（§3）----


async def seats_text(
    db: AsyncSession,
    campuses: list[str],
    names: dict[str, str],
    start: date,
    end: date,
    title: str,
    now: datetime | None = None,
) -> str:
    """單日列每個場次的已約／名額；多日每天一列剩幾組。已約數同後台月曆（已確認、已完成、未到場都占名額）。"""
    current = now or now_utc()
    slots = (
        await db.execute(
            select(VisitSlot)
            .where(VisitSlot.campus_key.in_(campuses), VisitSlot.slot_date >= start, VisitSlot.slot_date <= end)
            .order_by(VisitSlot.slot_date, VisitSlot.start_time)
        )
    ).scalars().all()
    booked = await slot_service.count_booked_by_slot(db, [slot.id for slot in slots])
    modes = {
        key: mode.value if mode is not None else None
        for key, mode in (
            await db.execute(select(BookingConfig.campus_key, BookingConfig.mode).where(BookingConfig.campus_key.in_(campuses)))
        ).all()
    }
    single = start == end
    lines = [title]
    for key in campuses:
        mode = MODE_LABELS.get(modes.get(key) or "")
        lines.append(names.get(key, key) + (f"（目前是{mode}）" if mode else ""))
        own = [slot for slot in slots if slot.campus_key == key]
        if not own:
            lines.append("・這天沒有場次" if single else "・這段期間沒有場次")
            continue
        if single:
            for slot in own:
                used = booked.get(slot.id, 0)
                span = f"{slot.start_time:%H:%M}–{slot.end_time:%H:%M}"
                if slot.closed:
                    state = "已關閉"
                elif used >= slot.capacity:
                    state = f"額滿（{used}／{slot.capacity} 組）"
                else:
                    state = f"已約 {used}／{slot.capacity} 組"
                if not slot.closed and slot_service.has_started(slot, current):
                    state += "（已開始）"
                lines.append(f"・{span}　{state}")
            continue
        for day in sorted({slot.slot_date for slot in own}):
            day_slots = [slot for slot in own if slot.slot_date == day]
            opened = [slot for slot in day_slots if not slot.closed and not slot_service.has_started(slot, current)]
            if not opened:
                lines.append(f"・{_day(day)}" + ("已關閉" if all(slot.closed for slot in day_slots) else "場次都已開始"))
                continue
            left = sum(max(slot.capacity - booked.get(slot.id, 0), 0) for slot in opened)
            lines.append(f"・{_day(day)}" + (f"剩 {left} 組" if left else "額滿") + f"（{len(opened)} 場）")
    return _capped(lines)


# ---- 休假日（§4）----


async def closures_text(db: AsyncSession, campuses: list[str], names: dict[str, str], today: date | None = None) -> str:
    """今天起 14 天內的休假日（含停班停課）與那天還要聯絡的已確認預約數。"""
    start = today or today_local()
    end = start + timedelta(days=CLOSURE_DAYS - 1)
    exceptions = (
        await db.execute(
            select(VisitException.exception_date, VisitException.campus_key, VisitException.reason)
            .where(
                VisitException.campus_key.in_(campuses),
                VisitException.exception_date >= start,
                VisitException.exception_date <= end,
            )
            .order_by(VisitException.exception_date)
        )
    ).all()
    if not exceptions:
        return f"近 {CLOSURE_DAYS} 天沒有休假日。"
    waiting = {
        (key, day): int(count)
        for key, day, count in (
            await db.execute(
                select(VisitRequest.campus_key, VisitSlot.slot_date, func.count())
                .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
                .where(
                    VisitRequest.campus_key.in_(campuses),
                    slot_service.awaiting_visit_condition(),
                    exclusion.not_excluded(),
                    VisitSlot.slot_date >= start,
                    VisitSlot.slot_date <= end,
                )
                .group_by(VisitRequest.campus_key, VisitSlot.slot_date)
            )
        ).all()
    }
    order = {key: index for index, key in enumerate(campuses)}
    lines = [f"近 {CLOSURE_DAYS} 天的休假日（{_md(start)}–{_md(end)}）"]
    for day, key, reason in sorted(exceptions, key=lambda row: (row[0], order.get(row[1], 99))):
        parts = [f"・{_day(day)}{names.get(key, key)}"]
        cleaned = _clean(reason, REASON_MAX)
        if cleaned:
            parts.append(cleaned)
        count = waiting.get((key, day), 0)
        if count:
            parts.append(f"還有 {count} 筆預約要聯絡")
        lines.append("　".join(parts))
    return _capped(lines)


# ---- 待辦（§5）----


async def todo_text(
    db: AsyncSession, campuses: list[str], names: dict[str, str], *, admissions_enabled: bool, now: datetime | None = None
) -> str:
    """每校現在的今天參觀、待標記、待追蹤、停課要聯絡；條件和後台總覽同一份。"""
    current = now or now_utc()
    in_scope = VisitRequest.campus_key.in_(campuses)
    counts = {
        "今天參觀": await _grouped(
            db,
            select(VisitRequest.campus_key, func.count())
            .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
            .where(
                in_scope,
                VisitRequest.status.in_(_TODAY_STATUSES),
                VisitSlot.slot_date == today_local(current),
                exclusion.not_excluded(),
            )
            .group_by(VisitRequest.campus_key),
        ),
        "待標記": await _grouped(
            db,
            select(VisitRequest.campus_key, func.count())
            .where(in_scope, pending_kinds.condition("awaiting_attendance", current), exclusion.not_excluded())
            .group_by(VisitRequest.campus_key),
        ),
    }
    if admissions_enabled:
        counts["待追蹤"] = await _grouped(
            db,
            select(RecruitmentVisit.campus_key, func.count())
            .where(RecruitmentVisit.campus_key.in_(campuses), follow_up.condition("due", current))
            .group_by(RecruitmentVisit.campus_key),
        )
    counts["停課要聯絡"] = await _grouped(
        db,
        select(VisitRequest.campus_key, func.count())
        .where(in_scope, needs_attention_condition(current), exclusion.not_excluded())
        .group_by(VisitRequest.campus_key),
    )

    def line(label: str, pick) -> str:
        return f"{label}　" + "｜".join(f"{name} {pick(values)}" for name, values in counts.items())

    lines = ["目前待辦"] + [line(names.get(key, key), lambda values, key=key: values.get(key, 0)) for key in campuses]
    if len(campuses) > 1:
        lines.append(line("合計", lambda values: sum(values.get(key, 0) for key in campuses)))
    hints = ["今天參觀", "待標記", *(["待追蹤"] if admissions_enabled else []), "休假日"]
    lines.append("看名單請輸入：" + "、".join(hints))
    return _capped(lines)


# ---- 統計（§6，只有總部群組）----


def stats_range(period: str, today: date) -> tuple[date, date]:
    """本週＝週一到今天；上週＝上週一到上週日；本月＝1 號到今天；上月＝整個上個月。"""
    monday = today - timedelta(days=today.weekday())
    first = today.replace(day=1)
    if period == "week":
        return monday, today
    if period == "last_week":
        return monday - timedelta(days=7), monday - timedelta(days=1)
    if period == "month":
        return first, today
    last = first - timedelta(days=1)
    return last.replace(day=1), last


async def stats_text(
    db: AsyncSession, campuses: list[str], names: dict[str, str], period: str, now: datetime | None = None
) -> str:
    """同後台成效統計「預約結果」（booking_outcomes：依預約送出日、排除測試／重複），加上這批預約裡預繳過的筆數。"""
    current = now or now_utc()
    start, end = stats_range(period, today_local(current))
    window = FunnelRange(start, end)
    outcomes = await booking_outcomes_service.booking_outcomes(db, campuses, window, current)
    deposited = await booking_outcomes_service.deposited_cases(db, campuses, window)

    def line(label: str, row: dict, deposits: int) -> str:
        return (
            f"{label}　預約 {row['cases']}｜到場 {row['completed']}｜未到場 {row['no_show']}｜取消 {row['cancelled']}"
            f"｜待標記 {row['awaiting_attendance']}｜尚未參觀 {row['upcoming']}｜預繳 {deposits}"
        )

    lines = [f"{_STATS_TITLES[period]}（{_md(start)}–{_md(end)}，依預約送出日）"]
    for row in outcomes["campuses"]:
        key = row["campus_key"]
        lines.append(line(names.get(key, key), row, deposited.get(key, 0)))
    totals = outcomes["totals"]
    if len(campuses) > 1:
        lines.append(line("合計", totals, sum(deposited.values())))
    rate = totals["attendance_rate"]
    if rate["value"] is None:
        lines.append("到場率 —（還沒有標記到場或未到場的）")
    else:
        lines.append(f"到場率 {rate['value']:g}%（到場 {rate['numerator']} ÷ 已標記 {rate['denominator']}）")
    return _capped(lines)


# ---- 額度（§7，只有總部群組）----


async def quota_text(settings: Settings, transport=None) -> str:
    """每個設好的官方帳號本月已用／上限（line_accounts 有 5 分鐘快取）。"""
    lines = ["LINE 官方帳號本月用量"]
    for status in await line_accounts.all_statuses(settings, transport):
        name = status.display_name or status.key
        if status.quota_error or status.quota_used is None:
            lines.append(f"・{name}　查不到（金鑰可能失效）")
        elif not status.quota_limit:
            lines.append(f"・{name}　已用 {status.quota_used} 則（沒有上限）")
        else:
            percent = round(status.quota_used * 100 / status.quota_limit)
            warn = "，快用完了" if status.quota_warning else ""
            lines.append(f"・{name}　{status.quota_used}／{status.quota_limit} 則（{percent}%{warn}）")
    if len(lines) == 1:
        lines.append("・沒有設定任何官方帳號")
    lines.append("推到群組是幾個人收到算幾則；查詢與按鈕的回覆不計。")
    return _capped(lines)
