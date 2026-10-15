"""在籍學生分布查詢（2026-10-15 規格 §5）：只回去識別的聚合——取整座標合併的點、各班人數、沒有點的原因、
距離帶、各里人數。距離用目前的本校座標即時算、取整 100 m（規格 E10）。"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.area import DISTANCE_BANDS, distance_band
from app.admissions.enrolled.models import ENROLLED_GRADES, EnrolledRoster, EnrolledStudentPoint
from app.admissions.geo import boundaries, matcher
from app.admissions.geo.models import VILLAGE_LEVELS
from app.admissions.geo.projection import haversine_m

UNPLACED_ORDER = ("street", "district", "outside_kaohsiung", "unlocated")


def _zero() -> dict[str, int]:
    return {grade: 0 for grade in ENROLLED_GRADES}


def _unplaced_reason(level: str, reason: str | None) -> str:
    if level in ("street", "district"):
        return level
    return "outside_kaohsiung" if reason == "outside_kaohsiung" else "unlocated"


def _empty() -> dict[str, Any]:
    return {
        "status": "not_imported", "roster_date": None, "school_year": None, "doorplate_version": None,
        "imported_at": None, "total": 0, "grades": [], "points": [], "unplaced": [], "distance_bands": [], "villages": [],
    }


async def query_enrolled(db: AsyncSession, campus_key: str) -> dict[str, Any]:
    roster = await db.get(EnrolledRoster, campus_key)
    if roster is None:
        return _empty()
    rows = (
        await db.execute(select(EnrolledStudentPoint).where(EnrolledStudentPoint.campus_key == campus_key))
    ).scalars().all()
    campus = await matcher.campus_point(db, campus_key)
    located = campus.lat is not None and campus.lng is not None

    totals, placed = _zero(), _zero()
    cells: dict[tuple[float, float], dict[str, int]] = {}
    unplaced: dict[str, dict[str, int]] = {reason: _zero() for reason in UNPLACED_ORDER}
    bands: dict[str, dict[str, int]] = {band: _zero() for band in DISTANCE_BANDS}
    villages: dict[tuple[str, str], dict[str, int]] = {}
    for row in rows:
        totals[row.grade] += 1
        point = (float(row.lat), float(row.lng)) if row.lat is not None and row.lng is not None else None
        distance: int | None = None
        if point is None:
            unplaced[_unplaced_reason(row.match_level, row.unlocated_reason)][row.grade] += 1
        else:
            placed[row.grade] += 1
            cells.setdefault(point, _zero())[row.grade] += 1
            if located:
                distance = int(round(haversine_m(campus.lat, campus.lng, point[0], point[1]) / 100.0)) * 100
        bands[distance_band(distance)][row.grade] += 1
        if row.match_level in VILLAGE_LEVELS and row.district and row.village:
            villages.setdefault((row.district, row.village), _zero())[row.grade] += 1

    village_rows = [
        {
            "district": district, "village": village, "village_code": boundaries.village_code(district, village),
            "counts": counts, "total": sum(counts.values()),
        }
        for (district, village), counts in villages.items()
    ]
    village_rows.sort(key=lambda item: (-item["total"], item["district"], item["village"]))
    return {
        "status": "ready",
        "roster_date": roster.roster_date,
        "school_year": roster.school_year,
        "doorplate_version": roster.doorplate_version,
        "imported_at": roster.imported_at,
        "total": roster.total,
        "grades": [
            {"grade": grade, "total": totals[grade], "placed": placed[grade]}
            for grade in ENROLLED_GRADES
            if grade != "其他" or totals[grade] > 0
        ],
        "points": [{"lat": lat, "lng": lng, "counts": counts} for (lat, lng), counts in sorted(cells.items())],
        "unplaced": [
            {"reason": reason, "counts": unplaced[reason]} for reason in UNPLACED_ORDER if sum(unplaced[reason].values())
        ],
        "distance_bands": [{"band": band, "counts": bands[band]} for band in DISTANCE_BANDS],
        "villages": village_rows,
    }
