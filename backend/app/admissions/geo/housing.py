"""各里房價與租金（內政部「不動產成交案件實際資訊」季檔，高雄市買賣 e_lvr_land_a.csv 與租賃 e_lvr_land_c.csv；
docs/specs/2026-11-20-area-point-overlay-housing-design.md §7.1、§7.2、§11 第 4、5、7 條）。

這裡只管解析與篩選、單價與中位數、寫入、重比與依里取交易；找最新季、下載、回補與排程在 sync.py。
季別運算、檔案格式（UTF-8 帶 BOM、兩列表頭）、門牌解析與比對都沿用 new_homes。

- 買賣（H1）：交易標的含「建物」、主要用途含「住」、建物型態以住宅清單開頭、交易筆棟數的建物數 = 1、備註沒有特殊
  交易字樣、扣車位後淨面積 ≥ 10 m² 且淨價 > 0；單價＝(總價 − 車位總價) ÷ ((建物面積 − 車位面積) ÷ 3.30579)，四捨五入到百元。
- 租賃（H2）：交易標的含「房屋」、主要用途含「住」（規格 §7.1 沒列，但 115S3 實測 4,230 筆／月租中位數 18,500 元要加這條才對得上）、出租型態 =「整棟(戶)出租」、建物型態同上、備註沒有親友／員工／特殊關係、總額元 > 0。
- 只存門牌鍵與比對結果、季別、建物型態與單價／月租；不存地址原文、樓層、總價、面積、交易日、格局、建案名稱（規格 §7.1）。"""

from __future__ import annotations

import csv
import io
import re
from collections import defaultdict
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Literal

from sqlalchemy import delete, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.geo import boundaries, matcher
from app.admissions.geo.models import VILLAGE_LEVELS, GeoDatasetStatus, GeoHousingDeal
from app.admissions.geo.new_homes import Key, _address, _district_of, match_keys, shift_season

SALE_FILE = "e_lvr_land_a.csv"
RENT_FILE = "e_lvr_land_c.csv"
KEEP_SEASONS = 4
# 一個里至少幾筆才給中位數（少於這個數回 None，筆數照給）。
MIN_DEALS = 5
# 一季買賣或租賃可用的筆數下限（115S3 買賣 4,108、租賃 4,230）：太少多半是殘缺檔，不寫。
MIN_SEASON_ROWS = 1000
PING_M2 = 3.30579
SOURCE_NOTE = "內政部不動產交易實價查詢服務網"
# 畫面上資料來源的完整說明（里的變化與任意點共用）。
SOURCE_NOTE_FULL = f"{SOURCE_NOTE}；近 4 季，排除親友、特殊關係、預售屋交屋等非一般交易，房價扣除車位"
RESIDENTIAL_TYPES = ("住宅大樓", "華廈", "公寓", "透天厝", "套房")
MIN_NET_AREA = Decimal("10")
# unit_price、monthly_rent 是 PostgreSQL integer（上限 2,147,483,647）：超過 20 億的單價或月租多半是打錯，整列不收，免得寫入時溢位。
MAX_STORED_VALUE = 2_000_000_000
SALE_REQUIRED = (
    "鄉鎮市區", "交易標的", "土地位置建物門牌", "交易筆棟數", "建物型態", "主要用途", "建物移轉總面積平方公尺", "總價元",
    "車位移轉總面積平方公尺", "車位總價元", "備註", "編號",
)
RENT_REQUIRED = ("鄉鎮市區", "交易標的", "土地位置建物門牌", "建物型態", "主要用途", "總額元", "出租型態", "備註", "編號")
SALE_EXCLUDED_NOTES = (
    "親友", "員工", "特殊關係", "共有人", "瑕疵", "急買急賣", "政府機關", "債權債務", "拍賣", "含增建", "未登記建物", "毛胚", "預售屋",
)
RENT_EXCLUDED_NOTES = ("親友", "員工", "特殊關係")
WHOLE_UNIT = "整棟(戶)出租"
_BUILDINGS = re.compile(r"建物(\d+)")


class HousingFormatError(ValueError):
    """季檔的格式或內容不對；訊息會寫進 geo_dataset_status.last_error，不含檔案內容。"""


