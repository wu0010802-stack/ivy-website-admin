"""招生訪視的區域比對結果（2026-10-08 區域分析規格 §5.4、§5.5、§6.1、§8.5、§10）：
建立與改地址時同交易比對、回應帶 geo、district 由伺服器填寫、匿名化清掉里與距離、
訪視明細的區域篩選。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.admissions import retention
from app.admissions.geo.address import parse_address
from app.admissions.geo.models import RecruitmentVisitGeo
from app.admissions.models import RecruitmentVisit
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
