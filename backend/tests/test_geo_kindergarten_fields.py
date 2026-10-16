"""幼兒園四個新欄位：室內／戶外面積、幼童專用車、兼辦國小課後（2026-10-15 規格 §3、§4.1、F15）。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.admissions.geo.kindergartens import nearby, parse_preschools, per_child
from app.admissions.geo.providers import apply_kindergartens
from tests.geo_helpers import registry_of

POINT = (22.6424556, 120.3437133)


def _feature(**overrides):
    props = {
        "id": "x1", "reg_docno": "高市教字第1號", "title": "高雄市私立測試幼兒園", "city": "高雄市", "town": "三民區",
        "type": "私立", "address": "[807]某路1號", "count_approved": "150", "monthly": 10000, "pre_public": "無",
        "penalty": "無", "tel": "", "is_active": 1,
    }
    props.update(overrides)
    return {"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [POINT[1], POINT[0]]}}


def _parse(*features):
    data = {"type": "FeatureCollection", "features": list(features)}
    return parse_preschools(data, registry=registry_of(data), school_year=115)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("703.5平方公尺", 703.5), ("1,099.99平方公尺", 1099.99), ("063.5平方公尺", 63.5), ("", None), ("0平方公尺", None), ("約百坪", None), (None, None)],
)
def test_area_is_parsed_or_unknown(raw, expected):
    (row,) = _parse(_feature(size_in=raw, size_out=raw))
    assert (row.indoor_m2, row.outdoor_m2) == (expected, expected)


@pytest.mark.parametrize(("raw", "expected"), [("\t\t", True), ("", False)])
def test_shuttle_is_told_by_the_raw_string(raw, expected):
    (row,) = _parse(_feature(shuttle=raw))
    assert row.has_shuttle is expected


def test_shuttle_unknown_when_the_field_is_missing():
    (row,) = _parse(_feature())
    assert row.has_shuttle is None


@pytest.mark.parametrize(("raw", "expected"), [("無", 0), ("有，人數：20", 20), ("有", None), ("", None), (None, None)])
def test_after_school_capacity(raw, expected):
    (row,) = _parse(_feature(is_after=raw))
    assert row.after_school_capacity == expected


@pytest.mark.parametrize(
    ("area", "capacity", "expected"),
    [(703.5, 150, 4.7), (556.0, 210, 2.6), (100.0, 0, None), (100.0, None, None), (None, 100, None)],
)
def test_per_child(area, capacity, expected):
    assert per_child(area, capacity) == expected


async def test_nearby_returns_area_per_child_and_services(db_session):
    rows = _parse(_feature(size_in="703.5平方公尺", size_out="556平方公尺", shuttle="\t\t", is_after="有，人數：20"))
    await apply_kindergartens(db_session, rows, synced_at=datetime.now(timezone.utc), school_year=115)
    await db_session.commit()
    (item,) = await nearby(db_session, POINT[0], POINT[1], 1000)
    assert (item.indoor_m2_per_child, item.outdoor_m2_per_child, item.has_shuttle, item.after_school_capacity) == (4.7, 3.7, True, 20)