@dataclass(frozen=True)
class HousingRow:
    kind: Literal["sale", "rent"]
    serial: str
    season: str
    building_type: str
    district: str
    street: str
    lane: str
    alley: str
    number: int | None
    number_sub: int
    unit_price: int | None
    monthly_rent: int | None

    @property
    def key(self) -> Key:
        return (self.district, self.street, self.lane, self.alley, self.number, self.number_sub)


@dataclass
class HousingBatch:
    """一季買賣與租賃符合篩選的交易。skipped 是兩個檔裡被篩掉的資料列數。"""

    season: str
    sales: list[HousingRow] = field(default_factory=list)
    rents: list[HousingRow] = field(default_factory=list)
    skipped: int = 0


# ---- 解析 ----


def _records(text: str, required: tuple[str, ...], label: str) -> Iterable[dict[str, str]]:
    """逐列產出必要欄位的值（去空白）。表頭缺欄、編號空白過長或重複都丟 HousingFormatError。"""
    reader = csv.reader(io.StringIO(text.lstrip("\N{ZERO WIDTH NO-BREAK SPACE}")))
    try:
        header = [cell.strip() for cell in next(reader)]
    except (StopIteration, csv.Error) as exc:
        raise HousingFormatError(f"{label}季檔是空的或不是 CSV") from exc
    missing = [name for name in required if name not in header]
    if missing:
        raise HousingFormatError(f"{label}季檔缺欄位：{'、'.join(missing)}")
    index = {name: header.index(name) for name in required}
    seen: set[str] = set()
    count = 0
    try:
        for cells in reader:
            if not cells or (cells[0].startswith("The ") and count == 0):
                continue  # 第二列英文表頭
            count += 1
            if len(cells) < len(header):
                cells = [*cells, *[""] * (len(header) - len(cells))]
            value = {name: cells[position].strip() for name, position in index.items()}
            serial = value["編號"]
            if not serial or len(serial) > 40:
                raise HousingFormatError(f"{label}季檔有編號空白或過長的列")
            if serial in seen:
                raise HousingFormatError(f"{label}季檔有重複的編號")
            seen.add(serial)
            yield value
    except csv.Error as exc:
        raise HousingFormatError(f"{label}季檔不是正確的 CSV") from exc


def _number(text: str) -> Decimal:
    """空白當 0；不是數字也當 0（之後會因為面積或總價不合而被篩掉）。"""
    try:
        return Decimal(text.replace(",", "")) if text else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


def _residential(building_type: str) -> str | None:
    return next((name for name in RESIDENTIAL_TYPES if building_type.startswith(name)), None)


def _row(kind: Literal["sale", "rent"], value: dict[str, str], season: str, building_type: str, **price) -> HousingRow:
    district = value["鄉鎮市區"][:8]
    parsed = _address(value["土地位置建物門牌"], district)
    usable = parsed is not None and not parsed.outside_kaohsiung and parsed.district is not None
    return HousingRow(
        kind=kind,
        serial=value["編號"],
        season=season,
        building_type=building_type,
        district=(parsed.district if usable else district) or district,
        street=(parsed.street or "")[:40] if usable else "",
        lane=(parsed.lane or "") if usable else "",
        alley=(parsed.alley or "") if usable else "",
        number=parsed.number if usable else None,
        number_sub=parsed.number_sub if usable else 0,
        unit_price=price.get("unit_price"),
        monthly_rent=price.get("monthly_rent"),
    )


def unit_price(total: Decimal, parking_total: Decimal, area: Decimal, parking_area: Decimal) -> int | None:
    """扣車位後的單價（元／坪），四捨五入到百元；淨面積不到 10 m² 或淨價不是正的回 None。"""
    net_area, net_total = area - parking_area, total - parking_total
    if net_area < MIN_NET_AREA or net_total <= 0:
        return None
    per_ping = net_total / (net_area / Decimal(str(PING_M2)))
    return int((per_ping / 100).quantize(Decimal(1), rounding=ROUND_HALF_UP)) * 100


def parse_sales(text: str, season: str) -> list[HousingRow]:
    """買賣檔 → 符合 H1 的交易。"""
    rows: list[HousingRow] = []
    for value in _records(text, SALE_REQUIRED, "買賣"):
        if "建物" not in value["交易標的"] or "住" not in value["主要用途"]:
            continue
        building_type = _residential(value["建物型態"])
        buildings = _BUILDINGS.search(value["交易筆棟數"])
        if building_type is None or buildings is None or int(buildings.group(1)) != 1:
            continue
        if any(note in value["備註"] for note in SALE_EXCLUDED_NOTES):
            continue
        price = unit_price(
            _number(value["總價元"]), _number(value["車位總價元"]),
            _number(value["建物移轉總面積平方公尺"]), _number(value["車位移轉總面積平方公尺"]),
        )
        if price is None or _number(value["總價元"]) <= 0 or price > MAX_STORED_VALUE:
            continue
        rows.append(_row("sale", value, season, building_type, unit_price=price))
    return rows


