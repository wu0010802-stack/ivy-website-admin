"""各國民小學的一年級人數（教育部統計處「國民小學校別學生數」basec，docs/specs/2026-10-20-admissions-potential-share-design.md §3.3）。

市佔率的分母用 2–5 歲戶籍人口，再拿「一年級人數 ÷ 6 歲戶籍人口」對帳。一年級人數來自教育部統計處每學年公布的
校別資料：一學年一個 CSV（`{學年}_basec.csv`，全國約 2,660 所、300 KB），一列一所學校。這裡只管網址、解析、驗證與
寫入；找新學年、下載與排程在 sync.py。geo_elementary_grade1 一學年一批、不刪舊年，只存縣市名稱＝高雄市的學校。

格式（2026-10-20 實測 107、114 學年）：
- UTF-8 帶 BOM、CRLF；
- 107 學年的表頭沒有「學年度」「鄉鎮市區」，114 學年有（欄位位置不同），所以一律照表頭名取欄；
- 一年級人數＝「1年級男學生數」＋「1年級女學生數」；高雄市 107 學年 249 所、114 學年 246 所，代碼都是 6 碼；
- 還沒公布的學年回 404（115 學年，2026-10-20 實測）。"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.models import GeoDatasetStatus, GeoElementaryGrade1

DATASET = "elementary"
URL_TEMPLATE = "https://stats.moe.gov.tw/files/detail/{year}/{year}_basec.csv"
KAOHSIUNG_NAME = "高雄市"
# 最早抓的學年：和九月底人口（september.FIRST_YEAR，ODRP014 最早 107-01）同一年，分母和對帳才對得上。
FIRST_YEAR = 107
# 高雄市的學校至少這麼多（107 學年 249 所、114 學年 246 所）才換版，少了多半是殘缺檔或錯誤頁。
MIN_ROWS = 200
# 每學年才更新一次，系統狀態的過期門檻用一年多（天數另加寬限），不能用其他資料的 30 天。
STALE_AFTER = timedelta(days=400)
# 用到的欄位（「學年度」只在新格式有，另外處理）。
_COLUMNS = {
    "county": "縣市名稱",
    "code": "學校代碼",
    "name": "學校名稱",
    "male": "1年級男學生數",
    "female": "1年級女學生數",
}
_YEAR_COLUMN = "學年度"
_FILENAME = re.compile(r"([0-9]{3})_basec\.csv", re.IGNORECASE)
_CODE = re.compile(r"[0-9A-Za-z]{1,6}")
_COUNT = re.compile(r"[0-9]+")
LEN_NAME = 32


class ElementaryFormatError(ValueError):
    """國小校別資料的格式或內容不對；訊息會寫進 geo_dataset_status.last_error，不含回應內容。"""


@dataclass(frozen=True)
class Grade1Row:
    school_code: str
    school_name: str
    grade1: int


def url_for(template: str, year: int) -> str:
    return template.replace("{year}", str(year))


def year_of_filename(name: str) -> int:
    """「114_basec.csv」→ 114；不是這個樣子的檔名丟 ElementaryFormatError。"""
    matched = _FILENAME.fullmatch(name.strip())
    if matched is None:
        raise ElementaryFormatError("國小校別資料的檔名要像 114_basec.csv（學年_basec.csv）")
    return int(matched.group(1))


def years_to_fetch(latest: int | None, current_year: int, *, force: bool = False) -> list[int]:
    """自動同步要抓的學年：從表裡最新的下一學年抓到當前學年的前一學年（當前學年的校別資料要到之後才公布）。
    表是空的從 FIRST_YEAR 開始；force 時表裡最新的學年也重抓。表裡已經有前一學年就是空的。"""
    first = FIRST_YEAR if latest is None else (latest if force else latest + 1)
    return list(range(first, current_year))


def _clean(cell: str) -> str:
    return cell.replace("﻿", "").strip().strip('"').strip()


def _count(value: str, column: str) -> int:
    text = value.strip().replace(",", "")
    if not _COUNT.fullmatch(text):
        raise ElementaryFormatError(f"國小校別資料的「{column}」不是非負整數")
    return int(text)


def decode(body: bytes) -> str:
    """下載或檔案的位元組 → 文字（UTF-8，BOM 去掉）。不是 UTF-8 多半是錯誤頁。"""
    try:
        return body.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ElementaryFormatError("國小校別資料不是 UTF-8（可能是錯誤頁）") from exc


def parse_basec(text: str, *, school_year: int) -> list[Grade1Row]:
    """解析一個學年的 CSV，只留縣市名稱＝高雄市的學校，依學校代碼排：
    - 剝掉 BOM；依表頭名取欄，缺任何必要欄丟 ElementaryFormatError（訊息列出缺的欄名）；
    - 有「學年度」欄時每一列都要等於 school_year（檔名和內容對不上就是抓錯檔）；
    - 一年級人數＝男＋女，兩欄都要是非負整數；學校代碼 6 碼以內的英數字，同一代碼不能出現兩次。
    筆數下限不在這裡檢查（require_rows）：自動同步要、人工指定的小樣本檔不要。"""
    reader = csv.reader(io.StringIO(text.lstrip("﻿")))
    try:
        header = [_clean(cell) for cell in next(reader)]
    except (StopIteration, csv.Error) as exc:
        raise ElementaryFormatError("國小校別資料是空的或不是 CSV") from exc
    missing = [name for name in _COLUMNS.values() if name not in header]
    if missing:
        raise ElementaryFormatError(f"國小校別資料缺欄位：{'、'.join(missing)}")
    index = {key: header.index(name) for key, name in _COLUMNS.items()}
    year_at = header.index(_YEAR_COLUMN) if _YEAR_COLUMN in header else None
    width = max([*index.values(), year_at if year_at is not None else 0]) + 1
    rows: dict[str, Grade1Row] = {}
    try:
        for cells in reader:
            if not cells or not any(cell.strip() for cell in cells):
                continue
            if len(cells) < width:
                raise ElementaryFormatError("國小校別資料有欄位不足的列")
            if year_at is not None and _clean(cells[year_at]) != str(school_year):
                raise ElementaryFormatError(f"國小校別資料的學年度不是 {school_year}")
            if _clean(cells[index["county"]]) != KAOHSIUNG_NAME:
                continue
            code = _clean(cells[index["code"]])
            if not _CODE.fullmatch(code):
                raise ElementaryFormatError("國小校別資料有學校代碼不是 6 碼以內的英數字")
            if code in rows:
                raise ElementaryFormatError(f"國小校別資料有重複的學校代碼：{code}")
            grade1 = _count(cells[index["male"]], _COLUMNS["male"]) + _count(cells[index["female"]], _COLUMNS["female"])
            rows[code] = Grade1Row(school_code=code, school_name=_clean(cells[index["name"]])[:LEN_NAME], grade1=grade1)
    except csv.Error as exc:
        raise ElementaryFormatError("國小校別資料不是正確的 CSV") from exc
    return sorted(rows.values(), key=lambda row: row.school_code)


def require_rows(rows: list[Grade1Row], *, minimum: int = 1) -> None:
    """換版前的筆數檢查：一列都沒有（檔案裡沒有高雄市）一律不換；minimum 是自動同步的下限（MIN_ROWS）。"""
    if not rows:
        raise ElementaryFormatError("國小校別資料裡沒有高雄市的學校")
    if len(rows) < minimum:
        raise ElementaryFormatError(f"國小校別資料只有 {len(rows)} 所高雄市的學校，少於 {minimum} 所，不換版")


async def replace_year(db: AsyncSession, school_year: int, rows: list[Grade1Row]) -> int:
    """那一學年整批換新（不 commit）：刪該學年所有列後寫入，不會留下上一次多出來的學校；其他學年不動。回傳寫入的列數。"""
    await db.execute(delete(GeoElementaryGrade1).where(GeoElementaryGrade1.school_year == school_year))
    values = [{"school_year": school_year, **asdict(row)} for row in rows]
    if values:
        await db.execute(insert(GeoElementaryGrade1), values)
    return len(values)


async def latest_year(db: AsyncSession) -> int | None:
    """表裡最新的學年；表是空的回 None。"""
    return await db.scalar(select(func.max(GeoElementaryGrade1.school_year)))


async def mark_synced(db: AsyncSession, *, now: datetime) -> None:
    """狀態列記成表裡最新的學年、換版時間，並清掉錯誤（不 commit，和 replace_year 在同一個交易）。確認時間
    （checked_at）不在這裡記：整輪抓完才記，中途失敗時它沒動，下一輪（背景迴圈一天一次）就接著補，不必等 30 天。"""
    latest = await latest_year(db)
    status = await db.get(GeoDatasetStatus, DATASET, with_for_update=True)
    if status is None:
        status = GeoDatasetStatus(dataset=DATASET)
        db.add(status)
    status.active_version = str(latest) if latest is not None else None
    status.label = status.active_version
    status.synced_at = now
    status.last_error = None
