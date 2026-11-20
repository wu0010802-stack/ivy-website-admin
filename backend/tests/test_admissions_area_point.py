"""任意點評估與地址定位 API（2026-11-20 規格 §5.2、§5.3、§11 第 1、6、8 項）：/area/point、/area/locate。

義華周邊用 peer_fees_helpers 的幼兒園與收費；人口用里的變化測試的 _seed；located_campus 讓五校都落在義華座標。
在籍點與地址全是虛構。"""

from __future__ import annotations

import json
from urllib.parse import quote

import pytest
from sqlalchemy import func, select

from app.admissions.enrolled.importer import load_payload, replace_roster
from app.admissions.geo import matcher
from app.campuses.models import CAMPUS_KEYS
from app.operations.models import AuditLogEntry
from tests.admissions_area_helpers import AREA
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.enrolled_helpers import payload_text, points_payload, student
from tests.geo_helpers import SAMPLE_ADDRESSES, load_babycare_sample, load_geo_samples, publish_campus_address
from tests.peer_fees_helpers import peers  # noqa: F401
from tests.test_admissions_trends import YIHUA_LAT, YIHUA_LNG, _seed, _seed_housing, located_campus  # noqa: F401

POINT = f"{AREA}/point"
LOCATE = f"{AREA}/locate"
HERE = f"lat={YIHUA_LAT}&lng={YIHUA_LNG}"
SEA = "lat=22.55&lng=120.20"


def _address(address: str) -> dict[str, str]:
    """地址放 X-Ivy-Search header（同後台 searchHeaders），不放網址。"""
    return {"X-Ivy-Search": quote(json.dumps({"address": address}, ensure_ascii=False), safe="")}


async def _get(client, query: str = HERE, radius: int = 3, status: int = 200):
    response = await client.get(f"{POINT}?{query}&radius_km={radius}")
    assert response.status_code == status, response.text
    return response.json()


async def test_point_requires_stats_scope(admin_client, reception_yihua_client, readonly_yihua_client, minghua_client, located_campus):  # noqa: F811
    for client in (reception_yihua_client, readonly_yihua_client, minghua_client):
        assert (await client.get(f"{POINT}?{HERE}&radius_km=3")).status_code == 403
        assert (await client.get(LOCATE, headers=_address("x"))).status_code == 403
    assert (await admin_client.get(f"{POINT}?{HERE}&radius_km=3")).status_code == 200


async def test_point_out_of_range(admin_client):
    for query in ("lat=25.03&lng=121.56", "lat=22.6&lng=121.56", "lat=21.0&lng=120.3"):
        body = await _get(admin_client, query, status=422)
        assert body["detail"]["code"] == "POINT_OUT_OF_RANGE"


async def test_point_rejects_bad_radius(admin_client):
    body = await _get(admin_client, radius=2, status=422)
    assert body["detail"]["code"] == "INVALID_RADIUS"


async def test_point_campus_column_matches_area_compare(admin_client, db_session, located_campus, peers):  # noqa: F811
    await _seed(db_session)
    await load_babycare_sample(db_session)
    compare = {r["campus_key"]: r for r in (await admin_client.get(f"{AREA}/compare?radius_km=3")).json()["rows"]}["yihua"]
    body = await _get(admin_client, f"{HERE}&campus_key=yihua")
    for name in ("point", "campus"):
        row = body["rows"][name]
        assert row["unavailable"] is None
        for key in ("children", "kids_net", "kids_unavailable", "kindergartens", "babycare", "fee_median", "changes_12m"):
            assert row[key] == compare[key], (name, key)
    assert compare["children"] > 0 and compare["kids_net"] is not None
    assert body["rows"]["campus"]["infants"] == body["rows"]["point"]["infants"]


async def test_point_without_campus_key_has_no_campus_column(admin_client, db_session, located_campus):  # noqa: F811
    body = await _get(admin_client)
    assert body["rows"]["campus"] is None and body["radius_km"] == 3
    assert [item["campus_key"] for item in body["rows"]["point"]["enrolled"]] == []


async def test_point_unknown_or_foreign_campus(admin_client, minghua_client):
    assert (await admin_client.get(f"{POINT}?{HERE}&radius_km=3&campus_key=nope")).status_code == 404
    assert (await minghua_client.get(f"{POINT}?{HERE}&radius_km=3&campus_key=yihua")).status_code in (403, 404)


