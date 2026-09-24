"""每週規則、休假日與依規則產生時段（規格 6.3）。"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.common.timezones import today_local
from tests.test_visit_workflow import _enable_slots, _slot_payload

API = "/api/website/v1"


def _next_weekday(weekday: int, min_days_ahead: int = 3) -> date:
    day = date.today() + timedelta(days=min_days_ahead)
    while day.weekday() != weekday:
        day += timedelta(days=1)
    return day


async def _set_rules(client, rules, campus="yihua", lead=24, advance=60):
    resp = await client.put(
        f"{API}/admin/visit-schedule/{campus}",
        json={"min_lead_hours": lead, "max_advance_days": advance, "rules": rules},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


WED_MORNING = {"weekday": 2, "start_time": "09:00:00", "end_time": "10:30:00", "slot_minutes": 30, "capacity": 2}


@pytest.mark.asyncio
async def test_schedule_defaults_and_replace(admin_client):
    initial = await admin_client.get(f"{API}/admin/visit-schedule/yihua")
    assert initial.status_code == 200, initial.text
    assert initial.json()["min_lead_hours"] == 24
    assert initial.json()["max_advance_days"] == 60
    assert initial.json()["rules"] == []

    saved = await _set_rules(admin_client, [WED_MORNING], lead=48, advance=30)
    assert saved["min_lead_hours"] == 48
    assert len(saved["rules"]) == 1

    replaced = await _set_rules(admin_client, [])
    assert replaced["rules"] == []


@pytest.mark.asyncio
async def test_rule_validation(admin_client):
    bad = await admin_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={"min_lead_hours": 24, "max_advance_days": 60, "rules": [{**WED_MORNING, "end_time": "08:00:00"}]},
    )
    assert bad.status_code == 422
    bad_day = await admin_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={"min_lead_hours": 24, "max_advance_days": 60, "rules": [{**WED_MORNING, "weekday": 7}]},
    )
    assert bad_day.status_code == 422


@pytest.mark.asyncio
async def test_generate_slots_from_rules_is_idempotent(admin_client):
    await _set_rules(admin_client, [WED_MORNING])
    wed = _next_weekday(2)
    gen = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": wed.isoformat(), "date_to": wed.isoformat()},
    )
    assert gen.status_code == 200, gen.text
    # 09:00–10:30 每 30 分鐘 → 3 格。
    assert gen.json()["created"] == 3

    slots = (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={wed}&date_to={wed}")).json()
    assert [s["start_time"] for s in slots] == ["09:00:00", "09:30:00", "10:00:00"]
    assert all(s["capacity"] == 2 for s in slots)

    again = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": wed.isoformat(), "date_to": wed.isoformat()},
    )
    assert again.json() == {"created": 0, "skipped_existing": 3, "skipped_exception_days": 0}


@pytest.mark.asyncio
async def test_generate_skips_past_and_exception_days(admin_client):
    await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)])
    holiday = today_local() + timedelta(days=5)
    exc = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions",
        json={"exception_date": holiday.isoformat(), "reason": "教師研習"},
    )
    assert exc.status_code == 201, exc.text

    start = today_local() - timedelta(days=3)
    end = today_local() + timedelta(days=6)
    gen = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": start.isoformat(), "date_to": end.isoformat()},
    )
    body = gen.json()
    # 今天到 +6 共 7 天，扣掉休假日 1 天 → 6 天 × 3 格。
    assert body["created"] == 18
    assert body["skipped_exception_days"] == 1
    assert (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={holiday}&date_to={holiday}")).json() == []
    past = (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={start}&date_to={today_local() - timedelta(days=1)}")).json()
    assert past == []

    too_wide = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": today_local().isoformat(), "date_to": (today_local() + timedelta(days=200)).isoformat()},
    )
    assert too_wide.status_code == 422


@pytest.mark.asyncio
async def test_exception_closes_existing_slots_without_cancelling(admin_client, public_client):
    version = await _enable_slots(admin_client, auto_confirm=True)
    await _set_rules(admin_client, [WED_MORNING])
    wed = _next_weekday(2)
    await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": wed.isoformat(), "date_to": wed.isoformat()},
    )
    slot = (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={wed}&date_to={wed}")).json()[0]
    booked = await public_client.post(
        f"{API}/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "exception-close-01"},
    )
    assert booked.status_code == 201, booked.text

    exc = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions",
        json={"exception_date": wed.isoformat(), "reason": "颱風假"},
    )
    body = exc.json()
    assert body["closed_slots"] == 3
    assert body["affected_requests"] == 1

    slots = (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={wed}&date_to={wed}")).json()
    assert all(s["closed"] for s in slots)
    case = (await admin_client.get(f"{API}/admin/visit-requests/{booked.json()['receipt_id']}")).json()
    assert case["status"] == "confirmed"

    schedule = (await admin_client.get(f"{API}/admin/visit-schedule/yihua")).json()
    assert [e["reason"] for e in schedule["exceptions"]] == ["颱風假"]
    removed = await admin_client.delete(f"{API}/admin/visit-schedule/yihua/exceptions/{body['id']}")
    assert removed.status_code == 204
    assert (await admin_client.get(f"{API}/admin/visit-schedule/yihua")).json()["exceptions"] == []


@pytest.mark.asyncio
async def test_public_window_follows_campus_settings(admin_client):
    await _enable_slots(admin_client, auto_confirm=True)
    near = date.today() + timedelta(days=2)
    created = await admin_client.post(
        f"{API}/admin/slots?campus_key=yihua",
        json={"slot_date": near.isoformat(), "start_time": "10:00:00", "end_time": "11:00:00", "capacity": 1},
    )
    assert created.status_code == 201
    listed = await admin_client.get(f"{API}/public/slots?campus_key=yihua&date_from={near}&date_to={near}")
    assert len(listed.json()) == 1

    # 提前時間拉到 7 天，兩天後的時段就不再公開。
    await _set_rules(admin_client, [], lead=24 * 7)
    listed = await admin_client.get(f"{API}/public/slots?campus_key=yihua&date_from={near}&date_to={near}")
    assert listed.json() == []


@pytest.mark.asyncio
async def test_schedule_is_campus_scoped(minghua_client):
    assert (await minghua_client.get(f"{API}/admin/visit-schedule/yihua")).status_code == 404
    assert (await minghua_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={"min_lead_hours": 24, "max_advance_days": 60, "rules": []},
    )).status_code == 404
    assert (await minghua_client.get(f"{API}/admin/visit-schedule/minghua")).status_code == 200
