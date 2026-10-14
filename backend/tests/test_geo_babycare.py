"""托嬰中心與公共托育家園公開資料的解析與半徑查詢（2026-10-14 規格 §2、§3、§5）。"""

from __future__ import annotations

import copy
from dataclasses import asdict
from datetime import datetime, timezone

import pytest

from app.admissions.geo.babycare import BabycareFormatError, _address, nearby, parse_babycare
from app.admissions.geo.kindergartens import ParseReport
from app.admissions.geo.models import GeoBabycare
from tests.geo_helpers import YIHUA_POINT, sample_babycare


def _by_id(rows):
    return {row.source_id: row for row in rows}


def _feature(**overrides):
    props = {
        "id": "x1", "name": "測試托嬰中心", "city": "高雄市", "address": "807高雄市三民區某路1號",
        "phone": "07-1234567", "capacity": 20, "status": 15, "is_active": True,
    }
    coordinates = overrides.pop("coordinates", [120.3, 22.6])
    props.update(overrides)
    return {"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": coordinates}}


def _collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


def test_only_active_kaohsiung_rows_are_kept():
    rows = parse_babycare(sample_babycare())
    assert sorted(row.source_id for row in rows) == [
        "CW10112245", "CW10112502", "CW10203013", "CW10808013", "CW11403015", "CW11507009",
    ]  # 兩筆停業、一筆新北市不收


def test_home_is_recognised_by_name_everything_else_is_a_center():
    rows = _by_id(parse_babycare(sample_babycare()))
    assert rows["CW10808013"].kind == "home"
    assert {row.kind for key, row in rows.items() if key != "CW10808013"} == {"center"}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("807高雄市三民區本揚里陽明路300號2樓", "高雄市三民區本揚里陽明路300號2樓"),
        # 有兩個「高雄市」：取最後一個起（前面是重複的區與里）。
        ("833高雄市鳥松區鳥松里高雄市鳥松區大埤路123之4號1樓、123之6號1-2樓", "高雄市鳥松區大埤路123之4號1樓、123之6號1-2樓"),
        ("高雄市某區某路1號", "高雄市某區某路1號"),  # 沒有郵遞區號
        ("  830高雄市鳳山區文福里文教路156號  ", "高雄市鳳山區文福里文教路156號"),
        ("", ""),
        (None, ""),
    ],
)
def test_address_cleaning(raw, expected):
    assert _address(raw) == expected


def test_fields_are_cleaned():
    rows = _by_id(parse_babycare(sample_babycare()))
    first = rows["CW10203013"]
    assert (first.approved_capacity, first.enrolled, first.phone) == (52, 52, "07-3801856")
    assert (first.lat, first.lng) == (22.643336, 120.342424)
    assert rows["CW10112245"].address == "高雄市鳥松區大埤路123之4號1樓、123之6號1-2樓"


def test_numbers_and_phone_edge_cases():
    data = _collection(
        _feature(id="a", capacity="1,200", status=" 3 ", phone=""),
        _feature(id="b", capacity="99999999999", status=None),
        _feature(id="c", capacity=True, status="abc"),
    )
    rows = _by_id(parse_babycare(data))
    assert (rows["a"].approved_capacity, rows["a"].enrolled, rows["a"].phone) == (1200, 3, None)
    assert (rows["b"].approved_capacity, rows["b"].enrolled) == (None, None)  # 超出 int4、空值：未知
    assert (rows["c"].approved_capacity, rows["c"].enrolled) == (None, None)  # 布林、非數字：未知


@pytest.mark.parametrize(
    ("value", "kept"),
    [(True, True), (False, False), ("1", True), ("0", False), (1, True), (0, False), ("true", True), (None, False), ("", False)],
)
def test_is_active_accepts_booleans_numbers_and_strings(value, kept):
    rows = parse_babycare(_collection(_feature(id="ok"), _feature(id="maybe", is_active=value)))
    assert ("maybe" in {row.source_id for row in rows}) is kept


def test_report_counts_only_rows_that_were_meant_to_be_kept():
    """別的縣市或停業的不算「略過」（本來就不要）；高雄市營業中卻不能用的才計數。"""
    report = ParseReport()
    data = _collection(
        _feature(id="ok"),
        _feature(id="taipei", city="臺北市"),
        _feature(id="closed", is_active=False),
        _feature(id="no-name", name=""),
        _feature(id="no-address", address=""),
        _feature(id="no-coordinates", coordinates=None),
        _feature(id="outside", coordinates=[121.56, 25.03]),
    )
    assert [row.source_id for row in parse_babycare(data, report=report)] == ["ok"]
    assert report.skipped == 4


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": "園" * 121},  # name 欄寬 120
        {"address": "路" * 201},  # address 200
        {"phone": "1" * 41},  # phone 40
        {"id": "a" * 65},  # source_id 64
    ],
    ids=["name", "address", "phone", "source_id"],
)
def test_overlong_fields_skip_the_row_and_are_counted(overrides):
    report = ParseReport()
    rows = parse_babycare(_collection(_feature(id="ok"), _feature(**{"id": "long", **overrides})), report=report)
    assert [row.source_id for row in rows] == ["ok"]
    assert report.skipped == 1


