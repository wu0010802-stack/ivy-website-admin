"""案件流程補完（main 的 test_visit_manual_and_assign.py 已涵蓋補登、指派、
承辦人清單、接待月曆與完成）：這裡只測聯絡中、退回聯絡中、重新預約關聯
舊案、送出日期篩選。"""
from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest

from tests.test_visit_workflow import _create_slot, _enable_slots, _slot_payload


# 預約表單要有已發布的同意文字（啟用 inquiry／slots、官網送單）。
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


async def _create(client, **overrides):
    resp = await client.post(
        f"{API}/admin/visit-requests",
        json=_manual(**overrides),
        headers={"Idempotency-Key": f"test-{uuid.uuid4()}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_contacting_then_confirm_then_complete(admin_client):
    rid = (await _create(admin_client))["id"]

    contacting = await admin_client.post(f"{API}/admin/visit-requests/{rid}/contacting")
    assert contacting.status_code == 200, contacting.text
    assert contacting.json()["status"] == "contacting"
    # 重送不報錯。
    assert (await admin_client.post(f"{API}/admin/visit-requests/{rid}/contacting")).status_code == 200
    assert (await admin_client.post(f"{API}/admin/visit-requests/{rid}/complete")).status_code == 409

    slot = await _create_slot(admin_client, capacity=1)
    confirmed = await admin_client.post(f"{API}/admin/visit-requests/{rid}/confirm", json={"slot_id": slot["id"]})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"

    done = await admin_client.post(f"{API}/admin/visit-requests/{rid}/complete")
    assert done.json()["status"] == "completed"
    assert (await admin_client.post(f"{API}/admin/visit-requests/{rid}/contacting")).status_code == 409


@pytest.mark.asyncio
async def test_pending_returned_to_contacting_releases_slot(admin_client, public_client):
    version = await _enable_slots(admin_client, auto_confirm=False)
    slot = await _create_slot(admin_client, capacity=1)
    submitted = await public_client.post(
        f"{API}/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "return-contacting-01"},
    )
    assert submitted.status_code == 201, submitted.text
    rid = submitted.json()["receipt_id"]

    returned = await admin_client.post(f"{API}/admin/visit-requests/{rid}/contacting")
    assert returned.status_code == 200, returned.text
    body = returned.json()
    assert body["status"] == "contacting"
    assert body["slot_id"] is None
    assert body["hold_expires_at"] is None

    slots = await admin_client.get(
        f"{API}/admin/slots?campus_key=yihua&date_from={slot['slot_date']}&date_to={slot['slot_date']}"
    )
    assert slots.json()[0]["booked_count"] == 0


@pytest.mark.asyncio
async def test_rebooking_links_previous_case_and_cross_campus_needs_super_admin(admin_client, minghua_client):
    old = await _create(admin_client, campus_key="minghua")
    same = await minghua_client.post(
        f"{API}/admin/visit-requests",
        json=_manual(campus_key="minghua", related_request_id=old["id"]),
        headers={"Idempotency-Key": "rebook-same"},
    )
    assert same.status_code == 201, same.text
    assert same.json()["related_request_id"] == old["id"]

    # 分校管理者不能把明華的舊案關聯到義華（本來也沒有義華範圍 → 404）。
    denied = await minghua_client.post(
        f"{API}/admin/visit-requests",
        json=_manual(campus_key="yihua", related_request_id=old["id"]),
        headers={"Idempotency-Key": "rebook-cross-denied"},
    )
    assert denied.status_code in (403, 404)

    cross = await admin_client.post(
        f"{API}/admin/visit-requests",
        json=_manual(campus_key="yihua", related_request_id=old["id"]),
        headers={"Idempotency-Key": "rebook-cross"},
    )
    assert cross.status_code == 201, cross.text
    assert cross.json()["related_request_id"] == old["id"]


@pytest.mark.asyncio
async def test_created_date_filter(admin_client):
    created = await _create(admin_client)
    today = date.today()
    hit = await admin_client.get(
        f"{API}/admin/visit-requests?created_from={today - timedelta(days=1)}&created_to={today + timedelta(days=1)}"
    )
    assert created["id"] in [r["id"] for r in hit.json()]
    miss = await admin_client.get(f"{API}/admin/visit-requests?created_from={today + timedelta(days=2)}")
    assert miss.json() == []
