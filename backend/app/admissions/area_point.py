"""任意點評估（docs/specs/2026-11-20-area-point-overlay-housing-design.md §5）：/admin/admissions/area/point。

只讀：不 flush、不 commit、不寫稽核。「這一點」與「本校」兩欄走同一條 point_row：六支查詢都用 center 參數，
欄位由 area_compare.derive_fields 換出（和五校比較表同一份程式），再加房價、預售、在籍計數。
每一欄包在 savepoint 裡，某一欄的 SQL 出錯，那一欄 unavailable="error"，另一欄照常。"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import area, opportunity, peer_fees, presale_area, trends
from app.admissions.area_compare import FEE_AGE, derive_fields
from app.admissions.enrolled.models import EnrolledRoster, EnrolledStudentPoint
from app.admissions.geo import boundaries, matcher
from app.admissions.geo import housing as housing_io
from app.admissions.geo.projection import haversine_m
from app.campuses.models import CAMPUS_KEYS

logger = logging.getLogger(__name__)

POINT_DECIMALS = 4
_NUMBER_KEYS = (
    "children", "infants", "kids_net", "kids_unavailable", "kindergartens", "babycare", "fee_median",
    "presale_households", "changes_12m", "housing",
)
# 緯度 1 度約 111 km；在籍點先用方框粗篩（SQL）再用 haversine 精算，圈外的點不必全讀進來。
_KM_PER_DEGREE = 111.0


def _blank(unavailable: str, locate_error: str | None) -> dict[str, Any]:
    return {"unavailable": unavailable, "locate_error": locate_error, **dict.fromkeys(_NUMBER_KEYS), "enrolled": []}


def _near_codes(center: dict[str, Any], radius_km: int) -> list[str]:
    """里界重心在半徑內的里代碼（同 trends 的 near）。"""
    radius_m = radius_km * 1000
    return [
        code for code, point in boundaries.village_centroids().items()
        if haversine_m(center["lat"], center["lng"], *point) <= radius_m
    ]


async def _housing(db: AsyncSession, center: dict[str, Any], radius_km: int) -> dict[str, Any] | None:
    codes = _near_codes(center, radius_km)
    latest, _, by_code = await housing_io.deals_by_code(db, codes)
    return None if latest is None else housing_io.summarize(by_code, codes)


async def _enrolled(db: AsyncSession, center: dict[str, Any], radius_km: int) -> list[dict[str, Any]]:
    """半徑內各校在籍人數：只列有清冊的校（count 可為 0），順序同 CAMPUS_KEYS。圈內的算法同在籍學生分頁的距離分組。"""
    imported = set((await db.execute(select(EnrolledRoster.campus_key))).scalars())
    if not imported:
        return []
    lat_span = radius_km / _KM_PER_DEGREE * 1.2
    lng_span = lat_span / max(0.2, abs(math.cos(math.radians(center["lat"]))))
    stmt = select(EnrolledStudentPoint.campus_key, EnrolledStudentPoint.lat, EnrolledStudentPoint.lng).where(
        EnrolledStudentPoint.lat.is_not(None),
        EnrolledStudentPoint.lat.between(center["lat"] - lat_span, center["lat"] + lat_span),
        EnrolledStudentPoint.lng.between(center["lng"] - lng_span, center["lng"] + lng_span),
    )
    counts = dict.fromkeys(imported, 0)
    radius_m = radius_km * 1000
    for campus_key, lat, lng in (await db.execute(stmt)).all():
        # 同在籍學生分頁的距離分組（enrolled/query.py＋area.distance_band）：距離取到 100 公尺，剛好在半徑上算圈外。
        if opportunity._round_distance(haversine_m(center["lat"], center["lng"], float(lat), float(lng))) < radius_m:
            counts[campus_key] += 1
    return [{"campus_key": key, "count": counts[key]} for key in CAMPUS_KEYS if key in counts]


async def _compute(db: AsyncSession, center: dict[str, Any], radius_km: int) -> tuple[dict[str, Any], int | None]:
    """(一欄, 公開收費資料的學年)。沒座標與出錯的欄學年是 None。"""
    if center["lat"] is None or center["lng"] is None:
        return _blank("no_campus_point", center["locate_error"]), None
    try:
        async with db.begin_nested():
            kwargs = {"radius_km": radius_km, "center": center}
            opp = await opportunity.query_opportunity(db, None, school_year=None, semester=None, **kwargs)
            kids = await trends.query_trends(db, None, school_year=None, semester=None, kids_only=True, **kwargs)
            fees = await peer_fees.query_peer_fees(db, None, age=FEE_AGE, **kwargs)
            babycare = await area.query_babycare(db, None, **kwargs)
            changes = await area.query_changes(db, None, **kwargs)
            presale = await presale_area.query_presale(db, None, **kwargs)
            row = {
                "unavailable": None,
                "locate_error": None,
                **derive_fields(opp, kids, fees, babycare, changes),
                "infants": opp["baseline"]["infants"] if opp["baseline"] is not None else None,
                "presale_households": presale["summary"]["households"] if presale["source"]["version"] is not None else None,
                "housing": await _housing(db, center, radius_km),
                "enrolled": await _enrolled(db, center, radius_km),
            }
    except Exception:
        logger.exception("任意點評估：計算失敗")
        return _blank("error", None), None
    return row, fees["school_year"]


async def point_row(db: AsyncSession, center: dict[str, Any], radius_km: int) -> dict[str, Any]:
    return (await _compute(db, center, radius_km))[0]


async def _nearest_campus(db: AsyncSession, lat: float, lng: float) -> dict[str, Any] | None:
    best: tuple[float, str, matcher.CampusPoint] | None = None
    for key, point in (await matcher.campus_points(db)).items():
        if point.lat is None or point.lng is None:
            continue
        distance = haversine_m(lat, lng, point.lat, point.lng)
        if best is None or distance < best[0]:
            best = (distance, key, point)
    if best is None:
        return None
    distance, key, point = best
    return {
        "key": key, "name": (await area.campus_out(db, key, point))["name"],
        "distance_m": opportunity._round_distance(distance),
    }


async def query_point(db: AsyncSession, *, lat: float, lng: float, radius_km: int, campus_key: str | None) -> dict[str, Any]:
    lat, lng = round(lat, POINT_DECIMALS), round(lng, POINT_DECIMALS)
    center = await area.point_center(lat, lng)
    code = boundaries.village_at(lng, lat)
    names = boundaries.village_names()
    point_column, fee_school_year = await _compute(db, center, radius_km)
    campus_column = None
    if campus_key is not None:
        campus_column = (await _compute(db, await area.campus_out(db, campus_key), radius_km))[0]
    status = await opportunity.population_status(db)
    latest, seasons, _ = await housing_io.deals_by_code(db, ())
    return {
        "as_of": datetime.now(timezone.utc),
        "radius_km": radius_km,
        "point": {
            "lat": lat, "lng": lng,
            "district": names[code][0] if code is not None else None,
            "village": names[code][1] if code is not None else None,
            "village_code": code,
        },
        "nearest_campus": await _nearest_campus(db, lat, lng),
        "sources": {
            "population_version": status["version"],
            "fee_school_year": fee_school_year,
            "housing": {
                "latest": latest, "seasons": seasons, "note": housing_io.SOURCE_NOTE_FULL if latest is not None else "",
            },
        },
        "rows": {"point": point_column, "campus": campus_column},
    }
