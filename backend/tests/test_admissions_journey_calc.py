"""預約全程漏斗的彙整核心（2026-10-15 預約全程規格 §3.1、§3.2）：純函式，不碰資料庫。

情境表（13 筆，今天 2026-10-15）：期望值都是手算的，改程式前先確認是規格變了。"""

from __future__ import annotations

from datetime import date, timedelta
from itertools import product

import pytest

from app.admissions.journey import CANCEL_BUCKETS, CaseInfo, VisitInfo, compute_journey

TODAY = date(2026, 10, 15)


def d(month: int, day: int) -> date:
    return date(2026, month, day)


def visit(
    visit_date: date, *, deposit: bool = False, deposit_on: date | None = None, enrolled: bool = False,
    enrolled_on: date | None = None, withdrawn_on: date | None = None, withdrawn_from: str | None = None,
) -> VisitInfo:
    return VisitInfo(
        visit_date=visit_date, has_deposit=deposit, enrolled=enrolled, enrolled_on=enrolled_on,
        withdrawn_on=withdrawn_on, withdrawn_from=withdrawn_from, deposit_on=deposit_on,
    )


def case(
    outcome: str, *, source: str = "web", created: date, visited: date, cancelled_on: date | None = None,
    cancel_reason: str | None = None, rescheduled: bool = False, linked: VisitInfo | None = None,
) -> CaseInfo:
    return CaseInfo(
        source=source, outcome=outcome, created_on=created, visited_on=visited, cancelled_on=cancelled_on,
        cancel_reason=cancel_reason, rescheduled=rescheduled, visit=linked,
    )


def scenario() -> list[CaseInfo]:
    return [
        # 1 到場、預繳、註冊
        case("completed", created=d(9, 1), visited=d(9, 8),
             linked=visit(d(9, 8), deposit=True, deposit_on=d(9, 20), enrolled=True, enrolled_on=d(10, 1))),
        # 2 到場、預繳、之後退預繳
        case("completed", created=d(9, 5), visited=d(9, 10),
             linked=visit(d(9, 10), deposit=True, deposit_on=d(9, 15), withdrawn_on=d(9, 30), withdrawn_from="deposited")),
        # 3 到場、沒預繳、參觀後 33 天（逾期）
        case("completed", source="phone", created=d(9, 10), visited=d(9, 12), linked=visit(d(9, 12))),
        # 4 到場、沒預繳、參觀後 7 天（觀察中）
        case("completed", source="line", created=d(10, 1), visited=d(10, 8), linked=visit(d(10, 8))),
        # 5 到場、沒預繳、參觀後 127 天（冷名單）
        case("completed", created=d(6, 1), visited=d(6, 10), linked=visit(d(6, 10))),
        # 6 到場但沒有招生訪視
        case("completed", created=d(9, 20), visited=d(9, 25)),
        # 7 沒來
        case("no_show", created=d(9, 18), visited=d(9, 24)),
        # 8 家長取消（參觀當天）
        case("cancelled", created=d(9, 1), visited=d(9, 20), cancelled_on=d(9, 20), cancel_reason="parent"),
        # 9 園方取消（7 天前）
        case("cancelled", source="phone", created=d(9, 2), visited=d(9, 22), cancelled_on=d(9, 15), cancel_reason="staff"),
        # 10 取消原因沒記（參觀日之後才取消）
        case("cancelled", created=d(9, 3), visited=d(9, 23), cancelled_on=d(9, 30), cancel_reason=None),
        # 11 時間已過未標記
        case("awaiting_attendance", created=d(10, 1), visited=d(10, 10)),
        # 12 到場、預繳過但沒有預繳事件（缺預繳日）
        case("completed", source="walk_in", created=d(9, 25), visited=d(9, 26), linked=visit(d(9, 26), deposit=True)),
        # 13 改過期、到場、預繳、註冊、之後退註冊。funnel.transition 退出時會把 has_deposit、enrolled、
        # enrolled_on 全部清掉（只留 deposit_added 事件的預繳日與 withdrawn_*），所以真實資料長這樣。
        case("completed", created=d(9, 28), visited=d(10, 1), rescheduled=True,
             linked=visit(d(10, 1), deposit=False, deposit_on=d(10, 3), enrolled=False, enrolled_on=None,
                          withdrawn_on=d(10, 10), withdrawn_from="enrolled")),
    ]


def run(cases, *, without_request: int = 4, undated: int = 2) -> dict:
    return compute_journey(cases, today=TODAY, visits_without_request=without_request, undated_cases=undated)


