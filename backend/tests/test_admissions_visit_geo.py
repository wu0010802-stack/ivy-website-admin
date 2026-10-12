"""招生訪視的區域比對結果（2026-10-08 區域分析規格 §5.4、§5.5、§6.1、§8.5、§10）：
建立與改地址時同交易比對、回應帶 geo、district 由伺服器填寫、匿名化清掉里與距離、
訪視明細的區域篩選。"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, event, select, update

from app.admissions import retention
from app.admissions.geo.address import parse_address
from app.admissions.geo.models import RecruitmentVisitGeo
from app.admissions.models import RecruitmentVisit
from app.operations.models import AuditLogEntry
from tests.admissions_area_helpers import add_visit, seed_area
from tests.admissions_helpers import ADMISSIONS, complete, create_record, started_booking
from tests.geo_helpers import SAMPLE_ADDRESSES, load_geo_samples, publish_campus_address


@pytest.fixture
async def geo_samples(db_session):
    await load_geo_samples(db_session)
    await db_session.commit()


async def _geo_row(db_session, visit_id: str) -> RecruitmentVisitGeo | None:
    return await db_session.scalar(
        select(RecruitmentVisitGeo)
        .where(RecruitmentVisitGeo.visit_id == uuid.UUID(visit_id))
        .execution_options(populate_existing=True)
    )


async def _patch(client, record: dict, **changes) -> dict:
    response = await client.patch(
        f"{ADMISSIONS}/records/{record['id']}", json={"expected_version": record["version"], **changes}
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_create_with_address_writes_village_and_district(admin_client, geo_samples):
    address = SAMPLE_ADDRESSES["yihua_exact"]
    record = await create_record(admin_client, address=address)
    assert record["geo"]["match_level"] == "exact"
    assert record["geo"]["village"]
    assert record["geo"]["unlocated_reason"] is None
    assert record["district"] == parse_address(address).district
    assert record["version"] == 1
    fetched = (await admin_client.get(f"{ADMISSIONS}/records/{record['id']}")).json()
    assert fetched["geo"] == record["geo"]


async def test_create_without_address_is_unlocated(admin_client, geo_samples):
    record = await create_record(admin_client)
    assert record["geo"] == {"village": None, "match_level": "unlocated", "unlocated_reason": "no_address", "distance_m": None}
    assert record["district"] is None


async def test_booking_arrival_writes_geo_row(admin_client, public_client, db_session, geo_samples):
    """標記已到場時建立的訪視也走 create_visit：沒有地址，比對結果是 no_address。"""
    booking = await started_booking(admin_client, public_client, db_session)
    done = await complete(admin_client, booking["id"])
    assert done.status_code == 200, done.text
    visit = await db_session.scalar(
        select(RecruitmentVisit)
        .where(RecruitmentVisit.visit_request_id == uuid.UUID(str(booking["id"])))
        .execution_options(populate_existing=True)
    )
    geo = await _geo_row(db_session, str(visit.id))
    assert geo is not None
    assert (geo.match_level, geo.unlocated_reason) == ("unlocated", "no_address")


async def test_rebuilding_from_a_visit_request_writes_the_geo_row_too(admin_client, public_client, db_session, geo_samples):
    """補建端點（POST /from-visit-request）也走 create_visit：回應帶比對結果、資料庫有 geo 列。
    預約沒有地址，所以是 unlocated／no_address。"""
    booking = await started_booking(admin_client, public_client, db_session)
    assert (await complete(admin_client, booking["id"])).status_code == 200
    first = await db_session.scalar(
        select(RecruitmentVisit)
        .where(RecruitmentVisit.visit_request_id == uuid.UUID(str(booking["id"])))
        .execution_options(populate_existing=True)
    )
    assert (await admin_client.delete(f"{ADMISSIONS}/records/{first.id}?expected_version={first.version}")).status_code == 204
    assert await _geo_row(db_session, str(first.id)) is None  # 刪訪視連帶刪 geo 列

    rebuilt = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{booking['id']}")
    assert rebuilt.status_code == 200, rebuilt.text
    expected = {"village": None, "match_level": "unlocated", "unlocated_reason": "no_address", "distance_m": None}
    assert rebuilt.json()["geo"] == expected
    assert rebuilt.json()["district"] is None
    geo = await _geo_row(db_session, rebuilt.json()["id"])
    assert geo is not None and (geo.match_level, geo.unlocated_reason) == ("unlocated", "no_address")
    assert geo.doorplate_version == "115-10"  # 當時使用中的門牌月份
    fetched = (await admin_client.get(f"{ADMISSIONS}/records/{rebuilt.json()['id']}")).json()
    assert fetched["geo"] == expected


async def test_editing_address_to_outside_clears_district_and_village(admin_client, geo_samples):
    """Review Focus 2：改到外縣市，舊的里與行政區不殘留；只加一次 version。"""
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_exact"])
    moved = await _patch(admin_client, record, address=SAMPLE_ADDRESSES["outside"])
    assert moved["version"] == 2
    assert moved["district"] is None
    assert moved["geo"] == {
        "village": None, "match_level": "unlocated", "unlocated_reason": "outside_kaohsiung", "distance_m": None,
    }


async def test_editing_address_to_blank_is_no_address(admin_client, geo_samples):
    """Review Focus 2：清空地址（空白字串在 schema 被清成 null）。"""
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_exact"])
    cleared = await _patch(admin_client, record, address="   ")
    assert cleared["address"] is None
    assert cleared["district"] is None
    assert cleared["geo"]["match_level"] == "unlocated"
    assert cleared["geo"]["unlocated_reason"] == "no_address"
    assert cleared["geo"]["village"] is None


async def test_editing_other_fields_keeps_geo(admin_client, db_session, geo_samples):
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_exact"])
    before = await _geo_row(db_session, record["id"])
    matched_at = before.matched_at
    updated = await _patch(admin_client, record, notes="家長想了解午睡")
    assert updated["geo"] == record["geo"]
    after = await _geo_row(db_session, record["id"])
    assert after.matched_at == matched_at


async def test_district_from_client_is_still_rejected(admin_client):
    response = await admin_client.post(
        f"{ADMISSIONS}/records?campus_key=yihua",
        json={
            "visit_date": "2026-09-08", "child_name": "王小明", "birthday": "2023-03-02",
            "target_school_year": 115, "target_semester": 1, "district": "三民區",
        },
    )
    assert response.status_code == 422


async def test_district_in_a_patch_is_rejected_too(admin_client, geo_samples):
    """行政區由伺服器依地址填，修改時帶 district 也是 422（建立時同樣，見上一則）。"""
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_exact"])
    response = await admin_client.patch(
        f"{ADMISSIONS}/records/{record['id']}", json={"expected_version": record["version"], "district": "苓雅區"}
    )
    assert response.status_code == 422, response.text
    fetched = (await admin_client.get(f"{ADMISSIONS}/records/{record['id']}")).json()
    assert fetched["district"] == record["district"] and fetched["version"] == record["version"]


@pytest.mark.parametrize("target", ["outside", "blank"])
async def test_moving_address_away_clears_stored_geo_and_district(admin_client, db_session, geo_samples, target):
    """Review Focus 2（資料庫層）：舊的里、距離、行政區都清掉，不只是回應看起來對。
    先發布本校校址，讓原本的比對結果帶距離，才能證明距離被清掉。"""
    await publish_campus_address(db_session, "yihua", SAMPLE_ADDRESSES["yihua_exact"])
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_nearby"])
    stored = await _geo_row(db_session, record["id"])
    assert (stored.match_level, stored.distance_m) == ("nearby", 0)
    assert stored.village
    new_address, reason = (
        (SAMPLE_ADDRESSES["outside"], "outside_kaohsiung") if target == "outside" else ("   ", "no_address")
    )
    await _patch(admin_client, record, address=new_address)
    moved = await _geo_row(db_session, record["id"])
    assert (moved.village, moved.match_level, moved.unlocated_reason, moved.distance_m) == (
        None, "unlocated", reason, None,
    )
    district = await db_session.scalar(
        select(RecruitmentVisit.district)
        .where(RecruitmentVisit.id == uuid.UUID(record["id"]))
        .execution_options(populate_existing=True)
    )
    assert district is None


async def _age(db_session, visit_id: str, days: int) -> None:
    """把訪視的 updated_at 推到 days 天前，讓保存政策判定到期。"""
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(visit_id))
        .values(updated_at=datetime.now(timezone.utc) - timedelta(days=days))
    )
    await db_session.commit()


async def test_anonymize_keeps_district_and_clears_village(admin_client, db_session, geo_samples):
    """規格 §10：清掉里與距離，行政區保留（同園務、同既有行為）。"""
    address = SAMPLE_ADDRESSES["yihua_exact"]
    record = await create_record(admin_client, address=address)
    await _age(db_session, record["id"], 60)
    assert await retention.anonymize_due(db_session, 30) == 1
    await db_session.commit()
    visit = await db_session.scalar(
        select(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(record["id"]))
        .execution_options(populate_existing=True)
    )
    assert visit.address is None
    assert visit.district == parse_address(address).district
    geo = await _geo_row(db_session, record["id"])
    assert (geo.village, geo.distance_m) == (None, None)
    assert (geo.match_level, geo.unlocated_reason) == ("district", "anonymized")


async def test_anonymize_clears_distance_of_nearby_visit(admin_client, db_session, geo_samples):
    """有校址時比對結果帶距離；匿名化後距離和里都清掉，等級退到 district。"""
    await publish_campus_address(db_session, "yihua", SAMPLE_ADDRESSES["yihua_exact"])
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_nearby"])
    stored = await _geo_row(db_session, record["id"])
    assert (stored.match_level, stored.distance_m) == ("nearby", 0)
    await _age(db_session, record["id"], 60)
    assert await retention.anonymize_due(db_session, 30) == 1
    await db_session.commit()
    geo = await _geo_row(db_session, record["id"])
    assert (geo.village, geo.distance_m, geo.match_level, geo.unlocated_reason) == (
        None, None, "district", "anonymized",
    )


async def test_anonymize_only_touches_the_due_visits_and_is_idempotent(admin_client, db_session, geo_samples):
    """只動到期的那一筆：沒到期的訪視，里、距離、行政區都原封不動。再跑一次什麼都不做，
    已匿名化那筆的比對結果維持 district／anonymized。"""
    await publish_campus_address(db_session, "yihua", SAMPLE_ADDRESSES["yihua_exact"])
    due = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_nearby"])
    fresh = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_exact"])
    fresh_before = await _geo_row(db_session, fresh["id"])
    snapshot = (fresh_before.village, fresh_before.match_level, fresh_before.distance_m, fresh_before.unlocated_reason)
    assert snapshot[0] is not None and snapshot[1] == "exact"
    await _age(db_session, due["id"], 60)

    assert await retention.anonymize_due(db_session, 30) == 1
    await db_session.commit()
    fresh_after = await _geo_row(db_session, fresh["id"])
    assert (fresh_after.village, fresh_after.match_level, fresh_after.distance_m, fresh_after.unlocated_reason) == snapshot
    fresh_visit = await db_session.scalar(
        select(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(fresh["id"])).execution_options(populate_existing=True)
    )
    assert (fresh_visit.district, fresh_visit.anonymized_at) == (parse_address(SAMPLE_ADDRESSES["yihua_exact"]).district, None)

    done = await _geo_row(db_session, due["id"])
    assert (done.village, done.distance_m, done.match_level, done.unlocated_reason) == (None, None, "district", "anonymized")
    matched_at = done.matched_at
    assert await retention.anonymize_due(db_session, 30) == 0  # 已匿名化的不再算到期
    await db_session.commit()
    again = await _geo_row(db_session, due["id"])
    assert (again.village, again.distance_m, again.match_level, again.unlocated_reason, again.matched_at) == (
        None, None, "district", "anonymized", matched_at,
    )


async def test_anonymize_updates_geo_objects_already_loaded_in_the_session(admin_client, db_session, geo_samples):
    """同一個 session 裡已經載入的 geo 物件，匿名化之後不必 refresh 就是新值（Core UPDATE 用
    synchronize_session=fetch）；否則同交易後面的程式會讀到舊的里與距離。"""
    await publish_campus_address(db_session, "yihua", SAMPLE_ADDRESSES["yihua_exact"])
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_nearby"])
    await _age(db_session, record["id"], 60)
    loaded = await db_session.get(RecruitmentVisitGeo, uuid.UUID(record["id"]))
    assert (loaded.village, loaded.match_level) != (None, "district")  # 載入時還是舊值
    assert await retention.anonymize_due(db_session, 30) == 1
    assert (loaded.village, loaded.distance_m, loaded.match_level, loaded.unlocated_reason) == (
        None, None, "district", "anonymized",
    )


async def test_anonymize_without_district_is_unlocated(admin_client, db_session, geo_samples):
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["outside"])
    await _age(db_session, record["id"], 60)
    assert await retention.anonymize_due(db_session, 30) == 1
    await db_session.commit()
    geo = await _geo_row(db_session, record["id"])
    assert (geo.match_level, geo.unlocated_reason, geo.village) == ("unlocated", "anonymized", None)


async def test_anonymize_without_geo_row_is_fine(admin_client, db_session, geo_samples):
    """上線前就存在、從沒比對過的訪視沒有 geo 列：匿名化照常，不補建。"""
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_exact"])
    await db_session.execute(delete(RecruitmentVisitGeo).where(RecruitmentVisitGeo.visit_id == uuid.UUID(record["id"])))
    await db_session.commit()
    await _age(db_session, record["id"], 60)
    assert await retention.anonymize_due(db_session, 30) == 1
    await db_session.commit()
    assert await _geo_row(db_session, record["id"]) is None


async def test_anonymize_updates_visit_row_before_geo_row(admin_client, db_session, geo_samples):
    """鎖定順序（與 matcher.rematch_visits 相同）：先 UPDATE recruitment_visits，再 UPDATE
    recruitment_visit_geo，兩個動作都不顛倒。"""
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_exact"])
    await _age(db_session, record["id"], 60)
    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(" ".join(statement.split()).lower())

    engine = db_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", _record)
    try:
        assert await retention.anonymize_due(db_session, 30) == 1
        await db_session.commit()
    finally:
        event.remove(engine, "before_cursor_execute", _record)
    visit_updates = [i for i, sql in enumerate(statements) if sql.startswith("update recruitment_visits ")]
    geo_updates = [i for i, sql in enumerate(statements) if sql.startswith("update recruitment_visit_geo ")]
    assert visit_updates and geo_updates
    assert max(visit_updates) < min(geo_updates)


async def test_anonymize_locks_due_visits_in_id_order(admin_client, db_session, geo_samples):
    """與 matcher.rematch_visits（依 id 逐列鎖）同一個順序，兩邊同時跑才不會互等：
    匿名化鎖到期列的那句 SELECT … FOR UPDATE 必須依 recruitment_visits.id 排序。"""
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_exact"])
    await _age(db_session, record["id"], 60)
    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(" ".join(statement.split()).lower())

    engine = db_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", _record)
    try:
        assert await retention.anonymize_due(db_session, 30) == 1
        await db_session.commit()
    finally:
        event.remove(engine, "before_cursor_execute", _record)
    locking = [sql for sql in statements if " for update" in sql]
    assert len(locking) == 1
    assert "order by recruitment_visits.id for update" in locking[0]
    assert "created_at" not in locking[0].split("order by", 1)[1]


# ---- 訪視明細的區域篩選（規格 §8.4；主控裁定 R2、R4） ----


def _ids(rows: list[dict]) -> set[str]:
    return {row["id"] for row in rows}


def _expect(visits: dict, *keys: str) -> set[str]:
    return {str(visits[key].id) for key in keys}


async def _list(client, **params) -> list[dict]:
    query = "&".join(f"{key}={value}" for key, value in {"campus_key": "yihua", **params}.items())
    response = await client.get(f"{ADMISSIONS}/records?{query}&page_size=100")
    assert response.status_code == 200, response.text
    return response.json()


async def test_records_filter_by_district_and_village(admin_client, db_session):
    """明細列表沒有預設學年篩選，114 學年的 X2 也在結果裡（X1 是明華，被 campus_key 擋掉）。"""
    visits = await seed_area(db_session)
    await db_session.commit()
    assert _ids(await _list(admin_client, district="三民區")) == _expect(visits, "V1", "V2", "V3", "V5", "V10", "X2")
    assert _ids(await _list(admin_client, district="三民區", village="鼎金里")) == _expect(visits, "V1", "V2", "X2")
    # 里要比對到里才算：V5（里有歧義）、匿名化的 V10 不算。
    assert _ids(await _list(admin_client, district="三民區", village="寶業里")) == _expect(visits, "V3")
    assert _ids(await _list(admin_client, district="左營區")) == _expect(visits, "V4")


async def test_records_filter_no_village(admin_client, db_session):
    """未定位到里＝有地址、但沒比對到里：只到區、境外、待比對、沒有比對結果。
    沒填地址（V6）與已匿名化（V10、V11）不算；比對到里的（V1–V3、X2）也不算。"""
    visits = await seed_area(db_session)
    await db_session.commit()
    rows = await _list(admin_client, geo="no_village")
    assert _ids(rows) == _expect(visits, "V4", "V5", "V7", "V8", "V9")


async def test_records_filter_no_village_excludes_no_address_and_anonymized(admin_client, db_session):
    visits = await seed_area(db_session)
    blank = await add_visit(db_session, address="   ", geo={"level": "unlocated", "reason": "no_address"})
    await db_session.commit()
    found = _ids(await _list(admin_client, geo="no_village"))
    assert str(visits["V6"].id) not in found  # 地址是 NULL
    assert str(blank.id) not in found  # 地址只有空白
    assert str(visits["V10"].id) not in found  # 已匿名化、沒有比對結果
    assert str(visits["V11"].id) not in found  # 已匿名化、unlocated／anonymized


async def test_records_filter_no_village_includes_pending_and_unmatched(admin_client, db_session):
    visits = await seed_area(db_session)
    await db_session.commit()
    found = _ids(await _list(admin_client, geo="no_village"))
    assert str(visits["V8"].id) in found  # pending（有 geo 列）
    assert str(visits["V9"].id) in found  # 有地址、沒有 geo 列（上線前的舊訪視）


async def test_records_list_carries_geo(admin_client, db_session):
    visits = await seed_area(db_session)
    await db_session.commit()
    by_id = {row["id"]: row for row in await _list(admin_client)}
    assert by_id[str(visits["V1"].id)]["geo"] == {
        "village": "鼎金里", "match_level": "exact", "unlocated_reason": None, "distance_m": 800,
    }
    assert by_id[str(visits["V9"].id)]["geo"] is None


async def test_records_filter_rejects_unknown_geo_value(admin_client):
    response = await admin_client.get(f"{ADMISSIONS}/records?campus_key=yihua&geo=somewhere")
    assert response.status_code == 422


async def test_records_export_audits_area_filter_category(admin_client, db_session):
    """匯出稽核只記篩了哪些區域條件（行政區、里），不記區名與里名（同其他篩選只記類別的做法）。"""
    await seed_area(db_session)
    await db_session.commit()
    response = await admin_client.get(f"{ADMISSIONS}/records/export?campus_key=yihua&district=三民區&village=鼎金里")
    assert response.status_code == 200, response.text
    entry = await db_session.scalar(
        select(AuditLogEntry)
        .where(AuditLogEntry.action == "recruitment_visit.export")
        .order_by(AuditLogEntry.created_at.desc())
    )
    assert entry.metadata_json["area"] == "district+village"
    assert "三民區" not in str(entry.metadata_json)
    assert "鼎金里" not in str(entry.metadata_json)


async def test_records_filter_village_without_district_is_refused(admin_client, db_session):
    """不同行政區有同名的里（例：中正里）：只給里會跨區命中，所以要求一定要同時給行政區。
    列表與匯出都一樣，不是默默回一份混了別區的結果。"""
    await seed_area(db_session)
    await db_session.commit()
    for path in ("records", "records/export"):
        response = await admin_client.get(f"{ADMISSIONS}/{path}?campus_key=yihua&village=%E5%AF%B6%E6%A5%AD%E9%87%8C")
        assert response.status_code == 422, (path, response.text)
        assert response.json()["detail"]["code"] == "VILLAGE_NEEDS_DISTRICT"
    # 空白的行政區等於沒給
    blank = await admin_client.get(f"{ADMISSIONS}/records?campus_key=yihua&village=%E5%AF%B6%E6%A5%AD%E9%87%8C&district=%20")
    assert blank.status_code == 422


async def test_records_filter_same_village_name_in_two_districts_stays_apart(admin_client, db_session):
    """同名的里 + 各自的行政區：三民區的「中正里」不會撈到鼓山區的。"""
    san = await add_visit(db_session, district="三民區", geo={"level": "exact", "village": "中正里", "distance_m": 100})
    gu = await add_visit(db_session, district="鼓山區", geo={"level": "exact", "village": "中正里", "distance_m": 100})
    await db_session.commit()
    assert _ids(await _list(admin_client, district="三民區", village="中正里")) == {str(san.id)}
    assert _ids(await _list(admin_client, district="鼓山區", village="中正里")) == {str(gu.id)}


async def test_records_filter_trims_district_and_village(admin_client, db_session):
    visits = await seed_area(db_session)
    await db_session.commit()
    padded = await _list(admin_client, district="%20三民區%20", village="%20鼎金里%20")
    assert _ids(padded) == _expect(visits, "V1", "V2", "X2")
    assert _ids(await _list(admin_client, district="%20%20")) == _ids(await _list(admin_client))  # 只有空白＝沒篩


@pytest.mark.parametrize(("district", "village"), [("區" * 31, None), ("三民區", "里" * 17)])
async def test_records_filter_rejects_too_long_district_or_village(admin_client, district, village):
    params = f"district={district}" + (f"&village={village}" if village else "")
    response = await admin_client.get(f"{ADMISSIONS}/records?campus_key=yihua&{params}")
    assert response.status_code == 422


async def test_records_filter_boundary_lengths_are_accepted(admin_client):
    response = await admin_client.get(f"{ADMISSIONS}/records?campus_key=yihua&district={'區' * 30}&village={'里' * 16}")
    assert response.status_code == 200, response.text
    assert response.json() == []


async def test_records_filter_area_combined_with_school_year_and_semester(admin_client, db_session):
    """區域條件與入學學年、學期可以一起用（交集）：X2 是 114 學年，只在不指定學年時出現。"""
    visits = await seed_area(db_session)
    await db_session.commit()
    both = await _list(admin_client, district="三民區", village="鼎金里", target_school_year=115, target_semester=1)
    assert _ids(both) == _expect(visits, "V1", "V2")
    old_year = await _list(admin_client, district="三民區", village="鼎金里", target_school_year=114)
    assert _ids(old_year) == _expect(visits, "X2")
    assert _ids(await _list(admin_client, district="三民區", target_school_year=115, target_semester=2)) == set()
    no_village = await _list(admin_client, geo="no_village", target_school_year=115, target_semester=1)
    assert _ids(no_village) == _expect(visits, "V4", "V5", "V7", "V8", "V9")


async def test_records_export_row_count_matches_the_list_with_an_area_filter(admin_client, db_session):
    """匯出：稽核的 row_count、CSV 實際的資料列、同篩選的列表筆數三者一致。"""
    await seed_area(db_session)
    await db_session.commit()
    query = "campus_key=yihua&district=%E4%B8%89%E6%B0%91%E5%8D%80&village=%E9%BC%8E%E9%87%91%E9%87%8C"
    listed = (await admin_client.get(f"{ADMISSIONS}/records?{query}&page_size=100")).json()
    response = await admin_client.get(f"{ADMISSIONS}/records/export?{query}")
    assert response.status_code == 200, response.text
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    entry = await db_session.scalar(
        select(AuditLogEntry).where(AuditLogEntry.action == "recruitment_visit.export").order_by(AuditLogEntry.created_at.desc())
    )
    assert len(rows) - 1 == len(listed) == entry.metadata_json["row_count"] == 3  # V1、V2、X2
    assert entry.metadata_json["area"] == "district+village"
