from __future__ import annotations

from datetime import date, datetime, time, timezone

import pytest

from app.booking.status_groups import display_status
from tests.conftest import book_slot, start_visit_slot

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
NOW = datetime(2026, 10, 2, 2, 0, tzinfo=timezone.utc)  # 台北 10:00


def test_display_status_turns_past_at_slot_start():
    assert display_status("confirmed", date(2026, 10, 2), time(10, 0), NOW) == "past"
    assert display_status("confirmed", date(2026, 10, 2), time(10, 1), NOW) == "upcoming"
    assert display_status("completed", date(2026, 10, 9), time(10, 0), NOW) == "past"
    assert display_status("no_show", date(2026, 10, 9), time(10, 0), NOW) == "past"
    # 沒有場次的只剩舊流程資料，還沒結案就算預約正常（2026-10-05 拿掉「待處理」分組）。
    assert display_status("confirmed", None, None, NOW) == "upcoming"
    assert display_status("cancelled", date(2026, 10, 9), time(10, 0), NOW) == "cancelled"


async def _ids(admin_client, **params) -> dict:
    response = await admin_client.get(f"{API}/admin/visit-requests", params=params)
    assert response.status_code == 200, response.text
    return {row["id"]: row for row in response.json()}


@pytest.mark.asyncio
async def test_list_filters_and_counts_by_group(admin_client, public_client, db_session):
    upcoming = await book_slot(admin_client, public_client, days_ahead=3, phone="0922000001")
    past = await book_slot(admin_client, public_client, days_ahead=4, phone="0922000002")
    await start_visit_slot(db_session, past["receipt_id"])
    done = await book_slot(
        admin_client, public_client, days_ahead=5, phone="0922000003", start_time="14:00:00", end_time="15:00:00"
    )
    await start_visit_slot(db_session, done["receipt_id"])
    assert (await admin_client.post(f"{API}/admin/visit-requests/{done['receipt_id']}/complete")).status_code == 200
    cancelled = await book_slot(admin_client, public_client, days_ahead=6, phone="0922000004")
    assert (await admin_client.post(f"{API}/admin/visit-requests/{cancelled['receipt_id']}/cancel", json={})).status_code == 200

    assert set(await _ids(admin_client, group="upcoming")) == {upcoming["receipt_id"]}
    assert set(await _ids(admin_client, group="past")) == {past["receipt_id"], done["receipt_id"]}
    cancelled_rows = await _ids(admin_client, group="cancelled")
    assert set(cancelled_rows) == {cancelled["receipt_id"]}
    assert cancelled_rows[cancelled["receipt_id"]]["cancel_reason"] == "staff"

    everything = await _ids(admin_client)
    assert everything[upcoming["receipt_id"]]["display_status"] == "upcoming"
    assert everything[past["receipt_id"]]["display_status"] == "past"

    counts = await admin_client.get(f"{API}/admin/visit-requests/group-counts")
    assert counts.status_code == 200, counts.text
    assert counts.json() == {"upcoming": 1, "past": 2, "cancelled": 1}
    other = (await admin_client.get(f"{API}/admin/visit-requests/group-counts", params={"campus_key": "minghua"})).json()
    assert other == {"upcoming": 0, "past": 0, "cancelled": 0}


@pytest.mark.asyncio
@pytest.mark.parametrize("group", ["contacting", "pending"])
async def test_unknown_group_is_rejected(admin_client, group):
    response = await admin_client.get(f"{API}/admin/visit-requests", params={"group": group})

    assert response.status_code == 422
