"""區域分析六支查詢的任意圓心（2026-11-20 規格 §5.3、§11 第 8–9 項）：以 point_center 取代校名時，
公開資料的數字要和同座標的校完全一樣（同一條程式路徑）；本校專屬的部分（參觀、本校收費排名）一律略過。"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import update

from app.admissions import area, opportunity, peer_fees, presale_area, trends
from app.admissions.geo import matcher
from app.admissions.geo.models import GeoBabycare, GeoProviderEvent
from tests.geo_helpers import load_babycare_sample, publish_campus_address
from tests.peer_fees_helpers import peers  # noqa: F401
from tests.test_admissions_presale_area import TODAY
from tests.test_admissions_presale_area import _seed as seed_presale
from tests.test_admissions_trends import _seed as seed_population


@pytest.fixture
async def world(db_session, peers):  # noqa: F811
    """義華有座標；人口、幼兒園收費、托嬰、預售、異動都有資料。回傳義華座標的圓心。"""
    await load_babycare_sample(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    await seed_population(db_session)
    await seed_presale(db_session)
    await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id == "CW10112502").values(is_active=False))
    db_session.add(GeoProviderEvent(provider="babycare", source_id="CW10112502", change="closed", occurred_on=date(2026, 10, 10)))
    await db_session.commit()
    point = await matcher.campus_point(db_session, "yihua")
    return await area.point_center(point.lat, point.lng)


async def test_point_center_shape(world):
    assert world["key"] == "" and world["name"] == "這一點"
    assert world["locate_error"] is None
    assert world["district"] == "三民區"


async def test_point_center_outside_any_village_has_no_district():
    center = await area.point_center(0.0, 0.0)
    assert center["district"] is None and (center["lat"], center["lng"]) == (0.0, 0.0)


async def test_center_equals_campus_for_public_numbers(db_session, world):
    kwargs = {"school_year": None, "semester": None, "radius_km": 1}
    by_campus = await opportunity.query_opportunity(db_session, "yihua", **kwargs)
    by_center = await opportunity.query_opportunity(db_session, None, center=world, **kwargs)
    assert by_campus["baseline"]["children"] == by_center["baseline"]["children"] > 0
    assert by_campus["baseline"]["infants"] == by_center["baseline"]["infants"]
    assert by_center["campus"] == world and by_center["filters"]["campus_key"] == ""

    full = await trends.query_trends(db_session, "yihua", kids_only=True, **kwargs)
    light = await trends.query_trends(db_session, None, kids_only=True, center=world, **kwargs)
    assert light["baseline"]["kids_net"] == full["baseline"]["kids_net"] is not None

    fees = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    fees_center = await peer_fees.query_peer_fees(db_session, None, radius_km=3, age=3, center=world)
    strip = lambda groups: [{k: v for k, v in g.items() if k not in ("own_rank", "rank_total")} for g in groups]  # noqa: E731
    assert strip(fees["groups"]) == strip(fees_center["groups"])
    assert fees_center["groups"][0]["schools"] > 0

    baby = await area.query_babycare(db_session, "yihua", radius_km=3)
    baby_center = await area.query_babycare(db_session, None, radius_km=3, center=world)
    assert baby["summary"]["count"] == baby_center["summary"]["count"]

    changes = await area.query_changes(db_session, "yihua", radius_km=3, today=date(2026, 10, 14))
    changes_center = await area.query_changes(db_session, None, radius_km=3, today=date(2026, 10, 14), center=world)
    assert changes["items"] == changes_center["items"] != []

    presale = await presale_area.query_presale(db_session, "yihua", radius_km=1, today=TODAY)
    presale_center = await presale_area.query_presale(db_session, None, radius_km=1, today=TODAY, center=world)
    assert presale["summary"] == presale_center["summary"] and presale["summary"]["cases"] > 0


async def test_center_skips_campus_specific_parts(db_session, world):
    fees = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert fees["own"] is not None
    result = await peer_fees.query_peer_fees(db_session, None, radius_km=3, age=3, center=world)
    assert result["own"] is None and result["own_missing"] is None
    assert all(group["own_rank"] is None for group in result["groups"])
    assert any(school["is_own"] for school in result["schools"])  # 五校座標仍標出本校

    baby = await area.query_babycare(db_session, None, radius_km=3, center=world)
    assert baby["summary"]["own_age2_monthly"] is None

    result = await opportunity.query_opportunity(db_session, None, school_year=None, semester=None, radius_km=1, center=world)
    assert result["baseline"]["visit"] == 0
    assert result["unplaced_visit"] == 0 and result["no_address_visit"] == 0


async def test_requires_campus_or_center(db_session, world):
    kwargs = {"school_year": None, "semester": None, "radius_km": 1}
    with pytest.raises(ValueError):
        await opportunity.query_opportunity(db_session, None, **kwargs)
    with pytest.raises(ValueError):
        await trends.query_trends(db_session, None, kids_only=True, **kwargs)
    with pytest.raises(ValueError):
        await peer_fees.query_peer_fees(db_session, None, radius_km=3, age=3)
    with pytest.raises(ValueError):
        await area.query_babycare(db_session, None, radius_km=3)
    with pytest.raises(ValueError):
        await area.query_changes(db_session, None, radius_km=3)
    with pytest.raises(ValueError):
        await presale_area.query_presale(db_session, None, radius_km=1)


async def test_trends_center_requires_kids_only(db_session, world):
    with pytest.raises(ValueError):
        await trends.query_trends(db_session, None, center=world, school_year=None, semester=None, radius_km=1)
