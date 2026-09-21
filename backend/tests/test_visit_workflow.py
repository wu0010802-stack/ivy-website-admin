from __future__ import annotations

from datetime import date, timedelta

import pytest


async def _enable_slots(admin_client, campus_key="yihua"):
    current = await admin_client.get(f"/api/website/v1/admin/booking-config/{campus_key}")
    resp = await admin_client.patch(
        f"/api/website/v1/admin/booking-config/{campus_key}",
        json={"expected_version": current.json()["version"], "mode": "slots"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["version"]


async def _create_slot(admin_client, campus_key="yihua", capacity=1, days_ahead=3):
    slot_date = (date.today() + timedelta(days=days_ahead)).isoformat()
    resp = await admin_client.post(
        f"/api/website/v1/admin/slots?campus_key={campus_key}",
        json={
            "slot_date": slot_date,
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "capacity": capacity,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _slot_payload(campus_key, config_version, slot_id, parent_name="陳媽媽"):
    return {
        "campus_key": campus_key,
        "config_version": config_version,
        "parent_name": parent_name,
        "phone": "0912345678",
        "age": "3-4",
        "preferred_time": None,
        "questions": None,
        "consent_given": True,
        "slot_id": slot_id,
    }


@pytest.mark.asyncio
async def test_create_slot_and_book_it(admin_client, public_client):
    version = await _enable_slots(admin_client)
    slot = await _create_slot(admin_client)

    response = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "slot-book-01"},
    )
    assert response.status_code == 201, response.text

    updated = await admin_client.get(
        f"/api/website/v1/admin/slots?campus_key=yihua&date_from={slot['slot_date']}&date_to={slot['slot_date']}"
    )
    assert updated.json()[0]["booked_count"] == 1


@pytest.mark.asyncio
async def test_full_slot_rejects_public_submission(admin_client, public_client):
    version = await _enable_slots(admin_client)
    slot = await _create_slot(admin_client, capacity=1)

    first = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "slot-full-01"},
    )
    assert first.status_code == 201

    second = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"], parent_name="林媽媽"),
        headers={"Idempotency-Key": "slot-full-02"},
    )
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "SLOT_FULL"


@pytest.mark.asyncio
async def test_public_slot_list_hides_full_slots(admin_client, public_client):
    version = await _enable_slots(admin_client)
    slot = await _create_slot(admin_client, capacity=1)

    before = await public_client.get(
        f"/api/website/v1/public/slots?campus_key=yihua&date_from={slot['slot_date']}&date_to={slot['slot_date']}"
    )
    assert len(before.json()) == 1

    await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "slot-hide-01"},
    )

    after = await public_client.get(
        f"/api/website/v1/public/slots?campus_key=yihua&date_from={slot['slot_date']}&date_to={slot['slot_date']}"
    )
    assert len(after.json()) == 0


@pytest.mark.asyncio
async def test_query_range_too_wide_rejected(admin_client):
    resp = await admin_client.get(
        "/api/website/v1/admin/slots?campus_key=yihua&date_from=2026-01-01&date_to=2026-12-31"
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "QUERY_RANGE_TOO_WIDE"


@pytest.mark.asyncio
async def test_reduce_capacity_below_booked_rejected(admin_client, public_client):
    version = await _enable_slots(admin_client)
    slot = await _create_slot(admin_client, capacity=2)
    await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "reduce-01"},
    )

    resp = await admin_client.patch(
        f"/api/website/v1/admin/slots/{slot['id']}", json={"capacity": 0}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "CAPACITY_BELOW_BOOKED"


@pytest.mark.asyncio
async def test_manual_confirm_inquiry_into_slot(admin_client, public_client):
    # 先用 inquiry 模式建立一筆案件
    current = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": current.json()["version"], "mode": "inquiry"},
    )
    me = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    inquiry_version = me.json()["version"]

    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json={
            "campus_key": "yihua",
            "config_version": inquiry_version,
            "parent_name": "陳媽媽",
            "phone": "0912345678",
            "age": "3-4",
            "preferred_time": "平日上午",
            "questions": None,
            "consent_given": True,
        },
        headers={"Idempotency-Key": "manual-confirm-01"},
    )
    receipt_id = created.json()["receipt_id"]

    # 切到 slots 模式並建立時段（手動確認不需要公開端啟用 slots，
    # 只要園方有時段可選即可）
    slot = await _create_slot(admin_client)

    confirm = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/confirm", json={"slot_id": slot["id"]}
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["status"] == "confirmed"
    assert confirm.json()["slot_id"] == slot["id"]


