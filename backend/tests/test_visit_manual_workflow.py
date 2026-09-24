"""案件流程補完：聯絡中、完成、承辦人、人工補登、接待日曆。"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.auth.models import Role
from tests.conftest import _create_user
from tests.test_visit_workflow import _create_slot, _enable_slots, _slot_payload

API = "/api/website/v1"


def _manual_payload(**overrides):
    payload = {
        "campus_key": "yihua",
        "source": "phone",
        "parent_name": "林爸爸",
        "phone": "0912-345-678",
        "questions": "想了解小班",
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_manual_entry_records_source_and_creator(admin_client):
    resp = await admin_client.post(f"{API}/admin/visit-requests", json=_manual_payload())
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "new"
    assert body["source"] == "phone"
    assert body["phone"] == "0912345678"
    assert body["created_by"] is not None

    listed = await admin_client.get(f"{API}/admin/visit-requests?source=phone")
    assert [r["id"] for r in listed.json()] == [body["id"]]
    assert (await admin_client.get(f"{API}/admin/visit-requests?source=web")).json() == []


@pytest.mark.asyncio
async def test_manual_entry_rejects_web_source_and_bad_phone(admin_client):
    assert (await admin_client.post(f"{API}/admin/visit-requests", json=_manual_payload(source="web"))).status_code == 422
    assert (await admin_client.post(f"{API}/admin/visit-requests", json=_manual_payload(phone="12345"))).status_code == 422


@pytest.mark.asyncio
async def test_manual_entry_is_campus_scoped(minghua_client):
    resp = await minghua_client.post(f"{API}/admin/visit-requests", json=_manual_payload(campus_key="yihua"))
    assert resp.status_code == 404
    ok = await minghua_client.post(f"{API}/admin/visit-requests", json=_manual_payload(campus_key="minghua"))
    assert ok.status_code == 201


@pytest.mark.asyncio
async def test_cross_campus_link_requires_super_admin(admin_client, minghua_client):
    old = (await admin_client.post(f"{API}/admin/visit-requests", json=_manual_payload(campus_key="minghua"))).json()
    # 同校關聯：分校管理者可以。
    same = await minghua_client.post(
        f"{API}/admin/visit-requests",
        json=_manual_payload(campus_key="minghua", related_request_id=old["id"]),
    )
    assert same.status_code == 201, same.text
    assert same.json()["related_request_id"] == old["id"]
    # 跨校關聯：總管理者可以。
    cross = await admin_client.post(
        f"{API}/admin/visit-requests",
        json=_manual_payload(campus_key="yihua", related_request_id=old["id"]),
    )
    assert cross.status_code == 201, cross.text


@pytest.mark.asyncio
async def test_contacting_then_confirm_then_complete(admin_client):
    created = (await admin_client.post(f"{API}/admin/visit-requests", json=_manual_payload())).json()
    rid = created["id"]

    contacting = await admin_client.post(f"{API}/admin/visit-requests/{rid}/contacting")
    assert contacting.status_code == 200, contacting.text
    assert contacting.json()["status"] == "contacting"
    # 重送不報錯。
    assert (await admin_client.post(f"{API}/admin/visit-requests/{rid}/contacting")).status_code == 200

    # 還沒確認就標完成 → 409。
    early = await admin_client.post(f"{API}/admin/visit-requests/{rid}/complete")
    assert early.status_code == 409

    slot = await _create_slot(admin_client, capacity=1)
    confirmed = await admin_client.post(f"{API}/admin/visit-requests/{rid}/confirm", json={"slot_id": slot["id"]})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"

    done = await admin_client.post(f"{API}/admin/visit-requests/{rid}/complete")
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "completed"
    # 結案後不能改回聯絡中。
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
async def test_assign_staff_and_filter(admin_client, minghua_client, db_session):
    created = (await admin_client.post(f"{API}/admin/visit-requests", json=_manual_payload())).json()
    rid = created["id"]

    staff = await admin_client.get(f"{API}/admin/visit-staff?campus_key=yihua")
    assert staff.status_code == 200
    emails = [s["email"] for s in staff.json()]
    # 明華管理者沒有義華範圍，不能被指派義華案件。
    assert "admin@ivy.example" in emails
    assert "minghua-admin@ivy.example" not in emails

    admin_id = next(s["id"] for s in staff.json() if s["email"] == "admin@ivy.example")
    assigned = await admin_client.patch(
        f"{API}/admin/visit-requests/{rid}/assignee", json={"assigned_staff_id": admin_id}
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["assigned_staff_id"] == admin_id

    mine = await admin_client.get(f"{API}/admin/visit-requests?assignee=me")
    assert [r["id"] for r in mine.json()] == [rid]
    assert (await admin_client.get(f"{API}/admin/visit-requests?assignee=none")).json() == []

    minghua_staff = await minghua_client.get(f"{API}/admin/visit-staff?campus_key=minghua")
    minghua_id = next(s["id"] for s in minghua_staff.json() if s["email"] == "minghua-admin@ivy.example")
    bad = await admin_client.patch(
        f"{API}/admin/visit-requests/{rid}/assignee", json={"assigned_staff_id": minghua_id}
    )
    assert bad.status_code == 422

    cleared = await admin_client.patch(f"{API}/admin/visit-requests/{rid}/assignee", json={"assigned_staff_id": None})
    assert cleared.json()["assigned_staff_id"] is None


@pytest.mark.asyncio
async def test_reception_can_read_but_not_manage(app, admin_client, db_session):
    from tests.conftest import _logged_in_client

    await _create_user(db_session, "reception@ivy.example", "reception-password-123", Role.RECEPTION, ["yihua"])
    reception = await _logged_in_client(app, "reception@ivy.example", "reception-password-123")
    try:
        created = (await admin_client.post(f"{API}/admin/visit-requests", json=_manual_payload())).json()
        assert (await reception.get(f"{API}/admin/visit-requests/{created['id']}")).status_code == 200
        staff = await reception.get(f"{API}/admin/visit-staff?campus_key=yihua")
        assert "reception@ivy.example" in [s["email"] for s in staff.json()]
    finally:
        await reception.aclose()


@pytest.mark.asyncio
async def test_calendar_lists_scheduled_visits_in_range(admin_client, minghua_client):
    await _enable_slots(admin_client, auto_confirm=True)
    slot = await _create_slot(admin_client, capacity=2, days_ahead=5)
    created = (await admin_client.post(f"{API}/admin/visit-requests", json=_manual_payload())).json()
    await admin_client.post(f"{API}/admin/visit-requests/{created['id']}/confirm", json={"slot_id": slot["id"]})
    unscheduled = (await admin_client.post(f"{API}/admin/visit-requests", json=_manual_payload(parent_name="未排"))).json()

    start = date.today()
    end = start + timedelta(days=30)
    cal = await admin_client.get(f"{API}/admin/visit-calendar?date_from={start}&date_to={end}")
    assert cal.status_code == 200, cal.text
    ids = [r["id"] for r in cal.json()]
    assert created["id"] in ids
    assert unscheduled["id"] not in ids
    assert cal.json()[0]["slot"]["slot_date"] == slot["slot_date"]

    # 分校管理者只看自己校。
    assert (await minghua_client.get(f"{API}/admin/visit-calendar?date_from={start}&date_to={end}")).json() == []
    too_long = await admin_client.get(f"{API}/admin/visit-calendar?date_from={start}&date_to={start + timedelta(days=90)}")
    assert too_long.status_code == 422


@pytest.mark.asyncio
async def test_created_date_filter(admin_client):
    created = (await admin_client.post(f"{API}/admin/visit-requests", json=_manual_payload())).json()
    today = date.today()
    hit = await admin_client.get(f"{API}/admin/visit-requests?created_from={today - timedelta(days=1)}&created_to={today + timedelta(days=1)}")
    assert created["id"] in [r["id"] for r in hit.json()]
    miss = await admin_client.get(f"{API}/admin/visit-requests?created_from={today + timedelta(days=2)}")
    assert miss.json() == []