async def test_point_campus_column_without_campus_point(admin_client, db_session, monkeypatch, peers):  # noqa: F811
    real = matcher.campus_point

    async def selective(db, campus_key):
        if campus_key == "minghua":
            return matcher.CampusPoint(campus_key=campus_key, lat=None, lng=None, locate_error="no_doorplate", district="")
        return await real(db, campus_key)

    monkeypatch.setattr(matcher, "campus_point", selective)
    body = await _get(admin_client, f"{HERE}&campus_key=minghua")
    campus = body["rows"]["campus"]
    assert campus["unavailable"] == "no_campus_point" and campus["locate_error"] == "no_doorplate"
    assert campus["children"] is None and campus["kindergartens"] is None and campus["housing"] is None
    assert body["rows"]["point"]["unavailable"] is None and body["rows"]["point"]["kindergartens"] is not None


async def test_point_outside_any_village_still_computes(admin_client, db_session, peers):  # noqa: F811
    body = await _get(admin_client, SEA)
    point = body["point"]
    assert (point["district"], point["village"], point["village_code"]) == (None, None, None)
    assert body["rows"]["point"]["unavailable"] is None


async def test_point_names_village_and_nearest_campus(admin_client, db_session):
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", SAMPLE_ADDRESSES["yihua_exact"])
    body = await _get(admin_client)
    assert body["point"]["district"] == "三民區" and body["point"]["village"] and body["point"]["village_code"]
    nearest = body["nearest_campus"]
    assert nearest["key"] == "yihua" and nearest["distance_m"] <= 200 and nearest["name"]


async def test_point_nearest_campus_null_without_any_point(admin_client, db_session):
    assert (await _get(admin_client))["nearest_campus"] is None


async def test_point_counts_enrolled_within_radius(admin_client, db_session, located_campus):  # noqa: F811
    inside = [student(), student(lat=22.643, lng=120.345), student(match_level="street", lat=None, lng=None)]
    outside = [student(lat=22.700, lng=120.300)]  # 約 7.8 km
    await replace_roster(db_session, load_payload(payload_text(points_payload(inside + outside))))
    far = points_payload([student(lat=22.80, lng=120.30)], campus_key="minghua")
    await replace_roster(db_session, load_payload(payload_text(far)))
    await db_session.commit()
    row = (await _get(admin_client, radius=3))["rows"]["point"]
    # 只列有清冊的校，順序同 CAMPUS_KEYS；minghua 有清冊但圈內沒人是 0，其他校沒匯入不列。
    assert row["enrolled"] == [{"campus_key": "yihua", "count": 2}, {"campus_key": "minghua", "count": 0}]
    assert [item["campus_key"] for item in row["enrolled"]] == [k for k in CAMPUS_KEYS if k in ("yihua", "minghua")]
    assert (await _get(admin_client, radius=6))["rows"]["point"]["enrolled"][0] == {"campus_key": "yihua", "count": 2}


async def test_point_enrolled_circle_matches_enrolled_tab_bands(admin_client, db_session, located_campus):  # noqa: F811
    """圈內的算法同在籍學生分頁的距離分組（enrolled/query.py）：距離取到 100 公尺、剛好 3 公里算圈外。
    中心是取到 4 位小數的 (22.6425, 120.3437)；在籍點的座標存到小數 3 位。"""
    near_edge = student(lat=22.664, lng=120.327)  # 約 2,942 m → 2,900 m，圈內
    on_edge = student(lat=22.668, lng=120.352)  # 約 2,960 m → 3,000 m，算 3–6 公里那一組，圈外
    await replace_roster(db_session, load_payload(payload_text(points_payload([near_edge, on_edge]))))
    await db_session.commit()
    assert (await _get(admin_client, radius=3))["rows"]["point"]["enrolled"] == [{"campus_key": "yihua", "count": 1}]
    assert (await _get(admin_client, radius=6))["rows"]["point"]["enrolled"] == [{"campus_key": "yihua", "count": 2}]


