"""園方「目標執行統計表」的格子表 → 年級列的數字（2026-10-20 規格 §3.1；2026-10-21 後台資料匯入拆出本層）。

早年的表只有 14 欄、中間還夾著各種「率」，所以一律依表頭文字對欄，不用欄位位置。
只讀第 2–3 列表頭，以及第 0 欄是年級或「總人數」的那五列；其餘列（備註寫著幼生姓名）不讀、不存、不印。
瀏覽器端只擷取這幾列再送上來（內容不明的格子只留位置，見 MASKED），xlrd 轉接層見 workbook.py。
錯誤訊息只寫工作表名與欄位名稱，不回印格子內容。純函式，不碰資料庫；這個模組在正式站跑，不可 import xlrd。"""
from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.admissions.history.models import HISTORY_GRADES

TOTAL_LABEL = "總人數"
GRADE_LABELS = frozenset((*HISTORY_GRADES, TOTAL_LABEL))
LABEL_PREVIEW_ROWS = 10  # --headers-only 預覽第 0 欄的前幾列
REDACTED = "…"  # 第 0 欄預覽裡不是年級標籤的格子（標題或備註）一律以此取代
BLOCK_ROW = 2  # 區塊名（舊生、新生、大班重讀生）與日期欄的表頭
SUBHEADER_ROW = 3  # 區塊內的子欄名
FIRST_GRADE_ROW = 4  # 往下找年級列的起點（不寫死列號：114 下的總人數在第 9 列）
TARGET_COLUMN = 1  # 第 0 欄是年級名，第 1 欄是目標人數

# 判斷順序有意義：「大班重讀生」先判，其他兩個才不會誤吃含「生」的後綴。
_BLOCKS = (("大班重讀生", "repeat"), ("舊生", "returning"), ("新生", "new"))
_FIELDS = {
    ("returning", "enrolled"): "returning_enrolled",
    ("returning", "deposit"): "returning_deposit",
    ("returning", "registered"): "returning_registered",
    ("new", "target"): "new_target",
    ("new", "visits"): "new_visits",
    ("new", "deposit"): "new_deposits",
    ("new", "registered"): "new_registered",
    ("repeat", "deposit"): "repeat_deposit",
    ("repeat", "registered"): "repeat_registered",
}

_TERM = re.compile(r"(\d{2,3})([上下])")
_DATE_DOTTED = re.compile(r"(?<!\d)(\d{2,3})[./](\d{1,2})[./](\d{1,2})(?!\d)")
_DATE_COMPACT = re.compile(r"(?<!\d)(\d{1,3})(\d{2})(\d{2})(?!\d)")
_DIGITS = re.compile(r"\d+")

CellKind = Literal["empty", "number", "text", "masked"]


@dataclass(frozen=True)
class GridCell:
    """一個格子。masked＝這格有內容但不明（率欄、備註、姓名），只留位置；解析時當成「不是整數」。"""

    kind: CellKind
    value: float | str | None = None


EMPTY = GridCell("empty")
MASKED = GridCell("masked")


@dataclass(frozen=True)
class SheetGrid:
    """一張工作表的格子。rows 可以稀疏（瀏覽器只送表頭與年級列）；沒有的列、比該列長的欄都是 EMPTY。"""

    name: str
    width: int
    rows: Mapping[int, Sequence[GridCell]]

    @property
    def nrows(self) -> int:
        return max(self.rows) + 1 if self.rows else 0

    def cell(self, row: int, col: int) -> GridCell:
        cells = self.rows.get(row)
        return cells[col] if cells is not None and 0 <= col < len(cells) else EMPTY


class WorkbookError(ValueError):
    """表的格式不對；訊息一定含工作表名，且不含格子內容，可以直接印給操作的人看。"""


@dataclass(frozen=True)
class TermRow:
    """某學期某年級的數字。欄位名與 CampusTermEnrollment 相同；表上沒有的欄是 None（不當 0）。"""

    school_year: int
    semester: int
    grade: str
    as_of: date
    registered: int
    target: int | None = None
    returning_enrolled: int | None = None
    returning_deposit: int | None = None
    returning_registered: int | None = None
    new_target: int | None = None
    new_visits: int | None = None
    new_deposits: int | None = None
    new_registered: int | None = None
    repeat_deposit: int | None = None
    repeat_registered: int | None = None


@dataclass(frozen=True)
class ParsedWorkbook:
    rows: tuple[TermRow, ...]
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class _Columns:
    registered: int
    as_of: date
    # (TermRow 欄位名, 欄, 錯誤訊息用的欄名)
    fields: tuple[tuple[str, int, str], ...]


def _normalize(text: str) -> str:
    """去掉所有空白（含全形空白、換行）：真檔的表頭字中間夾著空白與換行。"""
    return re.sub(r"\s+", "", text)


