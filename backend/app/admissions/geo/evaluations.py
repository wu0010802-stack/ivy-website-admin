"""幼兒園評鑑結果（教保資訊網公開搜尋；docs/specs/2026-10-20-peer-penalties-evaluations-design.md §2、C5、C6、C9、C10）。

這裡只管解析搜尋頁、組換頁表單、TLS 設定、與園所比對與寫入；下載與排程在 sync.py。

來源 `https://ap.ece.moe.edu.tw/webecems/pubSearch.aspx`（ASP.NET WebForms）：
GET 取隱藏欄位（`__VIEWSTATE`、`__EVENTVALIDATION` 等）→ POST（縣市＝高雄市、關鍵字空白、`btnSearch`）→ 之後每一頁 POST
`__EVENTTARGET=PageControl1$lbNextPage`，並帶上一頁回應的隱藏欄位。全高雄約 689 所、每頁 10 所、69 頁，沒有驗證碼。
每所一個結果區塊，裡面有負責人姓名、電話等欄位：**只用 id 白名單讀園所名稱與「評鑑情形」表的三個欄位**（學年度、完成日、結果），
其他欄位一律不讀、不存、不記；「檢視」連結的參數是 session 加密值，也不存。換頁用的隱藏欄位只在記憶體裡用完即丟。

TLS：伺服器只送葉憑證、沒送 TWCA 中繼憑證，Python 驗不過（curl 會自己從 AIA 補）。**不關閉驗證**：ssl_context() 用 certifi 的根憑證
加上隨程式提交的中繼憑證（certs/twca-secure-ssl-2023g3.pem，來源與到期日寫在檔頭）。"""

from __future__ import annotations

import csv
import io
import re
import ssl
from dataclasses import dataclass, field
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path

import certifi
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.models import GeoKindergarten, GeoKindergartenEvaluation

SEARCH_URL = "https://ap.ece.moe.edu.tw/webecems/pubSearch.aspx"
CITY_NAME = "高雄市"
SOURCE_NOTE = "資料來源：全國教保資訊網"
CA_FILE = Path(__file__).resolve().parent / "certs" / "twca-secure-ssl-2023g3.pem"
INSERT_CHUNK = 1000
CSV_COLUMNS = ("school_name", "school_year", "completed_on", "result")
# 換頁表單要原樣帶回去的隱藏欄位：ASP.NET 的 __ 開頭欄位，以及頁面 JS 用的 hY。
_HIDDEN_FIELD = re.compile(r"^(?:__[A-Z]+|hY)$")
_NAME_ID = re.compile(r"^GridView1_lblSchName_([0-9]+)$")
_EVAL_ID = re.compile(r"^GridView1_GridView11_([0-9]+)_lbl(SYear|Date|Result)_([0-9]+)$")
_PAGE_IDS = {
    "PageControl1_lblTotalCount": "total_count",
    "PageControl1_lblCurrentPage": "current_page",
    "PageControl1_lblTotalPage": "total_pages",
}
_SPACES = re.compile(r"\s+")
_DATE = re.compile(r"^\s*([0-9]{4})/([0-9]{1,2})/([0-9]{1,2})\s*$")
_YEAR = re.compile(r"^[0-9]{2,3}$")
_WIDTHS = {
    "school_name": GeoKindergartenEvaluation.__table__.c.school_name.type.length,
    "result": GeoKindergartenEvaluation.__table__.c.result.type.length,
}


class EvaluationFormatError(ValueError):
    """搜尋頁、換頁結果或打包的 CSV 不是預期的格式；訊息會寫進 geo_dataset_status.last_error，不含頁面內容。"""


@dataclass(frozen=True)
class Evaluation:
    """評鑑情形表的一列：學年度（民國）、評鑑完成日（解析不出來是 None）、結果原文。"""

    school_year: int
    completed_on: date | None
    result: str


@dataclass
class SearchPage:
    """一頁搜尋結果。schools 依頁面順序；hidden 是換頁表單要帶回去的隱藏欄位（不記錄、不存檔）；
    cities 是縣市下拉選單（顯示文字 → value）。"""

    schools: list[tuple[str, list[Evaluation]]] = field(default_factory=list)
    total_count: int | None = None
    current_page: int | None = None
    total_pages: int | None = None
    hidden: dict[str, str] = field(default_factory=dict)
    cities: dict[str, str] = field(default_factory=dict)

    def city_value(self, name: str = CITY_NAME) -> str:
        for text, value in self.cities.items():
            if text.replace("臺", "台") == name.replace("臺", "台"):
                return value
        raise EvaluationFormatError("找不到縣市選項")


