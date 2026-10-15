"""教保資訊網幼生清冊的讀取與班別換算（2026-10-15 規格 §2、E7、E8）。"""
from __future__ import annotations

from datetime import date

import pytest

from app.admissions.enrolled.roster import Roster, RosterError, RosterRow, parse_roster, roster_grade
from tests.enrolled_helpers import roster_html


def test_reads_birthday_and_address_by_header_text():
    roster = parse_roster(roster_html([("2022/02/11", "測試里1鄰測試路1號"), ("2020/09/26", "測試路2號")]))
    assert roster == Roster(
        printed_on=date(2026, 10, 15),
        rows=(RosterRow(date(2022, 2, 11), "測試里1鄰測試路1號"), RosterRow(date(2020, 9, 26), "測試路2號")),
    )


def test_column_order_does_not_matter():
    header = ("通訊地址", "實際年齡", "出生日期", "編號")
    roster = parse_roster(roster_html([("2022/02/11", "測試路1號")], header=header))
    assert roster.rows == (RosterRow(date(2022, 2, 11), "測試路1號"),)


def test_html_entities_in_the_address_are_decoded():
    roster = parse_roster(roster_html([("2022/02/11", "測試里1鄰&nbsp;測試路&#49;號")]))
    assert roster.rows[0].address == "測試里1鄰\xa0測試路1號"


def test_missing_print_date_is_none():
    assert parse_roster(roster_html([("2022/02/11", "測試路1號")], printed=None)).printed_on is None


def test_missing_required_column_is_an_error():
    with pytest.raises(RosterError, match="出生日期"):
        parse_roster(roster_html([("2022/02/11", "測試路1號")], header=("編號", "通訊地址")))


def test_bad_birthday_names_the_row_but_not_the_address():
    with pytest.raises(RosterError) as caught:
        parse_roster(roster_html([("2022/02/11", "測試路1號"), ("111/02/11", "秘密路9號")]))
    assert "第 3 列" in str(caught.value)
    assert "秘密路" not in str(caught.value)


def test_empty_roster_is_an_error():
    with pytest.raises(RosterError, match="沒有任何學生"):
        parse_roster(roster_html([]))


@pytest.mark.parametrize(
    ("birthday", "grade"),
    [
        (date(2021, 9, 1), "大班"),
        (date(2021, 9, 2), "中班"),
        (date(2024, 9, 1), "幼幼班"),
        (date(2024, 9, 2), "幼幼班"),  # 9/1 還沒滿 2 歲：學年中滿 2 歲才入園，實際在幼幼班（E7）
        (date(2020, 9, 2), "大班"),
        (date(2020, 9, 1), "其他"),  # 9/1 已滿 6 歲（E8）
    ],
)
def test_grade_for_school_year_115(birthday, grade):
    assert roster_grade(birthday, 115) == grade