def test_fields_exactly_at_column_width_are_kept():
    data = _collection(_feature(id="a" * 64, name="園" * 120, address="高雄市" + "路" * 197, phone="1" * 40))
    report = ParseReport()
    (row,) = parse_babycare(data, report=report)
    assert report.skipped == 0
    assert (len(row.source_id), len(row.name), len(row.address), len(row.phone)) == (64, 120, 200, 40)


@pytest.mark.parametrize(
    "coordinates",
    [[0, 0], [22.6, 120.3], ["nan", "nan"], [float("inf"), 22.6], [121.56, 25.03], [120.3], "abc", [], None],
)
def test_bad_or_out_of_range_coordinates_skip_the_row(coordinates):
    report = ParseReport()
    rows = parse_babycare(_collection(_feature(id="ok"), _feature(id="bad", coordinates=coordinates)), report=report)
    assert [row.source_id for row in rows] == ["ok"]
    assert report.skipped == 1


def test_duplicate_source_id_keeps_the_first_and_counts_the_rest():
    report = ParseReport()
    rows = parse_babycare(
        _collection(_feature(id="dup", name="甲"), _feature(id="dup", name="乙"), _feature(id="other", name="丙")), report=report
    )
    assert [(row.source_id, row.name) for row in rows] == [("dup", "甲"), ("other", "丙")]
    assert report.skipped == 1


def test_malformed_feature_entries_are_skipped_not_raised():
    report = ParseReport()
    data = _collection(_feature(id="ok"), None, "x", 5, {"properties": "oops"})
    assert [row.source_id for row in parse_babycare(data, report=report)] == ["ok"]
    assert report.skipped == 4


def test_report_is_optional_and_does_not_change_the_result():
    data = _collection(_feature(id="ok"), _feature(id="bad", name="園" * 121))
    assert [row.source_id for row in parse_babycare(copy.deepcopy(data))] == ["ok"]


@pytest.mark.parametrize(
    "data",
    [{}, {"features": "x"}, {"type": "FeatureCollection", "features": []},
     _collection(_feature(id="t", city="臺北市")), _collection(_feature(id="c", is_active=False))],
)
def test_unexpected_shape_or_no_active_kaohsiung_row_is_rejected(data):
    with pytest.raises(BabycareFormatError):
        parse_babycare(data)


async def _load(db, *, inactive: tuple[str, ...] = ()) -> None:
    now = datetime.now(timezone.utc)
    for row in parse_babycare(sample_babycare()):
        db.add(GeoBabycare(**asdict(row), is_active=row.source_id not in inactive, synced_at=now))
    await db.commit()


async def test_nearby_is_sorted_by_distance_within_the_radius(db_session):
    await _load(db_session)
    within_1km = await nearby(db_session, *YIHUA_POINT, 1000)
    assert [(item.source_id, item.distance_m) for item in within_1km] == [
        ("CW10203013", 165), ("CW10112502", 435), ("CW11507009", 939),
    ]
    within_3km = await nearby(db_session, *YIHUA_POINT, 3000)
    assert [(item.source_id, item.distance_m) for item in within_3km][-2:] == [("CW10808013", 1297), ("CW10112245", 1657)]
    assert "CW11403015" not in {item.source_id for item in await nearby(db_session, *YIHUA_POINT, 6000)}  # 8.3 公里
    assert "CW11403015" in {item.source_id for item in await nearby(db_session, *YIHUA_POINT, 9000)}


async def test_nearby_skips_closed_rows(db_session):
    await _load(db_session, inactive=("CW10112502",))
    assert [item.source_id for item in await nearby(db_session, *YIHUA_POINT, 1000)] == ["CW10203013", "CW11507009"]


async def test_nearby_breaks_distance_ties_by_name(db_session):
    now = datetime.now(timezone.utc)
    lat, lng = YIHUA_POINT
    for source_id, name in (("a", "甲托嬰中心"), ("b", "乙托嬰中心")):
        db_session.add(
            GeoBabycare(
                source_id=source_id, name=name, kind="center", address="高雄市三民區某路1號", lat=lat + 0.001, lng=lng,
                is_active=True, synced_at=now,
            )
        )
    await db_session.commit()
    # 乙（U+4E59）排在甲（U+7532）前面，和寫入順序（甲先）相反：確實是名稱在決定順序。
    assert [item.name for item in await nearby(db_session, lat, lng, 1000)] == ["乙托嬰中心", "甲托嬰中心"]
