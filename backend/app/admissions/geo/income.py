"""高雄市各里綜合所得（財政部財政資訊中心「綜稅綜合所得總額各縣市鄉鎮村里統計分析表-高雄市」，
docs/specs/2026-10-14-admissions-village-trends-design.md §2.3、§3.3、§4.4）。

每個年度一個 CSV（`{年度}_165-E.csv`，約 90 KB），一列一個里，金額單位千元。這裡只管網址、解析、驗證與寫入；
找新年度、下載與排程在 sync.py。只存最新一個年度、只存對得到里界的里（「其他」「合計」與 115-07 里鄰調整前的
舊里不存）；換年度時同一個交易刪光再寫入。驗證任一項不過就不換，保留使用中的年度。

格式（2026-10-14 實測 109～112 年度）：
- UTF-8、CRLF；BOM 有時在引號裡（`"\\ufeff縣市別"`），`utf-8-sig` 去不掉，要自己剝；
- 110 年度起第一欄欄名誤標「縣市別」（109 年度是「鄉鎮市區」），值都是「高雄市鹽埕區」：第一欄只看位置；
- 整數欄可能寫成「6392.00」（規格 §4.4；實測這四個年度都沒有，仍照收）。

所得只當背景（規格 V9）：只用中位數，不著色、不分級、不排序、不判讀，不做歷年比較（108 年度起計算方式改了）。"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from sqlalchemy import delete, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo import boundaries
from app.admissions.geo.models import GeoDatasetStatus, GeoVillageIncome

DATASET_API = "https://data.gov.tw/api/v2/rest/dataset/17971"
FIA_ROOT = "https://www.fia.gov.tw/WEB/fia/ias"
KAOHSIUNG_NAME = "高雄市"
# 對得到里界的里至少這麼多（高雄 893 里；112 年度 879 個對得到，其餘是 115-07 新設的里）。
MIN_VILLAGES = 850
# 「其他」（戶籍不在任何里）與「合計」是區的小計，不是里。
_NOT_VILLAGES = ("其他", "合計")
# 用到的欄位（第一欄「鄉鎮市區」只看位置，欄名在 110 年度起標錯）。
_COLUMNS = {
    "village": "村里",
    "taxpayers": "納稅單位(戶)",
    "mean": "平均數",
    "median": "中位數",
    "q1": "第一分位數",
    "q3": "第三分位數",
}
_YEAR = re.compile(r"[0-9]{3}")
_URL = re.compile(re.escape(FIA_ROOT) + r"/ias([0-9]{3})/\1_165-E\.csv")
_FILENAME = re.compile(r"(?<![0-9])([0-9]{3})_165-E", re.IGNORECASE)
_NUMBER = re.compile(r"[0-9]+(?:\.[0-9]+)?")
SOURCE_TITLE = "綜稅綜合所得總額各縣市鄉鎮村里統計分析表-高雄市"
# 官方附註（財政資訊中心統計專冊），畫面照引。
OFFICIAL_NOTE = "本統計之所得為課稅資料，不含政府移轉、免稅與分離課稅所得，不宜逕作為衡量所得差距之參據"


class IncomeFormatError(ValueError):
    """所得資料的格式或內容不對；訊息會寫進 geo_dataset_status.last_error，不含回應內容。"""


@dataclass(frozen=True)
class IncomeRow:
    village_code: str
    district: str
    village: str
    year: int
    taxpayers: int
    median: int
    q1: int
    q3: int
    mean: int


@dataclass
class IncomeBatch:
    """一個年度的高雄市各里所得。skipped 是對不到里界、被略過的列數（115-07 調整前的舊里）。"""

    year: int
    rows: list[IncomeRow] = field(default_factory=list)
    skipped: int = 0


def csv_url(year: int) -> str:
    return f"{FIA_ROOT}/ias{year}/{year}_165-E.csv"


def year_of_url(url: str) -> int | None:
    """財政資訊中心高雄市檔的網址 → 年度；不是這個樣子的網址回 None（只認 https://www.fia.gov.tw/）。"""
    matched = _URL.fullmatch(url.strip())
    return int(matched.group(1)) if matched else None


def year_of_filename(name: str) -> int | None:
    """「112_165-E.csv」→ 112；檔名裡沒有就回 None（CLI 要另給 --income-year）。"""
    matched = _FILENAME.search(name)
    return int(matched.group(1)) if matched else None


def parse_year(value: str) -> int:
    if not _YEAR.fullmatch(value.strip()):
        raise IncomeFormatError("所得年度要是三位數的民國年，例如 112")
    return int(value)


