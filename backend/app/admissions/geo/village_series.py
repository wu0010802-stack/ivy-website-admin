"""各里出生、遷入遷出、年齡的月份歷史（內政部戶政司 ODRP010／ODRP011／ODRP014，
docs/specs/2026-10-14-admissions-village-trends-design.md §2.1、§3.1、§4.2）。

三種資料同一支 API、同一套 11 碼村里代碼（和里界檔、ODRP014 相同），帶 COUNTY=高雄市 都只有一頁；
值全是字串。這裡只管網址、解析、驗證、寫入與月份運算；下載、回補與排程在 sync.py。
和 population.py（使用中的各里人口，只存一個月份）不同的地方：
- 一個月份一批，表裡留最新月份往回 KEEP_MONTHS 個月；
- 里界檔沒有的高雄代碼（例如 115-07 里鄰調整前的舊里）照存、不略過：里界調整合併計算時要用；
- 驗證任一項不過，那個月份不寫，其他月份照舊。"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from urllib.parse import urlencode

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo import boundaries
from app.admissions.geo import population as population_io
from app.admissions.geo.models import GeoVillageAges, GeoVillageBirths, GeoVillageMigration

RIS_ROOT = "https://www.ris.gov.tw/rs-opendata/api/v1/datastore"
# 最新月份往回幾個月（含）：近 12 個月，加上前一年同月份。
KEEP_MONTHS = 25
# 代碼對得到里界檔的里至少這麼多（高雄 893 里；115-06 以前的月份有 879 個對得到）；少於多半是殘缺檔。
MIN_VILLAGES = 850
_ID_KEYS = ("statistic_yyymm", "district_code", "site_id", "village")
_MONTH = re.compile(r"([0-9]{3})(0[1-9]|1[0-2])")
_LABEL = re.compile(r"([0-9]{3})-(0[1-9]|1[0-2])")
# 只認 ASCII 數字：str.isdigit() 會放行「²」這類字，int() 卻轉不了。
_COUNT = re.compile(r"[0-9]+")


class SeriesFormatError(ValueError):
    """資料的格式或內容不對；訊息會寫進 geo_dataset_status.last_error，不含回應內容。"""


@dataclass(frozen=True)
class Series:
    """一種月份資料。dataset 是 geo_dataset_status 的資料種類（年齡歷史沒有自己的狀態列，跟著 population）；
    columns 是「資料表欄位 → 相加的來源欄位」。"""

    dataset: str
    code: str
    name: str
    model: type
    columns: dict[str, tuple[str, ...]]

    @property
    def source_keys(self) -> tuple[str, ...]:
        return tuple(key for keys in self.columns.values() for key in keys)


def _both(prefix: str) -> tuple[str, str]:
    return (f"{prefix}_m", f"{prefix}_f")


BIRTHS = Series("births", "ODRP010", "各里出生", GeoVillageBirths, {"births": ("birth_total",)})
MIGRATION = Series(
    "migration",
    "ODRP011",
    "各里遷入遷出",
    GeoVillageMigration,
    {
        "moved_in": _both("in_total"),
        "moved_out": _both("out_total"),
        "address_in": _both("in_migrants"),
        "address_out": _both("out_migrants"),
        "boundary_in": _both("vlg_chg_add"),
        "boundary_out": _both("vlg_chg_dec"),
    },
)
AGES = Series(
    "ages",
    "ODRP014",
    "各里年齡",
    GeoVillageAges,
    {**{f"age_{age}": _both(f"people_age_{age:03d}") for age in range(7)}, "people_total": ("people_total",)},
)
SOURCE_NOTE = "資料來源：內政部戶政司 各村（里）戶籍人口統計月報表、遷入遷出統計表、村里戶數及單一年齡人口"


@dataclass
class SeriesBatch:
    """一個月份的高雄市各里資料。label 是「115-09」；rows 是要寫入的欄位；unknown 是里界檔沒有、照存的代碼數。"""

    label: str
    rows: list[dict] = field(default_factory=list)
    unknown: int = 0


# ---- 月份 ----


def label_of(yyymm: str) -> str:
    """「11509」→「115-09」；不是民國年月就丟 SeriesFormatError。"""
    matched = _MONTH.fullmatch(yyymm)
    if matched is None:
        raise SeriesFormatError("統計月份格式不對")
    return f"{matched.group(1)}-{matched.group(2)}"


def yyymm_of(label: str) -> str:
    """「115-09」→「11509」。"""
    matched = _LABEL.fullmatch(label)
    if matched is None:
        raise SeriesFormatError("月份格式不對")
    return f"{matched.group(1)}{matched.group(2)}"


def shift(label: str, months: int) -> str:
    """「115-09」往後（負數往前）幾個月。"""
    matched = _LABEL.fullmatch(label)
    if matched is None:
        raise SeriesFormatError("月份格式不對")
    index = int(matched.group(1)) * 12 + int(matched.group(2)) - 1 + months
    return f"{index // 12:03d}-{index % 12 + 1:02d}"


def window(latest: str, count: int) -> list[str]:
    """latest 往回 count 個月（含 latest），舊到新。"""
    return [shift(latest, offset) for offset in range(-(count - 1), 1)]


# ---- 網址與解析 ----


def page_url(series: Series, yyymm: str, page: int) -> str:
    return f"{RIS_ROOT}/{series.code}/{yyymm}?{urlencode({'COUNTY': population_io.KAOHSIUNG_NAME, 'page': page})}"


def parse_page(series: Series, text: str) -> object:
    """解析一頁 API 回應，解析當下就丟掉其他縣市的列與用不到的欄位（同 population.parse_page 的作法）。
    回應不是 JSON（擋頁是一段 HTML）丟 SeriesFormatError，不把內容寫進錯誤訊息。"""
    keep = (*_ID_KEYS, *series.source_keys)

    def slim(obj: dict) -> dict | None:
        if "district_code" not in obj:
            return obj
        if not str(obj["district_code"]).startswith(population_io.KAOHSIUNG_PREFIX):
            return None
        return {key: obj[key] for key in keep if key in obj}

    try:
        data = json.loads(text, object_hook=slim)
    except json.JSONDecodeError as exc:
        raise SeriesFormatError(f"{series.name}的回應不是資料（可能被來源擋下），下次再試") from exc
    if isinstance(data, dict) and isinstance(data.get("responseData"), list):
        data["responseData"] = [row for row in data["responseData"] if row is not None]
    return data


def response_rows(series: Series, data: object) -> list[dict] | None:
    """一頁回應的資料列；「查無資料」回 None（那個月份沒有資料），其他不認得的回應丟錯。"""
    if not isinstance(data, dict):
        raise SeriesFormatError(f"{series.name}不是 JSON 物件")
    code = data.get("responseCode")
    if code == population_io.RESPONSE_NO_DATA:
        return None
    rows = data.get("responseData")
    if code != population_io.RESPONSE_OK or not isinstance(rows, list):
        raise SeriesFormatError(f"{series.name}的回應不是「處理完成」")
    return rows


def total_pages(series: Series, data: object) -> int:
    if not isinstance(data, dict):
        raise SeriesFormatError(f"{series.name}不是 JSON 物件")
    try:
        pages = int(str(data.get("totalPage", "")))
    except ValueError as exc:
        raise SeriesFormatError(f"{series.name}缺少總頁數") from exc
    if not 1 <= pages <= population_io.MAX_PAGES:
        raise SeriesFormatError(f"{series.name}的總頁數 {pages} 不合理")
    return pages


def month_of_rows(rows: list[dict]) -> str | None:
    """資料列的統計月份（民國年月「11509」）；空的或混了不同月份回 None。"""
    months = {str(row.get("statistic_yyymm", "")) for row in rows if isinstance(row, dict)}
    return months.pop() if len(months) == 1 else None


def _count(series: Series, row: dict, key: str) -> int:
    value = str(row.get(key, "")).strip()
    if not _COUNT.fullmatch(value):
        raise SeriesFormatError(f"{series.name}的 {key} 不是非負整數")
    return int(value)


def collect(series: Series, pages: list[list[dict]]) -> SeriesBatch:
    """把一個月份的各頁資料列驗證後組成一批（規格 §4.2 的驗證）：
    - 每一列的 statistic_yyymm 一樣；
    - 只留 64000 開頭的代碼；同一代碼不能出現兩次；
    - 用到的欄位都是非負整數；
    - 代碼對得到里界檔的至少 MIN_VILLAGES 個；對不到的照存並計數。"""
    known = boundaries.village_codes()
    months: set[str] = set()
    rows: dict[str, dict] = {}
    unknown = 0
    for page in pages:
        for row in page:
            if not isinstance(row, dict):
                raise SeriesFormatError(f"{series.name}的資料列不是物件")
            months.add(str(row.get("statistic_yyymm", "")))
            code = str(row.get("district_code", ""))
            if not code.startswith(population_io.KAOHSIUNG_PREFIX):
                continue
            if code in rows:
                raise SeriesFormatError(f"{series.name}有重複的村里代碼")
            values = {
                column: sum(_count(series, row, key) for key in keys) for column, keys in series.columns.items()
            }
            rows[code] = {
                "village_code": code,
                "district": str(row.get("site_id", "")).removeprefix(population_io.KAOHSIUNG_NAME)[:8],
                "village": str(row.get("village", ""))[:16],
                **values,
            }
            if code not in known:
                unknown += 1
    if len(months) != 1:
        raise SeriesFormatError(f"{series.name}混了不同月份" if months else f"{series.name}是空的")
    label = label_of(months.pop())
    matched = len(rows) - unknown
    if matched < MIN_VILLAGES:
        raise SeriesFormatError(f"{series.name}只有 {matched} 個里對得到里界，少於 {MIN_VILLAGES} 個，不寫入")
    ordered = [{"month": label, **rows[code]} for code in sorted(rows)]
    return SeriesBatch(label=label, rows=ordered, unknown=unknown)


# ---- 資料庫 ----


async def replace_month(db: AsyncSession, series: Series, batch: SeriesBatch) -> int:
    """整個月份換新（不 commit）：同一個交易先刪那個月份再寫入，不會留下上一次的列。"""
    model = series.model
    await db.execute(delete(model).where(model.month == batch.label))
    if batch.rows:
        await db.execute(insert(model), batch.rows)
    return len(batch.rows)


async def months_in_table(db: AsyncSession, series: Series) -> set[str]:
    model = series.model
    return set((await db.execute(select(model.month).distinct())).scalars().all())


async def prune(db: AsyncSession, series: Series, latest: str) -> None:
    """只留 latest 往回 KEEP_MONTHS 個月（不 commit）。比 latest 新的月份不會出現（換版只往前）。"""
    model = series.model
    await db.execute(delete(model).where(model.month < shift(latest, -(KEEP_MONTHS - 1))))
