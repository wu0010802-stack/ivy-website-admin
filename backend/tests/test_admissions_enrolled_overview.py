"""五校在籍彙總 API（2026-11-20 規格 §6.2、§11 第 3 項）：/area/enrolled-overview。
在籍點、人口與校區座標全是虛構；里用里界檔的真實代碼，距離由測試自己算。"""

from __future__ import annotations

import pytest

from app.admissions.enrolled.importer import load_payload, replace_roster
from app.admissions.enrolled.overview import GAP_LIMIT, GAP_RADIUS_KM
from app.admissions.geo import boundaries, matcher
from app.admissions.geo.models import GeoDatasetStatus, GeoVillagePopulation
from app.admissions.geo.projection import haversine_m
from app.campuses.models import CAMPUS_KEYS
from tests.admissions_area_helpers import AREA, NOW
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.enrolled_helpers import payload_text, points_payload, student
from tests.test_admissions_trends import YIHUA_LAT, YIHUA_LNG

OVERVIEW = f"{AREA}/enrolled-overview"


def _near_yihua() -> list[tuple[float, str]]:
    """(離義華的距離 m, 里代碼)，由近到遠。"""
    return sorted(
        (haversine_m(YIHUA_LAT, YIHUA_LNG, *point), code) for code, point in boundaries.village_centroids().items()
    )


def _place(monkeypatch, **coords):
    """五校座標：沒列出的校沒有座標。"""

    async def points(db):
        return {
            key: matcher.CampusPoint(
                campus_key=key,
                lat=coords[key][0] if key in coords else None,
                lng=coords[key][1] if key in coords else None,
                locate_error=None if key in coords else "no_doorplate",
                district="",
            )
            for key in CAMPUS_KEYS
        }

    monkeypatch.setattr(matcher, "campus_points", points)


async def _import(db, campus_key: str, students: list[dict]) -> None:
    await replace_roster(db, load_payload(payload_text(points_payload(students, campus_key=campus_key))))
    await db.commit()


async def _population(db, codes: dict[str, int]) -> None:
    for code, per_age in codes.items():
        district, village = boundaries.village_names()[code]
        db.add(
            GeoVillagePopulation(
                village_code=code, district=district, village=village, age_0=0, age_1=0,
                age_2=per_age, age_3=per_age, age_4=per_age, age_5=per_age, age_6=0, people_total=3000,
            )
        )
    db.add(GeoDatasetStatus(dataset="population", active_version="115-09", label="115-09", synced_at=NOW))
    await db.commit()


def _name(code: str) -> dict:
    district, village = boundaries.village_names()[code]
    return {"district": district, "village": village}


async def _get(client) -> dict:
    response = await client.get(OVERVIEW)
    assert response.status_code == 200, response.text
    return response.json()


async def test_overview_requires_stats_scope(admin_client, reception_yihua_client, readonly_yihua_client, minghua_client):  # noqa: F811
    for client in (reception_yihua_client, readonly_yihua_client):
        assert (await client.get(OVERVIEW)).status_code == 403
    assert (await admin_client.get(OVERVIEW)).status_code == 200
    # 校區帳號沒有 admissions.stats（同 /area/compare），不能看五校彙總。
    assert (await minghua_client.get(OVERVIEW)).status_code == 403


async def test_overview_merges_points_per_campus_cell(admin_client, db_session):
    await _import(
        db_session, "yihua",
        [student(), student(grade="大班"), student(lat=22.643, lng=120.345), student(match_level="street", lat=None, lng=None)],
    )
    body = await _get(admin_client)
    assert body["points"] == [
        {"lat": 22.642, "lng": 120.344, "campus_key": "yihua", "count": 2},
        {"lat": 22.643, "lng": 120.345, "campus_key": "yihua", "count": 1},
    ]
    assert all(set(point) == {"lat", "lng", "campus_key", "count"} for point in body["points"])
    yihua = next(c for c in body["campuses"] if c["key"] == "yihua")
    assert (yihua["imported"], yihua["total"], yihua["placed"]) == (True, 4, 3)


async def test_overview_same_cell_different_campus_not_merged(admin_client, db_session):
    await _import(db_session, "yihua", [student()])
    await _import(db_session, "minghua", [student()])
    keys = [(p["campus_key"], p["count"]) for p in (await _get(admin_client))["points"]]
    assert keys == [("yihua", 1), ("minghua", 1)]


