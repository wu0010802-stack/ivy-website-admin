"""附近同業收費的計算（2026-10-15 規格 §5、F12–F14）與托嬰月費摘要。"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select, update

from app.admissions import area, peer_fees
from app.admissions.academic import current_term
from app.admissions.geo import matcher
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoKindergarten, GeoKindergartenFee
from app.common.timezones import today_local
from tests.geo_helpers import load_babycare_sample, publish_campus_address
from tests.peer_fees_helpers import OWN_ITEMS, add_fee, add_kindergarten, peers  # noqa: F401


def _group(result, kind):
    return next(group for group in result["groups"] if group["kind"] == kind)


async def test_private_group_median_range_and_rank(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert (result["school_year"], result["age"], result["radius_km"]) == (114, 3, 3)
    assert result["current_school_year"] == current_term(today_local())[0]
    assert _group(result, "private") == {
        "kind": "private", "schools": 4, "with_fee": 3, "median": 75000, "lowest": 40200, "highest": 93000,
        "own_rank": 2, "rank_total": 4,
    }
    assert [group["kind"] for group in result["groups"]] == ["private", "quasi_public", "public", "nonprofit"]


async def test_other_kinds_are_background_only(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert _group(result, "quasi_public") == {
        "kind": "quasi_public", "schools": 1, "with_fee": 1, "median": None, "lowest": 63190, "highest": 63190,
        "own_rank": None, "rank_total": None,
    }
    assert (_group(result, "nonprofit")["schools"], _group(result, "nonprofit")["with_fee"]) == (1, 0)


async def test_the_radius_decides_who_counts(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=6, age=3)
    group = _group(result, "private")
    assert (group["with_fee"], group["median"], group["own_rank"], group["rank_total"]) == (4, 84000, 3, 5)


async def test_own_school_and_items(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert result["own"] == {
        "source_id": "own", "name": "高雄市私立常春藤幼兒園", "semester_total": 89750, "months": 5.5,
        "monthly_average": 16318, "items": OWN_ITEMS, "transport_note": "單 770 雙 1540",
    }
    assert result["own_missing"] is None
    items = {item["key"]: item for item in result["items"]}
    assert list(items) == ["tuition", "misc_fee", "materials", "activities", "lunch", "snack", "after_care_monthly"]
    assert items["tuition"] == {"key": "tuition", "own": 19900, "peer_median": 15000, "peer_count": 3}
    assert items["snack"] == {"key": "snack", "own": 8250, "peer_median": None, "peer_count": 0}


async def test_schools_list_everyone_in_the_radius_with_or_without_fees(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    schools = {school["source_id"]: school for school in result["schools"]}
    assert set(schools) == {"own", "p1", "p2", "p3", "p4", "q1", "pub", "np"}  # 4 公里外與停辦不在
    assert schools["own"]["is_own"] is True and schools["p1"]["is_own"] is False
    assert (schools["p4"]["semester_total"], schools["p4"]["monthly_average"]) == (None, None)
    assert (schools["p3"]["semester_total"], schools["p3"]["monthly_average"]) == (40200, None)  # 月數不知道
    assert [school["distance_m"] for school in result["schools"]] == sorted(school["distance_m"] for school in result["schools"])


async def test_own_school_without_this_age_or_not_found(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=4)
    assert (result["own"], result["own_missing"], _group(result, "private")["own_rank"]) == (None, "no_fee", None)
    await db_session.execute(delete(GeoKindergarten).where(GeoKindergarten.source_id == "own"))
    await db_session.commit()
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert (result["own"], result["own_missing"]) == (None, "not_found")


async def test_quasi_public_own_school_is_not_ranked(db_session, peers):
    await db_session.execute(
        update(GeoKindergarten).where(GeoKindergarten.source_id == "own").values(kind="quasi_public", pre_public_period="113-115")
    )
    await db_session.commit()
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert result["own"]["semester_total"] == 89750
    assert (_group(result, "private")["own_rank"], _group(result, "private")["rank_total"]) == (None, None)


async def test_groups_use_the_kind_of_the_fee_school_year(db_session, peers):
    # 收費是 114 學年的公告：準公共期間 115-115 的園所在 114 學年還是私立一般，不能照目前學年（115）分進準公共。
    add_kindergarten(db_session, "late", "高雄市私立晚幼兒園", "quasi_public", 450, pre_public_period="115-115")
    await db_session.flush()
    add_fee(db_session, "late", 3, 50000)
    await db_session.commit()
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert _group(result, "private") == {
        "kind": "private", "schools": 5, "with_fee": 4, "median": 62500, "lowest": 40200, "highest": 93000,
        "own_rank": 2, "rank_total": 5,
    }
    assert (_group(result, "quasi_public")["schools"], _group(result, "quasi_public")["with_fee"]) == (1, 1)
    schools = {school["source_id"]: school for school in result["schools"]}
    assert (schools["late"]["kind"], schools["q1"]["kind"]) == ("private", "quasi_public")
    items = {item["key"]: item for item in result["items"]}
    assert items["tuition"]["peer_count"] == 3  # late 沒有分項，不影響項目對照


async def test_a_pre_public_period_covering_the_fee_year_stays_quasi_public(db_session, peers):
    add_kindergarten(db_session, "long", "高雄市私立久幼兒園", "quasi_public", 450, pre_public_period="114-120")
    await db_session.flush()
    add_fee(db_session, "long", 3, 50000)
    await db_session.commit()
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert (_group(result, "private")["schools"], _group(result, "private")["median"]) == (4, 75000)
    assert (_group(result, "quasi_public")["schools"], _group(result, "quasi_public")["with_fee"]) == (2, 2)
    assert next(school for school in result["schools"] if school["source_id"] == "long")["kind"] == "quasi_public"


async def test_own_school_is_ranked_by_the_kind_of_the_fee_school_year(db_session, peers):
    await db_session.execute(
        update(GeoKindergarten).where(GeoKindergarten.source_id == "own").values(kind="quasi_public", pre_public_period="115-115")
    )
    await db_session.commit()
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert (_group(result, "private")["own_rank"], _group(result, "private")["rank_total"]) == (2, 4)
    assert next(school for school in result["schools"] if school["source_id"] == "own")["kind"] == "private"


async def test_without_a_fee_school_year_the_stored_kind_is_used(db_session, peers):
    add_kindergarten(db_session, "late", "高雄市私立晚幼兒園", "quasi_public", 450, pre_public_period="115-115")
    await db_session.execute(delete(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "kindergarten_fees"))
    await db_session.commit()
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert result["school_year"] is None
    assert next(school for school in result["schools"] if school["source_id"] == "late")["kind"] == "quasi_public"
    assert (_group(result, "quasi_public")["schools"], _group(result, "private")["schools"]) == (2, 4)


async def test_another_campuss_neighbour_is_our_own_institution_not_a_peer(db_session, peers):
    # 明華校址（明華一路 176 號，距義華約 4.5 km）旁 20 m 有一所私立：在義華的結果裡是本機構（F13），不進任何分組。
    await publish_campus_address(db_session, "minghua", "高雄市三民區明華一路176號")
    point = (await matcher.campus_points(db_session))["minghua"]
    now = datetime.now(timezone.utc)
    db_session.add(GeoKindergarten(
        source_id="mh", name="高雄市私立明華幼兒園", kind="private", district="三民區", address="明華一路176號",
        lat=point.lat + 20 / 111_320.0, lng=point.lng, approved_capacity=100, has_penalty=False, is_active=True, synced_at=now,
    ))
    await db_session.flush()
    add_fee(db_session, "mh", 3, 200000)
    await db_session.commit()
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=6, age=3)
    schools = {school["source_id"]: school for school in result["schools"]}
    assert schools["mh"]["is_own"] is True and schools["p1"]["is_own"] is False
    # 和沒有明華那所時（test_the_radius_decides_who_counts）完全一樣：4 公里外的 far 算，mh 不算。
    assert _group(result, "private") == {
        "kind": "private", "schools": 5, "with_fee": 4, "median": 84000, "lowest": 40200, "highest": 120000,
        "own_rank": 3, "rank_total": 5,
    }
    assert 200000 not in [school["semester_total"] for school in result["schools"] if not school["is_own"]]


async def test_campus_without_coordinates_returns_empty_lists(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "minghua", radius_km=3, age=3)
    assert result["campus"]["locate_error"] == "no_address"
    assert (result["own"], result["own_missing"], result["items"], result["schools"]) == (None, None, [], [])
    assert [group["with_fee"] for group in result["groups"]] == [0, 0, 0, 0]


async def test_never_imported(db_session, peers):
    await db_session.execute(delete(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "kindergarten_fees"))
    await db_session.commit()
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert (result["synced_at"], result["school_year"]) == (None, None)


async def test_babycare_summary_has_fees_and_own_two_year_old_monthly(db_session, peers):
    await load_babycare_sample(db_session)
    ids = (await db_session.execute(select(GeoBabycare.source_id).order_by(GeoBabycare.source_id))).scalars().all()
    for source_id, fee in zip(ids, (17900, 15000, 21000)):
        await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id == source_id).values(monthly_fee=fee))
    await db_session.commit()
    result = await area.query_babycare(db_session, "yihua", radius_km=6)
    summary = result["summary"]
    in_radius = [item["monthly_fee"] for item in result["items"] if item["monthly_fee"] is not None]
    assert summary["fee_count"] == len(in_radius)
    assert (summary["fee_min"], summary["fee_max"]) == (min(in_radius), max(in_radius))
    assert summary["own_age2_monthly"] == 19264  # 105,950 ÷ 5.5
    assert summary["fee_school_year"] == 114


async def test_babycare_summary_without_fees(db_session, peers):
    await load_babycare_sample(db_session)
    await db_session.execute(delete(GeoKindergartenFee).where(GeoKindergartenFee.age == 2))
    await db_session.commit()
    summary = (await area.query_babycare(db_session, "yihua", radius_km=3))["summary"]
    assert (summary["fee_count"], summary["fee_median"], summary["own_age2_monthly"]) == (0, None, None)
