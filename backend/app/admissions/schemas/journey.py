"""預約全程漏斗（2026-10-15 預約全程規格 §3.2）。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


# ---- 預約全程漏斗（2026-10-15 預約全程規格 §3.2）----


class JourneyFiltersOut(BaseModel):
    campus_key: str
    date_from: date
    date_to: date
    source: Literal["all", "web", "assisted"]


class JourneyCasesOut(BaseModel):
    total: int
    # web／phone／line／walk_in／external 各幾筆（未知來源也會出現）。
    by_source: dict[str, int]


class JourneyCancelledOut(BaseModel):
    total: int
    parent: int
    staff: int
    # hold_expired 與沒記取消者。
    other: int


class JourneyOutcomesOut(BaseModel):
    completed: int
    no_show: int
    cancelled: JourneyCancelledOut
    # 時間已過、還沒標記到場或沒來。
    unmarked: int


class JourneyWithdrawnOut(BaseModel):
    total: int
    from_deposit: int
    from_enrolled: int


class JourneyWaitingOut(BaseModel):
    """參觀後未預繳：觀察中（0–13 天）、逾期（14–89 天）、冷名單（90 天以上）。"""

    observing: int
    overdue: int
    cold: int


class JourneyAdmissionsOut(BaseModel):
    with_visit: int
    completed_without_visit: int
    # 曾經到達該階段（預繳過含退出者；註冊過含退註冊者）。
    deposited: int
    enrolled: int
    withdrawn: JourneyWithdrawnOut
    not_deposited: JourneyWaitingOut


class JourneyRateOut(BaseModel):
    key: Literal["attendance", "cancel", "with_visit", "deposit", "enrolled", "withdrawn"]
    numerator: int
    denominator: int
    # 百分比到小數一位；分母 0 為 None。
    pct: float | None


class JourneyDaysOut(BaseModel):
    """天數的中位數（小數一位）與筆數；excluded＝缺時間或負值而不納入的筆數。"""

    median: float | None
    n: int
    excluded: int


class JourneyCancelBucketsOut(BaseModel):
    after_visit: int
    same_day: int
    day_1: int
    days_2_3: int
    days_4_7: int
    days_8_plus: int


class JourneyCancelTimingOut(BaseModel):
    n: int
    excluded: int
    parent: JourneyCancelBucketsOut
    staff: JourneyCancelBucketsOut
    other: JourneyCancelBucketsOut


class JourneyTimingOut(BaseModel):
    lead_days: JourneyDaysOut
    cancel_before_visit: JourneyCancelTimingOut
    visit_to_deposit: JourneyDaysOut
    deposit_to_enrolled: JourneyDaysOut
    deposit_to_withdrawn: JourneyDaysOut


class JourneyRescheduledOut(BaseModel):
    cases: int
    total: int


class JourneyCoverageOut(BaseModel):
    visits_without_request: int
    completed_without_visit: int
    undated_cases: int
    # 已標記排除的測試／重複案件（2026-10-15）；不在批次裡。和各段天數裡「不納入」的 excluded 是兩回事。
    excluded_cases: int = 0


class JourneyOut(BaseModel):
    filters: JourneyFiltersOut
    as_of: datetime
    cases: JourneyCasesOut
    visit_outcomes: JourneyOutcomesOut
    admissions: JourneyAdmissionsOut
    rates: list[JourneyRateOut]
    timing: JourneyTimingOut
    rescheduled: JourneyRescheduledOut
    coverage: JourneyCoverageOut