def parse_term_name(name: str) -> tuple[int, int]:
    """'104上' → (104, 1)，'104下' → (104, 2)。"""
    matched = _TERM.fullmatch(_normalize(name))
    if matched is None:
        raise ValueError("工作表名不是「學年＋上／下」")
    return int(matched.group(1)), 1 if matched.group(2) == "上" else 2


def parse_as_of(text: str) -> date:
    """民國日期 → 西元日期：'99.9.15'、'101.03.15'、'1150315'，前後可以夾「註冊人數」之類的字。"""
    plain = _normalize(text)
    matched = _DATE_DOTTED.search(plain) or _DATE_COMPACT.search(plain)
    if matched is None:
        raise ValueError("找不到民國年月日")
    roc_year, month, day = (int(part) for part in matched.groups())
    try:
        return date(roc_year + 1911, month, day)
    except ValueError:
        raise ValueError("民國年月日不是有效的日期") from None


def _text(grid: SheetGrid, row: int, col: int) -> str:
    """表頭與年級名用：正規化後的文字；數字格（例如 1150915.0）轉成不帶小數點的字串；遮住的格子當空白。"""
    cell = grid.cell(row, col)
    if cell.kind == "number":
        return str(int(cell.value)) if float(cell.value).is_integer() else repr(cell.value)
    if cell.kind == "text":
        return _normalize(cell.value)
    return ""


def _count(sheet_name: str, cell: GridCell, where: str) -> int | None:
    """人數格：空白 → None；浮點數必須是整數值；文字格只收純數字；遮住的格子和非數字文字一樣不收。"""
    if cell.kind == "empty":
        return None
    if cell.kind == "number":
        if not float(cell.value).is_integer():
            raise WorkbookError(f"{sheet_name}：{where}不是整數（{cell.value}）")
        return int(cell.value)
    if cell.kind == "text":
        text = _normalize(cell.value)
        if not text:
            return None
        if _DIGITS.fullmatch(text):
            return int(text)
    raise WorkbookError(f"{sheet_name}：{where}不是整數")


def _classify_block(header: str) -> str | None:
    for needle, prefix in _BLOCKS:
        if needle in header:
            return prefix
    return None


def _classify_sub(header: str) -> str | None:
    if "在籍" in header:
        return "enrolled"
    if "預繳人數" in header:
        return "deposit"
    if "目標人數" in header:
        return "target"
    if "參觀人數" in header:
        return "visits"
    if "註冊" in header and "率" not in header:
        return "registered"
    return None  # 各種「率」與看不懂的欄：略過


def _find_columns(grid: SheetGrid, name: str) -> _Columns:
    if grid.nrows <= SUBHEADER_ROW:
        raise WorkbookError(f"{name}：表頭不足（少於 {SUBHEADER_ROW + 1} 列）")
    width = grid.width
    row2 = [_text(grid, BLOCK_ROW, c) for c in range(width)]
    row3 = [_text(grid, SUBHEADER_ROW, c) for c in range(width)]

    starts: dict[str, int] = {}
    for col, header in enumerate(row2):
        prefix = _classify_block(header) if header else None
        if prefix is None:
            continue
        if prefix in starts:
            raise WorkbookError(f"{name}：第 {BLOCK_ROW} 列有兩個「{_block_name(prefix)}」欄")
        starts[prefix] = col
    for needle, prefix in _BLOCKS:
        if prefix not in starts:
            raise WorkbookError(f"{name}：第 {BLOCK_ROW} 列找不到「{needle}」欄")

    # 日期欄：第一個區塊之前、第 2 列＋第 3 列同欄串起來含「註冊人數」的那一欄。
    # 日期可能在第 2 列（「註冊人數」在第 3 列），也可能整句都在第 2 列，所以兩列串接再判斷。
    first_block = min(starts.values())
    registered_cols = [c for c in range(first_block) if "註冊人數" in row2[c] + row3[c]]
    if len(registered_cols) != 1:
        raise WorkbookError(f"{name}：表頭應有一個日期欄註冊人數，實際 {len(registered_cols)} 個")
    registered = registered_cols[0]
    try:
        as_of = parse_as_of(row2[registered] + row3[registered])
    except ValueError as exc:
        raise WorkbookError(f"{name}：日期欄表頭看不出截止日（{exc}）") from None

    ordered = sorted((col, prefix) for prefix, col in starts.items())
    fields: list[tuple[str, int, str]] = [("target", TARGET_COLUMN, "目標人數")]
    assigned: dict[str, int] = {}
    for index, (start, prefix) in enumerate(ordered):
        end = ordered[index + 1][0] if index + 1 < len(ordered) else width
        for col in range(start, end):
            kind = _classify_sub(row3[col])
            field = _FIELDS.get((prefix, kind)) if kind else None
            if field is None:
                continue
            if field in assigned:
                raise WorkbookError(f"{name}：「{_block_name(prefix)}」區塊有兩欄對到{field}")
            assigned[field] = col
            fields.append((field, col, f"{_block_name(prefix)}{row3[col]}"))
    return _Columns(registered=registered, as_of=as_of, fields=tuple(fields))