def years_listed(data: object) -> list[int]:
    """data.gov.tw 資料集 API 的回應 → 列出的高雄市檔年度（新到舊）。格式不對丟 IncomeFormatError。"""
    result = data.get("result") if isinstance(data, dict) else None
    distribution = result.get("distribution") if isinstance(result, dict) else None
    if not isinstance(distribution, list):
        raise IncomeFormatError("data.gov.tw 的資料集回應沒有檔案清單")
    years = set()
    for item in distribution:
        url = item.get("resourceDownloadUrl") if isinstance(item, dict) else None
        year = year_of_url(url) if isinstance(url, str) else None
        if year is not None:
            years.add(year)
    return sorted(years, reverse=True)


def _amount(value: str, column: str) -> int:
    """非負數字（千元或戶數）。「6392.00」照收、四捨五入成整數。"""
    text = value.strip().replace(",", "")
    if not _NUMBER.fullmatch(text):
        raise IncomeFormatError(f"所得資料的「{column}」不是非負數字")
    try:
        return int(Decimal(text).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    except InvalidOperation as exc:  # pragma: no cover - _NUMBER 已擋掉
        raise IncomeFormatError(f"所得資料的「{column}」不是非負數字") from exc


def _clean(cell: str) -> str:
    return cell.replace("\ufeff", "").strip().strip('"').strip()


def parse_csv(text: str, year: int) -> IncomeBatch:
    """解析並驗證一個年度的 CSV（規格 §4.4）：
    - 剝掉 BOM（含引號裡的）；表頭要有 _COLUMNS 的每一欄，否則多半是錯誤頁；
    - 跳過「其他」「合計」與「高雄市其他」；區名去掉「高雄市」；
    - 數字欄是非負數；同一（區、里）不能出現兩次；
    - 對到里界的至少 MIN_VILLAGES 個，對不到的略過並計數。"""
    reader = csv.reader(io.StringIO(text.lstrip("\ufeff")))
    try:
        header = [_clean(cell) for cell in next(reader)]
    except (StopIteration, csv.Error) as exc:
        raise IncomeFormatError("所得資料是空的或不是 CSV") from exc
    try:
        index = {key: header.index(name) for key, name in _COLUMNS.items()}
    except ValueError as exc:
        raise IncomeFormatError("所得資料的表頭不對（可能是錯誤頁）") from exc
    width = max(index.values()) + 1
    seen: set[tuple[str, str]] = set()
    rows: dict[str, IncomeRow] = {}
    skipped = 0
    try:
        for cells in reader:
            if not cells or not any(cell.strip() for cell in cells):
                continue
            if len(cells) < width:
                raise IncomeFormatError("所得資料有欄位不足的列")
            district = _clean(cells[0]).removeprefix(KAOHSIUNG_NAME)
            village = _clean(cells[index["village"]])
            if not district.endswith("區") or village in _NOT_VILLAGES:
                continue
            if (district, village) in seen:
                raise IncomeFormatError(f"所得資料有重複的里：{district}{village}")
            seen.add((district, village))
            values = {key: _amount(cells[index[key]], name) for key, name in _COLUMNS.items() if key != "village"}
            code = boundaries.village_code(district, village)
            if code is None:
                skipped += 1
                continue
            rows[code] = IncomeRow(village_code=code, district=district[:8], village=village[:16], year=year, **values)
    except csv.Error as exc:
        raise IncomeFormatError("所得資料不是正確的 CSV") from exc
    if len(rows) < MIN_VILLAGES:
        raise IncomeFormatError(f"所得資料只有 {len(rows)} 個里對得到里界，少於 {MIN_VILLAGES} 個，不換版")
    return IncomeBatch(year=year, rows=sorted(rows.values(), key=lambda row: row.village_code), skipped=skipped)


def decode(body: bytes) -> str:
    """下載或檔案的位元組 → 文字。財政資訊中心的檔是 UTF-8；不是的話多半是錯誤頁。"""
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise IncomeFormatError("所得資料不是 UTF-8（可能是錯誤頁）") from exc


def citation(year: int | None, synced_at: datetime | None) -> str:
    """政府資料開放授權條款要求的顯名（規格 §2.3），後面接官方附註。年份是取得資料的年份（西元）。"""
    if year is None:
        return ""
    taken = f"（{synced_at.year}）" if synced_at is not None else ""
    return f"資料來源：財政部財政資訊中心{taken}{SOURCE_TITLE}（{year}年度）。{OFFICIAL_NOTE}"


async def replace_income(db: AsyncSession, batch: IncomeBatch, *, synced_at: datetime) -> int:
    """整個年度換新並更新狀態列（不 commit）：同一個交易刪光再寫入。"""
    await db.execute(delete(GeoVillageIncome))
    await db.execute(insert(GeoVillageIncome), [asdict(row) for row in batch.rows])
    status = await db.get(GeoDatasetStatus, "income", with_for_update=True)
    if status is None:
        status = GeoDatasetStatus(dataset="income")
        db.add(status)
    status.active_version = str(batch.year)
    status.label = str(batch.year)
    status.synced_at = synced_at
    status.checked_at = synced_at
    status.last_error = None
    return len(batch.rows)
