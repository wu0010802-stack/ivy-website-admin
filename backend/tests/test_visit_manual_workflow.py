"""案件流程補完（main 的 test_visit_manual_and_assign.py 已涵蓋補登、指派、
承辦人清單、接待月曆與完成）：這裡只測舊的聯絡中案件確認後完成、重新預約
關聯舊案、送出日期篩選。"""
from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest

from tests.conftest import create_slot, legacy_request, start_visit_slot
from tests.test_visit_workflow import _create_slot


# 預約表單要有已發布的同意文字（啟用 slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"


def _manual(**overrides):
    payload = {
        "campus_key": "yihua",
        "source": "phone",
        "parent_name": "林爸爸",
        "phone": "0912-345-678",
        "questions": "想了解小班",
        "consent_given": True,
    }
    payload.update(overrides)
    return payload


async def _create(client, *, slot_id, **overrides):
    resp = await client.post(
        f"{API}/admin/visit-requests",
        json=_manual(slot_id=slot_id, **overrides),
        headers={"Idempotency-Key": f"test-{uuid.uuid4()}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_contacting_then_confirm_then_complete(admin_client, db_session):
    # 上線前留下的「聯絡中」舊案：仍可確認排入時段、完成參觀。
    rid = await legacy_request(db_session, status="contacting", parent_name="林爸爸")
    assert (await admin_client.post(f"{API}/admin/visit-requests/{rid}/complete")).status_code == 409

    slot = await _create_slot(admin_client, capacity=1)
    confirmed = await admin_client.post(f"{API}/admin/visit-requests/{rid}/confirm", json={"slot_id": slot["id"]})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"

    # 場次還沒開始不能標完成（會提早占住名額）；開始後才可以。
    early = await admin_client.post(f"{API}/admin/visit-requests/{rid}/complete")
    assert early.status_code == 409
    assert early.json()["detail"]["code"] == "INVALID_TRANSITION"
    await start_visit_slot(db_session, rid)
    done = await admin_client.post(f"{API}/admin/visit-requests/{rid}/complete")
    assert done.json()["status"] == "completed"
    # 「轉聯絡中」已退場，不管案件狀態一律 410。
    assert (await admin_client.post(f"{API}/admin/visit-requests/{rid}/contacting")).status_code == 410


@pytest.mark.asyncio
async def test_rebooking_links_previous_case_and_cross_campus_needs_super_admin(admin_client, minghua_client):
    minghua_slot = await create_slot(admin_client, "minghua", capacity=5)
    yihua_slot = await create_slot(admin_client, "yihua", capacity=5)
    old = await _create(admin_client, slot_id=minghua_slot, campus_key="minghua")
    same = await minghua_client.post(
        f"{API}/admin/visit-requests",
        json=_manual(campus_key="minghua", related_request_id=old["id"], slot_id=minghua_slot),
        headers={"Idempotency-Key": "rebook-same"},
    )
    assert same.status_code == 201, same.text
    assert same.json()["related_request_id"] == old["id"]

    # 分校管理者不能把明華的舊案關聯到義華（本來也沒有義華範圍 → 404）。
    denied = await minghua_client.post(
        f"{API}/admin/visit-requests",
        json=_manual(campus_key="yihua", related_request_id=old["id"], slot_id=yihua_slot),
        headers={"Idempotency-Key": "rebook-cross-denied"},
    )
    assert denied.status_code in (403, 404)

    cross = await admin_client.post(
        f"{API}/admin/visit-requests",
        json=_manual(campus_key="yihua", related_request_id=old["id"], slot_id=yihua_slot),
        headers={"Idempotency-Key": "rebook-cross"},
    )
    assert cross.status_code == 201, cross.text
    assert cross.json()["related_request_id"] == old["id"]


@pytest.mark.asyncio
async def test_created_date_filter(admin_client):
    created = await _create(admin_client, slot_id=await create_slot(admin_client))
    today = date.today()
    hit = await admin_client.get(
        f"{API}/admin/visit-requests?created_from={today - timedelta(days=1)}&created_to={today + timedelta(days=1)}"
    )
    assert created["id"] in [r["id"] for r in hit.json()]
    miss = await admin_client.get(f"{API}/admin/visit-requests?created_from={today + timedelta(days=2)}")
    assert miss.json() == []