@pytest.mark.asyncio
async def test_cancel_is_idempotent(admin_client, public_client):
    version = await _enable_slots(admin_client)
    slot = await _create_slot(admin_client)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "cancel-idempotent-01"},
    )
    receipt_id = created.json()["receipt_id"]

    first = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/cancel")
    assert first.status_code == 200
    assert first.json()["status"] == "cancelled"

    second = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/cancel")
    assert second.status_code == 200
    assert second.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_cancel_frees_slot_for_new_booking(admin_client, public_client):
    version = await _enable_slots(admin_client)
    slot = await _create_slot(admin_client, capacity=1)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "cancel-free-01"},
    )
    receipt_id = created.json()["receipt_id"]

    await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/cancel")

    retry = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"], parent_name="林媽媽"),
        headers={"Idempotency-Key": "cancel-free-02"},
    )
    assert retry.status_code == 201, retry.text


@pytest.mark.asyncio
async def test_reschedule_to_full_slot_rolls_back(admin_client, public_client):
    version = await _enable_slots(admin_client)
    slot_a = await _create_slot(admin_client, capacity=1, days_ahead=3)
    slot_b = await _create_slot(admin_client, capacity=1, days_ahead=4)

    booking_a = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot_a["id"]),
        headers={"Idempotency-Key": "reschedule-a"},
    )
    receipt_id = booking_a.json()["receipt_id"]

    # slot_b 先被別人訂滿
    await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot_b["id"], parent_name="林媽媽"),
        headers={"Idempotency-Key": "reschedule-b-other"},
    )

    reschedule = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/reschedule",
        json={"new_slot_id": slot_b["id"]},
    )
    assert reschedule.status_code == 409
    assert reschedule.json()["detail"]["code"] == "SLOT_FULL"

    # 原本的 slot_a 應該完全不受影響，案件仍在原時段
    detail = await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt_id}")
    assert detail.json()["slot_id"] == slot_a["id"]


@pytest.mark.asyncio
async def test_reschedule_success_moves_slot(admin_client, public_client):
    version = await _enable_slots(admin_client)
    slot_a = await _create_slot(admin_client, capacity=1, days_ahead=3)
    slot_b = await _create_slot(admin_client, capacity=1, days_ahead=4)

    booking = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot_a["id"]),
        headers={"Idempotency-Key": "reschedule-success-a"},
    )
    receipt_id = booking.json()["receipt_id"]

    reschedule = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/reschedule",
        json={"new_slot_id": slot_b["id"]},
    )
    assert reschedule.status_code == 200
    assert reschedule.json()["slot_id"] == slot_b["id"]

    # 原本的 slot_a 名額已釋放
    retry = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot_a["id"], parent_name="林媽媽"),
        headers={"Idempotency-Key": "reschedule-success-refill"},
    )
    assert retry.status_code == 201


@pytest.mark.asyncio
async def test_no_show_requires_confirmed_status(admin_client, public_client):
    # 先建立一筆 inquiry（狀態是 new，不是 confirmed）
    current = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": current.json()["version"], "mode": "inquiry"},
    )
    me = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json={
            "campus_key": "yihua",
            "config_version": me.json()["version"],
            "parent_name": "陳媽媽",
            "phone": "0912345678",
            "age": None,
            "preferred_time": None,
            "questions": None,
            "consent_given": True,
        },
        headers={"Idempotency-Key": "no-show-invalid-01"},
    )
    receipt_id = created.json()["receipt_id"]

    resp = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/no-show")
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "INVALID_TRANSITION"


@pytest.mark.asyncio
async def test_contact_note_and_follow_up(admin_client, public_client):
    version = await _enable_slots(admin_client)
    slot = await _create_slot(admin_client)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "contact-note-01"},
    )
    receipt_id = created.json()["receipt_id"]

    note = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/contact-notes",
        json={"note": "已電話確認家長會準時到場", "follow_up_at": "2026-10-01T09:00:00Z"},
    )
    assert note.status_code == 201

    notes = await admin_client.get(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/contact-notes"
    )
    assert len(notes.json()) == 1
    assert notes.json()[0]["note"] == "已電話確認家長會準時到場"


@pytest.mark.asyncio
async def test_minghua_cannot_manage_yihua_slot(minghua_client, admin_client):
    slot = await _create_slot(admin_client)
    resp = await minghua_client.patch(
        f"/api/website/v1/admin/slots/{slot['id']}", json={"capacity": 5}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_csv_export_escapes_formula_injection(admin_client, public_client):
    version = await _enable_slots(admin_client)
    slot = await _create_slot(admin_client)
    await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"], parent_name="=cmd|' /C calc'!A0"),
        headers={"Idempotency-Key": "csv-injection-01"},
    )

    resp = await admin_client.get("/api/website/v1/admin/visit-requests/export?campus_key=yihua")
    assert resp.status_code == 200
    # 危險前綴必須被加上前導單引號，變成純文字而不是可執行公式；
    # 原始未跳脫的 "=cmd..." 字串不應該原封不動出現。
    assert "\n=cmd" not in resp.text
    assert ",=cmd" not in resp.text
    assert "'=cmd|' /C calc'!A0" in resp.text
