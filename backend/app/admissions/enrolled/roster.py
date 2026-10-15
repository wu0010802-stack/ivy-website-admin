"""教保資訊網「園所幼生清冊」匯出檔（2026-10-15 規格 §2）：UTF-8 HTML，副檔名 .xls。
只取「出生日期」「通訊地址」兩欄（依表頭文字找欄）；編號、性別、入學日期、實際年齡讀了就丟。
純函式，不碰資料庫。錯誤訊息只寫第幾列，不寫地址。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser

from app.admissions.academic import grade_for_birthday

BIRTHDAY_COLUMN = "出生日期"
ADDRESS_COLUMN = "通訊地址"
_PRINTED = re.compile(r"列印日期[:：]\s*(\d{4})/(\d{1,2})/(\d{1,2})")
_DATE = re.compile(r"^(\d{4})/(\d{1,2})/(\d{1,2})$")


class RosterError(ValueError):
    """清冊格式不對；訊息可以直接印給操作的人看（不含地址）。"""


@dataclass(frozen=True)
class RosterRow:
    birthday: date
    address: str


@dataclass(frozen=True)
class Roster:
    printed_on: date | None
    rows: tuple[RosterRow, ...]


class _Tables(HTMLParser):
    """把每個 <table> 收成「列 × 格文字」；td、th 一視同仁，實體字元由 HTMLParser 解碼。"""

    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self.tables.append([])
        elif tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append("".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self.tables:
                self.tables[-1].append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def _date(text: str) -> date | None:
    matched = _DATE.match(text.strip())
    if matched is None:
        return None
    try:
        return date(int(matched[1]), int(matched[2]), int(matched[3]))
    except ValueError:
        return None


def _printed_on(tables: list[list[list[str]]]) -> date | None:
    for table in tables:
        for row in table:
            for cell in row:
                matched = _PRINTED.search(cell)
                if matched:
                    try:
                        return date(int(matched[1]), int(matched[2]), int(matched[3]))
                    except ValueError:
                        return None
    return None


def parse_roster(text: str) -> Roster:
    parser = _Tables()
    parser.feed(text)
    parser.close()
    for table in parser.tables:
        if not table or BIRTHDAY_COLUMN not in table[0] or ADDRESS_COLUMN not in table[0]:
            continue
        header = table[0]
        birthday_at, address_at = header.index(BIRTHDAY_COLUMN), header.index(ADDRESS_COLUMN)
        rows: list[RosterRow] = []
        # 列號照試算表的算法：表頭是第 1 列。
        for number, cells in enumerate(table[1:], start=2):
            if len(cells) != len(header):
                raise RosterError(f"名冊第 {number} 列的欄數和表頭不同")
            birthday = _date(cells[birthday_at])
            if birthday is None:
                raise RosterError(f"名冊第 {number} 列的出生日期不是 YYYY/MM/DD")
            rows.append(RosterRow(birthday, cells[address_at]))
        if not rows:
            raise RosterError("名冊沒有任何學生")
        return Roster(_printed_on(parser.tables), tuple(rows))
    raise RosterError(f"找不到有「{BIRTHDAY_COLUMN}」「{ADDRESS_COLUMN}」兩欄的名冊表格")


def roster_grade(birthday: date, school_year: int) -> str:
    """學年班別（9/1 足歲基準，同 academic.grade_for_birthday）。9/1 還沒滿 2 歲的是學年中滿 2 歲才入園，
    實際在幼幼班（規格 E7）；滿 6 歲以上歸「其他」（E8）。"""
    grade = grade_for_birthday(birthday, school_year)
    if grade is not None:
        return grade
    age = school_year + 1911 - birthday.year - (1 if (birthday.month, birthday.day) > (9, 1) else 0)
    return "幼幼班" if age < 2 else "其他"
