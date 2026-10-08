"""幼兒園公開資料的解析、整批換新與半徑查詢（2026-10-08 規格 §4、§5.2）。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.admissions.geo.kindergartens import KindergartenFormatError, nearby, parse_preschools, replace_kindergartens
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, GeoKindergarten
from tests.geo_helpers import SAMPLE_TAG, YIHUA_POINT, load_geo_samples, sample_preschools


def _by_name(rows):
    return {row.name: row for row in rows}


def test_only_active_kaohsiung_kindergartens_are_kept():
    rows = parse_preschools(sample_preschools(), school_year=115)
    names = {row.name for row in rows}
    assert len(rows) == 10
    assert "臺南市私立耶魯幼兒園" not in names  # 非高雄市
    assert "高雄市私立小太陽哈佛幼兒園" not in names  # is_active 0
    assert "高雄市英明非營利幼兒園" not in names  # is_active 0


def test_inactive_as_string_and_other_city_are_dropped():
    data = {"type": "FeatureCollection", "features": [
        {"properties": {"id": "a", "title": "甲", "city": "高雄市", "type": "公立", "is_active": "0"},
         "geometry": {"coordinates": [120.3, 22.6]}},
        {"properties": {"id": "b", "title": "乙", "city": "臺南市", "type": "公立", "is_active": 1},
         "geometry": {"coordinates": [120.2, 22.9]}},
        {"properties": {"id": "c", "title": "丙", "city": "高雄市", "type": "公立", "is_active": "1"},
         "geometry": {"coordinates": [120.3, 22.6]}},
    ]}
    assert [row.name for row in parse_preschools(data, school_year=115)] == ["丙"]


def test_kinds_and_quasi_public_period():
    rows = _by_name(parse_preschools(sample_preschools(), school_year=115))
    assert rows["高雄市私立保羅幼兒園"].kind == "quasi_public"  # pre_public 113-115
    assert rows["高雄市私立保羅幼兒園"].pre_public_period == "113-115"
    assert rows["高雄市私立常春藤幼兒園"].kind == "private"
    assert rows["高雄市私立常春藤幼兒園"].pre_public_period is None  # 「無」當成沒有
    assert rows["高雄市灣內非營利幼兒園"].kind == "nonprofit"
    assert rows["高雄市三民區東光國民小學附設幼兒園"].kind == "public"
    later = _by_name(parse_preschools(sample_preschools(), school_year=116))
    assert later["高雄市私立保羅幼兒園"].kind == "private"  # 準公共期間已過


def test_fields_are_cleaned():
    rows = _by_name(parse_preschools(sample_preschools(), school_year=115))
    wannei = rows["高雄市灣內非營利幼兒園"]  # 原始座標是字串
    assert (wannei.lat, wannei.lng) == (22.687159, 120.347932)
    ivy = rows["高雄市私立常春藤幼兒園"]
    assert (ivy.address, ivy.district) == ("義華路68號", "三民區")  # 去掉郵遞區號
    assert (ivy.approved_capacity, ivy.has_penalty) == (210, True)
    assert not hasattr(ivy, "owner")


def test_capacity_and_monthly_parsing():
    data = {"type": "FeatureCollection", "features": [
        {"properties": {"id": "x", "title": "測試", "city": "高雄市", "town": "三民區", "type": "私立",
                        "address": "[807]某路1號", "count_approved": "1,200", "monthly": "", "pre_public": "無",
                        "penalty": "無", "tel": "", "is_active": 1},
         "geometry": {"coordinates": [120.3, 22.6]}},
    ]}
    (row,) = parse_preschools(data, school_year=115)
    assert (row.approved_capacity, row.monthly_fee_estimate, row.phone, row.address) == (1200, None, None, "某路1號")


@pytest.mark.parametrize(
    "data",
    [{}, {"features": "x"}, {"type": "FeatureCollection", "features": [
        {"properties": {"id": "t", "title": "臺南", "city": "臺南市", "type": "公立", "is_active": 1},
         "geometry": {"coordinates": [120.2, 22.9]}}]}],
)
def test_unexpected_shape_is_rejected(data):
    with pytest.raises(KindergartenFormatError):
        parse_preschools(data, school_year=115)


async def test_replace_and_nearby(db_session):
    rows = parse_preschools(sample_preschools(), school_year=115)
    now = datetime.now(timezone.utc)
    assert await replace_kindergartens(db_session, rows, synced_at=now) == 10
    await db_session.commit()

    within_1km = await nearby(db_session, *YIHUA_POINT, 1000)
    assert [(item.name, item.distance_m) for item in within_1km] == [
        ("高雄市私立常春藤幼兒園", 12),
        ("高雄市私立何嘉仁幼兒園", 300),
        ("高雄市私立保羅幼兒園", 513),
        ("高雄市私立義華幼兒園", 581),
        ("高雄市私立愛爾蘭幼兒園", 607),
        ("高雄市私立新美倫幼兒園", 614),
        ("高雄市三民區東光國民小學附設幼兒園", 786),
    ]
    within_3km = await nearby(db_session, *YIHUA_POINT, 3000)
    assert [item.name for item in within_3km][-1] == "高雄市光武非營利幼兒園(委託高雄市教保人員職業工會辦理)"

    status = await db_session.get(GeoDatasetStatus, "kindergartens")
    assert status.synced_at == now and status.label == now.date().isoformat()

    await replace_kindergartens(db_session, rows[:2], synced_at=now)
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(GeoKindergarten)) == 2


async def test_load_geo_samples_is_repeatable(db_session):
    await load_geo_samples(db_session)
    await load_geo_samples(db_session)
    assert await db_session.scalar(select(func.count()).select_from(GeoDoorplate)) == 73
    assert await db_session.scalar(select(func.count()).select_from(GeoKindergarten)) == 10
    statuses = {s.dataset: s for s in (await db_session.execute(select(GeoDatasetStatus))).scalars()}
    assert set(statuses) == {"doorplates", "kindergartens"}
    assert statuses["doorplates"].active_version == SAMPLE_TAG
    assert all(s.synced_at is not None for s in statuses.values())