class _PageParser(HTMLParser):
    """只收白名單 id 的 <span> 文字、隱藏欄位和縣市下拉選單。其他標籤與文字一律不看，所以負責人、電話等欄位根本不會進到記憶體。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hidden: dict[str, str] = {}
        self.cities: dict[str, str] = {}
        self.names: dict[int, str] = {}
        self.cells: dict[tuple[int, int], dict[str, str]] = {}
        self.numbers: dict[str, str] = {}
        self._capture: tuple[str, ...] | None = None
        self._depth = 0
        self._buffer: list[str] = []
        self._in_city = False
        self._option: str | None = None
        self._option_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: value or "" for name, value in attrs}
        if self._capture is not None:
            if tag == "span":
                self._depth += 1
            return
        if tag == "span":
            ident = values.get("id", "")
            if _NAME_ID.fullmatch(ident):
                self._start(("name", _NAME_ID.fullmatch(ident).group(1)))
            elif (matched := _EVAL_ID.fullmatch(ident)) is not None:
                self._start(("cell", matched.group(1), matched.group(3), matched.group(2)))
            elif ident in _PAGE_IDS:
                self._start(("number", _PAGE_IDS[ident]))
        elif tag == "input" and values.get("type", "").lower() == "hidden":
            name = values.get("name", "")
            if _HIDDEN_FIELD.fullmatch(name):
                self.hidden[name] = values.get("value", "")
        elif tag == "select":
            self._in_city = values.get("name") == "ddlCityS"
        elif tag == "option" and self._in_city:
            self._option, self._option_text = values.get("value", ""), []

    def _start(self, key: tuple[str, ...]) -> None:
        self._capture, self._depth, self._buffer = key, 1, []

    def handle_endtag(self, tag: str) -> None:
        if self._capture is not None:
            if tag == "span":
                self._depth -= 1
                if self._depth == 0:
                    self._finish()
            return
        if tag == "option" and self._option is not None:
            self.cities[_SPACES.sub(" ", "".join(self._option_text)).strip()] = self._option
            self._option = None
        elif tag == "select":
            self._in_city = False

    def handle_data(self, data: str) -> None:
        if self._capture is not None:
            self._buffer.append(data)
        elif self._option is not None:
            self._option_text.append(data)

    def _finish(self) -> None:
        text = _SPACES.sub(" ", "".join(self._buffer)).strip()
        kind, *rest = self._capture
        if kind == "name":
            self.names[int(rest[0])] = text
        elif kind == "cell":
            self.cells.setdefault((int(rest[0]), int(rest[1])), {})[rest[2]] = text
        else:
            self.numbers[rest[0]] = text
        self._capture = None


def _to_date(value: str) -> date | None:
    matched = _DATE.fullmatch(value)
    if matched is None:
        return None
    try:
        return date(int(matched.group(1)), int(matched.group(2)), int(matched.group(3)))
    except ValueError:
        return None


def _number(value: str | None) -> int | None:
    return int(value) if value is not None and value.isdigit() else None


def parse_search_page(html: str) -> SearchPage:
    """搜尋頁（GET 的表單頁或 POST 的結果頁）→ SearchPage。只讀 id 白名單；評鑑表的一列要有學年度（2–3 位數字）和結果才收。"""
    parser = _PageParser()
    parser.feed(html)
    parser.close()
    evaluations: dict[int, list[Evaluation]] = {}
    for (block, _row), cell in sorted(parser.cells.items()):
        year = cell.get("SYear", "")
        result = cell.get("Result", "")[: _WIDTHS["result"]]
        if _YEAR.fullmatch(year) and result:
            evaluations.setdefault(block, []).append(Evaluation(int(year), _to_date(cell.get("Date", "")), result))
    page = SearchPage(
        hidden=parser.hidden,
        cities=parser.cities,
        total_count=_number(parser.numbers.get("total_count")),
        current_page=_number(parser.numbers.get("current_page")),
        total_pages=_number(parser.numbers.get("total_pages")),
    )
    for block, name in sorted(parser.names.items()):
        page.schools.append((name, evaluations.get(block, [])))
    return page


def search_fields(city_value: str) -> dict[str, str]:
    """搜尋條件：依校名關鍵字（空白）、縣市＝高雄市，不選鄉鎮市區。"""
    return {"ddlKey": "school_name", "txtKeyNameS": "", "ddlCityS": city_value, "ddlAreaS": ""}


def search_form(page: SearchPage, city_value: str) -> dict[str, str]:
    """第一次搜尋 POST 的欄位：GET 頁的隱藏欄位加搜尋條件加搜尋鈕。"""
    if "__VIEWSTATE" not in page.hidden:
        raise EvaluationFormatError("搜尋頁沒有表單欄位")
    return {**page.hidden, **search_fields(city_value), "btnSearch": "搜尋"}


def next_page_form(page: SearchPage, city_value: str) -> dict[str, str]:
    """換到下一頁的 POST 欄位：上一頁回應的隱藏欄位加搜尋條件加 __EVENTTARGET（連結觸發的 postback 不帶搜尋鈕）。"""
    if "__VIEWSTATE" not in page.hidden or page.current_page is None:
        raise EvaluationFormatError("搜尋結果沒有表單欄位或頁碼")
    return {
        **page.hidden,
        **search_fields(city_value),
        "__EVENTTARGET": "PageControl1$lbNextPage",
        "__EVENTARGUMENT": "",
        "PageControl1$txtPages": str(page.current_page),
    }


def ssl_context() -> ssl.SSLContext:
    """certifi 的根憑證加上隨程式提交的 TWCA 中繼憑證；預設的主機名稱與憑證鏈檢查都開著。"""
    context = ssl.create_default_context(cafile=certifi.where())
    context.load_verify_locations(cafile=str(CA_FILE))
    return context


def _name(value: object) -> str:
    return _SPACES.sub(" ", str(value if value is not None else "")).strip()


def merge_page(schools: dict[str, list[Evaluation]], page: SearchPage) -> None:
    """把一頁併進園所名稱 → 評鑑列表（同名的區塊合併）。"""
    for name, items in page.schools:
        schools.setdefault(name, []).extend(items)


# ---- CSV 往返（本機打包用，規格 C10）----


def rows_to_csv(schools: dict[str, list[Evaluation]]) -> str:
    """寫成我們自己的 CSV（打包退路用）：名稱、學年度、完成日、結果，**沒有姓名與電話欄**。沒有評鑑的園所不寫。"""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for name in sorted(schools):
        for item in schools[name]:
            writer.writerow([name, item.school_year, item.completed_on.isoformat() if item.completed_on else "", item.result])
    return buffer.getvalue()


def parse_csv(text: str) -> dict[str, list[Evaluation]]:
    """rows_to_csv 的反向（呼叫端已用 utf-8-sig 解碼）。缺欄位、學年度不是 2–3 位數字、日期不是 ISO、結果空白都丟 EvaluationFormatError。"""
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or not set(CSV_COLUMNS) <= set(reader.fieldnames):
        raise EvaluationFormatError("評鑑檔不是預期的格式")
    schools: dict[str, list[Evaluation]] = {}
    for record in reader:
        name = _name(record.get("school_name"))[: _WIDTHS["school_name"]]
        year = _name(record.get("school_year"))
        result = _name(record.get("result"))[: _WIDTHS["result"]]
        if not name or not _YEAR.fullmatch(year) or not result:
            raise EvaluationFormatError("評鑑檔的內容不對")
        completed = _name(record.get("completed_on"))
        try:
            completed_on = date.fromisoformat(completed) if completed else None
        except ValueError as exc:
            raise EvaluationFormatError("評鑑檔的日期格式不對") from exc
        schools.setdefault(name, []).append(Evaluation(int(year), completed_on, result))
    return schools


# ---- 比對園所與寫入 ----


async def resolve_source_ids(db: AsyncSession, names: set[str]) -> dict[str, str]:
    """園所名稱 → source_id（規格 C6）：geo_kindergartens.name 精確比對；營業中的優先，其次 source_id 小的。對不到的不在結果裡。"""
    found: dict[str, tuple[bool, str]] = {}
    listed = list(names)
    for start in range(0, len(listed), 500):
        result = await db.execute(
            select(GeoKindergarten.name, GeoKindergarten.source_id, GeoKindergarten.is_active).where(
                GeoKindergarten.name.in_(listed[start : start + 500])
            )
        )
        for name, source_id, active in result.all():
            candidate = (not active, source_id)
            if name not in found or candidate < found[name]:
                found[name] = candidate
    return {name: candidate[1] for name, candidate in found.items()}


async def replace_evaluations(db: AsyncSession, schools: dict[str, list[Evaluation]], *, now: datetime) -> tuple[int, int]:
    """整表替換（不 commit）：只寫對得到園所的列；同一個 (名稱, 學年度, 結果) 只留完成日最新的一筆。
    回傳 (寫入的列數, 有評鑑列的園所數)。"""
    resolved = await resolve_source_ids(db, {name for name, items in schools.items() if items})
    await db.execute(delete(GeoKindergartenEvaluation))
    values: dict[tuple[str, int, str], dict] = {}
    for name, items in schools.items():
        source_id = resolved.get(name)
        if source_id is None:
            continue
        for item in items:
            key = (name, item.school_year, item.result)
            kept = values.get(key)
            if kept is None or (item.completed_on is not None and (kept["completed_on"] is None or item.completed_on > kept["completed_on"])):
                values[key] = {
                    "source_id": source_id, "school_name": name, "school_year": item.school_year,
                    "completed_on": item.completed_on, "result": item.result, "synced_at": now,
                }
    rows = list(values.values())
    for start in range(0, len(rows), INSERT_CHUNK):
        await db.execute(pg_insert(GeoKindergartenEvaluation).values(rows[start : start + INSERT_CHUNK]).on_conflict_do_nothing())
    return len(rows), len({row["source_id"] for row in rows})
