"""區域分析歷年 2–5 歲人口（docs/specs/2026-11-16-area-compare-notices-design.md §5）：
/admin/admissions/area/children-history。

只讀：不 flush、不 commit、不寫稽核。只有里層級的公開人口資料。

- 範圍內的里＝里界面積重心在本校半徑內（同招生機會）。
- 各年＝geo_village_ages_september 的九月底人口；「最新」沿用招生機會的 geo_village_population。
- 某里在某年沒有資料（例如 115-07 新設的里）是 null，不當成 0。
- 九月表有、現行里界檔沒有的代碼（115-07 廢止的里）畫不出來，只列「和範圍內的里同一區」的（代碼前 7 碼）。
- adjusted：行政區域調整人數過里的變化 V5 門檻（≥ 20 人且 ≥ 該里人口 1%）的月份。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import opportunity, trends
from app.admissions.area import campus_out
from app.admissions.geo import boundaries
from app.admissions.geo.models import GeoVillageAgesSeptember, GeoVillageMigration, GeoVillagePopulation
from app.admissions.geo.projection import haversine_m

DISTRICT_PREFIX_LEN = 7


def _empty(campus: dict[str, Any], radius_km: int, latest: dict[str, Any] | None, unavailable: str | None) -> dict[str, Any]:
    return {
        "campus": campus,
        "radius_km": radius_km,
        "unavailable": unavailable,
        "latest": latest,
        "years": [],
        "villages": [],
        "retired": [],
        "max_children": 0,
    }


async def _adjusted_months(db: AsyncSession, codes: set[str], people: dict[str, int]) -> dict[str, list[str]]:
    m = GeoVillageMigration
    moved = func.greatest(m.boundary_in, m.boundary_out)
    rows = await db.execute(
        select(m.village_code, m.month, moved)
        .where(m.village_code.in_(codes), moved >= trends.BOUNDARY_MIN_PEOPLE)
        .order_by(m.village_code, m.month)
    )
    result: dict[str, list[str]] = {}
    for code, month, count in rows.all():
        if count >= trends.BOUNDARY_SHARE * people.get(code, 0):
            result.setdefault(code, []).append(month)
    return result


async def query_children_history(db: AsyncSession, campus_key: str, *, radius_km: int) -> dict[str, Any]:
    campus = await campus_out(db, campus_key)
    status = await opportunity.population_status(db)
    latest = {"label": status["version"], "synced_at": status["synced_at"]} if status["version"] is not None else None
    if campus["lat"] is None or campus["lng"] is None:
        return _empty(campus, radius_km, latest, "no_campus_point")

    radius_m = radius_km * 1000
    near: dict[str, int] = {}
    for code, point in boundaries.village_centroids().items():
        distance = haversine_m(campus["lat"], campus["lng"], *point)
        if distance <= radius_m:
            near[code] = opportunity._round_distance(distance)
    names = boundaries.village_names()
    prefixes = {code[:DISTRICT_PREFIX_LEN] for code in near}

    september = GeoVillageAgesSeptember
    rows = (
        await db.execute(
            select(september).where(
                september.village_code.in_(near.keys())
                | (func.substr(september.village_code, 1, DISTRICT_PREFIX_LEN).in_(prefixes) & september.village_code.not_in(names.keys()))
            )
        )
    ).scalars().all()
    # 年份取整張九月表（不是只看範圍內），這樣範圍內某年缺資料時滑桿仍有那一格，該里畫「沒有資料」。
    years = sorted((await db.execute(select(september.year).distinct())).scalars().all())
    if not years:
        return _empty(campus, radius_km, latest, "no_history")

    by_code: dict[str, dict[int, int]] = {}
    retired_rows: dict[str, GeoVillageAgesSeptember] = {}
    retired_years: dict[str, list[int]] = {}
    for row in rows:
        total = opportunity._sum_ages(row, opportunity.AGE_BAND)
        if row.village_code in near:
            by_code.setdefault(row.village_code, {})[row.year] = total
        else:
            retired_rows.setdefault(row.village_code, row)
            retired_years.setdefault(row.village_code, []).append(row.year)

    population = {
        row.village_code: row
        for row in (
            await db.execute(select(GeoVillagePopulation).where(GeoVillagePopulation.village_code.in_(near.keys())))
        ).scalars()
    }
    adjusted = await _adjusted_months(db, set(near), {code: row.people_total for code, row in population.items()})

    villages = []
    max_children = 0
    for code, distance in near.items():
        counts: dict[str, int | None] = {str(year): by_code.get(code, {}).get(year) for year in years}
        counts["latest"] = opportunity._sum_ages(population[code], opportunity.AGE_BAND) if code in population else None
        if all(value is None for value in counts.values()):
            continue
        max_children = max(max_children, *(value for value in counts.values() if value is not None))
        district, village = names[code]
        villages.append(
            {
                "village_code": code,
                "district": district,
                "village": village,
                "distance_m": distance,
                "counts": counts,
                "adjusted": adjusted.get(code, []),
            }
        )
    villages.sort(key=lambda item: (item["distance_m"], item["district"], item["village"]))
    retired = sorted(
        (
            {
                "village_code": code,
                "district": row.district,
                "village": row.village,
                "years": sorted(retired_years[code]),
            }
            for code, row in retired_rows.items()
        ),
        key=lambda item: (item["district"], item["village"], item["village_code"]),
    )
    return {
        "campus": campus,
        "radius_km": radius_km,
        "unavailable": None,
        "latest": latest,
        "years": years,
        "villages": villages,
        "retired": retired,
        "max_children": max_children,
    }
