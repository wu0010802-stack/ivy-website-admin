from __future__ import annotations

from datetime import date, timedelta

import httpx
import pytest


async def _enable_slots_and_book(admin_client, public_client, campus_key="yihua"):
    current = await admin_client.get(f"/api/website/v1/admin/booking-config/{campus_key}")
    await admin_client.patch(
        f"/api/website/v1/admin/booking-config/{campus_key}",
        json={
            "expected_version": current.json()["version"],
            "mode": "slots",
            # 家長自助管理的測試需要一筆「已確認」的案件才能申請改期。
            "slots_auto_confirm": True,
        },
    )
    me = await admin_client.get(f"/api/website/v1/admin/booking-config/{campus_key}")
    version = me.json()["version"]

    slot_date = (date.today() + timedelta(days=3)).isoformat()
    slot = await admin_client.post(
        f"/api/website/v1/admin/slots?campus_key={campus_key}",
        json={"slot_date": slot_date, "start_time": "10:00:00", "end_time": "11:00:00", "capacity": 2},
    )
    slot_id = slot.json()["id"]

    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json={
            "campus_key": campus_key,
            "config_version": version,
            "parent_name": "陳媽媽",
            "phone": "0912345678",
            "age": None,
            "preferred_time": None,
            "questions": None,
            "consent_given": True,
            "slot_id": slot_id,
        },
        headers={"Idempotency-Key": "parent-access-setup-01"},
    )
    assert created.status_code == 201, created.text
    return created.json()["receipt_id"], slot_id, slot_date


@pytest.mark.asyncio
async def test_parent_can_exchange_token_and_read_own_request(admin_client, public_client):
    receipt_id, _slot_id, _date = await _enable_slots_and_book(admin_client, public_client)

    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    assert link.status_code == 200
    fragment = link.json()["manage_url_fragment"]
    token = fragment.split("token=")[1]

    exchange = await public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": token}
    )
    assert exchange.status_code == 200
    assert exchange.json()["id"] == receipt_id

    me = await public_client.get("/api/website/v1/public/visit-manage/me")
    assert me.status_code == 200
    assert me.json()["id"] == receipt_id


@pytest.mark.asyncio
async def test_invalid_token_rejected(public_client):
    response = await public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": "not-a-real-token"}
    )
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "TOKEN_INVALID"


@pytest.mark.asyncio
async def test_parent_session_isolated_between_families(app, admin_client, public_client):
    """家長只能讀自己的案件：另一個家長的 session 讀不到這一筆。"""
    receipt_id, slot_id, slot_date = await _enable_slots_and_book(admin_client, public_client)

    # 建第二筆不同家長的案件（不同時段，避免撞名額）
    second_slot = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={"slot_date": slot_date, "start_time": "14:00:00", "end_time": "15:00:00", "capacity": 1},
    )
    me = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    other = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json={
            "campus_key": "yihua",
            "config_version": me.json()["version"],
            "parent_name": "林媽媽",
            "phone": "0922345678",
            "age": None,
            "preferred_time": None,
            "questions": None,
            "consent_given": True,
            "slot_id": second_slot.json()["id"],
        },
        headers={"Idempotency-Key": "parent-access-other-01"},
    )
    other_receipt_id = other.json()["receipt_id"]

    link_a = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    link_b = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{other_receipt_id}/access-link"
    )
    token_a = link_a.json()["manage_url_fragment"].split("token=")[1]
    token_b = link_b.json()["manage_url_fragment"].split("token=")[1]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client_a:
        await client_a.post("/api/website/v1/public/visit-manage/exchange", json={"token": token_a})
        me_a = await client_a.get("/api/website/v1/public/visit-manage/me")
        assert me_a.json()["id"] == receipt_id
        assert me_a.json()["id"] != other_receipt_id

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client_b:
        await client_b.post("/api/website/v1/public/visit-manage/exchange", json={"token": token_b})
        me_b = await client_b.get("/api/website/v1/public/visit-manage/me")
        assert me_b.json()["id"] == other_receipt_id


@pytest.mark.asyncio
async def test_parent_can_cancel_own_request(app, admin_client, public_client):
    receipt_id, _slot_id, _date = await _enable_slots_and_book(admin_client, public_client)
    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/api/website/v1/public/visit-manage/exchange", json={"token": token})
        cancel = await client.post("/api/website/v1/public/visit-manage/cancel")
        assert cancel.status_code == 200
        assert cancel.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_parent_reschedule_request_does_not_move_slot_until_approved(
    app, admin_client, public_client
):
    receipt_id, slot_a_id, slot_date = await _enable_slots_and_book(admin_client, public_client)
    slot_b = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={"slot_date": slot_date, "start_time": "16:00:00", "end_time": "17:00:00", "capacity": 1},
    )
    slot_b_id = slot_b.json()["id"]

    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/api/website/v1/public/visit-manage/exchange", json={"token": token})
        req = await client.post(
            "/api/website/v1/public/visit-manage/reschedule-request", json={"new_slot_id": slot_b_id}
        )
        assert req.status_code == 201

    # 原時段完全不變，直到園方核准。
    detail = await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt_id}")
    assert detail.json()["slot_id"] == slot_a_id

    pending = await admin_client.get("/api/website/v1/admin/reschedule-requests?campus_key=yihua")
    assert len(pending.json()) == 1
    request_id = pending.json()[0]["id"]

    approve = await admin_client.post(f"/api/website/v1/admin/reschedule-requests/{request_id}/approve")
    assert approve.status_code == 200
    assert approve.json()["slot_id"] == slot_b_id
