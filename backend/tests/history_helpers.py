"""歷年註冊測試共用：用 xlwt 合成「目標執行統計表」假檔（全是假資料；真的 .xls 不進 repo、不放測試）。

結構照真檔：第 0–1 列標題、第 2–3 列表頭（區塊名與日期在第 2 列、子欄名在第 3 列，字中間夾空白與換行）、
第 4–8 列年級與總人數、其後是備註（這裡寫的是假名）。數字一律寫成浮點數，和真檔一樣；
各種「率」欄填非整數的小數，用來確認解析器不去讀它們。"""
from __future__ import annotations

import io
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import xlwt

GRADES = ("大班", "中班", "小班", "幼幼班")
FAKE_NOTES = ("*115上新生(3人)：王小明.李小華", "*115上重讀生(1人)：陳小美")


@dataclass(frozen=True)
class Col:
    """一欄的表頭。key＝TermRow 欄位名（"grade" 是年級名欄、"registered" 是日期欄）；None＝只佔位的率欄。
    row2 裡的 {date} 會換成該表的日期字串。"""

    key: str | None
    row2: str = ""
    row3: str = ""


_HEAD = (
    Col("grade", "目標人數"),
    Col("target"),
    Col("registered"),
    Col(None, "{date}目標\n達成率"),
)
_REPEAT = (
    Col("repeat_deposit", "大班重讀生.保留生.回園生.轉校生", "預繳人數"),
    Col("repeat_registered", "", "註冊人數"),
    Col(None, "", "註冊率"),
)

# 102 下起（17 欄）：和規格 §3.1 列的欄位相同。
MODERN = _HEAD + (
    Col("returning_enrolled", "舊生", "在籍     人數"),
    Col("returning_deposit", "", "預繳人數"),
    Col("returning_registered", "", "註冊\n人數"),
    Col(None, "", "註冊率"),
    Col("new_target", "新生", "目標人數"),
    Col("new_visits", "", "參觀人數"),
    Col("new_deposits", "", "預繳人數"),
    Col(None, "", "預繳率"),
    Col("new_registered", "", "註冊人數"),
    Col(None, "", "參觀註冊率"),
) + _REPEAT

# 99 上、99 下（14 欄）：舊生預繳是 12/15 的、註冊寫成「註冊.月費人數」，新生沒有目標與參觀。
LAYOUT_99 = _HEAD + (
    Col("returning_enrolled", "舊生", "在籍     人數"),
    Col("returning_deposit", "", "（12/15）預繳人數"),
    Col("returning_registered", "", "註冊.月費人數"),
    Col(None, "", "註冊率"),
    Col("new_deposits", "新生", "預繳人數"),
    Col("new_registered", "", "註冊.月費人數"),
    Col(None, "", "註冊率"),
    Col("repeat_deposit", "大班重讀生.保留生.", "預繳人數"),
    Col("repeat_registered", "", "註冊.月費人數"),
    Col(None, "", "註冊率"),
)

# 100 下～102 上（18 欄）：新生區塊尾端多一個「預繳註冊率」，後面的重讀欄整體右移一格。
LAYOUT_100 = (
    _HEAD
    + MODERN[4:14]
    + (Col(None, "", "預繳註冊率"),)
    + _REPEAT
)

LAYOUTS = {"modern": MODERN, "99": LAYOUT_99, "100": LAYOUT_100}


@dataclass
class SheetSpec:
    """一張工作表。rows＝年級名 → {欄位名: 值}；值 None＝不寫格子、""＝空白格、數字寫成浮點、字串寫成文字格。

    - total：總人數列的 {欄位名: 值}；None＝照 rows 的 registered 加重讀 registered 自動加總（讓預設假檔本身就是對得上的）。
    - with_total=False：整列不寫。gap_rows：夾在年級列與總人數列之間的雜字列（114 下的樣子，總人數因此落在第 9 列）。
    - date_style：split＝日期在第 2 列、「註冊 人數」在第 3 列（真檔）；joined＝整句都在第 2 列。
    - pad_labels：第 0 欄的年級名中間夾全形空白、換行。"""

    layout: tuple[Col, ...] = MODERN
    as_of_text: str = "1150915"
    rows: dict[str, dict[str, Any]] = field(default_factory=dict)
    total: dict[str, Any] | None = None
    with_total: bool = True
    gap_rows: tuple[str, ...] = ()
    date_style: str = "split"
    pad_labels: bool = False
    notes: tuple[str, ...] = FAKE_NOTES


def _padded(label: str) -> str:
    return "　".join(label) if len(label) > 1 else label


def _write(sheet: Any, row: int, col: int, value: Any) -> None:
    if value is None:
        return
    if isinstance(value, (int, float)):
        sheet.write(row, col, float(value))
    else:
        sheet.write(row, col, value)


