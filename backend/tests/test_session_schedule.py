from __future__ import annotations

from datetime import timedelta

import pytest

from app.common.timezones import today_local
from tests.conftest import book_slot, create_slot, open_manage

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"


@pytest.mark.asyncio
async def test_saving_rules_fills_slots_right_away(admin_client):
    current = (await admin_client.get(f"{API}/admin/visit-schedule/yihua")).json()

    response = await admin_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={
            "expected_version": current["version"],
            "min_lead_hours": 24,
            "max_advance_days": 14,
            "rules": [
                {"weekday": day, "start_time": "10:00:00", "end_time": "11:00:00", "slot_minutes": 60, "capacity": 1}
                for day in range(7)
            ],
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["slot_sync"]["created"] >= 14
    today = today_local()
    slots = (
        await admin_client.get(
            f"{API}/admin/slots?campus_key=yihua&date_from={today}&date_to={today + timedelta(days=14)}"
        )
    ).json()
    assert len(slots) >= 14


async def _slot(admin_client, slot_id: str, slot_date: str) -> dict:
    rows = (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={slot_date}&date_to={slot_date}")).json()
    return next(row for row in rows if row["id"] == slot_id)


@pytest.mark.asyncio
async def test_manual_stop_keeps_bookings_valid_and_out_of_attention(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    slot = await _slot(admin_client, booked["slot_id"], booked["slot_date"])

    stopped = await admin_client.patch(
        f"{API}/admin/slots/{booked['slot_id']}", json={"closed": True, "expected_version": slot["version"]}
    )

    assert stopped.status_code == 200, stopped.text
    attention = (await admin_client.get(f"{API}/admin/visit-requests", params={"needs_attention": "true"})).json()
    assert booked["receipt_id"] not in {row["id"] for row in attention}
    public = (
        await public_client.get(
            f"{API}/public/slots",
            params={"campus_key": "yihua", "date_from": booked["slot_date"], "date_to": booked["slot_date"]},
        )
    ).json()
    assert booked["slot_id"] not in {row["id"] for row in public}
    detail = (await admin_client.get(f"{API}/admin/visit-requests/{booked['receipt_id']}")).json()
    assert detail["status"] == "confirmed"


@pytest.mark.asyncio
async def test_holiday_still_needs_attention(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)

    holiday = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": booked["slot_date"], "reason": "研習"}
    )

    assert holiday.status_code == 201, holiday.text
    attention = (await admin_client.get(f"{API}/admin/visit-requests", params={"needs_attention": "true"})).json()
    assert booked["receipt_id"] in {row["id"] for row in attention}


@pytest.mark.asyncio
async def test_parent_can_leave_a_stopped_slot(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    await open_manage(public_client, booked["manage_path"])
    other = await create_slot(admin_client, days_ahead=5, start_time="14:30:00", end_time="15:30:00")
    slot = await _slot(admin_client, booked["slot_id"], booked["slot_date"])
    await admin_client.patch(
        f"{API}/admin/slots/{booked['slot_id']}", json={"closed": True, "expected_version": slot["version"]}
    )

    moved = await public_client.post(
        f"{API}/public/visit-manage/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": other}
    )

    assert moved.status_code == 200, moved.text
    assert moved.json()["slot"]["id"] == other


@pytest.mark.asyncio
async def test_calendar_slots_carry_version_and_close_source(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)

    calendar = (
        await admin_client.get(
            f"{API}/admin/visit-calendar",
            params={"date_from": booked["slot_date"], "date_to": booked["slot_date"], "campus_key": "yihua"},
        )
    ).json()

    row = next(item for item in calendar if item["id"] == booked["slot_id"])
    assert isinstance(row["version"], int)
    assert row["closed_source"] is None
