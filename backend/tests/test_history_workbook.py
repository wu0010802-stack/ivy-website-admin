"""目標執行統計表解析（2026-10-20 招生潛力與市佔率規格 §3.1）。假檔由 history_helpers.make_workbook 用 xlwt 合成。"""
from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
import xlrd

from app.admissions.history.models import CampusTermEnrollment
from app.admissions.history.workbook import (
    ParsedWorkbook,
    TermRow,
    WorkbookError,
    parse_as_of,
    parse_term_name,
    parse_workbook,
    sheet_headers,
)
from tests.history_helpers import (
    LAYOUT_99,
    LAYOUT_100,
    MODERN,
    Col,
    SheetSpec,
    grade_values,
    modern_rows,
    write_workbook,
)

NULLABLE = (
    "target", "returning_enrolled", "returning_deposit", "returning_registered",
    "new_target", "new_visits", "new_deposits", "new_registered", "repeat_deposit", "repeat_registered",
)


def by_grade(parsed: ParsedWorkbook, year: int, semester: int) -> dict[str, TermRow]:
    return {r.grade: r for r in parsed.rows if (r.school_year, r.semester) == (year, semester)}


def test_fake_layouts_have_the_column_counts_of_the_real_workbook(tmp_path: Path) -> None:
    path = write_workbook(tmp_path, {
        "115上": SheetSpec(MODERN, rows=modern_rows()),
        "99上": SheetSpec(LAYOUT_99, as_of_text="99.9.15"),
        "100下": SheetSpec(LAYOUT_100, as_of_text="101.03.15"),
    })
    book = xlrd.open_workbook(str(path))
    assert [book.sheet_by_name(n).ncols for n in ("115上", "99上", "100下")] == [17, 14, 18]


def test_term_row_fields_match_the_table_columns() -> None:
    columns = {c.name for c in CampusTermEnrollment.__table__.columns}
    row_fields = set(TermRow.__dataclass_fields__)
    assert row_fields == {"school_year", "semester", "grade", "as_of", "registered", *NULLABLE}
    assert row_fields <= columns


def test_parses_modern_sheet(tmp_path: Path) -> None:
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, as_of_text="1150915", rows=modern_rows())})
    parsed = parse_workbook(path)

    assert [r.grade for r in parsed.rows] == ["大班", "中班", "小班", "幼幼班"]
    big = by_grade(parsed, 115, 1)["大班"]
    assert big.registered == 62
    assert big.returning_enrolled == 43
    assert big.new_visits == 24
    assert big.as_of == date(2026, 9, 15)
    assert big == TermRow(
        school_year=115, semester=1, grade="大班", as_of=date(2026, 9, 15), registered=62, target=70,
        returning_enrolled=43, returning_deposit=40, returning_registered=38,
        new_target=30, new_visits=24, new_deposits=20, new_registered=18, repeat_deposit=4, repeat_registered=6,
    )
    assert by_grade(parsed, 115, 1)["幼幼班"].new_registered == 24
    assert all(isinstance(getattr(r, name), int) for r in parsed.rows for name in ("registered", "school_year"))
    assert parsed.warnings == ()


def test_parses_99_layout(tmp_path: Path) -> None:
    rows = {
        "大班": grade_values(40, target=45, returning_enrolled=30, returning_deposit=28, returning_registered=27,
                           new_deposits=10, new_registered=9, repeat_deposit=4, repeat_registered=4),
        "中班": grade_values(30, returning_enrolled=25, returning_deposit=24, returning_registered=22, new_registered=8),
        "小班": grade_values(20, returning_enrolled=15, returning_deposit=14, returning_registered=13, new_registered=7),
        "幼幼班": grade_values(10, returning_enrolled=2, returning_deposit=1, returning_registered=1, new_registered=9),
    }
    path = write_workbook(tmp_path, {"99上": SheetSpec(LAYOUT_99, as_of_text="99.9.15", rows=rows)})
    parsed = parse_workbook(path)
    big = by_grade(parsed, 99, 1)["大班"]

    assert big.as_of == date(2010, 9, 15)
    assert big.new_target is None
    assert big.new_visits is None
    assert big.returning_deposit == 28
    assert big.returning_registered == 27
    assert big.new_deposits == 10
    assert big.new_registered == 9
    assert big.repeat_registered == 4
    assert by_grade(parsed, 99, 1)["中班"].repeat_deposit is None


def test_parses_100_layout_with_extra_rate(tmp_path: Path) -> None:
    rows = {
        "大班": grade_values(60, new_registered=15, repeat_deposit=3, repeat_registered=5, returning_registered=36),
        "中班": grade_values(50), "小班": grade_values(40), "幼幼班": grade_values(30),
    }
    path = write_workbook(tmp_path, {"100下": SheetSpec(LAYOUT_100, as_of_text="101.03.15", rows=rows)})
    big = by_grade(parse_workbook(path), 100, 2)["大班"]

    assert big.as_of == date(2012, 3, 15)
    assert big.repeat_registered == 5
    assert big.repeat_deposit == 3
    assert big.new_registered == 15
    assert big.returning_registered == 36


