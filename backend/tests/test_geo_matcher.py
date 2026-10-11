"""訪視地址比對（2026-10-08 規格 §6）：五個等級、校區座標、寫入訪視、重算。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.admissions.geo import matcher
from app.admissions.geo.kaohsiung import CODE_OF_DISTRICT
from app.admissions.geo.matcher import (
    CampusPoint,
    GeoMatch,
    active_doorplate_version,
    apply_visit_geo,
    campus_point,
    campus_points,
    distance_to,
    locate,
    rematch_visits,
)
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, RecruitmentVisitGeo
from app.admissions.models import RecruitmentVisit
from tests.geo_helpers import SAMPLE_ADDRESSES, SAMPLE_TAG, YIHUA_POINT, add_visit, load_geo_samples, publish_campus_address

LOCATE_CASES = [
    # (地址, 區, 里, 等級, 未定位原因)
    ("高雄市三民區義華路68號", "三民區", "本揚里", "exact", None),
    ("高雄市三民區義華路68之1號", "三民區", "本揚里", "exact", None),  # 之號對不到退回之 0
    ("高雄縣仁武鄉京吉一路102號", "仁武區", "八卦里", "exact", None),
    ("高雄市旗津區旗津三路900巷3弄1號", "旗津區", "復興里", "exact", None),
    ("高雄市仁武區仁心路博愛巷1弄2之1號", "仁武區", "考潭里", "exact", None),
    ("高雄市楠梓區右昌一巷12號", "楠梓區", "福昌里", "exact", None),
    ("高雄市鼓山區中華一路102號", "鼓山區", "北美術館里", "exact", None),
    ("高雄市三民區義華路74號", "三民區", "本揚里", "nearby", None),
    ("高雄市仁武區京吉一路104號", "仁武區", "八卦里", "nearby", None),
    ("高雄市三民區義華路200號", "三民區", "本揚里", "street", None),  # 差超過 30 號
    ("高雄市三民區憲政路", "三民區", "博惠里", "street", None),
    ("高雄市三民區九如一路1號", "三民區", None, "district", None),
    ("高雄市旗津區旗津三路900巷1號", "旗津區", None, "district", "ambiguous_village"),
    ("臺南市東區中華東路二段185巷14號", None, None, "unlocated", "outside_kaohsiung"),
    ("義華路68號", None, None, "unlocated", "no_doorplate"),
    ("", None, None, "unlocated", "no_address"),
    (None, None, None, "unlocated", "no_address"),
]


@pytest.mark.parametrize(("address", "district", "village", "level", "reason"), LOCATE_CASES)
async def test_locate_levels(db_session, address, district, village, level, reason):
    await load_geo_samples(db_session)
    match = await locate(db_session, address, version=await active_doorplate_version(db_session))
    assert (match.district, match.village, match.match_level, match.unlocated_reason) == (district, village, level, reason)
    has_point = level in ("exact", "nearby")
    assert (match.lat is not None, match.lng is not None) == (has_point, has_point)


async def test_nearby_prefers_same_parity_side_over_closer_opposite_side(db_session):
    """R7：鄰近比對先看單雙號（同一側街廓），再看號碼差距。10 號甲里、11、13 號乙里，
    查 12 號回甲里（同為雙號、差 2），不是乙里（差 1 但對側）。"""
    await load_geo_samples(db_session)
    for number, village in ((10, "博惠里"), (11, "本揚里"), (13, "本揚里")):
        db_session.add(
            GeoDoorplate(
                dataset_version=SAMPLE_TAG, town_code=CODE_OF_DISTRICT["三民區"], district="三民區", village=village,
                street="民族一路", street_kind="road", lane="", alley="", number=number, number_sub=0,
                lat=22.6431 + number * 1e-5, lng=120.3098,
            )
        )
    await db_session.commit()

    match = await locate(db_session, "高雄市三民區民族一路12號", version=SAMPLE_TAG)
    assert (match.district, match.village, match.match_level) == ("三民區", "博惠里", "nearby")
    assert match.lat == pytest.approx(22.6431 + 10 * 1e-5)


async def test_sample_addresses_for_later_stages(db_session):
    await load_geo_samples(db_session)
    version = await active_doorplate_version(db_session)
    levels = {key: (await locate(db_session, value, version=version)).match_level for key, value in SAMPLE_ADDRESSES.items()}
    assert levels == {
        "yihua_exact": "exact", "yihua_nearby": "nearby", "district_only": "district",
        "outside": "unlocated", "ambiguous": "district",
    }


async def test_pending_before_doorplates_are_imported(db_session):
    assert await active_doorplate_version(db_session) is None
    match = await locate(db_session, "高雄市三民區義華路68號", version=None)
    assert match == GeoMatch("三民區", None, "pending", None, None, None)
    outside = await locate(db_session, "臺南市東區中華東路二段185巷14號", version=None)
    assert outside.unlocated_reason == "outside_kaohsiung"


async def test_campus_point(db_session):
    assert (await campus_point(db_session, "yihua")).locate_error == "no_address"
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    assert (await campus_point(db_session, "yihua")).locate_error == "pending"

    await load_geo_samples(db_session)
    point = await campus_point(db_session, "yihua")
    assert point.locate_error is None
    assert (point.lat, point.lng) == pytest.approx(YIHUA_POINT, abs=1e-6)

    await publish_campus_address(db_session, "renwu", "高雄市仁武區不存在路1號")
    points = await campus_points(db_session)
    assert set(points) == {"yihua", "minghua", "chongde", "international", "renwu"}
    assert points["renwu"].locate_error == "no_doorplate"


def test_distance_rounds_to_100m():
    point = CampusPoint("yihua", *YIHUA_POINT, None)
    renwu = GeoMatch("仁武區", "八卦里", "exact", None, 22.68262, 120.3419108)
    assert distance_to(renwu, point) == 4500
    assert distance_to(GeoMatch("三民區", "本揚里", "street", None, None, None), point) is None
    assert distance_to(renwu, CampusPoint("yihua", None, None, "pending")) is None


async def _geo(db, visit_id) -> RecruitmentVisitGeo:
    return (await db.execute(select(RecruitmentVisitGeo).where(RecruitmentVisitGeo.visit_id == visit_id))).scalar_one()


async def test_apply_visit_geo_writes_result_without_touching_version(db_session):
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    visit = await add_visit(db_session, address="高雄縣仁武鄉京吉一路102號")
    await apply_visit_geo(db_session, visit)
    await db_session.commit()

    geo = await _geo(db_session, visit.id)
    assert visit.district == "仁武區" and visit.version == 1
    assert (geo.village, geo.match_level, geo.unlocated_reason, geo.distance_m, geo.doorplate_version) == (
        "八卦里", "exact", None, 4500, "115-10",
    )


@pytest.mark.parametrize(
    ("new_address", "reason"), [("  ", "no_address"), ("臺南市東區中華東路二段185巷14號", "outside_kaohsiung")]
)
async def test_changed_address_clears_old_result(db_session, new_address, reason):
    """Review Focus 2：地址改成空白或外縣市，舊的區、里、距離都不殘留。"""
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    visit = await add_visit(db_session, address="高雄市三民區義華路68號")
    await apply_visit_geo(db_session, visit)
    await db_session.commit()

    visit.address = new_address
    await apply_visit_geo(db_session, visit)
    await db_session.commit()
    geo = await _geo(db_session, visit.id)
    assert visit.district is None
    assert (geo.village, geo.match_level, geo.unlocated_reason, geo.distance_m) == (None, "unlocated", reason, None)


async def test_anonymized_visit_is_left_alone(db_session):
    await load_geo_samples(db_session)
    visit = await add_visit(db_session, address=None, anonymized=True)
    await apply_visit_geo(db_session, visit)
    await db_session.commit()
    assert (await db_session.execute(select(RecruitmentVisitGeo))).first() is None


async def test_rematch_keeps_version_and_updated_at(db_session):
    """Review Focus 5：重算只寫比對結果與 district，不加 version、不改 updated_at。"""
    await load_geo_samples(db_session)
    visit_id = (await add_visit(db_session, address="高雄市三民區義華路74號")).id
    anonymized_id = (await add_visit(db_session, address=None, anonymized=True)).id
    stamp = datetime.now(timezone.utc) - timedelta(days=3)
    await db_session.execute(update(RecruitmentVisit).values(updated_at=stamp, version=4))
    await db_session.commit()

    assert await rematch_visits(db_session, batch_size=1) == 1  # 匿名化的不算

    db_session.expire_all()
    refreshed = await db_session.get(RecruitmentVisit, visit_id)
    assert (refreshed.version, refreshed.updated_at, refreshed.district) == (4, stamp, "三民區")
    assert (await _geo(db_session, visit_id)).match_level == "nearby"
    geo_of_anonymized = select(RecruitmentVisitGeo).where(RecruitmentVisitGeo.visit_id == anonymized_id)
    assert (await db_session.execute(geo_of_anonymized)).first() is None


async def test_rematch_commits_every_100_visits_by_default(db_session, monkeypatch):
    """一批持有這些列的列鎖直到 commit，同時編輯要等；預設一批 100 筆，101 筆就是兩次 commit。"""
    await load_geo_samples(db_session)
    for _ in range(101):
        await add_visit(db_session, address="高雄市三民區義華路68號")
    await db_session.commit()
    commits = 0
    real_commit = db_session.commit

    async def counting_commit():
        nonlocal commits
        commits += 1
        await real_commit()

    monkeypatch.setattr(db_session, "commit", counting_commit)
    assert await rematch_visits(db_session) == 101
    assert commits == 2


async def test_rematch_does_not_overwrite_a_concurrent_address_edit(db_session, app, monkeypatch):
    await load_geo_samples(db_session)
    visit = await add_visit(db_session, address="高雄市三民區義華路68號")
    await db_session.commit()
    original_locate = matcher.locate

    async def locate_while_user_edits(db, address, *, version):
        async with app.state.session_factory() as other:
            await other.execute(
                update(RecruitmentVisit).where(RecruitmentVisit.id == visit.id).values(address="高雄市仁武區京吉一路102號")
            )
            await other.commit()
        return await original_locate(db, address, version=version)

    monkeypatch.setattr(matcher, "locate", locate_while_user_edits)
    await rematch_visits(db_session)
    assert (await db_session.execute(select(RecruitmentVisitGeo))).first() is None


async def test_status_row_is_what_marks_the_active_batch(db_session):
    await load_geo_samples(db_session)
    status = await db_session.get(GeoDatasetStatus, "doorplates")
    assert status.active_version == SAMPLE_TAG == await active_doorplate_version(db_session)
