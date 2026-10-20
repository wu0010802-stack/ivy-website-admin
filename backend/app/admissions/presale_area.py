"""附近預售建案（2026-10-20 預售建案規格 P11、P12）：/admin/admissions/area/presale。

只讀：不 flush、不 commit、不寫稽核。回應只有建案層級的公開資料（案名、戶數、建照日…），不含起造人，也沒有家長個資。
列出本校半徑內「在建」（P3）的預售建案：有座標（parcel、exact、nearby）用座標到本校的直線距離，只到里用里界面積重心
（同「里的變化」半徑內的里）；只到區、待比對的不列，案數放在 source.unplaced（半徑內有里的區裡）。預計交屋是建照日加
依戶數的月數（P4，粗估），只給到半年；已過預計時間還沒登記的標 overdue。預設依預計交屋由近到遠。"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.area import campus_out
from app.admissions.geo import boundaries
from app.admissions.geo import presale as presale_io
from app.admissions.geo.models import PRESALE_VILLAGE_LEVELS, GeoDatasetStatus
from app.admissions.geo.projection import haversine_m
from app.admissions.trends import building_cases
from app.common.timezones import today_local

DISTANCE_ROUND_M = 100


def _round_distance(meters: float) -> int:
    return int(round(meters / DISTANCE_ROUND_M) * DISTANCE_ROUND_M)


async def query_presale(
    db: AsyncSession, campus_key: str, *, radius_km: int, today: date | None = None, now: datetime | None = None
) -> dict[str, Any]:
    today = today or today_local()
    campus = await campus_out(db, campus_key)
    status = await db.get(GeoDatasetStatus, "presale_buildcases")
    imported = status is not None and status.active_version is not None
    result: dict[str, Any] = {
        "as_of": now or datetime.now(timezone.utc),
        "radius_km": radius_km,
        "campus": campus,
        "source": {
            "version": status.label if imported else None,
            "unplaced": 0,
            "note": presale_io.SOURCE_NOTE if imported else "",
        },
        "summary": {"cases": 0, "households": 0},
        "items": [],
    }
    if not imported or campus["lat"] is None or campus["lng"] is None:
        return result

    radius_m = radius_km * 1000
    names = boundaries.village_names()
    centroids = boundaries.village_centroids()
    districts = {
        names[code][0]
        for code, point in centroids.items()
        if code in names and haversine_m(campus["lat"], campus["lng"], *point) <= radius_m
    }
    items = []
    unplaced = 0
    for case in await building_cases(db, districts, today):
        placed = case.match_level in PRESALE_VILLAGE_LEVELS and case.village_code in names
        if not placed:
            unplaced += 1
            continue
        if case.lat is not None and case.lon is not None:
            distance = haversine_m(campus["lat"], campus["lng"], case.lat, case.lon)
        else:
            distance = haversine_m(campus["lat"], campus["lng"], *centroids[case.village_code])
        if distance > radius_m:
            continue
        expected = presale_io.expected_delivery(case.permit_on, case.households)
        year, half = presale_io.delivery_half(expected)
        items.append(
            (
                expected,
                {
                    "name": case.name,
                    "district": names[case.village_code][0],
                    "village": names[case.village_code][1],
                    "village_code": case.village_code,
                    "households": case.households,
                    "permit_on": case.permit_on,
                    "expected_year": year,
                    "expected_half": half,
                    "overdue": expected < today,
                    "distance_m": _round_distance(distance),
                    "match_level": case.match_level,
                    "lat": case.lat,
                    "lon": case.lon,
                },
            )
        )
    items.sort(key=lambda pair: (pair[0], pair[1]["distance_m"], pair[1]["district"], pair[1]["name"]))
    result["items"] = [item for _, item in items]
    result["source"]["unplaced"] = unplaced
    result["summary"] = {"cases": len(items), "households": sum(item["households"] for _, item in items)}
    return result