def test_scenario_counts():
    result = run(scenario())
    assert result["cases"] == {"total": 13, "by_source": {"web": 9, "phone": 2, "line": 1, "walk_in": 1, "external": 0}}
    assert result["visit_outcomes"] == {
        "completed": 8, "no_show": 1, "cancelled": {"total": 3, "parent": 1, "staff": 1, "other": 1}, "unmarked": 1,
    }
    assert result["admissions"] == {
        "with_visit": 7, "completed_without_visit": 1, "deposited": 4, "enrolled": 2,
        "withdrawn": {"total": 2, "from_deposit": 1, "from_enrolled": 1},
        "not_deposited": {"observing": 1, "overdue": 1, "cold": 1},
    }
    assert result["rescheduled"] == {"cases": 1, "total": 13}
    assert result["coverage"] == {"visits_without_request": 4, "completed_without_visit": 1, "undated_cases": 2}


def test_scenario_rates_carry_numerator_and_denominator():
    rates = {rate["key"]: rate for rate in run(scenario())["rates"]}
    assert list(rates) == ["attendance", "cancel", "with_visit", "deposit", "enrolled", "withdrawn"]
    assert rates["attendance"] == {"key": "attendance", "numerator": 8, "denominator": 9, "pct": 88.9}
    assert rates["cancel"] == {"key": "cancel", "numerator": 3, "denominator": 13, "pct": 23.1}
    assert rates["with_visit"] == {"key": "with_visit", "numerator": 7, "denominator": 8, "pct": 87.5}
    assert rates["deposit"] == {"key": "deposit", "numerator": 4, "denominator": 7, "pct": 57.1}
    assert rates["enrolled"] == {"key": "enrolled", "numerator": 2, "denominator": 4, "pct": 50.0}
    assert rates["withdrawn"] == {"key": "withdrawn", "numerator": 2, "denominator": 4, "pct": 50.0}


def test_scenario_timing():
    timing = run(scenario())["timing"]
    # 提前量（參觀日 − 送出日）：1,2,3,5,5,6,7,7,9,9,19,20,20 → 中位數 7。
    assert timing["lead_days"] == {"median": 7.0, "n": 13, "excluded": 0}
    # 取消時點：8 當天（家長）、9 距 7 天（園方）、10 參觀日之後（其他）。
    zero = dict.fromkeys(CANCEL_BUCKETS, 0)
    assert timing["cancel_before_visit"] == {
        "n": 3, "excluded": 0,
        "parent": {**zero, "same_day": 1}, "staff": {**zero, "days_4_7": 1}, "other": {**zero, "after_visit": 1},
    }
    # 參觀→預繳：1 是 12、2 是 5、13 是 2（12 沒有預繳事件，另列 1 筆）。
    assert timing["visit_to_deposit"] == {"median": 5.0, "n": 3, "excluded": 1}
    # 預繳→註冊：只剩 1 是 11；13 退註冊時註冊日已被清掉，缺註冊日算不納入。
    assert timing["deposit_to_enrolled"] == {"median": 11.0, "n": 1, "excluded": 1}
    # 預繳→退出：2 是 15、13 是 7 → 11.0。
    assert timing["deposit_to_withdrawn"] == {"median": 11.0, "n": 2, "excluded": 0}


@pytest.mark.parametrize(
    ("age_days", "bucket"),
    [(0, "observing"), (13, "observing"), (14, "overdue"), (89, "overdue"), (90, "cold"), (400, "cold")],
)
def test_waiting_for_deposit_splits_at_14_and_90_days(age_days, bucket):
    visited = TODAY - timedelta(days=age_days)
    result = run([case("completed", created=visited - timedelta(days=3), visited=visited, linked=visit(visited))])
    waiting = result["admissions"]["not_deposited"]
    assert waiting[bucket] == 1 and sum(waiting.values()) == 1


@pytest.mark.parametrize(
    ("days_before", "bucket"),
    [(-1, "after_visit"), (0, "same_day"), (1, "day_1"), (2, "days_2_3"), (3, "days_2_3"), (4, "days_4_7"), (7, "days_4_7"), (8, "days_8_plus")],
)
def test_cancel_buckets_edges(days_before, bucket):
    visited = d(9, 20)
    result = run([case("cancelled", created=d(9, 1), visited=visited, cancelled_on=visited - timedelta(days=days_before), cancel_reason="parent")])
    counts = result["timing"]["cancel_before_visit"]["parent"]
    assert counts[bucket] == 1 and sum(counts.values()) == 1