def _block_name(prefix: str) -> str:
    return next(needle for needle, p in _BLOCKS if p == prefix)


def _find_rows(grid: SheetGrid) -> dict[str, int]:
    """第 0 欄正規化後等於年級名或「總人數」的列（各取第一個），找齊就停，後面的備註列不碰。

    只走有資料的列（由小到大）：瀏覽器送來的格子表是稀疏的，沒送的列第 0 欄本來就是空白。"""
    found: dict[str, int] = {}
    for row in sorted(r for r in grid.rows if r >= FIRST_GRADE_ROW):
        label = _text(grid, row, 0)
        if label in GRADE_LABELS and label not in found:
            found[label] = row
            if len(found) == len(GRADE_LABELS):
                break
    return found


def _parse_sheet(grid: SheetGrid, name: str, term: tuple[int, int]) -> tuple[list[TermRow], list[str]]:
    columns = _find_columns(grid, name)
    found = _find_rows(grid)
    for grade in HISTORY_GRADES:
        if grade not in found:
            raise WorkbookError(f"{name}：找不到「{grade}」列")

    rows: list[TermRow] = []
    for grade in HISTORY_GRADES:
        row = found[grade]
        registered = _count(name, grid.cell(row, columns.registered), f"「{grade}」列日期欄註冊人數")
        if registered is None:
            raise WorkbookError(f"{name}：「{grade}」列日期欄註冊人數是空的")
        values = {
            field: _count(name, grid.cell(row, col), f"「{grade}」列{label}")
            for field, col, label in columns.fields
        }
        rows.append(TermRow(
            school_year=term[0], semester=term[1], grade=grade, as_of=columns.as_of, registered=registered, **values,
        ))

    warnings: list[str] = []
    if TOTAL_LABEL not in found:
        warnings.append(f"{name}：找不到「{TOTAL_LABEL}」列，略過核對")
        return rows, warnings
    total = _count(name, grid.cell(found[TOTAL_LABEL], columns.registered), f"「{TOTAL_LABEL}」列日期欄註冊人數")
    if total is None:
        warnings.append(f"{name}：「{TOTAL_LABEL}」列日期欄是空的，略過核對")
        return rows, warnings
    # 園方有的學期「總人數」含重讀生、有的不含：等於其中一種算法就不警告。
    grades_only = sum(r.registered for r in rows)
    with_repeat = grades_only + sum(r.repeat_registered or 0 for r in rows)
    if total not in (grades_only, with_repeat):
        warnings.append(f"{name}：總人數 {total}，四個年級 {grades_only}、加重讀 {with_repeat}，都對不上")
    return rows, warnings


def parse_grids(grids: Sequence[SheetGrid]) -> ParsedWorkbook:
    """所有工作表依學期排序；同學期內依 大班、中班、小班、幼幼班。總人數列只拿來核對，不存。"""
    terms: dict[tuple[int, int], tuple[str, SheetGrid]] = {}
    for grid in grids:
        name = _normalize(grid.name)
        try:
            term = parse_term_name(name)
        except ValueError:
            raise WorkbookError(f"{name}：工作表名不是「學年＋上／下」（例：104上）") from None
        if term in terms:
            raise WorkbookError(f"{name}：學期重複")
        terms[term] = (name, grid)

    rows: list[TermRow] = []
    warnings: list[str] = []
    for term in sorted(terms):
        name, grid = terms[term]
        sheet_rows, sheet_warnings = _parse_sheet(grid, name, term)
        rows.extend(sheet_rows)
        warnings.extend(sheet_warnings)
    return ParsedWorkbook(rows=tuple(rows), warnings=tuple(warnings))


def _term_order(name: str) -> tuple[int, int, int]:
    try:
        year, semester = parse_term_name(name)
    except ValueError:
        return (1, 0, 0)  # 看不懂的表名排最後（--headers-only 要能照樣印出來）
    return (0, year, semester)


def masked_headers(grids: Sequence[SheetGrid]) -> list[tuple[str, list[str], list[str], list[str]]]:
    """（表名、正規化後第 2 列、正規化後第 3 列、第 0 欄前 10 列），給 --headers-only 檢查真檔表頭用。

    第 0 欄只輸出空字串或年級／總人數標籤，其他（標題、備註）一律以「…」取代；不碰其他欄的第 4 列以後。"""
    result = []
    for grid in grids:
        row2 = [_text(grid, BLOCK_ROW, c) for c in range(grid.width)]
        row3 = [_text(grid, SUBHEADER_ROW, c) for c in range(grid.width)]
        while row2 and not row2[-1] and not row3[-1]:
            row2.pop()
            row3.pop()
        labels = [_text(grid, r, 0) for r in range(LABEL_PREVIEW_ROWS)]
        labels = [text if not text or text in GRADE_LABELS else REDACTED for text in labels]
        result.append((_normalize(grid.name), row2, row3, labels))
    result.sort(key=lambda item: _term_order(item[0]))
    return result
