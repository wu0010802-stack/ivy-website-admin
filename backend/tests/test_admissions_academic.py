"""招生入學的民國月份、學期與年級換算（規格 6.4；園務 utils/academic.py、
ivy-frontend constants/recruitment.ts gradeForBirthday）。共用案例在
contracts/ivy-recruitment/grade-cases.json，web 與 admin 的 vitest 讀同一份。"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from app.admissions import academic, constants
from app.common.timezones import today_local

CASES_FILE = Path(__file__).resolve().parents[2] / "contracts" / "ivy-recruitment" / "grade-cases.json"


def _cases() -> list[dict]:
    return json.loads(CASES_FILE.read_text(encoding="utf-8"))["cases"]


def test_shared_cases_cover_every_boundary():
    cases = _cases()
    todays = {case["today"] for case in cases}
    births = {case["birthday"] for case in cases}
    assert {"2026-07-31", "2026-08-01", "2027-01-31", "2027-02-01"} <= todays
    assert {"2023-09-01", "2023-09-02"} <= births
    assert any(case["expected_grade"] is None for case in cases)
    assert {case["expected_grade"] for case in cases} - {None} == set(constants.GRADES)


@pytest.mark.parametrize("case", _cases(), ids=lambda case: case["name"])
def test_shared_grade_cases(case):
    school_year, semester = academic.current_term(date.fromisoformat(case["today"]))
    assert [school_year, semester] == case["expected_term"]
    assert academic.grade_for_birthday(date.fromisoformat(case["birthday"]), school_year) == case["expected_grade"]


@pytest.mark.parametrize(
    ("today", "expected"),
    [
        (date(2026, 7, 31), (114, 2)),
        (date(2026, 8, 1), (115, 1)),
        (date(2026, 12, 31), (115, 1)),
        (date(2027, 1, 1), (115, 1)),
        (date(2027, 1, 31), (115, 1)),
        (date(2027, 2, 1), (115, 2)),
    ],
)
def test_current_term_boundaries(today, expected):
    """Review Focus 2：7/31 → 114 下、8/1 → 115 上、1/31 → 115 上、2/1 → 115 下。"""
    assert academic.current_term(today) == expected
    start, end = academic.term_bounds(*expected)
    assert start <= today <= end


def test_current_term_must_be_given_the_taipei_date():
    # UTC 7/31 16:00 已經是台北 8/1 00:00。呼叫端一律先 today_local()，不能拿 UTC 日期。
    late_utc = datetime(2026, 7, 31, 16, 0, tzinfo=timezone.utc)
    assert academic.current_term(today_local(late_utc)) == (115, 1)
    assert academic.current_term(late_utc.date()) == (114, 2)


def test_term_bounds_match_ivy():
    assert academic.term_bounds(115, 1) == (date(2026, 8, 1), date(2027, 1, 31))
    assert academic.term_bounds(115, 2) == (date(2027, 2, 1), date(2027, 7, 31))
    with pytest.raises(ValueError):
        academic.term_bounds(115, 3)


def test_roc_month_and_date():
    assert academic.roc_month(date(2026, 9, 8)) == "115.09"
    assert academic.roc_date(date(2026, 9, 8)) == "115.09.08"
    assert academic.roc_month(date(2027, 1, 31)) == "116.01"
    assert academic.ROC_MONTH_RE.match("115.09")
    assert not academic.ROC_MONTH_RE.match("115.9")
    assert not academic.ROC_MONTH_RE.match("115.13")


def test_shift_roc_month_crosses_years():
    assert academic.shift_roc_month("115.01", -1) == "114.12"
    assert academic.shift_roc_month("114.12", 1) == "115.01"
    assert academic.shift_roc_month("115.09", -12) == "114.09"
    with pytest.raises(ValueError):
        academic.shift_roc_month("115.9", 1)


def test_constants_follow_ivy_wording():
    assert constants.GRADES == ("幼幼班", "小班", "中班", "大班")
    assert len(constants.NO_DEPOSIT_REASONS) == 8
    grouped = [reason for reasons in constants.NO_DEPOSIT_PRIORITY.values() for reason in reasons]
    assert len(grouped) == len(set(grouped)) and set(grouped) < set(constants.NO_DEPOSIT_REASONS)
    # 「未註明／待追蹤」不屬於任何優先度（園務 shared.py 同）。
    assert set(constants.NO_DEPOSIT_REASONS) - set(grouped) == {"未註明／待追蹤"}
    assert list(constants.SOURCE_CATEGORIES) == [
        "sibling_current", "sibling_split", "sibling_graduate", "self_report", "referral",
        "invite_success", "invite_origin", "home_deposit", "returning",
    ]
    assert constants.STAGES == ("visited", "deposited", "enrolled", "withdrawn")
    assert set(constants.STAGE_LABELS) == set(constants.STAGES)
    assert constants.WITHDRAWN_FROM == ("deposited", "enrolled")
    assert set(constants.WEBSITE_ONLY_EVENT_TYPES) < set(constants.EVENT_TYPES)
    # 年級、未預繳原因都要塞得進欄位長度。
    assert max(len(g) for g in constants.GRADES) <= constants.LEN_GRADE
    assert max(len(r) for r in constants.NO_DEPOSIT_REASONS) <= constants.LEN_REASON_CODE
    assert len(constants.ANONYMIZED_TEXT) <= constants.LEN_CHILD_NAME
    assert len(constants.MISSING_CHILD_NAME) <= constants.LEN_CHILD_NAME
