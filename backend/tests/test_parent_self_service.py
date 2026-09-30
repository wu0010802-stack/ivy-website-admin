from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.booking.models import OutboxMessage, VisitRequestEvent
from app.common.timezones import today_local
from tests.conftest import VISIT_SUBMIT_PATH, book_slot, create_slot, open_manage, set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
MANAGE = f"{API}/public/visit-manage"


async def _booked_and_open(admin_client, public_client, **kwargs) -> dict:
    booked = await book_slot(admin_client, public_client, **kwargs)
    await open_manage(public_client, booked["manage_path"])
    return booked


@pytest.mark.asyncio
async def test_me_returns_the_editable_details(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client, child_name="小寶")

    me = (await public_client.get(f"{MANAGE}/me")).json()

    assert me["parent_name"] == "陳媽媽"
    assert me["phone"] == "0912345678"
    assert me["email"] == "parent@example.com"
    assert me["child_name"] == "小寶"
    assert me["can_edit"] is True and me["can_reschedule"] is True
    assert "phone_masked" not in me
    assert me["version"] >= 1
    assert me["id"] == booked["receipt_id"]


@pytest.mark.asyncio
async def test_parent_reschedules_directly(admin_client, public_client, db_session):
    booked = await _booked_and_open(admin_client, public_client)
    other = await create_slot(admin_client, days_ahead=5, start_time="14:30:00", end_time="15:30:00")

    response = await public_client.post(
        f"{MANAGE}/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": other}
    )

    assert response.status_code == 200, response.text
    assert response.json()["slot"]["id"] == other
    assert response.json()["status"] == "confirmed"
    event = (
        await db_session.execute(select(VisitRequestEvent).where(VisitRequestEvent.event_type == "rescheduled"))
    ).scalar_one()
    assert event.source == "parent"
    kinds = (await db_session.execute(select(OutboxMessage.kind))).scalars().all()
    assert "parent_visit_changed" in kinds and "visit_request_rescheduled" in kinds


@pytest.mark.asyncio
async def test_last_seat_goes_to_exactly_one_of_parent_reschedule_and_new_booking(
    admin_client, public_client, second_public_client
):
    booked = await _booked_and_open(admin_client, public_client)
    last = await create_slot(admin_client, days_ahead=6, capacity=1)
    version = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()["version"]

    reschedule, submit = await asyncio.gather(
        public_client.post(f"{MANAGE}/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": last}),
        second_public_client.post(
            VISIT_SUBMIT_PATH,
            json={
                "campus_key": "yihua",
                "config_version": version,
                "parent_name": "林媽媽",
                "phone": "0922333444",
                "email": "lin@example.com",
                "consent_given": True,
                "slot_id": last,
            },
            headers={"Idempotency-Key": "race-last-seat"},
        ),
    )

    assert sorted([reschedule.status_code, submit.status_code]) in ([200, 409], [201, 409])
    loser = reschedule if reschedule.status_code == 409 else submit
    assert loser.json()["detail"]["code"] == "SLOT_FULL"
    today = today_local()
    slots = (
        await admin_client.get(
            f"{API}/admin/slots",
            params={
                "campus_key": "yihua",
                "date_from": today.isoformat(),
                "date_to": (today + timedelta(days=10)).isoformat(),
            },
        )
    ).json()
    assert next(s for s in slots if s["id"] == last)["booked_count"] == 1


@pytest.mark.asyncio
async def test_reschedule_after_deadline_is_refused(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client, days_ahead=3)
    other = await create_slot(admin_client, days_ahead=5)
    await set_booking_mode(admin_client, "yihua", mode="slots", parent_change_deadline_hours=336)

    response = await public_client.post(
        f"{MANAGE}/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": other}
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "CHANGE_DEADLINE_PASSED"


@pytest.mark.asyncio
async def test_reschedule_request_endpoint_is_retired(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client)
    other = await create_slot(admin_client, days_ahead=5)

    response = await public_client.post(
        f"{MANAGE}/reschedule-request", json={"visit_request_id": booked["receipt_id"], "new_slot_id": other}
    )

    assert response.status_code == 410
    assert response.json()["detail"]["code"] == "ENDPOINT_RETIRED"


@pytest.mark.asyncio
async def test_parent_updates_details_without_leaking_them_into_history(admin_client, public_client, db_session):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()

    response = await public_client.patch(
        f"{MANAGE}/me",
        json={
            "visit_request_id": booked["receipt_id"],
            "expected_version": me["version"],
            "phone": "0922-333-444",
            "email": "new@example.com",
            "party_size": 3,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "0922333444"
    assert response.json()["email"] == "new@example.com"
    assert response.json()["version"] == me["version"] + 1
    event = (
        await db_session.execute(select(VisitRequestEvent).where(VisitRequestEvent.event_type == "details_updated"))
    ).scalar_one()
    assert event.source == "parent"
    assert sorted(event.after["fields"]) == ["email", "party_size", "phone"]
    assert "0922333444" not in str(event.after) and "new@example.com" not in str(event.after)
    kinds = (await db_session.execute(select(OutboxMessage.kind))).scalars().all()
    assert kinds.count("parent_visit_changed") == 1


@pytest.mark.asyncio
async def test_same_details_write_nothing(admin_client, public_client, db_session):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()

    response = await public_client.patch(
        f"{MANAGE}/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "phone": me["phone"]},
    )

    assert response.status_code == 200
    assert response.json()["version"] == me["version"]
    events = (
        await db_session.execute(select(VisitRequestEvent).where(VisitRequestEvent.event_type == "details_updated"))
    ).scalars().all()
    assert events == []


@pytest.mark.asyncio
async def test_details_version_conflict_and_required_fields(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()

    stale = await public_client.patch(
        f"{MANAGE}/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"] - 1, "party_size": 4},
    )
    cleared = await public_client.patch(
        f"{MANAGE}/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "email": None},
    )

    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "VISIT_REQUEST_VERSION_CONFLICT"
    assert cleared.status_code == 422


@pytest.mark.asyncio
async def test_details_update_checks_the_session_matches(admin_client, public_client):
    first = await _booked_and_open(admin_client, public_client, phone="0912000001")
    await _booked_and_open(admin_client, public_client, phone="0912000002", days_ahead=4)

    response = await public_client.patch(
        f"{MANAGE}/me", json={"visit_request_id": first["receipt_id"], "expected_version": 1, "party_size": 4}
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PARENT_SESSION_CHANGED"
