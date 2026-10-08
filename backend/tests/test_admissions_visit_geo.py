"""招生訪視的區域比對結果（2026-10-08 區域分析規格 §5.4、§5.5、§6.1、§8.5、§10）：
建立與改地址時同交易比對、回應帶 geo、district 由伺服器填寫、匿名化清掉里與距離、
訪視明細的區域篩選。"""

from __future__ import annotations

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
    assert _ids(await _list(admin_client, village="寶業里")) == _expect(visits, "V3")
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
    """匯出稽核只記篩了哪一種區域，不記區名（同其他篩選只記類別的做法）。"""
    await seed_area(db_session)
    await db_session.commit()
    response = await admin_client.get(f"{ADMISSIONS}/records/export?campus_key=yihua&district=三民區&village=鼎金里")
    assert response.status_code == 200, response.text
    entry = await db_session.scalar(
        select(AuditLogEntry)
        .where(AuditLogEntry.action == "recruitment_visit.export")
        .order_by(AuditLogEntry.created_at.desc())
    )
    assert entry.metadata_json["area"] == "village"
    assert "三民區" not in str(entry.metadata_json)
    assert "鼎金里" not in str(entry.metadata_json)
