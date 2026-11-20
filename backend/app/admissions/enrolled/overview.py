"""五校在籍彙總（2026-11-20 規格 §6.2、§11 第 3 項）：每校清冊概況、同校同格合併的點、各里在籍人數與跨校重疊、
「孩子多、五校都沒有在籍」的里。只回去識別的聚合，不帶班別。"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import opportunity
from app.admissions.enrolled.models import EnrolledRoster, EnrolledStudentPoint
from app.admissions.geo import boundaries, matcher
from app.admissions.geo.models import VILLAGE_LEVELS, GeoVillagePopulation
from app.admissions.geo.projection import haversine_m
from app.campuses.models import Campus

GAP_RADIUS_KM = 6
GAP_LIMIT = 15
DISTANCE_ROUND_M = 100


def _round_distance(meters: float) -> int:
    return int(round(meters / DISTANCE_ROUND_M) * DISTANCE_ROUND_M)


async def _gaps(
    db: AsyncSession, imported: set[str], enrolled_codes: set[str], points: dict[str, matcher.CampusPoint]
) -> tuple[list[dict[str, Any]], str | None]:
    version = (await opportunity.population_status(db))["version"]
    if not imported:
        return [], version
    population = (await db.execute(select(GeoVillagePopulation))).scalars().all()
    if not population:
        return [], version
    located = {key: point for key, point in points.items() if point.lat is not None and point.lng is not None}
    imported_located = [key for key in located if key in imported]
    if not imported_located:
        return [], version
    centroids = boundaries.village_centroids()
    radius_m = GAP_RADIUS_KM * 1000
    rows: list[dict[str, Any]] = []
    for row in population:
        centroid = centroids.get(row.village_code)
        if centroid is None or row.village_code in enrolled_codes:
            continue
        distances = {key: haversine_m(located[key].lat, located[key].lng, *centroid) for key in located}
        if min(distances[key] for key in imported_located) > radius_m:
            continue
        nearest = min(distances, key=lambda key: (distances[key], key))
        if nearest not in imported:
            continue  # 最近的校沒有清冊：那是別校的腹地，不能說沒人
        rows.append(
            {
                "village_code": row.village_code, "district": row.district, "village": row.village,
                "children": opportunity.sum_ages(row, opportunity.AGE_BAND),
                "nearest_campus_key": nearest, "distance_m": _round_distance(distances[nearest]),
            }
        )
    rows.sort(key=lambda item: (-item["children"], item["district"], item["village"]))
    return rows[:GAP_LIMIT], version


async def query_enrolled_overview(db: AsyncSession, campus_keys: list[str]) -> dict[str, Any]:
    rosters = {
        roster.campus_key: roster
        for roster in (await db.execute(select(EnrolledRoster).where(EnrolledRoster.campus_key.in_(campus_keys)))).scalars()
    }
    names = {campus.key: campus.name for campus in (await db.execute(select(Campus))).scalars()}
    all_points = await matcher.campus_points(db)
    rows = (
        await db.execute(select(EnrolledStudentPoint).where(EnrolledStudentPoint.campus_key.in_(list(rosters))))
    ).scalars().all()

    placed = {key: 0 for key in rosters}
    cells: dict[tuple[str, float, float], int] = {}
    villages: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.lat is not None and row.lng is not None:
            placed[row.campus_key] += 1
            cell = (row.campus_key, float(row.lat), float(row.lng))
            cells[cell] = cells.get(cell, 0) + 1
        if row.match_level in VILLAGE_LEVELS and row.district and row.village:
            code = boundaries.village_code(row.district, row.village)
            if code is not None:
                entry = villages.setdefault(
                    code, {"village_code": code, "district": row.district, "village": row.village, "counts": {}, "total": 0}
                )
                entry["counts"][row.campus_key] = entry["counts"].get(row.campus_key, 0) + 1
                entry["total"] += 1

    campuses = []
    for key in campus_keys:
        roster, point = rosters.get(key), all_points.get(key)
        campuses.append(
            {
                "key": key, "name": names.get(key, key), "imported": roster is not None,
                "roster_date": roster.roster_date if roster else None,
                "total": roster.total if roster else 0, "placed": placed.get(key, 0),
                "lat": point.lat if point else None, "lng": point.lng if point else None,
            }
        )
    village_rows = sorted(villages.values(), key=lambda item: (-item["total"], item["district"], item["village"]))
    gaps, version = await _gaps(db, set(rosters), set(villages), all_points)
    return {
        "campuses": campuses,
        "points": [
            {"lat": lat, "lng": lng, "campus_key": key, "count": count}
            for (key, lat, lng), count in sorted(cells.items(), key=lambda item: (campus_keys.index(item[0][0]), item[0][1], item[0][2]))
        ],
        "villages": village_rows,
        "overlap": [item for item in village_rows if sum(1 for n in item["counts"].values() if n > 0) >= 2],
        "gaps": gaps,
        "population_version": version,
        "gap_radius_km": GAP_RADIUS_KM,
    }
