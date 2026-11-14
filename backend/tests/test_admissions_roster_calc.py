"""缺額統計的純計算（2026-11-14 規格 §6.3，計畫 Task 2）。不碰資料庫，姓名不存在。"""

from __future__ import annotations

from datetime import date

from app.admissions.roster.calc import (
    Facts,
    TierStatus,
    achievement,
    compute_gap,
    is_new,
    is_underage,
    signed_gap,
    state_on,
    term_for_date,
    tier_status,
)

AS_OF = date(2026, 11, 11)


def facts(**overrides) -> Facts:
    values = dict(
        grade="大班",
        status="enrolled",
        enrollment_date=None,
        deposit_date=None,
        left_date=None,
        refunded_date=None,
        target_school_year=None,
        target_semester=None,
        birthday=None,
        underage_manual=False,
        is_new_manual=False,
        next_year="continue",
    )
    values.update(overrides)
    return Facts(**values)


def enrolled(grade: str, count: int, **overrides) -> list[Facts]:
    return [facts(grade=grade, **overrides) for _ in range(count)]


def pending(grade: str, year: int, semester: int, count: int, **overrides) -> list[Facts]:
    values = dict(
        status="pending",
        deposit_date=date(2026, 9, 1),
        target_school_year=year,
        target_semester=semester,
    )
    values.update(overrides)
    return [facts(grade=grade, **values) for _ in range(count)]


OLD_BIRTHDAY = date(2023, 5, 1)  # 113/9/1 之前出生：升小班
UNDERAGE_BIRTHDAY = date(2024, 10, 1)  # 113/9/1 之後出生：不足齡


def renwu() -> list[Facts]:
    """規格 §6.3 驗算基準（仁武 115.11.11）：在籍 60／59／40／45（幼幼班 10 位不足齡、9–10 月入園）、
    預繳 (115,1) 幼幼 8、(115,2) 中 1＋幼幼 23（幼幼 31 位都不足齡）、(116,1) 小 4＋幼幼 20。"""
    rows: list[Facts] = []
    rows += enrolled("大班", 60)
    rows += enrolled("中班", 59)
    rows += enrolled("小班", 40)
    rows += enrolled("幼幼班", 35, birthday=OLD_BIRTHDAY)
    rows += enrolled("幼幼班", 10, birthday=UNDERAGE_BIRTHDAY, enrollment_date=date(2026, 9, 14))
    rows += pending("幼幼班", 115, 1, 8, birthday=UNDERAGE_BIRTHDAY)
    rows += pending("中班", 115, 2, 1)
    rows += pending("幼幼班", 115, 2, 23, birthday=UNDERAGE_BIRTHDAY)
    rows += pending("小班", 116, 1, 4)
    rows += pending("幼幼班", 116, 1, 20)
    return rows


def test_baseline_matches_excel():
    g = compute_gap(renwu(), school_year=115, as_of=AS_OF)
    assert g.enrolled == {"大班": 60, "中班": 59, "小班": 40, "幼幼班": 45}
    assert g.pending_s1 == {"大班": 0, "中班": 0, "小班": 0, "幼幼班": 8}
    assert g.pending_s2 == {"大班": 0, "中班": 1, "小班": 0, "幼幼班": 23}
    assert g.estimate == {"大班": 60, "中班": 60, "小班": 40, "幼幼班": 76}
    assert g.promoted == {"大班": 60, "中班": 40, "小班": 35, "幼幼班": 41}
    assert g.pending_next == {"大班": 0, "中班": 0, "小班": 4, "幼幼班": 20}
    assert g.estimate_next == {"大班": 60, "中班": 40, "小班": 39, "幼幼班": 61}
    assert (g.underage_enrolled, g.underage_pending) == (10, 31)
    assert (g.missing_birthday, g.incomplete) == (0, 0)


def test_leaving_and_repeating():
    rows = renwu()
    rows[60] = facts(grade="中班", next_year="leave")  # 在籍中班兩位、小班一位標不讀
    rows[61] = facts(grade="中班", next_year="leave")
    rows[119 + 0] = facts(grade="小班", next_year="leave")
    g = compute_gap(rows, school_year=115, as_of=AS_OF)
    assert g.estimate_next == {"大班": 58, "中班": 39, "小班": 39, "幼幼班": 61}
    assert g.leaving == {"大班": 2, "中班": 1, "小班": 0, "幼幼班": 0}
    rows[0] = facts(grade="大班", next_year="repeat")
    g = compute_gap(rows, school_year=115, as_of=AS_OF)
    assert g.estimate_next["大班"] == 59
    assert g.repeating["大班"] == 1


def test_big_class_leave_has_no_effect():
    rows = renwu()
    rows[0] = facts(grade="大班", next_year="leave")
    g = compute_gap(rows, school_year=115, as_of=AS_OF)
    assert g.estimate_next == {"大班": 60, "中班": 40, "小班": 39, "幼幼班": 61}