def test_total_row_found_by_label(tmp_path: Path) -> None:
    rows = {g: grade_values(r) for g, r in zip(("大班", "中班", "小班", "幼幼班"), (50, 40, 30, 20))}
    path = write_workbook(tmp_path, {
        "114下": SheetSpec(MODERN, as_of_text="1150315", rows=rows, gap_rows=("（待補）",), total={"registered": 140}),
    })
    book = xlrd.open_workbook(str(path))
    assert book.sheet_by_name("114下").cell_value(9, 0) == "總人數"
    assert book.sheet_by_name("114下").cell_value(8, 0) == "（待補）"

    parsed = parse_workbook(path)

    assert parsed.warnings == ()
    assert {r.grade: r.registered for r in parsed.rows} == {"大班": 50, "中班": 40, "小班": 30, "幼幼班": 20}


def test_labels_and_headers_are_normalized(tmp_path: Path) -> None:
    path = write_workbook(tmp_path, {
        "115上": SheetSpec(MODERN, rows=modern_rows(), pad_labels=True),
        "115下": SheetSpec(MODERN, as_of_text="1160315", rows=modern_rows(), date_style="joined"),
    })
    parsed = parse_workbook(path)

    assert by_grade(parsed, 115, 1)["幼幼班"].registered == 33
    assert by_grade(parsed, 115, 2)["大班"].as_of == date(2027, 3, 15)
    assert parsed.warnings == ()


def test_missing_columns_become_none(tmp_path: Path) -> None:
    rows = modern_rows()
    rows["中班"]["returning_enrolled"] = ""
    rows["中班"]["new_visits"] = "　 \n"
    del rows["中班"]["new_target"]
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, rows=rows)})
    middle = by_grade(parse_workbook(path), 115, 1)["中班"]

    assert middle.returning_enrolled is None
    assert middle.new_visits is None
    assert middle.new_target is None
    assert middle.returning_deposit == 39
    assert middle.repeat_registered == 0


def test_total_mismatch_warns(tmp_path: Path) -> None:
    rows = {
        "大班": grade_values(48, repeat_registered=5), "中班": grade_values(50),
        "小班": grade_values(45), "幼幼班": grade_values(42),
    }
    path = write_workbook(tmp_path, {
        "104上": SheetSpec(MODERN, as_of_text="104.09.15", rows=rows, total={"registered": 193}),
    })
    parsed = parse_workbook(path)

    assert parsed.warnings == ("104上：總人數 193，四個年級加重讀 190，差 3",)
    assert len(parsed.rows) == 4
    assert by_grade(parsed, 104, 1)["大班"].registered == 48


def test_missing_total_row_warns_but_still_parses(tmp_path: Path) -> None:
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, rows=modern_rows(), with_total=False)})
    parsed = parse_workbook(path)

    assert len(parsed.rows) == 4
    assert parsed.warnings == ("115上：找不到「總人數」列，略過核對",)


def test_sheets_sorted_by_term(tmp_path: Path) -> None:
    path = write_workbook(tmp_path, {
        "115上": SheetSpec(MODERN, rows=modern_rows()),
        "99下": SheetSpec(LAYOUT_99, as_of_text="100.3.15", rows={g: grade_values(5) for g in ("大班", "中班", "小班", "幼幼班")}),
        "104上": SheetSpec(MODERN, as_of_text="1040915", rows=modern_rows()),
    })
    parsed = parse_workbook(path)

    terms = [(r.school_year, r.semester) for r in parsed.rows]
    assert terms == sorted(terms)
    assert [t for i, t in enumerate(terms) if i % 4 == 0] == [(99, 2), (104, 1), (115, 1)]
    assert [name for name, _, _ in sheet_headers(path)] == ["99下", "104上", "115上"]


def test_notes_never_leak(tmp_path: Path) -> None:
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, rows=modern_rows())})
    sheet = xlrd.open_workbook(str(path)).sheet_by_name("115上")
    on_sheet = " ".join(str(v) for r in range(sheet.nrows) for v in sheet.row_values(r))
    assert "王小明" in on_sheet and "李小華" in on_sheet  # 假檔真的有備註，下面的斷言才有意義

    text = repr(parse_workbook(path)) + str(sheet_headers(path))

    for name in ("王小明", "李小華", "陳小美", "新生(3人)"):
        assert name not in text