def parse_rents(text: str, season: str) -> list[HousingRow]:
    """租賃檔 → 符合 H2 的交易（整棟(戶)出租）。"""
    rows: list[HousingRow] = []
    for value in _records(text, RENT_REQUIRED, "租賃"):
        if "房屋" not in value["交易標的"] or "住" not in value["主要用途"] or value["出租型態"] != WHOLE_UNIT:
            continue
        building_type = _residential(value["建物型態"])
        if building_type is None or any(note in value["備註"] for note in RENT_EXCLUDED_NOTES):
            continue
        rent = _number(value["總額元"])
        if rent <= 0 or rent > MAX_STORED_VALUE:
            continue
        rows.append(_row("rent", value, season, building_type, monthly_rent=int(rent)))
    return rows


def _data_rows(text: str) -> int:
    return sum(1 for line in text.splitlines()[2:] if line.strip())


def parse_season(sale_text: str, rent_text: str, season: str, *, minimum: int = MIN_SEASON_ROWS) -> HousingBatch:
    """一季的買賣與租賃檔 → HousingBatch；任一種可用筆數少於 minimum 就丟 HousingFormatError（可能是殘缺檔）。"""
    sales, rents = parse_sales(sale_text, season), parse_rents(rent_text, season)
    for label, rows in (("買賣", sales), ("租賃", rents)):
        if len(rows) < minimum:
            raise HousingFormatError(f"{season} {label}可用的只有 {len(rows)} 筆，少於 {minimum} 筆（可能是殘缺檔），不寫入")
    skipped = _data_rows(sale_text) + _data_rows(rent_text) - len(sales) - len(rents)
    return HousingBatch(season=season, sales=sales, rents=rents, skipped=max(skipped, 0))


# ---- 中位數 ----


def median(values: Sequence[int], *, minimum: int = MIN_DEALS) -> int | None:
    """少於 minimum 筆回 None；偶數筆取中間兩筆平均，四捨五入（half-up，不用 Python 的 round）。"""
    if len(values) < minimum:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle] + 1) // 2


# ---- 資料庫 ----


def _values(row: HousingRow, match: matcher.GeoMatch, label: str | None) -> dict:
    return {
        "kind": row.kind, "serial": row.serial, "season": row.season, "building_type": row.building_type,
        "district": _district_of(row.district, match), "street": row.street, "lane": row.lane, "alley": row.alley,
        "number": row.number, "number_sub": row.number_sub, "village": match.village, "match_level": match.match_level,
        "doorplate_version": label if match.match_level != "pending" else None,
        "unit_price": row.unit_price, "monthly_rent": row.monthly_rent,
    }


async def seasons_in_table(db: AsyncSession) -> set[str]:
    return set((await db.execute(select(GeoHousingDeal.season).distinct())).scalars().all())


async def write_season(session_factory: async_sessionmaker[AsyncSession], batch: HousingBatch, *, now: datetime) -> str:
    """寫入一季、刪掉 4 季以外的、更新狀態列（label＝表裡最新的季），同一個交易；回傳表裡最新的季。
    先刪那一季的列，再以 (kind, 編號) upsert：同一個編號已在較新的季就不動，在較舊的季就覆蓋（更正案件出現在後面的批次）。"""
    rows = [*batch.sales, *batch.rents]
    async with session_factory() as db:
        version, label = await matcher.doorplate_state(db)
        await db.execute(delete(GeoHousingDeal).where(GeoHousingDeal.season == batch.season))
        if rows:
            matches = await match_keys(db, (row.key for row in rows), version=version)
            table = GeoHousingDeal.__table__
            for start in range(0, len(rows), 1000):
                chunk = [_values(row, matches[row.key], label) for row in rows[start : start + 1000]]
                stmt = pg_insert(table).values(chunk)
                stmt = stmt.on_conflict_do_update(
                    index_elements=[table.c.kind, table.c.serial],
                    set_={name: stmt.excluded[name] for name in chunk[0] if name not in ("kind", "serial")},
                    where=table.c.season < stmt.excluded.season,
                )
                await db.execute(stmt)
        latest = max(await seasons_in_table(db) | {batch.season})
        # 季別是固定寬度「115S3」，字串比較就是先後。
        await db.execute(delete(GeoHousingDeal).where(GeoHousingDeal.season < shift_season(latest, -(KEEP_SEASONS - 1))))
        status = await db.get(GeoDatasetStatus, "housing", with_for_update=True)
        if status is None:
            status = GeoDatasetStatus(dataset="housing")
            db.add(status)
        status.active_version = latest
        status.label = latest
        status.synced_at = now
        status.last_error = None
        await db.commit()
    return latest