async def test_point_housing_summary(admin_client, db_session, located_campus):  # noqa: F811
    await _seed(db_session)
    body = await _get(admin_client)
    assert body["rows"]["point"]["housing"] is None
    assert body["sources"]["housing"]["latest"] is None
    await _seed_housing(db_session)
    body = await _get(admin_client)
    housing = body["rows"]["point"]["housing"]
    assert housing["sale_count"] >= 6 and housing["sale_median"] is not None
    assert housing["rent_count"] >= 2
    sources = body["sources"]["housing"]
    assert sources["latest"] == "115S3" and sources["seasons"] == ["115S1", "115S3"]
    assert sources["note"].startswith("內政部不動產交易實價查詢服務網；近 4 季")


async def test_point_rounds_to_four_decimals(admin_client):
    body = await _get(admin_client, "lat=22.627349&lng=120.312951")
    assert (body["point"]["lat"], body["point"]["lng"]) == (22.6273, 120.3130)


async def test_point_writes_no_audit(admin_client, db_session, located_campus):  # noqa: F811
    before = await db_session.scalar(select(func.count()).select_from(AuditLogEntry))
    await _get(admin_client)
    assert await db_session.scalar(select(func.count()).select_from(AuditLogEntry)) == before


# ---- /area/locate ----


async def test_locate_found(admin_client, db_session):
    await load_geo_samples(db_session)
    response = await admin_client.get(LOCATE, headers=_address(f"  {SAMPLE_ADDRESSES['yihua_exact']} "))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["district"] == "三民區" and body["village"] == "本揚里" and body["match_level"] == "exact"
    assert body["lat"] == pytest.approx(22.6424556, abs=1e-6) and body["lng"] == pytest.approx(120.3437133, abs=1e-6)


@pytest.mark.parametrize(
    ("key", "reason"),
    [("outside", "outside_kaohsiung"), ("district_only", "imprecise")],
)
async def test_locate_not_found_reason(admin_client, db_session, key, reason):
    await load_geo_samples(db_session)
    response = await admin_client.get(LOCATE, headers=_address(SAMPLE_ADDRESSES[key]))
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert (detail["code"], detail["reason"]) == ("ADDRESS_NOT_FOUND", reason)
    assert SAMPLE_ADDRESSES[key] not in response.text


async def test_locate_before_doorplates_are_imported(admin_client):
    response = await admin_client.get(LOCATE, headers=_address(SAMPLE_ADDRESSES["yihua_exact"]))
    assert response.status_code == 404 and response.json()["detail"]["reason"] == "pending"


@pytest.mark.parametrize("address", ["", "   ", "路" * 101, " " * 50 + "路" * 101])
async def test_locate_rejects_bad_address(admin_client, address):
    response = await admin_client.get(LOCATE, headers=_address(address))
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_ADDRESS"


async def test_locate_ignores_address_in_query_string(admin_client, db_session):
    """2026-10-22 資安稽核：網址的查詢字串可能留在 web 服務那一層的 HTTP 紀錄；地址只收 header。"""
    await load_geo_samples(db_session)
    response = await admin_client.get(LOCATE, params={"address": SAMPLE_ADDRESSES["yihua_exact"]})
    assert response.status_code == 422 and response.json()["detail"]["code"] == "INVALID_ADDRESS"


@pytest.mark.parametrize(
    "raw",
    [
        "not-json",
        quote(json.dumps({"q": "路"}), safe=""),
        quote(json.dumps({"address": 1}), safe=""),
        quote(json.dumps({"address": "路" * 201}, ensure_ascii=False), safe=""),
    ],
)
async def test_locate_rejects_malformed_header(admin_client, raw):
    response = await admin_client.get(LOCATE, headers={"X-Ivy-Search": raw})
    assert response.status_code == 422 and response.json()["detail"]["code"] == "INVALID_SEARCH_HEADER"


async def test_locate_writes_no_audit(admin_client, db_session):
    await load_geo_samples(db_session)
    before = await db_session.scalar(select(func.count()).select_from(AuditLogEntry))
    await admin_client.get(LOCATE, headers=_address(SAMPLE_ADDRESSES["yihua_exact"]))
    await admin_client.get(LOCATE, headers=_address(SAMPLE_ADDRESSES["outside"]))
    assert await db_session.scalar(select(func.count()).select_from(AuditLogEntry)) == before
