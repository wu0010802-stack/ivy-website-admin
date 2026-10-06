from __future__ import annotations

import pytest
from sqlalchemy import text

from app.booking.models import BookingMode
from app.booking import workflow_service
from tests.conftest import book_slot, create_slot, set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"


async def _slots_mode(admin_client) -> tuple[str, int]:
    slot_id = await create_slot(admin_client)
    response = await set_booking_mode(admin_client, "yihua", mode="slots")
    assert response.status_code == 200, response.text
    return slot_id, response.json()["version"]


def _body(version: int, **extra) -> dict:
    return {
        "campus_key": "yihua",
        "config_version": version,
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "consent_given": True,
        **extra,
    }


@pytest.mark.asyncio
async def test_submission_is_confirmed_without_hold(admin_client, public_client):
    slot_id, version = await _slots_mode(admin_client)

    response = await public_client.post(
        f"{API}/public/visit-requests", json=_body(version, slot_id=slot_id), headers={"Idempotency-Key": "self-01"}
    )

    assert response.status_code == 201, response.text
    assert response.json()["status"] == "confirmed"
    detail = (await admin_client.get(f"{API}/admin/visit-requests/{response.json()['receipt_id']}")).json()
    assert "hold_expires_at" not in detail
    assert detail["confirmed_at"] is not None


@pytest.mark.asyncio
async def test_submission_needs_a_slot_and_an_email(admin_client, public_client):
    slot_id, version = await _slots_mode(admin_client)

    no_slot = await public_client.post(
        f"{API}/public/visit-requests", json=_body(version), headers={"Idempotency-Key": "self-02"}
    )
    no_email = await public_client.post(
        f"{API}/public/visit-requests",
        json=_body(version, slot_id=slot_id, email=None),
        headers={"Idempotency-Key": "self-03"},
    )

    assert no_slot.status_code == 422
    assert ["body", "slot_id"] in [error["loc"] for error in no_slot.json()["detail"]]
    assert no_email.status_code == 422
    assert ["body", "email"] in [error["loc"] for error in no_email.json()["detail"]]


@pytest.mark.asyncio
async def test_inquiry_mode_no_longer_exists(admin_client, public_client, db_session):
    # 2026-10-06 拿掉 inquiry（c4e8a2f61b97）：API 不認得這個值，資料庫型別也沒有。
    response = await set_booking_mode(admin_client, "yihua", mode="inquiry")
    assert response.status_code == 422
    assert "inquiry" not in {mode.value for mode in BookingMode}
    labels = (
        await db_session.execute(text("SELECT unnest(enum_range(NULL::booking_mode))::text"))
    ).scalars().all()
    assert labels == ["SLOTS", "LINE", "PHONE", "EXTERNAL", "PAUSED"]

    public = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    assert "slots_auto_confirm" not in public


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["contacting", "confirm"])
async def test_retired_case_actions_no_longer_exist(admin_client, public_client, action):
    booked = await book_slot(admin_client, public_client)

    response = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/{action}", json={})

    assert response.status_code in (404, 405)


@pytest.mark.asyncio
async def test_manual_entry_requires_a_slot_and_is_confirmed(admin_client):
    base = {"campus_key": "yihua", "source": "phone", "parent_name": "王先生", "phone": "0933111222", "consent_given": True}

    missing = await admin_client.post(
        f"{API}/admin/visit-requests", json=base, headers={"Idempotency-Key": "manual-self-01"}
    )
    slot_id = await create_slot(admin_client, days_ahead=1)  # 24 小時預約窗內，園方仍可排
    created = await admin_client.post(
        f"{API}/admin/visit-requests", json={**base, "slot_id": slot_id}, headers={"Idempotency-Key": "manual-self-02"}
    )

    assert missing.status_code == 422
    assert ["body", "slot_id"] in [error["loc"] for error in missing.json()["detail"]]
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "confirmed"
    assert created.json()["slot"]["id"] == slot_id


@pytest.mark.asyncio
async def test_cancel_records_who_cancelled(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    cancelled = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})
    assert cancelled.status_code == 200, cancelled.text

    staff = (await admin_client.get(f"{API}/admin/visit-requests/{booked['receipt_id']}")).json()
    assert staff["cancel_reason"] == "staff"


def test_hold_expiry_flow_is_gone():
    """占位逾期取消的流程已整個刪除，不會再有人把案件標成 hold_expired。"""
    assert not hasattr(workflow_service, "expire_holds")
    assert not hasattr(workflow_service, "confirm_with_slot")
