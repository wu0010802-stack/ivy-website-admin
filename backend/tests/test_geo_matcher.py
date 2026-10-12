"""訪視地址比對（2026-10-08 規格 §6）：五個等級、校區座標、寫入訪視、重算。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, func, select, text, update
from sqlalchemy.dialects import postgresql

from app.admissions.geo import matcher
from app.admissions.geo.kaohsiung import CODE_OF_DISTRICT
from app.admissions.geo.matcher import (
    NEARBY_MAX_GAP,
    CampusPoint,
    GeoMatch,
    active_doorplate_version,
    apply_visit_geo,
    campus_point,
    campus_points,
    distance_to,
    doorplate_label,
    doorplate_state,
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
    missing = await campus_point(db_session, "yihua")
    assert (missing.locate_error, missing.district) == ("no_address", None)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    # 門牌還沒匯入：沒有座標，但行政區照樣從校址文字解析（地圖先框住這個區）。
    pending = await campus_point(db_session, "yihua")
    assert (pending.lat, pending.lng, pending.locate_error, pending.district) == (None, None, "pending", "三民區")

    await load_geo_samples(db_session)
    point = await campus_point(db_session, "yihua")
    assert point.locate_error is None
    assert point.district == "三民區"
    assert (point.lat, point.lng) == pytest.approx(YIHUA_POINT, abs=1e-6)

    await publish_campus_address(db_session, "renwu", "高雄市仁武區不存在路1號")
    points = await campus_points(db_session)
    assert set(points) == {"yihua", "minghua", "chongde", "international", "renwu"}
    assert (points["renwu"].locate_error, points["renwu"].district) == ("no_doorplate", "仁武區")


async def test_campus_point_district_from_address_text(db_session):
    """行政區只看地址文字：舊縣轄鄉鎮轉新區名；外縣市或解析不出高雄的區時是 None。"""
    await publish_campus_address(db_session, "international", "833高雄縣鳥松鄉球場路59號")
    assert (await campus_point(db_session, "international")).district == "鳥松區"
    await publish_campus_address(db_session, "renwu", "臺南市東區大學路1號")
    assert (await campus_point(db_session, "renwu")).district is None


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
    visit_id = visit.id
    db_session.expire_all()  # 不要拿記憶體裡剛設的值當證據，重新從資料庫讀
    visit = await db_session.get(RecruitmentVisit, visit_id)
    geo = await _geo(db_session, visit_id)
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
    visit_id = visit.id
    original_locate = matcher.locate

    async def locate_while_user_edits(db, address, *, version):
        async with app.state.session_factory() as other:
            await other.execute(
                update(RecruitmentVisit).where(RecruitmentVisit.id == visit_id).values(address="高雄市仁武區京吉一路102號")
            )
            await other.commit()
        return await original_locate(db, address, version=version)

    monkeypatch.setattr(matcher, "locate", locate_while_user_edits)
    await rematch_visits(db_session)
    assert (await db_session.execute(select(RecruitmentVisitGeo))).first() is None
    # 使用者剛存的新地址與行政區沒有被舊地址的比對結果蓋掉。
    db_session.expire_all()
    current = await db_session.get(RecruitmentVisit, visit_id)
    assert current.address == "高雄市仁武區京吉一路102號"
    assert current.district is None


async def test_status_row_is_what_marks_the_active_batch(db_session):
    await load_geo_samples(db_session)
    status = await db_session.get(GeoDatasetStatus, "doorplates")
    assert status.active_version == SAMPLE_TAG == await active_doorplate_version(db_session)


async def test_rematch_writes_distance_to_each_visits_own_campus(db_session):
    """重算要寫到本校的距離：有發布校址的校區算得出來，沒有的是 None。"""
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    near_id = (await add_visit(db_session, address="高雄縣仁武鄉京吉一路102號", campus_key="yihua")).id
    no_campus_id = (await add_visit(db_session, address="高雄縣仁武鄉京吉一路102號", campus_key="renwu")).id
    await db_session.commit()

    assert await rematch_visits(db_session) == 2
    db_session.expire_all()
    with_campus, without_campus = await _geo(db_session, near_id), await _geo(db_session, no_campus_id)
    assert (with_campus.village, with_campus.match_level, with_campus.distance_m) == ("八卦里", "exact", 4500)
    assert (without_campus.match_level, without_campus.distance_m) == ("exact", None)


async def _add_doorplate(db, *, version, street, number, village, district="三民區", lane="", alley="", lat=22.64, lng=120.34):
    db.add(
        GeoDoorplate(
            dataset_version=version, town_code=CODE_OF_DISTRICT[district], district=district, village=village,
            street=street, street_kind="road", lane=lane, alley=alley, number=number, number_sub=0, lat=lat, lng=lng,
        )
    )


async def test_rows_from_inactive_batches_are_ignored(db_session):
    """門牌換版後舊批次還在（下次同步才刪）：精確、鄰近、街路層級都只看使用中的批次。"""
    await load_geo_samples(db_session)
    old = "115-09#old000"
    await _add_doorplate(db_session, version=old, street="義華路", number=68, village="舊批次里")  # 同號
    await _add_doorplate(db_session, version=old, street="義華路", number=80, village="舊批次里")  # 78 號更近
    await _add_doorplate(db_session, version=old, street="憲政路", number=1, village="舊批次里")  # 街路層級
    await db_session.commit()

    exact = await locate(db_session, "高雄市三民區義華路68號", version=SAMPLE_TAG)
    assert (exact.village, exact.match_level) == ("本揚里", "exact")
    nearby = await locate(db_session, "高雄市三民區義華路78號", version=SAMPLE_TAG)
    assert (nearby.village, nearby.match_level) == ("本揚里", "nearby")
    street = await locate(db_session, "高雄市三民區憲政路", version=SAMPLE_TAG)
    assert (street.village, street.match_level) == ("博惠里", "street")  # 舊批次要是被算進去就是兩個里
    # 反過來查舊批次，只看到舊批次的列。
    assert (await locate(db_session, "高雄市三民區義華路68號", version=old)).village == "舊批次里"


async def test_nearby_tie_between_villages_is_decided_by_village_name_not_import_order(db_session):
    """同一側、號碼差距相同、但分在兩個里：以前靠 id（匯入順序）選邊，同一份資料換個匯入順序答案就變。
    現在固定先看里名（逐字元排序，與資料庫語系無關）。查 12 號：10 號與 14 號等距、同為雙號。"""
    await load_geo_samples(db_session)
    await _add_doorplate(db_session, version=SAMPLE_TAG, street="民族一路", number=14, village="本揚里", lat=22.7)
    await _add_doorplate(db_session, version=SAMPLE_TAG, street="民族一路", number=10, village="博惠里", lat=22.6)
    await db_session.commit()  # 本揚里的 id 比較小，舊作法會選本揚里

    match = await locate(db_session, "高雄市三民區民族一路12號", version=SAMPLE_TAG)
    assert (match.village, match.match_level, match.lat) == ("博惠里", "nearby", 22.6)  # 「博」(U+535A) 在「本」(U+672C) 前


def _filters(street: str, district: str = "三民區", lane: str = "", alley: str = "") -> tuple[tuple, tuple]:
    base = (
        GeoDoorplate.dataset_version == SAMPLE_TAG,
        GeoDoorplate.town_code == CODE_OF_DISTRICT[district],
        GeoDoorplate.street == street,
    )
    return base, (GeoDoorplate.lane == lane, GeoDoorplate.alley == alley)


async def test_nearby_query_can_use_the_number_column_of_the_index(db_session):
    """func.abs(number - n) 用不到 ix_geo_doorplates_lookup 的 number 欄；between 可以（rematch 會跑幾千次）。
    樣本只有幾十列，所以關掉循序掃描，看計畫的 Index Cond 有沒有 number 的範圍。"""
    await load_geo_samples(db_session)
    stmt = matcher._nearby_stmt(*_filters("義華路"), 70)
    sql = str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    await db_session.execute(text("SET LOCAL enable_seqscan = off"))
    plan = "\n".join((await db_session.execute(text("EXPLAIN " + sql))).scalars())
    index_conditions = [line for line in plan.splitlines() if "Index Cond" in line]
    assert index_conditions, plan
    assert any("number >=" in line and "number <=" in line for line in index_conditions), plan


async def _old_nearby(db, base, same_unit, number):
    """改成 between 之前的寫法（func.abs），留在這裡當對照組。"""
    return (
        await db.execute(
            select(GeoDoorplate.village, GeoDoorplate.lat, GeoDoorplate.lng)
            .where(*base, *same_unit, func.abs(GeoDoorplate.number - number) <= NEARBY_MAX_GAP)
            .order_by(
                func.mod(GeoDoorplate.number + number, 2),
                func.abs(GeoDoorplate.number - number),
                GeoDoorplate.number_sub,
                GeoDoorplate.id,
            )
            .limit(1)
        )
    ).first()


@pytest.mark.parametrize(
    ("street", "lane", "alley", "district"),
    [("義華路", "", "", "三民區"), ("京吉一路", "", "", "仁武區"), ("旗津三路", "900", "", "旗津區"), ("憲政路", "", "", "三民區")],
)
async def test_nearby_between_gives_the_same_answers_as_the_old_abs_filter(db_session, street, lane, alley, district):
    """同一批樣本、每個號碼（含邊界 ±30 與樣本之外）：between 與 abs 找到的列完全一樣。"""
    await load_geo_samples(db_session)
    base, same_unit = _filters(street, district, lane, alley)
    hits = 0
    for number in range(1, 260):
        new = (await db_session.execute(matcher._nearby_stmt(base, same_unit, number))).first()
        old = await _old_nearby(db_session, base, same_unit, number)
        assert (new and tuple(new)) == (old and tuple(old)), number
        hits += new is not None
    assert hits > 0  # 對照組不是空轉


async def test_active_version_and_label_are_read_in_one_statement(app, db_session):
    await load_geo_samples(db_session)
    seen: list[str] = []
    engine = app.state.session_factory.kw["bind"].sync_engine

    def record(conn, cursor, statement, parameters, context, executemany):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        assert await doorplate_state(db_session) == (SAMPLE_TAG, "115-10")
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert len([statement for statement in seen if "geo_dataset_status" in statement]) == 1


async def test_doorplate_state_before_the_first_import(db_session):
    assert await doorplate_state(db_session) == (None, None)
    assert await active_doorplate_version(db_session) is None
    assert await doorplate_label(db_session) is None


async def test_apply_and_rematch_do_not_read_version_and_label_separately(db_session, monkeypatch):
    """換版瞬間分兩次讀會拿到「新版本＋舊月份」。apply_visit_geo、rematch_visits 一律用 doorplate_state 一次讀，
    連校區座標也用同一個版本（不經過會自己再讀一次的 campus_point）。"""
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    first = await add_visit(db_session, address="高雄縣仁武鄉京吉一路102號")
    second = await add_visit(db_session, address="高雄市三民區義華路74號")
    await db_session.commit()
    first_id, second_id = first.id, second.id

    async def forbidden(*args, **kwargs):
        raise AssertionError("版本與月份要用 doorplate_state 一次讀")

    monkeypatch.setattr(matcher, "active_doorplate_version", forbidden)
    monkeypatch.setattr(matcher, "doorplate_label", forbidden)
    await apply_visit_geo(db_session, first)
    assert await rematch_visits(db_session) == 2
    db_session.expire_all()
    assert (await _geo(db_session, first_id)).doorplate_version == "115-10"
    assert (await _geo(db_session, second_id)).distance_m == 0
