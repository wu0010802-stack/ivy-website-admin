"""各里每年九月底的 0–6 歲人口（內政部戶政司 ODRP014，docs/specs/2026-10-20-admissions-potential-share-design.md §3.2）。

市佔率的分母要「該學年九月底 3 公里內 2–5 歲」，geo_village_ages 只留 25 個月，所以九月另存一張
geo_village_ages_september：一年一批、不刪舊年，year 是民國年（115＝115-09 的統計）。
這裡只管月份判斷與資料表讀寫；檔案匯入與正常同步的接線在 sync.py。這條路不寫 geo_village_population
與 geo_village_ages，不影響使用中的人口月份。"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.models import GeoVillageAgesSeptember
from app.admissions.geo.population import PopulationRow

SEPTEMBER_SUFFIX = "-09"
# ODRP014 最早的資料是 107-01（104–106 回「查無資料」，2026-10-20 實測），所以九月底人口從 107 年開始。
FIRST_YEAR = 107


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


async def upsert_september(db: AsyncSession, year: int, rows: Iterable[PopulationRow]) -> int:
    """那一年整批換新（不 commit）：先刪該年所有列再寫入，不會留下上一次多出來的里；其他年份不動。回傳寫入的列數。"""
    values = [{"year": year, **asdict(row)} for row in rows]
    await db.execute(delete(GeoVillageAgesSeptember).where(GeoVillageAgesSeptember.year == year))
    if values:
        await db.execute(insert(GeoVillageAgesSeptember), values)
    return len(values)


async def september_years(db: AsyncSession) -> list[int]:
    """表裡有的民國年，小到大。"""
    return list((await db.execute(select(GeoVillageAgesSeptember.year).distinct().order_by(GeoVillageAgesSeptember.year))).scalars())
