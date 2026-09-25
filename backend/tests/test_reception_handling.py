"""接待人員處理案件（2026-09-25 業主裁定）：booking.handle。

櫃台可以記聯絡紀錄、轉聯絡中、確認排入時段、人工補登、取消、標記未到場、
完成參觀、後台改期、核准／退回家長改期、產生／撤銷家長管理連結；時段、
每週規則、休假日、預約設定與指派承辦人仍限 booking.manage。"""

from __future__ import annotations

from datetime import date, timedelta

import httpx
import pytest

from app.auth.models import Role, User
from app.auth.permissions import effective_capabilities, has_capability, roles_with
from tests.conftest import _create_user, _logged_in_client, set_booking_mode


# 預約表單要有已發布的同意文字（啟用 inquiry／slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
BASE = f"{API}/admin"


@pytest.fixture
async def reception(app, db_session):
    user = await _create_user(db_session, "desk@ivy.example", "desk-password-1234", Role.RECEPTION, ["yihua"])
    client = await _logged_in_client(app, "desk@ivy.example", "desk-password-1234")
    yield user, client
    await client.aclose()


async def _slot(client, *, days_ahead=3, start="10:00:00", end="11:00:00", capacity=2, campus_key="yihua"):
    response = await client.post(
        f"{BASE}/slots?campus_key={campus_key}",
        json={
            "slot_date": (date.today() + timedelta(days=days_ahead)).isoformat(),
            "start_time": start,
            "end_time": end,
            "capacity": capacity,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _manual_case(client, key: str, campus_key="yihua", **extra) -> dict:
    response = await client.post(
        f"{BASE}/visit-requests",
        json={
            "campus_key": campus_key,
            "source": "phone",
            "parent_name": "王媽媽",
            "phone": "0912345678",
            "consent_given": True,
            **extra,
        },
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_booking_handle_includes_reception_but_manage_does_not():
    assert roles_with("booking.handle") == {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.RECEPTION}
    assert roles_with("booking.manage") == {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN}
    desk = User(role=Role.RECEPTION, capabilities=[])
    assert has_capability(desk, "booking.handle")
    assert not has_capability(desk, "booking.manage")
    caps = effective_capabilities(desk)
    assert {"booking.read", "booking.handle"} <= set(caps)
    assert "booking.manage" not in caps and "booking.export" not in caps
    for role in (Role.EDITOR, Role.READONLY):
        assert not has_capability(User(role=role, capabilities=[]), "booking.handle")


@pytest.mark.asyncio
async def test_reception_handles_a_case_end_to_end(admin_client, reception):
    _, desk = reception
    slot_a = await _slot(admin_client)
    slot_b = await _slot(admin_client, start="14:00:00", end="15:00:00")

    # 電話來的家長：櫃台自己補登並寫第一筆聯絡紀錄。
    case = await _manual_case(desk, "desk-1", note="家長來電")
    case_id = case["id"]
    assert case["created_by"] is not None

    note = await desk.post(f"{BASE}/visit-requests/{case_id}/contact-notes", json={"note": "已回電，約週六"})
    assert note.status_code == 201, note.text
    assert (await desk.post(f"{BASE}/visit-requests/{case_id}/contacting")).json()["status"] == "contacting"

    confirmed = await desk.post(f"{BASE}/visit-requests/{case_id}/confirm", json={"slot_id": slot_a["id"]})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"

    moved = await desk.post(f"{BASE}/visit-requests/{case_id}/reschedule", json={"new_slot_id": slot_b["id"]})
    assert moved.status_code == 200, moved.text
    assert moved.json()["slot_id"] == slot_b["id"]

    link = await desk.post(f"{BASE}/visit-requests/{case_id}/access-link")
    assert link.status_code == 200, link.text
    assert "token=" in link.json()["manage_url_fragment"]
    assert (await desk.post(f"{BASE}/visit-requests/{case_id}/revoke-access")).status_code == 204

    assert (await desk.post(f"{BASE}/visit-requests/{case_id}/complete")).json()["status"] == "completed"

    no_show_case = await _manual_case(desk, "desk-2", slot_id=slot_a["id"])
    assert no_show_case["status"] == "confirmed"
    assert (await desk.post(f"{BASE}/visit-requests/{no_show_case['id']}/no-show")).json()["status"] == "no_show"

    cancel_case = await _manual_case(desk, "desk-3")
    assert (await desk.post(f"{BASE}/visit-requests/{cancel_case['id']}/cancel")).json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_reception_cannot_touch_schedule_settings_or_assignments(admin_client, reception):
    _, desk = reception
    slot = await _slot(admin_client)
    case = await _manual_case(admin_client, "desk-admin-1")
    me = (await desk.get(f"{API}/auth/me")).json()["user"]

    assert (await desk.post(
        f"{BASE}/slots?campus_key=yihua",
        json={"slot_date": date.today().isoformat(), "start_time": "10:00:00", "end_time": "11:00:00", "capacity": 1},
    )).status_code == 403
    assert (await desk.patch(f"{BASE}/slots/{slot['id']}", json={"capacity": 5})).status_code == 403
    assert (await desk.patch(f"{BASE}/slots/{slot['id']}", json={"closed": True})).status_code == 403
    assert (await desk.put(
        f"{BASE}/visit-schedule/yihua", json={"min_lead_hours": 24, "max_advance_days": 60, "rules": []}
    )).status_code == 403
    assert (await desk.post(
        f"{BASE}/visit-schedule/yihua/exceptions", json={"exception_date": date.today().isoformat()}
    )).status_code == 403
    today = date.today().isoformat()
    assert (await desk.post(
        f"{BASE}/visit-schedule/yihua/generate", json={"date_from": today, "date_to": today}
    )).status_code == 403
    assert (await desk.patch(
        f"{BASE}/booking-config/yihua", json={"expected_version": 0, "mode": "phone", "phone": "07-000-0000"}
    )).status_code == 403
    assert (await desk.patch(
        f"{BASE}/visit-requests/{case['id']}/assignee", json={"assigned_staff_id": me["id"]}
    )).status_code == 403
    # 匯出要總管理者另外授權，接待角色本身沒有。
    assert (await desk.get(f"{BASE}/visit-requests/export")).status_code == 403


@pytest.mark.asyncio
async def test_reception_stays_inside_own_campus(admin_client, reception):
    _, desk = reception
    other = await _manual_case(admin_client, "desk-other-campus", campus_key="minghua")
    assert (await desk.post(f"{BASE}/visit-requests/{other['id']}/contact-notes", json={"note": "x"})).status_code == 404
    assert (await desk.post(f"{BASE}/visit-requests/{other['id']}/cancel")).status_code == 404
    assert (await desk.post(f"{BASE}/visit-requests/{other['id']}/access-link")).status_code == 404
    assert (await desk.post(
        f"{BASE}/visit-requests", json={"campus_key": "minghua", "source": "phone", "parent_name": "林先生",
                                        "phone": "0911222333", "consent_given": True},
        headers={"Idempotency-Key": "desk-wrong-campus"},
    )).status_code == 404


@pytest.mark.asyncio
async def test_reception_decides_parent_reschedule_requests(app, admin_client, public_client, reception):
    _, desk = reception
    await set_booking_mode(admin_client, "yihua", mode="slots", slots_auto_confirm=True)
    version = (await admin_client.get(f"{BASE}/booking-config/yihua")).json()["version"]
    slot_a = await _slot(admin_client)
    slot_b = await _slot(admin_client, start="15:00:00", end="16:00:00")
    slot_c = await _slot(admin_client, start="16:00:00", end="17:00:00")
    created = await public_client.post(
        f"{API}/public/visit-requests",
        json={"campus_key": "yihua", "config_version": version, "parent_name": "陳媽媽", "phone": "0912345678",
              "consent_given": True, "slot_id": slot_a["id"]},
        headers={"Idempotency-Key": "desk-reschedule-01"},
    )
    assert created.status_code == 201, created.text
    receipt_id = created.json()["receipt_id"]

    link = await desk.post(f"{BASE}/visit-requests/{receipt_id}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]

    async def parent_asks_for(slot_id: str) -> str:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", headers={"X-Ivy-Parent": "1"}) as parent:
            await parent.post(f"{API}/public/visit-manage/exchange", json={"token": token})
            asked = await parent.post(f"{API}/public/visit-manage/reschedule-request", json={"new_slot_id": slot_id})
            assert asked.status_code == 201, asked.text
            return asked.json()["id"]

    first = await parent_asks_for(slot_b["id"])
    rejected = await desk.post(f"{BASE}/reschedule-requests/{first}/reject")
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "rejected"

    second = await parent_asks_for(slot_c["id"])
    approved = await desk.post(f"{BASE}/reschedule-requests/{second}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["slot_id"] == slot_c["id"]


@pytest.mark.asyncio
async def test_reception_can_mark_notifications_handled(
    admin_client, public_client, reception, run_outbox_once, recording_mail_adapter
):
    _, desk = reception
    current = await admin_client.get(f"{BASE}/booking-config/yihua")
    await admin_client.patch(
        f"{BASE}/booking-config/yihua", json={"expected_version": current.json()["version"], "mode": "inquiry"}
    )
    version = (await admin_client.get(f"{BASE}/booking-config/yihua")).json()["version"]
    await public_client.post(
        f"{API}/public/visit-requests",
        json={"campus_key": "yihua", "config_version": version, "parent_name": "陳媽媽", "phone": "0912345678",
              "consent_given": True},
        headers={"Idempotency-Key": "desk-notif-01"},
    )
    await run_outbox_once(recording_mail_adapter)
    items = (await desk.get(f"{BASE}/notifications?campus_key=yihua")).json()
    assert len(items) == 1
    marked = await desk.post(f"{BASE}/notifications/{items[0]['id']}/read")
    assert marked.status_code == 200, marked.text


@pytest.mark.asyncio
async def test_reception_is_an_assignable_handler(admin_client, minghua_client, reception, db_session):
    desk_user, desk = reception
    other_desk = await _create_user(db_session, "desk-mh@ivy.example", "desk-password-5678", Role.RECEPTION, ["minghua"])
    readonly = await _create_user(db_session, "ro@ivy.example", "readonly-password-1", Role.READONLY, ["yihua"])

    staff = (await admin_client.get(f"{BASE}/visit-staff")).json()
    ids = {s["id"] for s in staff}
    assert str(desk_user.id) in ids and str(other_desk.id) in ids
    assert str(readonly.id) not in ids
    # 分校管理者只看得到跟自己有共同校區的人。
    assert str(desk_user.id) not in {s["id"] for s in (await minghua_client.get(f"{BASE}/visit-staff")).json()}

    case = await _manual_case(admin_client, "desk-assign-1")
    assigned = await admin_client.patch(
        f"{BASE}/visit-requests/{case['id']}/assignee", json={"assigned_staff_id": str(desk_user.id)}
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["assigned_staff_id"] == str(desk_user.id)

    wrong_campus = await admin_client.patch(
        f"{BASE}/visit-requests/{case['id']}/assignee", json={"assigned_staff_id": str(other_desk.id)}
    )
    assert wrong_campus.status_code == 422
    not_handler = await admin_client.patch(
        f"{BASE}/visit-requests/{case['id']}/assignee", json={"assigned_staff_id": str(readonly.id)}
    )
    assert not_handler.status_code == 422

    mine = (await desk.get(f"{BASE}/visit-requests?assignee=me")).json()
    assert [r["id"] for r in mine] == [case["id"]]
