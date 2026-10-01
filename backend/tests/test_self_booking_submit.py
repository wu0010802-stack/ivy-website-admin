from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.booking import service
from app.booking.models import BookingMode
from app.booking.workflow_service import expire_holds
from tests.conftest import book_slot, create_slot, legacy_request, set_booking_mode

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
async def test_submission_is_confirmed_even_if_old_config_said_manual(admin_client, public_client, db_session):
    slot_id, version = await _slots_mode(admin_client)
    config = await service.get_or_create_config(db_session, "yihua")
    config.slots_auto_confirm = False  # 上線前的舊設定列
    await db_session.commit()

    response = await public_client.post(
        f"{API}/public/visit-requests", json=_body(version, slot_id=slot_id), headers={"Idempotency-Key": "self-01"}
    )

    assert response.status_code == 201, response.text
    assert response.json()["status"] == "confirmed"
    detail = (await admin_client.get(f"{API}/admin/visit-requests/{response.json()['receipt_id']}")).json()
    assert detail["hold_expires_at"] is None
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
async def test_inquiry_mode_can_no_longer_be_selected(admin_client):
    response = await set_booking_mode(admin_client, "yihua", mode="inquiry")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "BOOKING_MODE_RETIRED"


@pytest.mark.asyncio
async def test_leftover_inquiry_config_is_shown_as_paused(admin_client, public_client, db_session):
    config = await service.get_or_create_config(db_session, "yihua")
    config.mode = BookingMode.INQUIRY
    config.message = None
    await db_session.commit()

    public = (await public_client.get(f"{API}/public/booking-config/yihua")).json()

    assert public["mode"] == "paused"
    assert public["message"] == "線上預約即將開放，歡迎來電洽詢。"
    assert "slots_auto_confirm" not in public


@pytest.mark.asyncio
async def test_contacting_endpoint_is_retired(admin_client, db_session):
    case_id = await legacy_request(db_session, status="new")

    response = await admin_client.post(f"{API}/admin/visit-requests/{case_id}/contacting")

    assert response.status_code == 410
    assert response.json()["detail"]["code"] == "ENDPOINT_RETIRED"


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
async def test_cancel_records_who_cancelled(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)
    cancelled = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})
    assert cancelled.status_code == 200, cancelled.text

    slot_id = await create_slot(admin_client, days_ahead=5, start_time="14:00:00", end_time="15:00:00")
    expired_id = await legacy_request(
        db_session,
        status="pending_confirmation",
        slot_id=slot_id,
        hold_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    await expire_holds(db_session)
    await db_session.commit()

    staff = (await admin_client.get(f"{API}/admin/visit-requests/{booked['receipt_id']}")).json()
    system = (await admin_client.get(f"{API}/admin/visit-requests/{expired_id}")).json()
    assert staff["cancel_reason"] == "staff"
    assert system["cancel_reason"] == "hold_expired"
