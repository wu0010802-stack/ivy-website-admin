"""預約表單「預計入學時間」的規則（2026-10-15 規格 X2、X4、X7、§3.3）。選項、公開範圍與顯示文字
讀 contracts/expected-start-cases.json，web 與 admin 的 vitest 讀同一份（計畫裁定 P2）。"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from app.booking import expected_start

CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "contracts" / "expected-start-cases.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES["choices"], ids=lambda case: case["name"])
def test_public_choices_follow_the_shared_cases(case):
    choices = expected_start.public_choices(date.fromisoformat(case["today"]))
    assert [choice["value"] for choice in choices] == case["values"]
    assert [choice["label"] for choice in choices] == case["labels"]


@pytest.mark.parametrize("case", CASES["public_range"], ids=lambda case: f"{case['today']}:{case['value']}")
def test_public_range(case):
    today = date.fromisoformat(case["today"])
    if case["ok"]:
        expected_start.validate_public(case["value"], today)
    else:
        with pytest.raises(ValueError, match="已過期"):
            expected_start.validate_public(case["value"], today)


@pytest.mark.parametrize("case", CASES["labels"], ids=lambda case: f"{case['value']}@{case['submitted_on']}")
def test_display_label(case):
    assert expected_start.display_label(case["value"], date.fromisoformat(case["submitted_on"])) == case["label"]


# 合法值的正向對照在下面兩個測試；"115-1\n"（結尾換行，`$` 會放過）與全形數字（`\d` 會放過）
# 是計畫 W3-8 裁定要擋的兩種，格式一律用 fullmatch ＋ [0-9]。"1１５-1" 開頭是半形 1、後兩位全形，
# 才是真正會被 `\d` 放過（int() 認得全形數字）的寫法。
@pytest.mark.parametrize(
    "value", ["", "115", "115-3", "99-1", "200-1", "115-1 ", "ASAP", "1150-1", "115-1\n", "１１５-１", "1１５-1"]
)
def test_parse_rejects_malformed_values(value):
    with pytest.raises(ValueError, match="格式不對"):
        expected_start.parse(value)


def test_parse_accepts_the_three_shapes():
    assert expected_start.parse("asap") == "asap"
    assert expected_start.parse("unsure") == "unsure"
    assert expected_start.parse("115-2") == (115, 2)


@pytest.mark.parametrize(("value", "expected"), [("100-1", (100, 1)), ("199-2", (199, 2))])
def test_parse_accepts_the_year_bounds(value, expected):
    assert expected_start.parse(value) == expected


@pytest.mark.parametrize("value", ["115-1\n", "１１５-１", "1１５-1"])
def test_validate_public_rejects_malformed_values_before_checking_the_range(value):
    today = date(2026, 10, 15)
    expected_start.validate_public("115-1", today)  # 同一個學期、合法寫法的對照
    with pytest.raises(ValueError, match="格式不對"):
        expected_start.validate_public(value, today)


@pytest.mark.parametrize(
    ("value", "visit_date", "today", "expected"),
    [
        (None, date(2026, 10, 20), date(2026, 10, 20), (115, 1)),
        ("unsure", date(2026, 10, 20), date(2026, 10, 20), (115, 1)),
        # 盡快＝參觀日所在學期：十二月送單、二月才來參觀，就是下學期。
        ("asap", date(2027, 2, 3), date(2027, 2, 3), (115, 2)),
        ("116-1", date(2026, 10, 20), date(2026, 10, 20), (116, 1)),
        # 選的學期比參觀日所在學期還早（家長很晚才來）→ 參觀日所在學期。
        ("115-1", date(2027, 2, 3), date(2027, 2, 3), (115, 2)),
        # 認不得的值不丟例外，退回今天所在學期（計畫裁定 P5）。
        ("not-a-term", date(2026, 10, 20), date(2026, 10, 20), (115, 1)),
        # 結尾換行不算合法學期：若被當成 116-1 會得到 (116, 1)，這裡要退回今天所在學期。
        ("116-1\n", date(2026, 10, 20), date(2026, 10, 20), (115, 1)),
    ],
)
def test_resolve_term(value, visit_date, today, expected):
    assert expected_start.resolve_term(value, visit_date=visit_date, today=today) == expected