async def test_overview_village_counts_and_overlap(admin_client, db_session):
    a, b, c = (code for _, code in _near_yihua()[:3])
    await _import(db_session, "yihua", [student(**_name(a)), student(**_name(a)), student(**_name(b))])
    await _import(db_session, "minghua", [student(**_name(a)), student(**_name(c)), student(match_level="district", village=None, lat=None, lng=None)])
    body = await _get(admin_client)
    by_code = {v["village_code"]: v for v in body["villages"]}
    assert by_code[a]["counts"] == {"yihua": 2, "minghua": 1} and by_code[a]["total"] == 3
    assert by_code[b]["counts"] == {"yihua": 1} and by_code[c]["counts"] == {"minghua": 1}
    assert [v["total"] for v in body["villages"]] == [3, 1, 1]
    assert [v["village_code"] for v in body["overlap"]] == [a]
    # 只到區的學生算進 total，沒有座標不進 points、對不到里不進 villages。
    minghua = next(c for c in body["campuses"] if c["key"] == "minghua")
    assert minghua["total"] == 3 and sum(p["count"] for p in body["points"] if p["campus_key"] == "minghua") == 2


async def test_overview_no_campus_imported(admin_client, db_session, monkeypatch):
    _place(monkeypatch, yihua=(YIHUA_LAT, YIHUA_LNG))
    await _population(db_session, {code: 10 for _, code in _near_yihua()[:5]})
    body = await _get(admin_client)
    assert body["gaps"] == [] and body["points"] == [] and body["villages"] == [] and body["overlap"] == []
    assert [c["imported"] for c in body["campuses"]] == [False] * len(CAMPUS_KEYS)
    assert all(c["total"] == 0 and c["roster_date"] is None for c in body["campuses"])
    assert body["population_version"] == "115-09" and body["gap_radius_km"] == GAP_RADIUS_KM == 6


async def test_overview_population_missing(admin_client, db_session, monkeypatch):
    _place(monkeypatch, yihua=(YIHUA_LAT, YIHUA_LNG))
    await _import(db_session, "yihua", [student()])
    body = await _get(admin_client)
    assert body["gaps"] == [] and body["population_version"] is None
    assert next(c for c in body["campuses"] if c["key"] == "yihua")["lat"] == YIHUA_LAT


async def test_overview_gaps_rules(admin_client, db_session, monkeypatch):
    ranked = _near_yihua()
    inside = [code for dist, code in ranked if dist <= GAP_RADIUS_KM * 1000 - 300]
    outside = [code for dist, code in ranked if dist > GAP_RADIUS_KM * 1000 + 300]
    assert len(inside) >= GAP_LIMIT + 4 and outside
    enrolled_code, other_code = inside[0], inside[1]
    # 明華（未匯入）放在 other_code 的重心上：那個里最近的校是明華，不能列。
    other_lat, other_lng = boundaries.village_centroids()[other_code]
    _place(monkeypatch, yihua=(YIHUA_LAT, YIHUA_LNG), minghua=(other_lat, other_lng))
    await _import(db_session, "yihua", [student(**_name(enrolled_code))])
    per_age = {code: 10 + i for i, code in enumerate(inside + outside[:3])}
    await _population(db_session, per_age)

    gaps = (await _get(admin_client))["gaps"]
    codes = [g["village_code"] for g in gaps]
    assert len(gaps) == GAP_LIMIT
    assert enrolled_code not in codes and other_code not in codes and not set(codes) & set(outside)
    assert [g["children"] for g in gaps] == sorted((g["children"] for g in gaps), reverse=True)
    for gap in gaps:
        assert gap["children"] == 4 * per_age[gap["village_code"]]
        assert gap["nearest_campus_key"] in ("yihua", "minghua") and gap["distance_m"] % 100 == 0


async def test_overview_gaps_tie_breaks_and_nearest_among_all(admin_client, db_session, monkeypatch):
    ranked = _near_yihua()
    codes = [code for dist, code in ranked if dist <= 3000][:4]
    _place(monkeypatch, yihua=(YIHUA_LAT, YIHUA_LNG))
    await _import(db_session, "yihua", [student()])
    await _population(db_session, {code: 7 for code in codes})
    gaps = (await _get(admin_client))["gaps"]
    assert [(g["district"], g["village"]) for g in gaps] == sorted((g["district"], g["village"]) for g in gaps)
    assert {g["nearest_campus_key"] for g in gaps} == {"yihua"}
