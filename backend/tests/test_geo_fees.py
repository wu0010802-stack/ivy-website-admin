"""幼兒園收費檔解析與統計小工具（2026-10-15 規格 §2、§4.2、F4、F5、F14）。"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import quote

import pytest
from sqlalchemy import delete

from app.admissions.geo import fees
from app.admissions.geo.models import GeoKindergarten, GeoKindergartenFee
from tests.geo_helpers import sample_slip


def _by_age(rows):
    return {row.age: row for row in rows}


def test_full_day_first_term_is_read_for_each_age():
    rows = _by_age(fees.parse_slip(sample_slip()))
    assert sorted(rows) == [2, 3, 4, 5]
    four = rows[4]
    assert (four.semester_total, four.months) == (89750, 5.5)
    assert (four.tuition, four.misc_fee, four.materials, four.activities, four.lunch, four.snack) == (19900, 5500, 24750, 23100, 8250, 8250)
    assert four.after_care_monthly == 1200
    assert four.transport_note == "單 770 雙 1540"


def test_second_term_is_used_when_the_first_term_is_blank():
    rows = _by_age(fees.parse_slip(sample_slip(blank_first_term=(5,))))
    assert (rows[5].semester_total, rows[5].after_care_monthly) == (74650, 1500)


def test_an_age_without_any_total_is_left_out():
    data = sample_slip()
    del data["slip"]["3"]
    for term in ("上學期", "下學期"):
        data["slip"]["2"][term]["class"]["全日班"]["全學期總收費"] = {"收費期間": "學期", "單價": "0", "小計": "0"}
    assert sorted(_by_age(fees.parse_slip(data))) == [4, 5]


def test_items_can_be_blank_while_the_total_is_kept():
    data = sample_slip()
    table = data["slip"]["4"]["上學期"]["class"]["全日班"]
    for name in ("學費", "雜費", "材料費", "活動費", "午餐費", "點心費", "課後延托費"):
        table[name] = {"收費期間": "", "單價": "", "小計": ""}
    table["全學期總收費"] = {"收費期間": "學期", "單價": "1,200", "小計": "1,200"}
    four = _by_age(fees.parse_slip(data))[4]
    assert four.semester_total == 1200
    assert (four.tuition, four.snack, four.after_care_monthly) == (None, None, None)


@pytest.mark.parametrize(("raw", "expected"), [("5.5", 5.5), ("6", 6.0), ("abc", None), ("13", None), ("0.2", None)])
def test_months(raw, expected):
    data = sample_slip()
    data["slip"]["4"]["上學期"]["months"] = raw
    assert _by_age(fees.parse_slip(data))[4].months == expected


def test_transport_note_is_squashed_and_capped():
    data = sample_slip()
    data["slip"]["4"]["上學期"]["class"]["全日班"]["交通費"]["單價"] = "單 " + "1" * 60
    assert len(_by_age(fees.parse_slip(data))[4].transport_note) == 40
    data["slip"]["4"]["上學期"]["class"]["全日班"]["交通費"]["單價"] = "  \r\n "
    assert _by_age(fees.parse_slip(data))[4].transport_note is None


def test_the_header_is_never_read():
    data = sample_slip()
    data["meta"] = {"owner": "某某某", "title": "x"}
    rows = fees.parse_slip(data)
    assert all(set(vars(row)) == set(fees.FeeRow.__dataclass_fields__) for row in rows)


@pytest.mark.parametrize("data", [None, [], {}, {"slip": []}])
def test_unexpected_shape_is_rejected(data):
    with pytest.raises(fees.FeeFormatError):
        fees.parse_slip(data)


def test_slip_url_encodes_the_city_and_the_title():
    url = fees.slip_url(114, "高雄市鳳山非營利幼兒園(委託某協會辦理)")
    assert url == f"{fees.SLIP_ROOT}/slip114/{quote('高雄市')}/{quote('高雄市鳳山非營利幼兒園(委託某協會辦理)', safe='')}.json"
    assert "%28" in url and "%29" in url


@pytest.mark.parametrize(
    ("values", "expected"),
    [([], None), ([1, 2], None), ([3, 1, 2], 2), ([1, 2, 3, 4], 3), ([10, 11, 12, 13], 12), ([75000, 40200, 93000], 75000)],
)
def test_median_needs_three_and_rounds_half_up(values, expected):
    assert fees.median(values) == expected


@pytest.mark.parametrize(
    ("total", "months", "expected"),
    [(89750, Decimal("5.5"), 16318), (105950, 5.5, 19264), (11, 2, 6), (89750, None, None), (89750, 0, None)],
)
def test_monthly_average(total, months, expected):
    assert fees.monthly_average(total, months) == expected


async def test_own_fee_finds_the_nearest_active_school_within_the_radius(db_session):
    now = datetime.now(timezone.utc)
    lat, lng = 22.6424556, 120.3437133
    for source_id, north_m, active in (("near", 12, True), ("nearer-but-closed", 5, False), ("outside", 80, True)):
        db_session.add(GeoKindergarten(
            source_id=source_id, name=source_id, kind="private", district="三民區", address="某路1號",
            lat=lat + north_m / 111_320.0, lng=lng, has_penalty=False, is_active=active, synced_at=now,
        ))
    db_session.add(GeoKindergartenFee(source_id="near", age=3, school_year=114, months=Decimal("5.5"), semester_total=89750, synced_at=now))
    await db_session.commit()
    school, fee = await fees.own_fee(db_session, lat, lng, age=3, radius_m=50)
    assert school.source_id == "near" and fee.semester_total == 89750
    school, fee = await fees.own_fee(db_session, lat, lng, age=2, radius_m=50)
    assert school.source_id == "near" and fee is None
    await db_session.execute(delete(GeoKindergarten).where(GeoKindergarten.source_id == "near"))
    await db_session.commit()
    assert await fees.own_fee(db_session, lat, lng, age=3, radius_m=50) == (None, None)


async def test_own_fee_takes_the_nearest_of_several_schools_within_the_radius(db_session):
    now = datetime.now(timezone.utc)
    lat, lng = 22.6424556, 120.3437133
    # 遠的那所 source_id 排在前面，免得是靠同距離時的 source_id 排序碰巧選對。
    for source_id, north_m, total in (("a-30m", 30, 70000), ("z-10m", 10, 89750)):
        db_session.add(GeoKindergarten(
            source_id=source_id, name=source_id, kind="private", district="三民區", address="某路1號",
            lat=lat + north_m / 111_320.0, lng=lng, has_penalty=False, is_active=True, synced_at=now,
        ))
        db_session.add(GeoKindergartenFee(source_id=source_id, age=3, school_year=114, months=Decimal("5.5"), semester_total=total, synced_at=now))
    await db_session.commit()
    school, fee = await fees.own_fee(db_session, lat, lng, age=3, radius_m=50)
    assert (school.source_id, fee.semester_total) == ("z-10m", 89750)
