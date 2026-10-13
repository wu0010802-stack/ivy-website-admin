"""高雄市各里學齡前人口（內政部戶政司 ODRP014「村里戶數、單一年齡人口（新增區域代碼）」，
docs/specs/2026-10-13-admissions-opportunity-design.md 第 2–4 節）。

來源是每頁最多 2,000 筆的 JSON API；帶 COUNTY=高雄市 只回高雄 893 里（一頁、約 4.4 MB，2026-10-13 實測），
不帶是全國約 7,800 筆、四頁共約 38 MB。值全是字串。解析時仍只留 district_code 以 64000 開頭的列
（來源哪天不理會 COUNTY 也不會把外縣市寫進來）。這裡只管解析、驗證與寫入；下載與排程在 sync.py。
驗證任一項不過就整批不換，保留使用中的月份。"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from urllib.parse import urlencode

from sqlalchemy import delete, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo import boundaries
from app.admissions.geo.models import GeoDatasetStatus, GeoVillagePopulation

RIS_BASE = "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014"
KAOHSIUNG_PREFIX = "64000"
KAOHSIUNG_NAME = "高雄市"
# 回應代碼：處理完成、查無資料（那個月份還沒公布）。
RESPONSE_OK = "OD-0101-S"
RESPONSE_NO_DATA = "OD-0102-S"
# 高雄 893 里；少於這個數字多半是來源給了殘缺的資料，不換版。
MIN_VILLAGES = 850
# 只要高雄是 1 頁（全國也只有 4 頁）；超過這個頁數視為來源異常，不無限抓下去。
MAX_PAGES = 10
AGES = range(0, 7)
_KEEP_FIELDS = (
    "statistic_yyymm", "district_code", "site_id", "village", "people_total",
    *(f"people_age_{age:03d}_{sex}" for age in AGES for sex in "mf"),
)
SOURCE_NOTE = "資料來源：內政部戶政司 村里戶數、單一年齡人口"
_MONTH = re.compile(r"([0-9]{3})(0[1-9]|1[0-2])")
# 只認 ASCII 數字：str.isdigit() 會放行「²」這類字，int() 卻轉不了。
_COUNT = re.compile(r"[0-9]+")


class PopulationFormatError(ValueError):
    """人口資料的格式或內容不對；訊息會寫進 geo_dataset_status.last_error，不含回應內容。"""


@dataclass(frozen=True)
class PopulationRow:
    village_code: str
    district: str
    village: str
    age_0: int
    age_1: int
    age_2: int
    age_3: int
    age_4: int
    age_5: int
    age_6: int
    people_total: int


@dataclass
class PopulationBatch:
    """一個月份的高雄市各里人口。label 是「115-09」；skipped 是對不到里界、被略過的高雄列數。"""

    label: str
    rows: list[PopulationRow] = field(default_factory=list)
    skipped: int = 0


def page_url(yyymm: str, page: int) -> str:
    return f"{RIS_BASE}/{yyymm}?{urlencode({'COUNTY': KAOHSIUNG_NAME, 'page': page})}"


def label_of(yyymm: str) -> str:
    """「11509」→「115-09」；不是民國年月就丟 PopulationFormatError。"""
    matched = _MONTH.fullmatch(yyymm)
    if matched is None:
        raise PopulationFormatError("人口資料的統計月份格式不對")
    return f"{matched.group(1)}-{matched.group(2)}"


def response_rows(data: object) -> list[dict] | None:
    """一頁 API 回應的資料列；「查無資料」回 None（那個月份還沒公布），其他不認得的回應丟錯。"""
    if not isinstance(data, dict):
        raise PopulationFormatError("人口資料不是 JSON 物件")
    code = data.get("responseCode")
    if code == RESPONSE_NO_DATA:
        return None
    rows = data.get("responseData")
    if code != RESPONSE_OK or not isinstance(rows, list):
        raise PopulationFormatError("人口資料的回應不是「處理完成」")
    return rows


def _slim_row(obj: dict) -> dict | None:
    """json.loads 的 object_hook：每個 JSON 物件一解析出來就經過這裡。資料列（有 district_code）不是高雄市的
    回 None、是高雄的只留用得到的欄位；其他物件（整頁的外層）原樣回傳。"""
    if "district_code" not in obj:
        return obj
    if not str(obj["district_code"]).startswith(KAOHSIUNG_PREFIX):
        return None
    return {key: obj[key] for key in _KEEP_FIELDS if key in obj}


def parse_page(text: str) -> object:
    """解析一頁 API 回應，解析當下就丟掉其他縣市的列與 7 歲以上的欄位。每列 210 欄，整頁照原樣解析成
    物件很佔記憶體（全國一頁上百 MB）；api 容器記憶體有限，所以不先整份解析再篩。"""
    data = json.loads(text, object_hook=_slim_row)
    if isinstance(data, dict) and isinstance(data.get("responseData"), list):
        data["responseData"] = [row for row in data["responseData"] if row is not None]
    return data


def total_pages(data: object) -> int:
    if not isinstance(data, dict):
        raise PopulationFormatError("人口資料不是 JSON 物件")
    try:
        pages = int(str(data.get("totalPage", "")))
    except ValueError as exc:
        raise PopulationFormatError("人口資料缺少總頁數") from exc
    if not 1 <= pages <= MAX_PAGES:
        raise PopulationFormatError(f"人口資料的總頁數 {pages} 不合理")
    return pages


def _count(row: dict, key: str) -> int:
    value = str(row.get(key, "")).strip()
    if not _COUNT.fullmatch(value):
        raise PopulationFormatError(f"人口資料的 {key} 不是非負整數")
    return int(value)


def collect(pages: list[list[dict]]) -> PopulationBatch:
    """把各頁的資料列篩成高雄市、驗證後組成一批（規格 §4 的驗證）。

    - 每一列的 statistic_yyymm 要一樣（同一個月份；經 parse_page 解析的頁只剩高雄的列，就只比高雄的列）；
    - 只留 district_code 以 64000 開頭的列，代碼不在里界檔的略過並計數；
    - 各歲與全里人口要是非負整數，同一個代碼不能出現兩次；
    - 對到的里至少 MIN_VILLAGES 個。"""
    known = boundaries.village_codes()
    months: set[str] = set()
    batch_rows: dict[str, PopulationRow] = {}
    skipped = 0
    for rows in pages:
        for row in rows:
            if not isinstance(row, dict):
                raise PopulationFormatError("人口資料的資料列不是物件")
            months.add(str(row.get("statistic_yyymm", "")))
            code = str(row.get("district_code", ""))
            if not code.startswith(KAOHSIUNG_PREFIX):
                continue
            if code not in known:
                skipped += 1
                continue
            if code in batch_rows:
                raise PopulationFormatError("人口資料有重複的村里代碼")
            ages = {f"age_{age}": _count(row, f"people_age_{age:03d}_m") + _count(row, f"people_age_{age:03d}_f") for age in AGES}
            batch_rows[code] = PopulationRow(
                village_code=code,
                district=str(row.get("site_id", "")).removeprefix(KAOHSIUNG_NAME)[:8],
                village=str(row.get("village", ""))[:16],
                people_total=_count(row, "people_total"),
                **ages,
            )
    if len(months) != 1:
        raise PopulationFormatError("人口資料混了不同月份" if months else "人口資料是空的")
    label = label_of(months.pop())
    if len(batch_rows) < MIN_VILLAGES:
        raise PopulationFormatError(f"高雄市只有 {len(batch_rows)} 個里的人口，少於 {MIN_VILLAGES} 個，不換版")
    return PopulationBatch(label=label, rows=sorted(batch_rows.values(), key=lambda row: row.village_code), skipped=skipped)


async def replace_population(db: AsyncSession, batch: PopulationBatch, *, synced_at: datetime) -> int:
    """整批換新並更新狀態列（不 commit）。893 列，一個交易做完：換到一半失敗就整批回滾，
    畫面不會看到一半新、一半舊的月份。"""
    await db.execute(delete(GeoVillagePopulation))
    await db.execute(insert(GeoVillagePopulation), [asdict(row) for row in batch.rows])
    status = await db.get(GeoDatasetStatus, "population", with_for_update=True)
    if status is None:
        status = GeoDatasetStatus(dataset="population")
        db.add(status)
    status.active_version = batch.label
    status.label = batch.label
    status.synced_at = synced_at
    status.checked_at = synced_at
    status.last_error = None
    return len(batch.rows)
