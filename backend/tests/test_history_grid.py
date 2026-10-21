"""歷年註冊解析的格子表層（2026-10-21 後台資料匯入）：grid.py 不碰 xlrd，吃瀏覽器擷取後的格子表。
擷取規則的共用案例在 contracts/ivy-recruitment/history-extract-cases.json，admin 的 vitest 讀同一份。
假檔由 history_helpers 用 xlwt 合成；備註列是假名，確認擷取後一個字都沒帶出去。"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import xlrd

from app.admissions.history.grid import EMPTY, MASKED, GridCell, SheetGrid, WorkbookError, masked_headers, parse_grids
from app.admissions.history.workbook import _grid_cell, parse_workbook, read_grids, sheet_headers
from tests.history_helpers import (
    FAKE_NOTES,
    LAYOUT_99,
    LAYOUTS,
    MODERN,
    SheetSpec,
    browser_extract,
    grade_values,
    grid_from_raw,
    grid_json,
    modern_rows,
    write_workbook,
)

CASES_FILE = Path(__file__).resolve().parents[2] / "contracts" / "ivy-recruitment" / "history-extract-cases.json"


def _cases() -> list[dict]:
    return json.loads(CASES_FILE.read_text(encoding="utf-8"))["cases"]


def _rows_99() -> dict[str, dict[str, Any]]:
    return {
        "大班": grade_values(40, target=45, returning_enrolled=30, returning_deposit=28, returning_registered=27,
                           new_deposits=10, new_registered=9, repeat_deposit=4, repeat_registered=4),
        "中班": grade_values(30, returning_enrolled=25, returning_deposit=24, returning_registered=22, new_registered=8),
        "小班": grade_values(20, returning_enrolled=15, returning_deposit=14, returning_registered=13, new_registered=7),
        "幼幼班": grade_values(10, returning_enrolled=2, returning_deposit=1, returning_registered=1, new_registered=9),
    }


# 版型 → (該版型的表頭日期寫法, 上學期日期, 下學期日期, 四個年級的數字)
LAYOUT_SHEETS = {
    "modern": ("1040915", "1050315", modern_rows),
    "99": ("99.9.15", "100.3.15", _rows_99),
    "100": ("101.03.15", "102.03.15", modern_rows),
}


def test_shared_cases_cover_the_extraction_rules() -> None:
    cases = _cases()
    assert len(cases) >= 2
    text = json.dumps(cases, ensure_ascii=False)
    assert "測試小明" in text  # 案例裡真的有姓名，下面「不外送」的斷言才有意義
    assert all(set(case) == {"name", "sheet", "width", "rows", "expected"} for case in cases)


@pytest.mark.parametrize("case", _cases(), ids=lambda case: case["name"])
def test_browser_extract_shared_cases(case: dict) -> None:
    grid = grid_from_raw(case["sheet"], case["rows"], case["width"])

    assert grid_json(browser_extract(grid)) == case["expected"]


@pytest.mark.parametrize("case", _cases(), ids=lambda case: case["name"])
def test_shared_cases_never_carry_names(case: dict) -> None:
    grid = grid_from_raw(case["sheet"], case["rows"], case["width"])

    text = json.dumps(grid_json(browser_extract(grid)), ensure_ascii=False)

    assert "測試小明" not in text and "測試小華" not in text and "測試小美" not in text


def test_browser_extract_rows_never_exceed_width() -> None:
    """每一列都不比原表的 width 長（width 0 時標籤列也不例外），送出的 width 至少 1、不比任何一列短。"""
    raw = [[], [], ["目標人數"], ["註冊"], ["大班", 1], ["總人數", 2]]
    for width in (0, 1, 2, 5):
        grid = browser_extract(grid_from_raw("104上", raw, width))
        assert grid.width == max([1, *(len(cells) for cells in grid.rows.values())])
        assert all(len(cells) <= width for cells in grid.rows.values()), width


@pytest.mark.parametrize("layout", LAYOUTS, ids=list(LAYOUTS))
def test_grids_parse_the_same_as_xlrd(tmp_path: Path, layout: str) -> None:
    first, second, make_rows = LAYOUT_SHEETS[layout]
    path = write_workbook(tmp_path, {
        "104上": SheetSpec(layout=LAYOUTS[layout], as_of_text=first, rows=make_rows(), pad_labels=True),
        # 下學期：總人數對不上（要有警告）、年級列與總人數之間夾雜字列、整句日期寫在第 2 列。
        "104下": SheetSpec(
            layout=LAYOUTS[layout], as_of_text=second, rows=make_rows(), total={"registered": 999},
            gap_rows=("（待補）",), date_style="joined",
        ),
    })

    from_xlrd = parse_workbook(path)
    from_grids = parse_grids([browser_extract(grid) for grid in read_grids(path)])

    assert len(from_xlrd.rows) == 8 and len(from_xlrd.warnings) == 1
    assert from_grids == from_xlrd


def test_extraction_does_not_change_the_parse_result(tmp_path: Path) -> None:
    # 標題與備註列沒送，解析結果也不能因此不同：整份原始格子與擷取後的格子要得到一樣的結果。
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, rows=modern_rows())})
    grids = read_grids(path)

    assert grids[0].nrows > max(browser_extract(grids[0]).rows) + 1
    assert parse_grids(grids) == parse_grids([browser_extract(grid) for grid in grids])


def test_browser_extract_never_carries_notes(tmp_path: Path) -> None:
    path = write_workbook(tmp_path, {"104上": SheetSpec(rows=modern_rows())})
    grids = read_grids(path)
    on_sheet = json.dumps([grid_json(grid) for grid in grids], ensure_ascii=False)
    assert all(note in on_sheet for note in FAKE_NOTES)  # 假檔真的有備註，下面的斷言才有意義

    text = json.dumps([grid_json(browser_extract(grid)) for grid in grids], ensure_ascii=False)

    assert not any(note in text for note in FAKE_NOTES)
    for name in ("王小明", "李小華", "陳小美", "新生(3人)"):
        assert name not in text


def test_masked_count_is_rejected_like_text(tmp_path: Path) -> None:
    rows = modern_rows()
    rows["大班"]["registered"] = "約四十"
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, rows=rows, total={"registered": 200})})
    grids = read_grids(path)
    with pytest.raises(WorkbookError) as from_text:
        parse_grids(grids)

    extracted = [browser_extract(grid) for grid in grids]
    assert extracted[0].cell(4, 2) == MASKED  # 第 4 列是大班，第 2 欄是日期欄註冊人數
    with pytest.raises(WorkbookError) as from_masked:
        parse_grids(extracted)

    assert str(from_masked.value) == str(from_text.value)
    assert "115上" in str(from_masked.value) and "不是整數" in str(from_masked.value)
    assert "約四十" not in str(from_masked.value)


def test_masked_optional_count_is_rejected_and_masked_header_reads_as_blank() -> None:
    raw = [
        [], [],
        ["目標人數", None, "1150915", "舊生", "新生", "大班重讀生"],
        [None, None, "註冊人數", "在籍人數", "目標人數", "預繳人數"],
        ["大班", 70, 62, "測試小明", 30, 4],
        ["中班", 60, 50, 41, 22, 1],
        ["小班", 55, 48, 37, 25, 0],
        ["幼幼班", 40, 33, 12, 30, 2],
    ]
    grid = browser_extract(grid_from_raw("115上", raw, 6))
    assert grid.cell(4, 3) == MASKED
    with pytest.raises(WorkbookError, match="115上.*「大班」列舊生在籍人數不是整數"):
        parse_grids([grid])

    # 表頭被遮住等於空白：找不到區塊，訊息只有工作表名與欄位名。
    headless = SheetGrid(name="115上", width=6, rows={**grid.rows, 2: [MASKED] * 6})
    with pytest.raises(WorkbookError, match="115上.*找不到「大班重讀生」欄") as error:
        parse_grids([headless])
    assert "測試小明" not in str(error.value)


def test_sheet_grid_reads_missing_cells_as_empty() -> None:
    grid = SheetGrid(name="104上", width=3, rows={2: [GridCell("number", 1.0)], 5: []})

    assert grid.nrows == 6
    assert grid.cell(2, 0) == GridCell("number", 1.0)
    assert grid.cell(2, 2) == EMPTY  # 這一列比 width 短
    assert grid.cell(3, 0) == EMPTY  # 沒有這一列
    assert grid.cell(99, 99) == EMPTY
    assert SheetGrid(name="x", width=0, rows={}).nrows == 0


def test_parse_grids_checks_header_rows_present() -> None:
    with pytest.raises(WorkbookError, match="104上：表頭不足"):
        parse_grids([SheetGrid(name="104上", width=2, rows={2: [EMPTY, EMPTY]})])


def test_parse_grids_rejects_duplicate_and_unknown_terms() -> None:
    with pytest.raises(WorkbookError, match="備註：工作表名不是"):
        parse_grids([SheetGrid(name="備註", width=0, rows={})])
    with pytest.raises(WorkbookError, match="104上：學期重複"):
        parse_grids([SheetGrid(name="104上", width=0, rows={}), SheetGrid(name="104 上", width=0, rows={})])


def test_masked_headers_match_cli_headers(tmp_path: Path) -> None:
    path = write_workbook(tmp_path, {
        "115上": SheetSpec(MODERN, rows=modern_rows(), pad_labels=True),
        "99下": SheetSpec(LAYOUT_99, as_of_text="100.3.15", rows=_rows_99(), gap_rows=("（待補）",)),
        "備註": SheetSpec(MODERN, rows=modern_rows(), notes=()),
    })
    grids = read_grids(path)

    headers = masked_headers(grids)

    assert headers == sheet_headers(path)
    assert [name for name, *_ in headers] == ["99下", "115上", "備註"]
    # 擷取後的格子表頭兩列與整份原始格子相同；標題列（第 0、1 列）與備註列沒送，第 0 欄對應的位置是空白。
    extracted = masked_headers([browser_extract(grid) for grid in grids])
    assert [item[:3] for item in extracted] == [item[:3] for item in headers]
    assert extracted[1][3] == ["", "", "…", "", "大班", "中班", "小班", "幼幼班", "總人數", ""]
    assert headers[1][3] == ["…", "…", "…", "", "大班", "中班", "小班", "幼幼班", "總人數", "…"]
    assert not any(note in str(extracted) for note in FAKE_NOTES)


@pytest.mark.parametrize(
    ("cell", "expected"),
    [
        (xlrd.sheet.Cell(xlrd.XL_CELL_EMPTY, ""), EMPTY),
        (xlrd.sheet.Cell(xlrd.XL_CELL_BLANK, ""), EMPTY),
        (xlrd.sheet.Cell(xlrd.XL_CELL_NUMBER, 3.0), GridCell("number", 3.0)),
        (xlrd.sheet.Cell(xlrd.XL_CELL_TEXT, "大班"), GridCell("text", "大班")),
        (xlrd.sheet.Cell(xlrd.XL_CELL_DATE, 45915.0), GridCell("text", "45915.0")),
        # 布林與錯誤碼的 value 是整數：當文字會被人數欄收下（錯誤碼 7 變成 7 人），所以和瀏覽器一樣遮住。
        (xlrd.sheet.Cell(xlrd.XL_CELL_BOOLEAN, 1), MASKED),
        (xlrd.sheet.Cell(xlrd.XL_CELL_ERROR, 7), MASKED),
    ],
)
def test_xlrd_cell_adapter(cell: xlrd.sheet.Cell, expected: GridCell) -> None:
    assert _grid_cell(cell) == expected


def test_boolean_cell_in_a_count_column_is_rejected(tmp_path: Path) -> None:
    rows = modern_rows()
    rows["中班"]["returning_enrolled"] = True
    path = write_workbook(tmp_path, {"108下": SheetSpec(MODERN, as_of_text="1090315", rows=rows)})
    assert xlrd.open_workbook(str(path)).sheet_by_name("108下").cell_type(5, 4) == xlrd.XL_CELL_BOOLEAN

    with pytest.raises(WorkbookError, match="108下.*「中班」列舊生在籍人數不是整數"):
        parse_workbook(path)
