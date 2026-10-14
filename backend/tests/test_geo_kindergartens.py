"""幼兒園公開資料的解析、整批換新與半徑查詢（2026-10-08 規格 §4、§5.2）。"""

from __future__ import annotations

import copy
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import func, select

from app.admissions.geo.kindergartens import (
    KindergartenFormatError,
    ParseReport,
    _int_or_none,
    kind_as_of,
    nearby,
    parse_preschools,
    replace_kindergartens,
)
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, GeoKindergarten
from app.common.timezones import today_local
from tests.geo_helpers import SAMPLE_LABEL, SAMPLE_TAG, YIHUA_POINT, load_geo_samples, sample_preschools


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


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (15073.0, 15073),  # 浮點數不能把小數點去掉後串起來（以前會變 150730）
        (15072.6, 15073),
        ("15073.0", 15073),
        ("1,234", 1234),
        (" 2 500 ", 2500),
        (15073, 15073),
        ("", None),
        (None, None),
        ("abc", None),
        ("nan", None),
        ("inf", None),
        (float("nan"), None),
        (True, None),
        (2_147_483_647, 2_147_483_647),  # int4 上限；再大寫入會讓整批失敗
        (2_147_483_648, None),
        ("99999999999", None),
        (1e20, None),
        ("1e10", None),
    ],
)
def test_int_or_none(raw, expected):
    assert _int_or_none(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2026/02/13", date(2026, 2, 13)),
        ("2026/2/3", date(2026, 2, 3)),
        ("2026/02/30", None),  # 不存在的日期
        ("2026-02-13", None),  # 來源固定用斜線
        ("20260213", None),
        ("0000/01/01", None),
        ("99999999999/01/01", None),  # 年份大到超出 C int（date() 丟 OverflowError 不是 ValueError）
        ("", None),
        (None, None),
    ],
)
def test_registered_on_is_parsed_or_unknown(raw, expected):
    (row,) = parse_preschools(_collection(_feature(id="x", reg_date=raw)), school_year=115)
    assert row.registered_on == expected


def test_registered_on_is_unknown_when_the_source_has_no_such_field():
    (row,) = parse_preschools(_collection(_feature(id="x")), school_year=115)
    assert row.registered_on is None


@pytest.mark.parametrize(
    ("kind", "period", "school_year", "expected"),
    [
        ("quasi_public", "113-115", 115, "quasi_public"),
        ("quasi_public", "113-115", 116, "private"),  # 期間過了：沒改過資料的準公共自己變回私立
        ("private", "113-115", 115, "quasi_public"),  # 舊列存的是私立，但期間涵蓋這一年
        ("private", None, 115, "private"),
        ("public", "113-115", 116, "public"),  # 公立、非營利不受準公共期間影響
        ("nonprofit", None, 116, "nonprofit"),
    ],
)
def test_kind_as_of_recomputes_the_private_and_quasi_public_kinds(kind, period, school_year, expected):
    assert kind_as_of(kind, period, school_year) == expected


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
    assert status.synced_at == now and status.label == today_local(now).isoformat()

    await replace_kindergartens(db_session, rows[:2], synced_at=now)
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(GeoKindergarten)) == 2


async def test_nearby_is_sorted_by_distance_then_name(db_session):
    """排序鍵只定義在 nearby（API 層不再重排）：距離相同時依名稱，與寫入順序無關。"""
    now = datetime.now(timezone.utc)
    lat, lng = YIHUA_POINT
    for source_id, name, dlat in (("a", "甲幼兒園", 0.001), ("b", "乙幼兒園", 0.001), ("c", "丙幼兒園", 0.0005)):
        db_session.add(
            GeoKindergarten(
                source_id=source_id, name=name, kind="private", district="三民區", address="某路1號",
                lat=lat + dlat, lng=lng, is_active=True, synced_at=now,
            )
        )
    await db_session.commit()
    found = await nearby(db_session, lat, lng, 1000)
    # 乙（U+4E59）排在甲（U+7532）前面，和寫入順序（甲先）相反：確實是名稱在決定順序。
    assert [item.name for item in found] == ["丙幼兒園", "乙幼兒園", "甲幼兒園"]
    assert found[1].distance_m == found[2].distance_m


@pytest.mark.parametrize(
    ("synced_at", "label"),
    [
        (datetime(2026, 10, 12, 15, 59, tzinfo=timezone.utc), "2026-10-12"),  # 台北 23:59
        (datetime(2026, 10, 12, 16, 0, tzinfo=timezone.utc), "2026-10-13"),  # 台北 00:00：UTC 還是前一天
        (datetime(2026, 10, 12, 23, 30, tzinfo=timezone.utc), "2026-10-13"),  # 台北 07:30
        (datetime(2026, 12, 31, 20, 0, tzinfo=timezone.utc), "2027-01-01"),  # 跨年
    ],
)
async def test_version_label_is_the_taipei_date(db_session, synced_at, label):
    """台北凌晨 0–8 點 UTC 日期還停在前一天；畫面上的「資料日期」要照園方所在時區。"""
    rows = parse_preschools(sample_preschools(), school_year=115)
    await replace_kindergartens(db_session, rows, synced_at=synced_at)
    await db_session.commit()
    status = await db_session.get(GeoDatasetStatus, "kindergartens")
    assert (status.label, status.active_version) == (label, label)


