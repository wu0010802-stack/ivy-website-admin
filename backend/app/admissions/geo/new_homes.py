"""新成屋交屋（內政部「不動產成交案件實際資訊」季檔，高雄市買賣 e_lvr_land_a.csv；
docs/specs/2026-10-14-admissions-village-trends-design.md §2.2、§3.2、§4.3、V7、V8，B 段）。

這裡只管季別運算、網址、解析與篩選、寫入與重比；找最新季、下載、回補與排程在 sync.py。

- 季別依**登記日**切：S1 12/11～3/10、S2 3/11～6/10、S3 6/11～9/10、S4 9/11～12/10。季別或檔名不存在時來源仍回
  HTTP 200，內容是一小段 HTML「系統訊息」頁：開頭不是（BOM＋）「鄉鎮市區」表頭的回應都當成這一季還沒出。
- 檔案：UTF-8 帶 BOM、CRLF、兩列表頭（中、英）、33 欄。
- 新成屋（V7）：交易標的含建物、主要用途含「住」、建築完成年月（7 碼民國年月日，以年月算）在該季登記期間迄日的
  月份往前 12 個月內（含；115S3 迄日 9/10 → 114 年 9 月到 115 年 9 月完工），含預售屋交屋（備註「預售屋、或土地及建物分件登記案件」：交易日是幾年前的簽約日，但完工、過戶在這一季）。
- 地址用 address.parse_address；「…號等１８５戶共用部分」這種沒有市、區的地址，用「鄉鎮市區」欄補上再解析。比對沿用
  matcher.locate_parsed（exact → nearby → street → district），門牌尚未匯入時 pending；門牌換版後整表重比。
- 只存門牌鍵與比對結果、季別、完工日、建物型態；不存地址原文、樓層、價格、面積、建案名稱（規格 §8）。"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.geo import matcher
from app.admissions.geo.address import ParsedAddress, parse_address
from app.admissions.geo.models import VILLAGE_LEVELS, GeoDatasetStatus, GeoNewHomeSale

PLVR_ROOT = "https://plvr.land.moi.gov.tw/DownloadSeason"
FILE_NAME = "e_lvr_land_a.csv"
KEEP_SEASONS = 8
# 一季符合 V7 的筆數下限（115S2 2,892、115S3 3,805）：太少多半是殘缺檔，不寫。
MIN_ROWS = 100
COMPLETED_WITHIN_MONTHS = 12
PRESALE_NOTE = "預售屋、或土地及建物分件登記"
SOURCE_NOTE = "資料來源：內政部不動產交易實價查詢服務網"
REQUIRED = ("鄉鎮市區", "交易標的", "土地位置建物門牌", "建物型態", "主要用途", "建築完成年月", "備註", "編號")
_SEASON = re.compile(r"([0-9]{3})S([1-4])")
_SEASON_IN_NAME = re.compile(r"(?<![0-9])([0-9]{3}S[1-4])(?![0-9])", re.IGNORECASE)
_ROC_DATE = re.compile(r"([0-9]{3})([0-9]{2})([0-9]{2})")
# 各季登記期間的迄日（月, 日）；起日是前一季迄日的隔天。
SEASON_END = {1: (3, 10), 2: (6, 10), 3: (9, 10), 4: (12, 10)}

Key = tuple[str, str, str, str, int | None, int]  # (區, 街路段, 巷, 弄, 號, 之號)


class NewHomesFormatError(ValueError):
    """季檔的格式或內容不對；訊息會寫進 geo_dataset_status.last_error，不含檔案內容。"""


@dataclass(frozen=True)
class NewHomeRow:
    serial: str
    season: str
    completed_on: date
    presale: bool
    building_type: str
    district: str
    street: str
    lane: str
    alley: str
    number: int | None
    number_sub: int

    @property
    def key(self) -> Key:
        return (self.district, self.street, self.lane, self.alley, self.number, self.number_sub)


@dataclass
class NewHomesBatch:
    """一季符合 V7 的交易。total 是檔案的資料列數。"""

    season: str
    rows: list[NewHomeRow] = field(default_factory=list)
    total: int = 0


# ---- 季別 ----


def parse_season(text: str) -> str:
    matched = _SEASON.fullmatch(text.strip().upper())
    if matched is None:
        raise NewHomesFormatError("季別格式不對（例：115S3）")
    return matched.group(0)


def season_of_filename(name: str) -> str | None:
    """「115S3_e_lvr_land_a.csv」→「115S3」；取不到回 None（CLI 要另給 --new-homes-season）。"""
    matched = _SEASON_IN_NAME.search(name)
    return matched.group(1).upper() if matched else None


def shift_season(season: str, count: int) -> str:
    matched = _SEASON.fullmatch(season)
    if matched is None:
        raise NewHomesFormatError("季別格式不對（例：115S3）")
    index = int(matched.group(1)) * 4 + int(matched.group(2)) - 1 + count
    return f"{index // 4:03d}S{index % 4 + 1}"


def window(latest: str, count: int = KEEP_SEASONS) -> list[str]:
    """latest 往回 count 季（含 latest），舊到新。"""
    return [shift_season(latest, offset) for offset in range(-(count - 1), 1)]


def season_end(season: str) -> date:
    """登記期間迄日（S3 是 9/10）。"""
    year, quarter = int(season[:3]) + 1911, int(season[-1])
    month, day = SEASON_END[quarter]
    return date(year, month, day)


def season_of_day(day: date) -> str:
    """那一天的登記落在哪一季（12/11 以後算下一年的 S1）。"""
    roc = day.year - 1911
    for quarter in (1, 2, 3, 4):
        month, end_day = SEASON_END[quarter]
        if (day.month, day.day) <= (month, end_day):
            return f"{roc:03d}S{quarter}"
    return f"{roc + 1:03d}S1"


def season_url(season: str) -> str:
    return f"{PLVR_ROOT}?season={season}&fileName={FILE_NAME}"


# ---- 解析 ----


def decode(body: bytes) -> str | None:
    """下載或檔案的位元組 → 文字；不是季檔（錯誤頁、HTML）回 None。"""
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return text if text.lstrip("\ufeff").startswith("鄉鎮市區") else None


def completed_date(text: str) -> date | None:
    """建築完成年月「1150301」→ 2026-03-01；空白、格式不對、日期不存在回 None。"""
    matched = _ROC_DATE.fullmatch(text.strip())
    if matched is None:
        return None
    try:
        return date(int(matched.group(1)) + 1911, int(matched.group(2)), int(matched.group(3)))
    except ValueError:
        return None


def months_before_end(completed: date, season: str) -> int:
    """建築完成年月到該季登記期間迄日差幾個月（以年月算，同一個月是 0；完工在迄日之後的月份是負數）。"""
    end = season_end(season)
    return (end.year * 12 + end.month) - (completed.year * 12 + completed.month)


def _address(raw: str, district: str) -> ParsedAddress | None:
    parsed = parse_address(raw)
    if parsed is not None and parsed.district is None and not parsed.outside_kaohsiung and district:
        # 「…號等１８５戶共用部分」這種沒有市、區的寫法：用「鄉鎮市區」欄補上。
        parsed = parse_address(f"高雄市{district}{raw}")
    return parsed


def parse_csv(text: str, season: str, *, minimum: int | None = None) -> NewHomesBatch:
    """解析一季的檔案並篩出新成屋（V7）。表頭缺欄、編號空白或重複、符合的筆數少於下限都丟 NewHomesFormatError。"""
    reader = csv.reader(io.StringIO(text.lstrip("\ufeff")))
    try:
        header = [cell.strip() for cell in next(reader)]
    except (StopIteration, csv.Error) as exc:
        raise NewHomesFormatError("新成屋季檔是空的或不是 CSV") from exc
    missing = [name for name in REQUIRED if name not in header]
    if missing:
        raise NewHomesFormatError(f"新成屋季檔缺欄位：{'、'.join(missing)}")
    index = {name: header.index(name) for name in REQUIRED}
    batch = NewHomesBatch(season=season)
    seen: set[str] = set()
    try:
        for cells in reader:
            if not cells or (cells[0].startswith("The ") and batch.total == 0):
                continue  # 第二列英文表頭
            if len(cells) < len(header):
                cells = [*cells, *[""] * (len(header) - len(cells))]
            batch.total += 1
            value = {name: cells[position].strip() for name, position in index.items()}
            serial = value["編號"]
            if not serial or len(serial) > 40:
                raise NewHomesFormatError("新成屋季檔有編號空白或過長的列")
            if serial in seen:
                raise NewHomesFormatError("新成屋季檔有重複的編號")
            seen.add(serial)
            if "建物" not in value["交易標的"] or "住" not in value["主要用途"]:
                continue
            completed = completed_date(value["建築完成年月"])
            if completed is None or not 0 <= months_before_end(completed, season) <= COMPLETED_WITHIN_MONTHS:
                continue
            district = value["鄉鎮市區"][:8]
            parsed = _address(value["土地位置建物門牌"], district)
            usable = parsed is not None and not parsed.outside_kaohsiung and parsed.district is not None
            batch.rows.append(
                NewHomeRow(
                    serial=serial,
                    season=season,
                    completed_on=completed,
                    presale=PRESALE_NOTE in value["備註"],
                    building_type=re.split(r"[(（]", value["建物型態"])[0][:16],
                    district=(parsed.district if usable else district) or district,
                    street=(parsed.street or "")[:40] if usable else "",
                    lane=(parsed.lane or "") if usable else "",
                    alley=(parsed.alley or "") if usable else "",
                    number=parsed.number if usable else None,
                    number_sub=parsed.number_sub if usable else 0,
                )
            )
    except csv.Error as exc:
        raise NewHomesFormatError("新成屋季檔不是正確的 CSV") from exc
    floor = MIN_ROWS if minimum is None else minimum
    if len(batch.rows) < floor:
        raise NewHomesFormatError(f"{season} 符合新成屋的只有 {len(batch.rows)} 筆，少於 {floor} 筆（可能是殘缺檔），不寫入")
    return batch


# ---- 比對 ----


def _parsed(key: Key) -> ParsedAddress:
    district, street, lane, alley, number, number_sub = key
    return ParsedAddress(district, street or None, lane or None, alley or None, number, number_sub, False)


async def match_keys(db: AsyncSession, keys: Iterable[Key], *, version: str | None) -> dict[Key, matcher.GeoMatch]:
    """門牌鍵 → 比對結果（同一個鍵只查一次；一季約 500–700 個）。沒有街路段的只到區。"""
    result: dict[Key, matcher.GeoMatch] = {}
    for key in keys:
        if key in result:
            continue
        if not key[1]:
            result[key] = matcher.GeoMatch(key[0], None, "district" if version else "pending", None, None, None)
            continue
        result[key] = await matcher.locate_parsed(db, _parsed(key), version=version)
    return result


def _district_of(stated: str, match: matcher.GeoMatch) -> str:
    """表裡存的區：到里的列用門牌表登記的區（跨區界道，實價登錄寫苓雅區、門牌表登在新興區，里屬於新興區；
    (區, 里) 才對得到里界），其餘維持實價登錄寫的區。重比時表裡的區就是門牌鍵的區，換版後仍會再比一次。"""
    return match.district if match.match_level in VILLAGE_LEVELS and match.district else stated


def _values(row: NewHomeRow, match: matcher.GeoMatch, label: str | None) -> dict:
    return {
        "serial": row.serial, "season": row.season, "completed_on": row.completed_on, "presale": row.presale,
        "building_type": row.building_type, "district": _district_of(row.district, match), "street": row.street, "lane": row.lane,
        "alley": row.alley, "number": row.number, "number_sub": row.number_sub,
        "village": match.village, "match_level": match.match_level,
        "doorplate_version": label if match.match_level != "pending" else None,
    }


# ---- 資料庫 ----


async def replace_season(db: AsyncSession, batch: NewHomesBatch, *, version: str | None, label: str | None) -> int:
    """寫入一季（不 commit）：先刪那一季的列，再以編號 upsert——同一個編號已在**較新**的季就不動，在較舊的季就覆蓋
    （更正出現在後面的批次）。回傳這一季寫入的筆數。"""
    await db.execute(delete(GeoNewHomeSale).where(GeoNewHomeSale.season == batch.season))
    if not batch.rows:
        return 0
    matches = await match_keys(db, (row.key for row in batch.rows), version=version)
    table = GeoNewHomeSale.__table__
    written = 0
    for start in range(0, len(batch.rows), 1000):
        chunk = [_values(row, matches[row.key], label) for row in batch.rows[start : start + 1000]]
        stmt = pg_insert(table).values(chunk)
        stmt = stmt.on_conflict_do_update(
            index_elements=[table.c.serial],
            set_={name: stmt.excluded[name] for name in chunk[0] if name != "serial"},
            where=table.c.season < stmt.excluded.season,
        )
        written += (await db.execute(stmt)).rowcount or 0
    return written


async def seasons_in_table(db: AsyncSession) -> set[str]:
    return set((await db.execute(select(GeoNewHomeSale.season).distinct())).scalars().all())


async def prune(db: AsyncSession, latest: str) -> None:
    """只留 latest 往回 KEEP_SEASONS 季（不 commit）。季別是固定寬度「115S3」，字串比較就是先後。"""
    await db.execute(delete(GeoNewHomeSale).where(GeoNewHomeSale.season < shift_season(latest, -(KEEP_SEASONS - 1))))


async def write_season(
    session_factory: async_sessionmaker[AsyncSession], batch: NewHomesBatch, *, now: datetime
) -> str:
    """寫入一季、刪掉 8 季以外的、更新狀態列（label＝表裡最新的季），同一個交易；回傳表裡最新的季。"""
    async with session_factory() as db:
        version, label = await matcher.doorplate_state(db)
        await replace_season(db, batch, version=version, label=label)
        latest = max(await seasons_in_table(db) | {batch.season})
        await prune(db, latest)
        status = await db.get(GeoDatasetStatus, "new_homes", with_for_update=True)
        if status is None:
            status = GeoDatasetStatus(dataset="new_homes")
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
        t = GeoNewHomeSale
        stale = t.doorplate_version.is_distinct_from(label)
        key_columns = (t.district, t.street, t.lane, t.alley, t.number, t.number_sub)
        keys: list[Key] = [tuple(row) for row in (await db.execute(select(*key_columns).where(stale).distinct())).all()]
    updated = 0
    for start in range(0, len(keys), keys_per_commit):
        async with session_factory() as db:
            chunk = keys[start : start + keys_per_commit]
            matches = await match_keys(db, chunk, version=version)
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

