"""後台人工補登案件與指派承辦人。"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.auth.models import Role
from app.booking.models import OutboxMessage
from app.operations.models import AnalyticsEvent, AuditLogEntry
from tests.conftest import case_version, _create_user, _logged_in_client


# 預約表單要有已發布的同意文字（啟用 inquiry／slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")

BASE = "/api/website/v1/admin"


def _manual(campus_key="yihua", **overrides) -> dict:
    body = {
        "campus_key": campus_key,
        "source": "phone",
        "parent_name": "王媽媽",
        "phone": "0912-345-678",
        "child_name": "小安",
        "preferred_time": "平日下午",
        "consent_given": True,
    }
    body.update(overrides)
    return body


async def _create_slot(client, campus_key="yihua", capacity=1, days_ahead=3):
    response = await client.post(
        f"{BASE}/slots?campus_key={campus_key}",
        json={
            "slot_date": (date.today() + timedelta(days=days_ahead)).isoformat(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "capacity": capacity,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _me(client) -> str:
    return (await client.get("/api/website/v1/auth/me")).json()["user"]["id"]


@pytest.mark.asyncio
async def test_manual_intake_creates_new_case_even_when_online_booking_paused(admin_client, db_session):
    # 預設模式是 paused：官網不收單，但電話來的家長仍要能登錄。
    response = await admin_client.post(
        f"{BASE}/visit-requests",
        json=_manual(note="家長來電，想週六參觀"),
        headers={"Idempotency-Key": "manual-1"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "new"
    assert body["source"] == "phone"
    assert body["phone"] == "0912345678"
    me = await _me(admin_client)
    assert body["created_by"] == me
    assert body["assigned_staff_id"] == me

    notes = await admin_client.get(f"{BASE}/visit-requests/{body['id']}/contact-notes")
    assert [n["note"] for n in notes.json()] == ["家長來電，想週六參觀"]

    # 人員自己登錄的案件不發「新需求」通知、不算官網成效。
    assert (await db_session.execute(select(OutboxMessage))).scalars().all() == []
    assert (await db_session.execute(select(AnalyticsEvent))).scalars().all() == []
    actions = (await db_session.execute(select(AuditLogEntry.action))).scalars().all()
    assert "visit_request.manual_create" in actions


@pytest.mark.asyncio
async def test_manual_intake_retry_returns_same_case(admin_client):
    first = await admin_client.post(
        f"{BASE}/visit-requests", json=_manual(), headers={"Idempotency-Key": "dup"}
    )
    again = await admin_client.post(
        f"{BASE}/visit-requests", json=_manual(), headers={"Idempotency-Key": "dup"}
    )
    assert first.status_code == 201
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]

    changed = await admin_client.post(
        f"{BASE}/visit-requests",
        json=_manual(parent_name="別人"),
        headers={"Idempotency-Key": "dup"},
    )
    assert changed.status_code == 409


@pytest.mark.asyncio
async def test_manual_intake_key_cannot_collide_with_public_form_key(admin_client, public_client):
    config = (await admin_client.get(f"{BASE}/booking-config/yihua")).json()
    await admin_client.patch(
        f"{BASE}/booking-config/yihua",
        json={"expected_version": config["version"], "mode": "inquiry"},
    )
    version = (await public_client.get("/api/website/v1/public/booking-config/yihua")).json()["version"]
    public = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json={
            "campus_key": "yihua",
            "config_version": version,
            "parent_name": "官網家長",
            "phone": "0922333444",
            "consent_given": True,
        },
        headers={"Idempotency-Key": "same-key"},
    )
    assert public.status_code == 201, public.text
    manual = await admin_client.post(
        f"{BASE}/visit-requests", json=_manual(), headers={"Idempotency-Key": "same-key"}
    )
    assert manual.status_code == 201
    assert manual.json()["id"] != public.json()["receipt_id"]
    listed = await admin_client.get(f"{BASE}/visit-requests?source=web")
    assert [r["parent_name"] for r in listed.json()] == ["官網家長"]


@pytest.mark.asyncio
async def test_manual_intake_with_slot_confirms_and_respects_capacity(admin_client):
    slot = await _create_slot(admin_client, capacity=1)
    ok = await admin_client.post(
        f"{BASE}/visit-requests",
        json=_manual(source="walk_in", slot_id=slot["id"]),
        headers={"Idempotency-Key": "slot-1"},
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["status"] == "confirmed"
    assert ok.json()["slot"]["id"] == slot["id"]

    full = await admin_client.post(
        f"{BASE}/visit-requests",
        json=_manual(parent_name="第二位", slot_id=slot["id"]),
        headers={"Idempotency-Key": "slot-2"},
    )
    assert full.status_code == 409
    assert full.json()["detail"]["code"] == "SLOT_FULL"
    # 額滿時整筆不建立，不留下半成品案件。
    listed = await admin_client.get(f"{BASE}/visit-requests?q=第二位")
    assert listed.json() == []


@pytest.mark.asyncio
async def test_manual_intake_validates_input(admin_client):
    bad_phone = await admin_client.post(
        f"{BASE}/visit-requests", json=_manual(phone="12345"), headers={"Idempotency-Key": "a"}
    )
    assert bad_phone.status_code == 422
    no_consent = await admin_client.post(
        f"{BASE}/visit-requests", json=_manual(consent_given=False), headers={"Idempotency-Key": "b"}
    )
    assert no_consent.status_code == 422
    web_source = await admin_client.post(
        f"{BASE}/visit-requests", json=_manual(source="web"), headers={"Idempotency-Key": "c"}
    )
    assert web_source.status_code == 422


@pytest.mark.asyncio
async def test_campus_admin_cannot_manually_create_for_other_campus(minghua_client):
    response = await minghua_client.post(
        f"{BASE}/visit-requests", json=_manual(campus_key="yihua"), headers={"Idempotency-Key": "x"}
    )
    assert response.status_code == 404
    own = await minghua_client.post(
        f"{BASE}/visit-requests", json=_manual(campus_key="minghua"), headers={"Idempotency-Key": "y"}
    )
    assert own.status_code == 201, own.text


@pytest.mark.asyncio
async def test_assign_and_filter_by_assignee(app, admin_client, db_session):
    colleague = await _create_user(
        db_session, "yihua-staff@ivy.example", "yihua-staff-password-123", Role.CAMPUS_ADMIN, ["yihua"]
    )
    case = (
        await admin_client.post(f"{BASE}/visit-requests", json=_manual(), headers={"Idempotency-Key": "k"})
    ).json()

    assigned = await admin_client.patch(
        f"{BASE}/visit-requests/{case['id']}/assignee", json={"assigned_staff_id": str(colleague.id), "expected_version": await case_version(admin_client, case["id"])}
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["assigned_staff_id"] == str(colleague.id)

    colleague_client = await _logged_in_client(app, "yihua-staff@ivy.example", "yihua-staff-password-123")
    try:
        mine = await colleague_client.get(f"{BASE}/visit-requests?assignee=me")
        assert [r["id"] for r in mine.json()] == [case["id"]]
    finally:
        await colleague_client.aclose()
    assert (await admin_client.get(f"{BASE}/visit-requests?assignee=me")).json() == []

    cleared = await admin_client.patch(
        f"{BASE}/visit-requests/{case['id']}/assignee", json={"assigned_staff_id": None, "expected_version": await case_version(admin_client, case["id"])}
    )
    assert cleared.json()["assigned_staff_id"] is None
    unassigned = await admin_client.get(f"{BASE}/visit-requests?assignee=none")
    assert [r["id"] for r in unassigned.json()] == [case["id"]]

    actions = (await db_session.execute(select(AuditLogEntry.action))).scalars().all()
    assert actions.count("visit_request.assign") == 2


@pytest.mark.asyncio
async def test_cannot_assign_to_staff_without_campus_scope_or_inactive(admin_client, db_session):
    other_campus = await _create_user(
        db_session, "renwu-staff@ivy.example", "renwu-staff-password-123", Role.CAMPUS_ADMIN, ["renwu"]
    )
    editor = await _create_user(
        db_session, "editor2@ivy.example", "editor2-password-12345", Role.EDITOR, ["yihua"]
    )
    inactive = await _create_user(
        db_session, "gone@ivy.example", "gone-password-1234567", Role.CAMPUS_ADMIN, ["yihua"]
    )
    inactive.is_active = False
    await db_session.commit()

    case = (
        await admin_client.post(f"{BASE}/visit-requests", json=_manual(), headers={"Idempotency-Key": "k"})
    ).json()
    for user in (other_campus, editor, inactive):
        response = await admin_client.patch(
            f"{BASE}/visit-requests/{case['id']}/assignee", json={"assigned_staff_id": str(user.id), "expected_version": await case_version(admin_client, case["id"])}
        )
        assert response.status_code == 422, user.email
        assert response.json()["detail"]["code"] == "ASSIGNEE_INVALID"


@pytest.mark.asyncio
async def test_confirm_keeps_existing_assignee(admin_client, db_session):
    colleague = await _create_user(
        db_session, "yihua-staff@ivy.example", "yihua-staff-password-123", Role.CAMPUS_ADMIN, ["yihua"]
    )
    slot = await _create_slot(admin_client)
    case = (
        await admin_client.post(f"{BASE}/visit-requests", json=_manual(), headers={"Idempotency-Key": "k"})
    ).json()
    await admin_client.patch(
        f"{BASE}/visit-requests/{case['id']}/assignee", json={"assigned_staff_id": str(colleague.id), "expected_version": await case_version(admin_client, case["id"])}
    )
    confirmed = await admin_client.post(
        f"{BASE}/visit-requests/{case['id']}/confirm", json={"slot_id": slot["id"]}
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["assigned_staff_id"] == str(colleague.id)


@pytest.mark.asyncio
async def test_staff_list_is_scoped_for_campus_admin(admin_client, minghua_client, db_session):
    await _create_user(
        db_session, "renwu-staff@ivy.example", "renwu-staff-password-123", Role.CAMPUS_ADMIN, ["renwu"]
    )
    await _create_user(
        db_session, "shared@ivy.example", "shared-password-123456", Role.CAMPUS_ADMIN, ["minghua", "renwu"]
    )
    everyone = (await admin_client.get(f"{BASE}/visit-staff")).json()
    assert {s["email"] for s in everyone} >= {
        "admin@ivy.example", "minghua-admin@ivy.example", "renwu-staff@ivy.example", "shared@ivy.example",
    }

    scoped = (await minghua_client.get(f"{BASE}/visit-staff")).json()
    emails = {s["email"] for s in scoped}
    assert "renwu-staff@ivy.example" not in emails
    assert {"admin@ivy.example", "minghua-admin@ivy.example", "shared@ivy.example"} <= emails
    shared = next(s for s in scoped if s["email"] == "shared@ivy.example")
    # 不透露同事在其他校的權限。
    assert shared["campus_keys"] == ["minghua"]


# ---------------------------------------------------------------------------
# 接待月曆與完成參觀
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_calendar_lists_slots_with_visits_and_booked_counts(admin_client):
    slot = await _create_slot(admin_client, capacity=2)
    await _create_slot(admin_client, capacity=1, days_ahead=4)
    confirmed = (
        await admin_client.post(
            f"{BASE}/visit-requests",
            json=_manual(slot_id=slot["id"]),
            headers={"Idempotency-Key": "c1"},
        )
    ).json()
    cancelled = (
        await admin_client.post(
            f"{BASE}/visit-requests",
            json=_manual(parent_name="取消的家長", slot_id=slot["id"]),
            headers={"Idempotency-Key": "c2"},
        )
    ).json()
    await admin_client.post(f"{BASE}/visit-requests/{cancelled['id']}/cancel")

    start = date.today().isoformat()
    end = (date.today() + timedelta(days=10)).isoformat()
    response = await admin_client.get(f"{BASE}/visit-calendar?date_from={start}&date_to={end}")
    assert response.status_code == 200, response.text
    days = response.json()
    assert len(days) == 2
    first = days[0]
    assert first["id"] == slot["id"]
    assert first["booked_count"] == 1
    assert [v["id"] for v in first["visits"]] == [confirmed["id"]]
    assert first["visits"][0]["parent_name"] == "王媽媽"
    assert days[1]["visits"] == []


@pytest.mark.asyncio
async def test_calendar_is_scoped_and_range_limited(admin_client, minghua_client):
    await _create_slot(admin_client, campus_key="yihua")
    await _create_slot(admin_client, campus_key="minghua")
    start = date.today().isoformat()
    end = (date.today() + timedelta(days=10)).isoformat()

    own = (await minghua_client.get(f"{BASE}/visit-calendar?date_from={start}&date_to={end}")).json()
    assert {s["campus_key"] for s in own} == {"minghua"}
    other = await minghua_client.get(
        f"{BASE}/visit-calendar?date_from={start}&date_to={end}&campus_key=yihua"
    )
    assert other.status_code == 404

    too_wide = await admin_client.get(
        f"{BASE}/visit-calendar?date_from={start}&date_to={(date.today() + timedelta(days=90)).isoformat()}"
    )
    assert too_wide.status_code == 400


@pytest.mark.asyncio
async def test_complete_only_from_confirmed(admin_client):
    slot = await _create_slot(admin_client)
    pending = (
        await admin_client.post(f"{BASE}/visit-requests", json=_manual(), headers={"Idempotency-Key": "p"})
    ).json()
    early = await admin_client.post(f"{BASE}/visit-requests/{pending['id']}/complete")
    assert early.status_code == 409

    confirmed = (
        await admin_client.post(
            f"{BASE}/visit-requests",
            json=_manual(parent_name="來參觀的家長", slot_id=slot["id"]),
            headers={"Idempotency-Key": "q"},
        )
    ).json()
    done = await admin_client.post(f"{BASE}/visit-requests/{confirmed['id']}/complete")
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "completed"