def test_negative_and_missing_times_are_excluded_not_hidden():
    cases = [
        # 送出日比參觀日晚（補登順序造成）：提前量不納入。
        case("completed", created=d(9, 12), visited=d(9, 10), linked=visit(d(9, 10), deposit=True, deposit_on=d(9, 5))),
        # 取消但沒有取消時間。
        case("cancelled", created=d(9, 1), visited=d(9, 10), cancelled_on=None, cancel_reason="staff"),
        # 註冊了但缺註冊日。
        case("completed", created=d(9, 1), visited=d(9, 2),
             linked=visit(d(9, 2), deposit=True, deposit_on=d(9, 4), enrolled=True, enrolled_on=None)),
    ]
    timing = run(cases)["timing"]
    assert timing["lead_days"] == {"median": 5.0, "n": 2, "excluded": 1}  # c2 九天、c3 一天；c1 倒置不納入
    assert timing["cancel_before_visit"]["n"] == 0 and timing["cancel_before_visit"]["excluded"] == 1
    assert timing["visit_to_deposit"] == {"median": 2.0, "n": 1, "excluded": 1}  # 第一筆的預繳日早於參觀日：負值不納入
    assert timing["deposit_to_enrolled"] == {"median": None, "n": 0, "excluded": 1}


def test_empty_cohort():
    result = run([], without_request=0, undated=0)
    assert result["cases"] == {"total": 0, "by_source": {"web": 0, "phone": 0, "line": 0, "walk_in": 0, "external": 0}}
    assert all(rate["pct"] is None and rate["denominator"] == 0 for rate in result["rates"])
    assert result["timing"]["lead_days"] == {"median": None, "n": 0, "excluded": 0}
    assert result["rescheduled"] == {"cases": 0, "total": 0}


def test_unknown_outcome_is_a_bug_not_a_silent_miscount():
    with pytest.raises(ValueError):
        run([case("upcoming", created=d(10, 1), visited=d(10, 20))])


def _visit_variants() -> list[VisitInfo | None]:
    """涵蓋各種奇怪組合：預繳旗標、註冊旗標、退出、缺預繳日。"""
    variants: list[VisitInfo | None] = [None]
    for deposit, enrolled, withdrawn_from in product((False, True), (False, True), (None, "deposited", "enrolled")):
        for deposit_on in (None, d(9, 12)):
            variants.append(
                visit(
                    d(9, 10), deposit=deposit, deposit_on=deposit_on, enrolled=enrolled,
                    enrolled_on=d(9, 20) if enrolled else None,
                    withdrawn_on=d(9, 25) if withdrawn_from else None, withdrawn_from=withdrawn_from,
                )
            )
    return variants


def test_invariants_hold_for_every_combination():
    cases = [
        case(outcome, created=d(9, 1), visited=d(9, 10), cancelled_on=d(9, 8) if outcome == "cancelled" else None,
             cancel_reason="parent" if outcome == "cancelled" else None,
             linked=linked if outcome == "completed" else None)
        for outcome in ("completed", "no_show", "cancelled", "awaiting_attendance")
        for linked in _visit_variants()
    ]
    result = run(cases)
    total = result["cases"]["total"]
    outcomes, adm = result["visit_outcomes"], result["admissions"]
    waiting = adm["not_deposited"]
    # (a)
    assert total == outcomes["completed"] + outcomes["no_show"] + outcomes["cancelled"]["total"] + outcomes["unmarked"]
    # (b)
    assert outcomes["completed"] == adm["with_visit"] + adm["completed_without_visit"]
    # (c)
    assert adm["with_visit"] == adm["deposited"] + waiting["observing"] + waiting["overdue"] + waiting["cold"]
    # (d)
    assert total == (
        adm["deposited"] + outcomes["cancelled"]["total"] + outcomes["no_show"] + outcomes["unmarked"]
        + adm["completed_without_visit"] + waiting["observing"] + waiting["overdue"] + waiting["cold"]
    )
    # (e)
    assert adm["enrolled"] <= adm["deposited"] <= adm["with_visit"] <= outcomes["completed"]
    assert adm["withdrawn"]["total"] <= adm["deposited"]
    assert adm["withdrawn"]["total"] == adm["withdrawn"]["from_deposit"] + adm["withdrawn"]["from_enrolled"]
