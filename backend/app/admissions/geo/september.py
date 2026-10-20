"""各里每年九月底的 0–6 歲人口（內政部戶政司 ODRP014，docs/specs/2026-10-20-admissions-potential-share-design.md §3.2）。

市佔率的分母要「該學年九月底 3 公里內 2–5 歲」，geo_village_ages 只留 25 個月，所以九月另存一張
geo_village_ages_september：一年一批、不刪舊年，year 是民國年（115＝115-09 的統計）。
這裡只管月份判斷、換碼與資料表讀寫；檔案匯入與正常同步的接線在 sync.py。這條路不寫 geo_village_population
與 geo_village_ages，不影響使用中的人口月份。

寫入前舊代碼換成現行里界檔的代碼：109 年以前三民、鳳山在 ODRP014 分成「三民一／三民二／鳳山一／鳳山二」，
162 個里的代碼（例如 64000051046）和現行的（64000050xxx）不同，不換就對不上里界重心。"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import asdict, dataclass, replace

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo import boundaries
from app.admissions.geo.models import GeoVillageAges, GeoVillageAgesSeptember
from app.admissions.geo.population import PopulationRow

logger = logging.getLogger(__name__)

SEPTEMBER_SUFFIX = "-09"
# ODRP014 最早的資料是 107-01（104–106 回「查無資料」，2026-10-20 實測），所以九月底人口從 107 年開始。
FIRST_YEAR = 107
# 里代碼前 7 碼是區（分區代碼只差第 8 碼：三民區 6400005，舊的三民一 64000051、三民二 64000052）。
DISTRICT_PREFIX = 7
_COUNT_FIELDS = tuple(f"age_{age}" for age in range(7)) + ("people_total",)

_Index = dict[tuple[str, str], list[str]]


def is_september(label: str) -> bool:
    """「115-09」是九月底的統計；label 是 population.label_of 的結果。"""
    return label.endswith(SEPTEMBER_SUFFIX)


def year_of(label: str) -> int:
    """「115-09」→ 115。"""
    return int(label[:3])


def september_months(latest: str) -> list[str]:
    """打包要抓的九月：從 FIRST_YEAR 的九月到 latest（人口最新月份，「11509」）以前最後一個九月，舊到新，
    回傳 API 網址上的民國年月（「10709」）。latest 是十月以後算當年九月、八月以前算前一年九月；
    latest 還沒到 FIRST_YEAR 的九月就是空的。"""
    year, month = int(latest[:3]), int(latest[3:])
    last = year if month >= 9 else year - 1
    return [f"{y:03d}09" for y in range(FIRST_YEAR, last + 1)]


# ---- 換碼 ----


def _index() -> _Index:
    """(代碼前 7 碼, 里名) → 現行里界檔的代碼們（正常只有一個；有兩個以上就是不唯一，不換）。"""
    index: _Index = {}
    for code, (_, village) in boundaries.village_names().items():
        index.setdefault((code[:DISTRICT_PREFIX], village), []).append(code)
    return index


def _lookup(raw_code: str, village: str, known: frozenset[str], index: _Index) -> str | None:
    if raw_code in known:
        return raw_code
    candidates = index.get((raw_code[:DISTRICT_PREFIX], village), [])
    return candidates[0] if len(candidates) == 1 else None


def current_code(raw_code: str, village: str) -> str | None:
    """來源的里代碼對到現行里界檔的代碼：本來就在里界檔裡 → 原樣；不在就用「代碼前 7 碼＋里名」找唯一的現行代碼；
    找不到或不唯一回 None（呼叫端照原代碼存）。"""
    return _lookup(raw_code, village, boundaries.village_codes(), _index())


@dataclass(frozen=True)
class Normalized:
    """換碼的結果。remapped＝換成現行代碼的列數；merged＝換碼後撞到同一個代碼、被加總進別列的列數
    （輸出比輸入少的列數）；unmatched＝換不到、照原代碼存的列數（例如 115-07 廢止的里）。"""

    rows: list[PopulationRow]
    remapped: int = 0
    merged: int = 0
    unmatched: int = 0


def normalize(rows: Iterable[PopulationRow]) -> Normalized:
    """舊代碼換成現行代碼；同一個現行代碼出現多列就把人數加總成一列；換過的列 district／village 改寫成里界檔的名稱。"""
    known, index, names = boundaries.village_codes(), _index(), boundaries.village_names()
    grouped: dict[str, PopulationRow] = {}
    renamed: set[str] = set()
    remapped = merged = unmatched = 0
    for row in rows:
        code = _lookup(row.village_code, row.village, known, index)
        if code is None:
            unmatched += 1
            code = row.village_code
        elif code != row.village_code:
            remapped += 1
            renamed.add(code)
            row = replace(row, village_code=code)
        kept = grouped.get(code)
        if kept is None:
            grouped[code] = row
        else:
            merged += 1
            grouped[code] = replace(kept, **{field: getattr(kept, field) + getattr(row, field) for field in _COUNT_FIELDS})
    for code in renamed:
        district, village = names[code]
        grouped[code] = replace(grouped[code], district=district[:8], village=village[:16])
    return Normalized(list(grouped.values()), remapped, merged, unmatched)


# ---- 資料庫 ----


async def upsert_september(db: AsyncSession, year: int, rows: Iterable[PopulationRow]) -> int:
    """那一年整批換新（不 commit）：舊代碼先換成現行代碼（normalize），再刪該年所有列後寫入，不會留下上一次
    多出來的里；其他年份不動。回傳寫入的列數（換碼後撞到同一里加總的列不另計）。"""
    result = normalize(rows)
    values = [{"year": year, **asdict(row)} for row in result.rows]
    await db.execute(delete(GeoVillageAgesSeptember).where(GeoVillageAgesSeptember.year == year))
    if values:
        await db.execute(insert(GeoVillageAgesSeptember), values)
    if result.remapped or result.merged or result.unmatched:
        logger.info(
            "九月底人口 %s 年：%s 列換成現行里代碼，%s 列併入同一里，%s 列對不到現行里界、照原代碼存",
            year, result.remapped, result.merged, result.unmatched,
        )
    return len(values)


async def september_years(db: AsyncSession) -> list[int]:
    """表裡有的民國年，小到大。"""
    return list((await db.execute(select(GeoVillageAgesSeptember.year).distinct().order_by(GeoVillageAgesSeptember.year))).scalars())


async def backfill_from_ages(db: AsyncSession) -> list[int]:
    """年齡歷史（geo_village_ages）裡九月的月份，九月表還沒有那一年的就補進去（不 commit，同樣換碼）；回傳補的民國年。
    九月只有被同步到的那一輪會直接寫入，同步間隔 30 天可能跳過九月，或九月已經是使用中的月份而不再寫入，
    所以每次寫完年齡歷史（prune 之前）就檢查一次。已經有的年份不動。"""
    present = set(await september_years(db))
    months = (
        await db.execute(select(GeoVillageAges.month).distinct().where(GeoVillageAges.month.like(f"%{SEPTEMBER_SUFFIX}")))
    ).scalars().all()
    filled: list[int] = []
    for month in sorted(months):
        year = year_of(month)
        if year in present:
            continue
        ages = (await db.execute(select(GeoVillageAges).where(GeoVillageAges.month == month))).scalars().all()
        rows = [
            PopulationRow(
                village_code=age.village_code, district=age.district, village=age.village,
                **{field: getattr(age, field) for field in _COUNT_FIELDS},
            )
            for age in ages
        ]
        await upsert_september(db, year, rows)
        filled.append(year)
    return filled