async def test_load_geo_samples_is_repeatable(db_session):
    await load_geo_samples(db_session)
    await load_geo_samples(db_session)
    assert await db_session.scalar(select(func.count()).select_from(GeoDoorplate)) == 73
    assert await db_session.scalar(select(func.count()).select_from(GeoKindergarten)) == 10
    statuses = {s.dataset: s for s in (await db_session.execute(select(GeoDatasetStatus))).scalars()}
    assert set(statuses) == {"doorplates", "kindergartens"}
    assert statuses["doorplates"].active_version == SAMPLE_TAG
    assert statuses["doorplates"].label == SAMPLE_LABEL
    kindergartens = statuses["kindergartens"]
    assert kindergartens.label == kindergartens.active_version == today_local(kindergartens.synced_at).isoformat()
    assert all(s.synced_at is not None for s in statuses.values())


def _feature(**overrides):
    props = {
        "id": "x1", "title": "測試幼兒園", "city": "高雄市", "town": "三民區", "type": "私立",
        "address": "[807]某路1號", "count_approved": "100", "monthly": 10000, "pre_public": "無",
        "penalty": "無", "tel": "(07)1234567", "reg_no": "高市教幼字第1號", "is_active": 1,
    }
    coordinates = overrides.pop("coordinates", [120.3, 22.6])
    props.update(overrides)
    return {"properties": props, "geometry": {"coordinates": coordinates}}


def _collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


def test_report_counts_only_rows_that_were_meant_to_be_kept():
    """高雄市以外或停業的不算「略過」（本來就不要）；高雄市營業中卻不能用的才計數。"""
    report = ParseReport()
    data = _collection(
        _feature(id="ok"),
        _feature(id="tainan", city="臺南市"),
        _feature(id="closed", is_active=0),
        _feature(id="no-name", title=""),
        _feature(id="odd-type", type="其他"),
        _feature(id="no-coordinates", coordinates=None),
    )
    assert [row.source_id for row in parse_preschools(data, school_year=115, report=report)] == ["ok"]
    assert report.skipped == 3


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": "園" * 121},  # name 欄寬 120
        {"address": "路" * 201},  # address 200
        {"tel": "1" * 41},  # phone 40
        {"reg_no": "字" * 81},  # reg_no 80
        {"id": "a" * 65},  # source_id 64
        {"pre_public": "1" * 17},  # pre_public_period 16
        {"town": "三民" + "區" * 7},  # district 8
    ],
    ids=["name", "address", "phone", "reg_no", "source_id", "pre_public", "district"],
)
def test_overlong_fields_skip_the_row_and_are_counted(overrides):
    report = ParseReport()
    rows = parse_preschools(
        _collection(_feature(id="ok"), _feature(**{"id": "long", **overrides})), school_year=115, report=report
    )
    assert [row.source_id for row in rows] == ["ok"]
    assert report.skipped == 1


def test_fields_exactly_at_column_width_are_kept():
    data = _collection(_feature(
        id="a" * 64, title="園" * 120, address="路" * 200, tel="1" * 40, reg_no="字" * 80, pre_public="1" * 16, town="三民" + "區" * 6,
    ))
    report = ParseReport()
    (row,) = parse_preschools(data, school_year=115, report=report)
    assert report.skipped == 0
    assert (len(row.source_id), len(row.name), len(row.address), len(row.phone), len(row.reg_no)) == (64, 120, 200, 40, 80)
    assert (len(row.pre_public_period), len(row.district)) == (16, 8)


@pytest.mark.parametrize(
    "coordinates",
    [
        [0, 0], [22.6, 120.3],  # 經緯度對調
        ["nan", "nan"], [float("inf"), 22.6], [120.3, float("-inf")],
        [121.56, 25.03],  # 台北
        [120.3], "abc", [], None,
    ],
)
def test_bad_or_out_of_range_coordinates_skip_the_row(coordinates):
    report = ParseReport()
    rows = parse_preschools(_collection(_feature(id="ok"), _feature(id="bad", coordinates=coordinates)), school_year=115, report=report)
    assert [row.source_id for row in rows] == ["ok"]
    assert report.skipped == 1


def test_duplicate_source_id_keeps_the_first_and_counts_the_rest():
    """source_id 是主鍵；重複會讓整批 INSERT 失敗。"""
    report = ParseReport()
    rows = parse_preschools(
        _collection(_feature(id="dup", title="甲"), _feature(id="dup", title="乙"), _feature(id="other", title="丙")),
        school_year=115, report=report,
    )
    assert [(row.source_id, row.name) for row in rows] == [("dup", "甲"), ("other", "丙")]
    assert report.skipped == 1


def test_malformed_feature_entries_are_skipped_not_raised():
    report = ParseReport()
    data = _collection(_feature(id="ok"), None, "x", 5, {"properties": "oops"})
    assert [row.source_id for row in parse_preschools(data, school_year=115, report=report)] == ["ok"]
    assert report.skipped == 4


def test_report_is_optional_and_does_not_change_the_result():
    data = _collection(_feature(id="ok"), _feature(id="bad", title="園" * 121))
    assert [row.source_id for row in parse_preschools(copy.deepcopy(data), school_year=115)] == ["ok"]


def test_huge_capacity_becomes_unknown_instead_of_failing_the_insert():
    (row,) = parse_preschools(_collection(_feature(count_approved="99999999999", monthly=1e20)), school_year=115)
    assert (row.approved_capacity, row.monthly_fee_estimate) == (None, None)


async def test_a_row_that_would_not_fit_never_reaches_the_database(db_session):
    """解析端擋下超長列之後，整批才寫得進去（一列超長以前會讓整個交易失敗）。"""
    data = _collection(_feature(id="ok"), _feature(id="long", title="園" * 121), _feature(id="far", coordinates=[0, 0]))
    report = ParseReport()
    rows = parse_preschools(data, school_year=115, report=report)
    assert await replace_kindergartens(db_session, rows, synced_at=datetime.now(timezone.utc)) == 1
    await db_session.commit()
    assert report.skipped == 2
    assert await db_session.scalar(select(func.count()).select_from(GeoKindergarten)) == 1
