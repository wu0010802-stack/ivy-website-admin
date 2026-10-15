"""預約全程漏斗與退出時點（2026-10-15 預約全程規格 §3）。

預約案件 → 到場 → 有招生訪視 → 預繳 → 註冊，以及家庭離開的時點。本檔分兩層：
- `compute_journey` 只吃整理好的案件列（`CaseInfo`／`VisitInfo`，日期都是台北日），純函式、不碰資料庫；
- 查庫與整理案件列在檔案後半（Task 2 加）。
一批家庭＝預定參觀日落在期間內、已過參觀時間的預約案件，一案一筆；所有階段都從同一批往下數，所以數字
只會遞減。只描述過去，不預測。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from statistics import median
from typing import Any

from app.admissions.stats import COLD_LEAD_DAYS, DEFAULT_OVERDUE_DAYS, pct

SOURCES = ("web", "phone", "line", "walk_in", "external")
# 預約結果的四類（尚未到參觀時間的 upcoming 在查庫時就丟掉，不會進來）。
OUTCOMES = ("completed", "no_show", "cancelled", "awaiting_attendance")
CANCEL_GROUPS = ("parent", "staff", "other")
# 取消日距預定參觀日：after_visit＝參觀日之後才取消（園方事後取消）。
CANCEL_BUCKETS = ("after_visit", "same_day", "day_1", "days_2_3", "days_4_7", "days_8_plus")


@dataclass(frozen=True)
class VisitInfo:
    """連到預約的招生訪視。日期都是台北日；deposit_on 是最後一筆 deposit_added 的台北日（沒有事件是 None）。"""

    visit_date: date
    has_deposit: bool
    enrolled: bool
    enrolled_on: date | None
    withdrawn_on: date | None
    withdrawn_from: str | None
    deposit_on: date | None

    @property
    def deposited(self) -> bool:
        # 預繳過：目前已預繳、已註冊、或已退出（退出的一定預繳過；註冊的一定預繳過，舊資料可能沒有旗標）。
        return self.has_deposit or self.enrolled or self.withdrawn_on is not None

    @property
    def ever_enrolled(self) -> bool:
        return self.enrolled or self.withdrawn_from == "enrolled"


@dataclass(frozen=True)
class CaseInfo:
    source: str
    outcome: str
    created_on: date
    visited_on: date
    cancelled_on: date | None
    cancel_reason: str | None
    rescheduled: bool
    visit: VisitInfo | None


def _rate(key: str, numerator: int, denominator: int) -> dict[str, Any]:
    return {"key": key, "numerator": numerator, "denominator": denominator, "pct": pct(numerator, denominator)}


def _days(values: list[int], excluded: int) -> dict[str, Any]:
    return {"median": round(float(median(values)), 1) if values else None, "n": len(values), "excluded": excluded}


def _cancel_bucket(days_before: int) -> str:
    if days_before < 0:
        return "after_visit"
    if days_before == 0:
        return "same_day"
    if days_before == 1:
        return "day_1"
    if days_before <= 3:
        return "days_2_3"
    if days_before <= 7:
        return "days_4_7"
    return "days_8_plus"


def _gap(start: date | None, end: date | None, values: list[int]) -> bool:
    """end − start 的天數加進 values；缺日期或負值回 True（呼叫端記成「不納入」）。"""
    if start is None or end is None:
        return True
    days = (end - start).days
    if days < 0:
        return True
    values.append(days)
    return False


def compute_journey(
    cases: list[CaseInfo], *, today: date, visits_without_request: int, undated_cases: int
) -> dict[str, Any]:
    by_source = dict.fromkeys(SOURCES, 0)
    outcomes = dict.fromkeys(OUTCOMES, 0)
    cancelled = dict.fromkeys(CANCEL_GROUPS, 0)
    waiting = {"observing": 0, "overdue": 0, "cold": 0}
    withdrawn = {"from_deposit": 0, "from_enrolled": 0}
    with_visit = deposited = enrolled = without_visit = rescheduled = 0
    lead: list[int] = []
    lead_excluded = 0
    cancel_counts = {group: dict.fromkeys(CANCEL_BUCKETS, 0) for group in CANCEL_GROUPS}
    cancel_n = cancel_excluded = 0
    to_deposit: list[int] = []
    to_deposit_excluded = 0
    to_enrolled: list[int] = []
    to_enrolled_excluded = 0
    to_withdrawn: list[int] = []
    to_withdrawn_excluded = 0

    for item in cases:
        if item.outcome not in outcomes:
            raise ValueError(f"不認得的預約結果：{item.outcome}")
        by_source[item.source] = by_source.get(item.source, 0) + 1
        outcomes[item.outcome] += 1
        if item.rescheduled:
            rescheduled += 1
        lead_excluded += _gap(item.created_on, item.visited_on, lead)
        if item.outcome == "cancelled":
            group = item.cancel_reason if item.cancel_reason in ("parent", "staff") else "other"
            cancelled[group] += 1
            if item.cancelled_on is None:
                cancel_excluded += 1
            else:
                cancel_counts[group][_cancel_bucket((item.visited_on - item.cancelled_on).days)] += 1
                cancel_n += 1
        if item.outcome != "completed":
            continue
        found = item.visit
        if found is None:
            without_visit += 1
            continue
        with_visit += 1
        if found.deposited:
            deposited += 1
            to_deposit_excluded += _gap(found.visit_date, found.deposit_on, to_deposit)
        else:
            age = (today - found.visit_date).days
            waiting["cold" if age >= COLD_LEAD_DAYS else "overdue" if age >= DEFAULT_OVERDUE_DAYS else "observing"] += 1
        if found.ever_enrolled:
            enrolled += 1
            to_enrolled_excluded += _gap(found.deposit_on, found.enrolled_on, to_enrolled)
        if found.withdrawn_on is not None:
            withdrawn["from_enrolled" if found.withdrawn_from == "enrolled" else "from_deposit"] += 1
            to_withdrawn_excluded += _gap(found.deposit_on, found.withdrawn_on, to_withdrawn)

    total = len(cases)
    marked = outcomes["completed"] + outcomes["no_show"]
    withdrawn_total = withdrawn["from_deposit"] + withdrawn["from_enrolled"]
    return {
        "cases": {"total": total, "by_source": by_source},
        "visit_outcomes": {
            "completed": outcomes["completed"],
            "no_show": outcomes["no_show"],
            "cancelled": {"total": outcomes["cancelled"], **cancelled},
            "unmarked": outcomes["awaiting_attendance"],
        },
        "admissions": {
            "with_visit": with_visit,
            "completed_without_visit": without_visit,
            "deposited": deposited,
            "enrolled": enrolled,
            "withdrawn": {"total": withdrawn_total, **withdrawn},
            "not_deposited": waiting,
        },
        "rates": [
            _rate("attendance", outcomes["completed"], marked),
            _rate("cancel", outcomes["cancelled"], total),
            _rate("with_visit", with_visit, outcomes["completed"]),
            _rate("deposit", deposited, with_visit),
            _rate("enrolled", enrolled, deposited),
            _rate("withdrawn", withdrawn_total, deposited),
        ],
        "timing": {
            "lead_days": _days(lead, lead_excluded),
            "cancel_before_visit": {"n": cancel_n, "excluded": cancel_excluded, **cancel_counts},
            "visit_to_deposit": _days(to_deposit, to_deposit_excluded),
            "deposit_to_enrolled": _days(to_enrolled, to_enrolled_excluded),
            "deposit_to_withdrawn": _days(to_withdrawn, to_withdrawn_excluded),
        },
        "rescheduled": {"cases": rescheduled, "total": total},
        "coverage": {
            "visits_without_request": visits_without_request,
            "completed_without_visit": without_visit,
            "undated_cases": undated_cases,
        },
    }