def test_leaving_toddler_goes_to_own_column_when_underage():
    rows = [
        facts(grade="幼幼班", birthday=UNDERAGE_BIRTHDAY, next_year="leave"),
        facts(grade="幼幼班", birthday=OLD_BIRTHDAY, next_year="leave"),
    ]
    g = compute_gap(rows, school_year=115, as_of=AS_OF)
    assert g.leaving == {"大班": 0, "中班": 0, "小班": 1, "幼幼班": 1}
    assert g.estimate_next == {"大班": 0, "中班": 0, "小班": 0, "幼幼班": 0}


def test_underage_boundary():
    on_cutoff = facts(grade="幼幼班", birthday=date(2024, 9, 1))
    after = facts(grade="幼幼班", birthday=date(2024, 9, 2))
    assert not is_underage(on_cutoff, 115)
    assert is_underage(after, 115)


def test_manual_underage_only_without_birthday():
    assert is_underage(facts(grade="幼幼班", underage_manual=True), 115)
    assert not is_underage(facts(grade="幼幼班", birthday=date(2023, 10, 1), underage_manual=True), 115)


def test_missing_birthday_counted():
    rows = enrolled("幼幼班", 4) + enrolled("幼幼班", 2, birthday=OLD_BIRTHDAY)
    g = compute_gap(rows, school_year=115, as_of=AS_OF)
    assert g.missing_birthday == 4
    assert g.promoted["小班"] == 6  # 沒生日的暫時算可以升小班


def test_incomplete_pending_excluded():
    rows = [
        facts(grade=None, status="pending", deposit_date=date(2026, 9, 1), target_school_year=115, target_semester=1),
        facts(grade="小班", status="pending", deposit_date=date(2026, 9, 1), target_school_year=115, target_semester=None),
    ]
    g = compute_gap(rows, school_year=115, as_of=AS_OF)
    assert g.incomplete == 2
    assert all(sum(block.values()) == 0 for block in (g.enrolled, g.pending_s1, g.pending_s2, g.pending_next))


def test_next_year_underage_not_judged():
    rows = pending("幼幼班", 116, 1, 1, birthday=date(2025, 1, 1))
    g = compute_gap(rows, school_year=115, as_of=AS_OF)
    assert g.pending_next["幼幼班"] == 1
    assert g.underage_pending == 0


def test_other_terms_not_counted():
    rows = pending("小班", 116, 2, 1) + pending("小班", 114, 1, 1)
    g = compute_gap(rows, school_year=115, as_of=AS_OF)
    assert g.incomplete == 0
    assert sum(g.pending_next.values()) == 0 and sum(g.estimate.values()) == 0


def test_state_on_history():
    entered = facts(
        status="enrolled", enrollment_date=date(2026, 10, 5), deposit_date=date(2026, 8, 20)
    )
    assert state_on(entered, date(2026, 9, 15)) == "pending"
    assert state_on(entered, date(2026, 10, 5)) == "enrolled"
    left = facts(status="left", left_date=date(2026, 10, 3))
    assert state_on(left, date(2026, 9, 15)) == "enrolled"
    assert state_on(left, date(2026, 10, 3)) is None
    refunded = facts(status="refunded", deposit_date=date(2026, 9, 1), refunded_date=date(2026, 10, 12))
    assert state_on(refunded, date(2026, 9, 15)) == "pending"
    assert state_on(refunded, date(2026, 10, 12)) is None
    no_deposit = facts(status="enrolled", enrollment_date=date(2026, 10, 1))
    assert state_on(no_deposit, date(2026, 9, 15)) is None


def test_as_of_recomputes_counts():
    rows = [facts(grade="大班", enrollment_date=date(2026, 10, 1), deposit_date=date(2026, 8, 20))]
    early = compute_gap(rows, school_year=115, as_of=date(2026, 9, 15))
    assert early.enrolled["大班"] == 0
    assert early.pending_s1["大班"] == 0  # 沒有入學學期，算進 incomplete
    assert early.incomplete == 1


def test_is_new():
    assert is_new(facts(deposit_date=date(2026, 3, 1)), 115)
    assert is_new(facts(enrollment_date=date(2026, 8, 1)), 115)
    assert not is_new(facts(enrollment_date=date(2026, 7, 31)), 115)
    assert is_new(facts(is_new_manual=True), 115)
    assert not is_new(facts(), 115)


def test_achievement_and_signed_gap():
    assert achievement(39, 44) == 89
    assert achievement(5, None) is None
    assert achievement(5, 0) is None
    assert signed_gap(60, 66) == -6
    assert signed_gap(61, 60) == 1
    assert signed_gap(5, None) is None


def test_tier_status():
    assert tier_status(236, 220, 230, 240) == TierStatus("boost", "top", 4)
    assert tier_status(250, 220, 230, 240) == TierStatus("top", None, None)
    assert tier_status(100, None, None, None) == TierStatus(None, None, None)
    assert tier_status(100, 220, 230, 240) == TierStatus(None, "base", 120)


def test_term_for_date():
    assert term_for_date(date(2026, 12, 1)) == (115, 1)
    assert term_for_date(date(2027, 2, 1)) == (115, 2)
    assert term_for_date(date(2027, 8, 1)) == (116, 1)