def _auto_total(spec: SheetSpec) -> dict[str, Any]:
    registered = sum(spec.rows.get(g, {}).get("registered") or 0 for g in GRADES)
    repeat = sum(spec.rows.get(g, {}).get("repeat_registered") or 0 for g in GRADES)
    return {"registered": registered + repeat}


def _header_text(col: Col, spec: SheetSpec) -> tuple[str, str]:
    date_text = spec.as_of_text + "     "
    row2, row3 = col.row2.replace("{date}", date_text), col.row3
    if col.key == "registered":
        if spec.date_style == "joined":
            row2, row3 = f"{spec.as_of_text} 註冊\n人數", ""
        else:
            row2, row3 = date_text, "註冊\n人數"
    return row2, row3


def _write_sheet(book: xlwt.Workbook, name: str, spec: SheetSpec) -> None:
    sheet = book.add_sheet(name)
    keys = [c.key for c in spec.layout]
    sheet.write(0, 0, "常春藤測試幼兒園目標執行統計表")
    sheet.write(1, 0, "測試學年度")
    for index, col in enumerate(spec.layout):
        row2, row3 = _header_text(col, spec)
        if row2:
            sheet.write(2, index, row2)
        if row3:
            sheet.write(3, index, row3)

    def put_row(row: int, label: str, values: dict[str, Any]) -> None:
        unknown = set(values) - set(keys)
        if unknown:
            raise KeyError(f"版型沒有這些欄位：{sorted(unknown)}")
        sheet.write(row, 0, _padded(label) if spec.pad_labels else label)
        for index, col in enumerate(spec.layout):
            if col.key is None:
                sheet.write(row, index, 0.8333)  # 率欄：非整數小數，解析器必須略過
            elif col.key in values:
                _write(sheet, row, index, values[col.key])

    row = 4
    for grade in GRADES:
        if grade in spec.rows:
            put_row(row, grade, spec.rows[grade])
            row += 1
    for text in spec.gap_rows:
        sheet.write(row, 0, text)
        row += 1
    if spec.with_total:
        put_row(row, "總人數", spec.total if spec.total is not None else _auto_total(spec))
        row += 1
    for note in spec.notes:
        sheet.write(row, 0, note)
        row += 1


def make_workbook(sheets: dict[str, SheetSpec]) -> bytes:
    book = xlwt.Workbook(encoding="utf-8")
    for name, spec in sheets.items():
        _write_sheet(book, name, spec)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def write_workbook(directory: Path, sheets: dict[str, SheetSpec], name: str = "stats.xls") -> Path:
    path = directory / name
    path.write_bytes(make_workbook(sheets))
    return path


def grade_values(registered: int, **others: Any) -> dict[str, Any]:
    return {"registered": registered, **others}


def modern_rows() -> dict[str, dict[str, Any]]:
    """17 欄版型的四個年級（數字隨意但各欄不同，才看得出有沒有錯位）。"""
    return {
        "大班": grade_values(62, target=70, returning_enrolled=43, returning_deposit=40, returning_registered=38,
                           new_target=30, new_visits=24, new_deposits=20, new_registered=18,
                           repeat_deposit=4, repeat_registered=6),
        "中班": grade_values(50, target=60, returning_enrolled=41, returning_deposit=39, returning_registered=36,
                           new_target=22, new_visits=19, new_deposits=15, new_registered=14,
                           repeat_deposit=1, repeat_registered=0),
        "小班": grade_values(48, target=55, returning_enrolled=37, returning_deposit=33, returning_registered=31,
                           new_target=25, new_visits=21, new_deposits=18, new_registered=17,
                           repeat_deposit=0, repeat_registered=0),
        "幼幼班": grade_values(33, target=40, returning_enrolled=12, returning_deposit=11, returning_registered=9,
                            new_target=30, new_visits=27, new_deposits=26, new_registered=24,
                            repeat_deposit=2, repeat_registered=1),
    }


def term_row(school_year: int = 115, semester: int = 1, grade: str = "大班", **changes: Any) -> dict[str, Any]:
    """匯入 JSON 的一列（全是假數字）；as_of 照園方慣例：上學期 9/15、下學期隔年 3/15。"""
    as_of = f"{school_year + 1911}-09-15" if semester == 1 else f"{school_year + 1912}-03-15"
    row: dict[str, Any] = {
        "school_year": school_year, "semester": semester, "grade": grade, "as_of": as_of, "registered": 62,
        "target": 70, "returning_enrolled": 43, "returning_deposit": 40, "returning_registered": 38,
        "new_target": 30, "new_visits": 24, "new_deposits": 20, "new_registered": 18,
        "repeat_deposit": 4, "repeat_registered": 6,
    }
    row.update(changes)
    return row


def history_payload(rows: list[dict[str, Any]] | None = None, **changes: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "format": "ivy-enrollment-history/1", "campus_key": "yihua",
        "rows": rows if rows is not None else [term_row()], "warnings": [],
    }
    payload.update(changes)
    return payload


def history_text(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)
