"""總覽「今天的行程板」（2026-10-06）：今天名單含孩子、電話與狀態（已到場也列），
加本週五校彙總（已預約、還可約、預約方式）。承辦人同日拿掉，名單不回。"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import update

from app.booking.models import VisitRequest
from tests.conftest import create_slot, legacy_request, set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")

BASE = "/api/website/v1/admin"


@pytest.mark.asyncio
async def test_today_list_and_week_campuses(admin_client, minghua_client, db_session):
    today_slot = await create_slot(admin_client, days_ahead=0, start_time="23:00:00", end_time="23:30:00", capacity=3)
    later_slot = await create_slot(admin_client, days_ahead=3, capacity=2)
    far_slot = await create_slot(admin_client, days_ahead=10, capacity=2)  # 下週，不算本週
    confirmed = await legacy_request(db_session, status="confirmed", slot_id=today_slot, parent_name="林小姐", phone="0912000001")
    completed = await legacy_request(db_session, status="completed", slot_id=today_slot, parent_name="王先生", phone="0912000002")
    await legacy_request(db_session, status="confirmed", slot_id=later_slot, parent_name="陳媽媽", phone="0912000003")
    await legacy_request(db_session, status="confirmed", slot_id=far_slot, parent_name="周小姐", phone="0912000008")
    await db_session.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(confirmed)).values(child_name="小安"))
    await db_session.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(completed)).values(child_name="小芸"))
    await db_session.commit()
    assert (await set_booking_mode(admin_client, "yihua", mode="slots")).status_code == 200

    summary = (await admin_client.get(f"{BASE}/dashboard")).json()
    today = summary["today_visit_list"]
    assert [row["parent_name"] for row in today] == ["林小姐", "王先生"]
    assert today[0]["child_name"] == "小安"
    assert today[0]["phone"] == "0912000001"
    assert today[0]["status"] == "confirmed"
    assert "assignee_display_name" not in today[0]
    assert today[1]["status"] == "completed"
    assert summary["today_visits"] == 2

    week = {row["campus_key"]: row for row in summary["week_campuses"]}
    assert set(week) == {"yihua", "minghua", "chongde", "international", "renwu"}
    assert week["yihua"]["mode"] == "slots"
    assert week["yihua"]["booked"] == 3  # 今天 2 組（含已到場）＋三天後 1 組，下週的不算
    assert week["yihua"]["open"] == 2  # (3-2)+(2-1)
    assert week["minghua"] == {"campus_key": "minghua", "mode": "paused", "booked": 0, "open": None}

    minghua = (await minghua_client.get(f"{BASE}/dashboard")).json()
    assert [row["campus_key"] for row in minghua["week_campuses"]] == ["minghua"]
    assert minghua["today_visit_list"] == []
