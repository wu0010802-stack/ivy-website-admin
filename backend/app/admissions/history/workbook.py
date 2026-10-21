"""園方「目標執行統計表」（.xls，一學期一張工作表，99 上～）→ xlrd 轉接層（2026-10-20 規格 §3.1）。

解析規則都在 grid.py（不依賴 xlrd，正式站的上傳頁也用它）；這裡只負責把 .xls 讀成 SheetGrid，
給本機 CLI（enrollment-history-extract、enrolled-match 的測試）與測試用。xlrd 只在 extract／dev 群組，
所以正式站跑的模組不可在模組層 import 本檔。read_grids 會把整張表讀進記憶體（含備註列）；
解析與預覽只看表頭與年級列，備註不存、不印。名字從 grid 搬走後仍從這裡匯出，CLI 與既有測試不用改 import。"""
from __future__ import annotations

from pathlib import Path

import xlrd

from app.admissions.history.grid import (
    BLOCK_ROW,
    EMPTY,
    FIRST_GRADE_ROW,
    GRADE_LABELS,
    LABEL_PREVIEW_ROWS,
    MASKED,
    REDACTED,
    SUBHEADER_ROW,
    TARGET_COLUMN,
    TOTAL_LABEL,
    GridCell,
    ParsedWorkbook,
    SheetGrid,
    TermRow,
    WorkbookError,
    masked_headers,
    parse_as_of,
    parse_grids,
    parse_term_name,
)

__all__ = [
    "BLOCK_ROW",
    "FIRST_GRADE_ROW",
    "GRADE_LABELS",
    "LABEL_PREVIEW_ROWS",
    "REDACTED",
    "SUBHEADER_ROW",
    "TARGET_COLUMN",
    "TOTAL_LABEL",
    "ParsedWorkbook",
    "TermRow",
    "WorkbookError",
    "parse_as_of",
    "parse_term_name",
    "parse_workbook",
    "read_grids",
    "sheet_headers",
]


def _open(path: Path) -> xlrd.Book:
    try:
        return xlrd.open_workbook(str(path), formatting_info=False)
    except (xlrd.XLRDError, xlrd.compdoc.CompDocError) as exc:
        # 損毀的 OLE 檔丟的是 CompDocError（不是 XLRDError）；xlrd 的訊息會帶出檔頭位元組，只留例外種類。
        raise WorkbookError(f"無法讀取活頁簿（{type(exc).__name__}）") from None


def _grid_cell(cell: xlrd.sheet.Cell) -> GridCell:
    if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
        return EMPTY
    if cell.ctype == xlrd.XL_CELL_NUMBER:
        return GridCell("number", float(cell.value))
    if cell.ctype in (xlrd.XL_CELL_BOOLEAN, xlrd.XL_CELL_ERROR):
        # value 是整數（布林 0／1、錯誤碼）：轉成文字會被人數欄當成人數收下，和瀏覽器一樣不收內容。
        return MASKED
    return GridCell("text", str(cell.value))  # 文字；日期格也走這裡（讀成浮點數字串，人數欄不收）


def read_grids(path: Path) -> list[SheetGrid]:
    """整本活頁簿的每張工作表（依檔內順序、表名原樣）讀成格子表。"""
    book = _open(path)
    try:
        return [
            SheetGrid(
                name=sheet.name,
                width=sheet.ncols,
                rows={r: [_grid_cell(sheet.cell(r, c)) for c in range(sheet.ncols)] for r in range(sheet.nrows)},
            )
            for sheet in book.sheets()
        ]
    finally:
        book.release_resources()


def parse_workbook(path: Path) -> ParsedWorkbook:
    """所有工作表依學期排序；同學期內依 大班、中班、小班、幼幼班。總人數列只拿來核對，不存。"""
    return parse_grids(read_grids(path))


def sheet_headers(path: Path) -> list[tuple[str, list[str], list[str], list[str]]]:
    """（表名、正規化後第 2 列、正規化後第 3 列、第 0 欄前 10 列），給 --headers-only 檢查真檔表頭用。"""
    return masked_headers(read_grids(path))