def test_sheet_headers_are_normalized_rows_two_and_three(tmp_path: Path) -> None:
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, rows=modern_rows())})
    [(name, row2, row3)] = sheet_headers(path)

    assert name == "115上"
    assert len(row2) == len(row3) == 17
    assert row2[2] == "1150915"
    assert row3[2] == "註冊人數"
    assert row2[4] == "舊生" and row2[8] == "新生" and row2[14].startswith("大班重讀生")
    assert row3[4] == "在籍人數"
    assert all(not any(ch.isspace() for ch in cell) for cell in row2 + row3)


def test_non_integer_count_rejected(tmp_path: Path) -> None:
    rows = modern_rows()
    rows["大班"]["registered"] = 56.5
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, rows=rows)})

    with pytest.raises(WorkbookError, match="115上"):
        parse_workbook(path)


@pytest.mark.parametrize("value", [43.5, "約四十", float("nan")])
def test_non_integer_optional_count_rejected(tmp_path: Path, value: object) -> None:
    rows = modern_rows()
    rows["中班"]["returning_enrolled"] = value
    path = write_workbook(tmp_path, {"108下": SheetSpec(MODERN, as_of_text="1090315", rows=rows)})

    with pytest.raises(WorkbookError) as error:
        parse_workbook(path)
    assert "108下" in str(error.value)
    assert "約四十" not in str(error.value)  # 錯誤訊息不回印格子內容


def test_integer_valued_text_cell_is_accepted(tmp_path: Path) -> None:
    rows = modern_rows()
    rows["中班"]["returning_enrolled"] = " 41 "
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, rows=rows)})

    assert by_grade(parse_workbook(path), 115, 1)["中班"].returning_enrolled == 41


def test_missing_registered_rejected(tmp_path: Path) -> None:
    rows = modern_rows()
    rows["小班"]["registered"] = ""
    path = write_workbook(tmp_path, {"107上": SheetSpec(MODERN, as_of_text="1070915", rows=rows)})

    with pytest.raises(WorkbookError, match="107上"):
        parse_workbook(path)


def test_missing_grade_row_rejected(tmp_path: Path) -> None:
    rows = modern_rows()
    del rows["幼幼班"]
    path = write_workbook(tmp_path, {"107上": SheetSpec(MODERN, as_of_text="1070915", rows=rows)})

    with pytest.raises(WorkbookError, match="107上.*幼幼班"):
        parse_workbook(path)


def test_unrecognised_date_header_rejected(tmp_path: Path) -> None:
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, as_of_text="九月十五日", rows=modern_rows())})

    with pytest.raises(WorkbookError, match="115上"):
        parse_workbook(path)


@pytest.mark.parametrize("block", ["舊生", "新生", "大班重讀生"])
def test_missing_block_header_rejected(tmp_path: Path, block: str) -> None:
    broken = tuple(Col(c.key, "", c.row3) if block in c.row2 else c for c in MODERN)
    path = write_workbook(tmp_path, {"115上": SheetSpec(broken, rows=modern_rows())})

    with pytest.raises(WorkbookError, match=f"115上.*{block}"):
        parse_workbook(path)


def test_sheet_name_must_be_a_term(tmp_path: Path) -> None:
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, rows=modern_rows()), "備註": SheetSpec(MODERN, rows=modern_rows())})

    with pytest.raises(WorkbookError, match="備註"):
        parse_workbook(path)


def test_unreadable_file_rejected(tmp_path: Path) -> None:
    path = tmp_path / "broken.xls"
    path.write_bytes(b"not an xls file")

    with pytest.raises(WorkbookError):
        parse_workbook(path)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("99.9.15", date(2010, 9, 15)),
        ("101.03.15", date(2012, 3, 15)),
        ("102.03.20", date(2013, 3, 20)),
        ("1150315", date(2026, 3, 15)),
        ("註冊人數1150315", date(2026, 3, 15)),
        ("104.09.15註冊人數", date(2015, 9, 15)),
        (" 104.09.15 \n註冊 人數", date(2015, 9, 15)),
        ("990915", date(2010, 9, 15)),
    ],
)
def test_parse_as_of(text: str, expected: date) -> None:
    assert parse_as_of(text) == expected


@pytest.mark.parametrize("text", ["", "註冊人數", "115.13.40", "1150230", "九月十五日"])
def test_parse_as_of_rejects_garbage(text: str) -> None:
    with pytest.raises(ValueError):
        parse_as_of(text)


@pytest.mark.parametrize(
    ("name", "expected"),
    [("104上", (104, 1)), ("104下", (104, 2)), ("99上", (99, 1)), ("115 上", (115, 1)), ("99下", (99, 2))],
)
def test_parse_term_name(name: str, expected: tuple[int, int]) -> None:
    assert parse_term_name(name) == expected


@pytest.mark.parametrize("name", ["", "Sheet1", "104", "備註", "104上學期"])
def test_parse_term_name_rejects_other_names(name: str) -> None:
    with pytest.raises(ValueError):
        parse_term_name(name)