async def rematch(session_factory: async_sessionmaker[AsyncSession], *, keys_per_commit: int = 200) -> int:
    """門牌換版（或之前是 pending）後重比：比對時的門牌月份和使用中的不同的列，依門牌鍵查一次、整批更新。
    門牌還沒匯入時什麼都不做。回傳更新的列數。"""
    async with session_factory() as db:
        version, label = await matcher.doorplate_state(db)
        if version is None:
            return 0
        t = GeoHousingDeal
        stale = t.doorplate_version.is_distinct_from(label)
        key_columns = (t.district, t.street, t.lane, t.alley, t.number, t.number_sub)
        keys: list[Key] = [tuple(row) for row in (await db.execute(select(*key_columns).where(stale).distinct())).all()]
    updated = 0
    for start in range(0, len(keys), keys_per_commit):
        async with session_factory() as db:
            matches = await match_keys(db, keys[start : start + keys_per_commit], version=version)
            for key, match in matches.items():
                conditions = [column.is_not_distinct_from(value) for column, value in zip(key_columns, key)]
                result = await db.execute(
                    update(t)
                    .where(stale, *conditions)
                    .values(
                        district=_district_of(key[0], match), village=match.village, match_level=match.match_level,
                        doorplate_version=label,
                    )
                    .execution_options(synchronize_session=False)
                )
                updated += result.rowcount or 0
            await db.commit()
    return updated


async def deals_by_code(
    db: AsyncSession, codes: Collection[str]
) -> tuple[str | None, list[str], dict[str, tuple[list[int], list[int]]]]:
    """(表裡最新的季, 近 KEEP_SEASONS 季中表裡有的季（舊到新）, 里代碼 → (買賣單價清單, 月租清單))。
    只算比到里（VILLAGE_LEVELS）的列；代碼沒有交易就不在結果裡；還沒匯入是 (None, [], {})。"""
    present = sorted(await seasons_in_table(db))
    if not present:
        return None, [], {}
    latest = present[-1]
    floor = shift_season(latest, -(KEEP_SEASONS - 1))
    seasons = [season for season in present if season >= floor]
    names = boundaries.village_names()
    pairs = [names[code] for code in codes if code in names]
    result: dict[str, tuple[list[int], list[int]]] = defaultdict(lambda: ([], []))
    if pairs:
        stmt = select(GeoHousingDeal.district, GeoHousingDeal.village, GeoHousingDeal.unit_price, GeoHousingDeal.monthly_rent).where(
            GeoHousingDeal.season.in_(seasons),
            GeoHousingDeal.match_level.in_(VILLAGE_LEVELS),
            tuple_(GeoHousingDeal.district, GeoHousingDeal.village).in_(pairs),
        )
        for district, village, price, rent in (await db.execute(stmt)).all():
            code = boundaries.village_code(district, village)
            if code is None:
                continue
            sales, rents = result[code]
            if price is not None:
                sales.append(price)
            if rent is not None:
                rents.append(rent)
    return latest, seasons, dict(result)


def summarize(by_code: dict[str, tuple[list[int], list[int]]], codes: Iterable[str]) -> dict:
    """幾個里代碼的交易合併後算中位數與筆數；少於 MIN_DEALS 筆中位數是 None。"""
    sales: list[int] = []
    rents: list[int] = []
    for code in codes:
        code_sales, code_rents = by_code.get(code, ([], []))
        sales.extend(code_sales)
        rents.extend(code_rents)
    return {
        "sale_median": median(sales), "sale_count": len(sales), "rent_median": median(rents), "rent_count": len(rents),
    }
