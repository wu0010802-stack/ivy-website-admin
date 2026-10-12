"""接待人員處理案件（2026-09-25 業主裁定）：booking.handle。

櫃台可以記聯絡紀錄、確認排入時段（舊案）、人工補登（選場次即確認）、取消、標記未到場、
完成參觀、後台改期、產生／撤銷家長管理連結；時段、
每週規則、休假日與預約設定仍限 booking.manage。站內通知標為
已處理不在裁定的清單裡，業主確認前也限 booking.manage。"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.auth.models import Role, User
from app.auth.permissions import effective_capabilities, has_capability, roles_with
from app.operations.models import AuditLogEntry
from tests.conftest import (
    _create_user,
    _logged_in_client,
    book_slot,
    legacy_request,
    start_visit_slot,
)


# 預約表單要有已發布的同意文字（啟用 slots、官網送單）。
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


async def _manual_case(client, key: str, *, slot_id: str, campus_key="yihua", **extra) -> dict:
    """人工補登：一定要選場次，送出即確認。"""
    response = await client.post(
        f"{BASE}/visit-requests",
        json={
            "campus_key": campus_key,
            "source": "phone",
            "parent_name": "王媽媽",
            "phone": "0912345678",
            "consent_given": True,
            "slot_id": slot_id,
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
async def test_reception_handles_a_case_end_to_end(admin_client, public_client, reception, db_session):
    desk_user, desk = reception
    slot_a = await _slot(admin_client)
    slot_b = await _slot(admin_client, start="14:00:00", end="15:00:00")

    # 已確認的案件：櫃台寫聯絡紀錄、改期。人工確認的 confirm 端點已退場。
    case_id = await legacy_request(db_session, status="confirmed", slot_id=slot_a["id"], parent_name="王媽媽")
    note = await desk.post(f"{BASE}/visit-requests/{case_id}/contact-notes", json={"note": "已回電，約週六"})
    assert note.status_code == 201, note.text
    retired = await desk.post(f"{BASE}/visit-requests/{case_id}/confirm", json={"slot_id": slot_a["id"]})
    assert retired.status_code in (404, 405)

    moved = await desk.post(f"{BASE}/visit-requests/{case_id}/reschedule", json={"new_slot_id": slot_b["id"]})
    assert moved.status_code == 200, moved.text
    assert moved.json()["slot_id"] == slot_b["id"]

    link = await desk.post(f"{BASE}/visit-requests/{case_id}/access-link")
    assert link.status_code == 200, link.text
    assert "token=" in link.json()["manage_url_fragment"]
    assert (await desk.post(f"{BASE}/visit-requests/{case_id}/revoke-access")).status_code == 204
    # 拿到連結的人能以家長身分取消或改期：櫃台產生、撤銷都要查得到是誰、哪一校，
    # 稽核裡不留 token。
    token = link.json()["manage_url_fragment"].split("token=")[1]
    audits = (await db_session.execute(
        select(AuditLogEntry).where(
            AuditLogEntry.target_id == case_id,
            AuditLogEntry.action.in_(["visit_request.create_access_link", "visit_request.revoke_access"]),
        )
    )).scalars().all()
    assert sorted(entry.action for entry in audits) == ["visit_request.create_access_link", "visit_request.revoke_access"]
    for entry in audits:
        assert entry.actor_user_id == desk_user.id
        assert entry.campus_key == "yihua"
        assert token not in str(entry.metadata_json)

    await start_visit_slot(db_session, case_id)
    assert (await desk.post(f"{BASE}/visit-requests/{case_id}/complete")).json()["status"] == "completed"

    # 電話來的家長：櫃台自己補登（選場次即確認）並寫第一筆聯絡紀錄。
    no_show_case = await _manual_case(desk, "desk-2", slot_id=slot_a["id"], note="家長來電")
    assert no_show_case["created_by"] is not None
    assert no_show_case["status"] == "confirmed"
    await start_visit_slot(db_session, no_show_case["id"])
    assert (await desk.post(f"{BASE}/visit-requests/{no_show_case['id']}/no-show")).json()["status"] == "no_show"

    booked = await book_slot(admin_client, public_client, days_ahead=6, idempotency_key="desk-3")
    assert (await desk.post(f"{BASE}/visit-requests/{booked['receipt_id']}/cancel")).json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_reception_cannot_touch_schedule_settings(admin_client, reception):
    _, desk = reception
    slot = await _slot(admin_client)

    assert (await desk.post(
        f"{BASE}/slots?campus_key=yihua",
        json={"slot_date": date.today().isoformat(), "start_time": "10:00:00", "end_time": "11:00:00", "capacity": 1},
    )).status_code == 403
    assert (await desk.patch(f"{BASE}/slots/{slot['id']}", json={"capacity": 5, "expected_version": 1})).status_code == 403
    assert (await desk.patch(f"{BASE}/slots/{slot['id']}", json={"closed": True, "expected_version": 1})).status_code == 403
    assert (await desk.put(
        f"{BASE}/visit-schedule/yihua", json={"expected_version": 1, "min_lead_hours": 24, "max_advance_days": 60, "rules": []}
    )).status_code == 403
    assert (await desk.post(
        f"{BASE}/visit-schedule/yihua/exceptions", json={"exception_date": date.today().isoformat()}
    )).status_code == 403
    assert (await desk.patch(
        f"{BASE}/booking-config/yihua", json={"expected_version": 0, "mode": "phone", "phone": "07-000-0000"}
    )).status_code == 403
    # 匯出要總管理者另外授權，接待角色本身沒有。
    assert (await desk.get(f"{BASE}/visit-requests/export")).status_code == 403


@pytest.mark.asyncio
async def test_reception_stays_inside_own_campus(admin_client, reception):
    _, desk = reception
    other_slot = await _slot(admin_client, campus_key="minghua")
    other = await _manual_case(admin_client, "desk-other-campus", slot_id=other_slot["id"], campus_key="minghua")
    assert (await desk.post(f"{BASE}/visit-requests/{other['id']}/contact-notes", json={"note": "x"})).status_code == 404
    assert (await desk.post(f"{BASE}/visit-requests/{other['id']}/cancel")).status_code == 404
    assert (await desk.post(f"{BASE}/visit-requests/{other['id']}/access-link")).status_code == 404
    assert (await desk.post(
        f"{BASE}/visit-requests", json={"campus_key": "minghua", "source": "phone", "parent_name": "林先生",
                                        "phone": "0911222333", "consent_given": True, "slot_id": other_slot["id"]},
        headers={"Idempotency-Key": "desk-wrong-campus"},
    )).status_code == 404


@pytest.mark.asyncio
async def test_reception_sees_notifications_but_only_managers_mark_them_handled(
    admin_client, public_client, reception, run_outbox_once, recording_mail_adapter
):
    # read_at 是全校共用的狀態；2026-09-25 裁定沒有把「標為已處理」開給櫃台。
    _, desk = reception
    await book_slot(admin_client, public_client, idempotency_key="desk-notif-01")
    await run_outbox_once(recording_mail_adapter)
    items = (await desk.get(f"{BASE}/notifications?campus_key=yihua")).json()
    # 自選場次送單即確認：園方只收到一則「新的參觀預約」站內通知。
    assert [item["kind"] for item in items] == ["visit_request_created"]
    denied = await desk.post(f"{BASE}/notifications/{items[0]['id']}/read")
    assert denied.status_code == 403, denied.text
    assert all(item["read_at"] is None for item in (await desk.get(f"{BASE}/notifications?campus_key=yihua")).json())
    marked = await admin_client.post(f"{BASE}/notifications/{items[0]['id']}/read")
    assert marked.status_code == 200, marked.text


@pytest.mark.asyncio
async def test_visit_staff_lists_handlers(admin_client, minghua_client, reception, db_session):
    """同事名單（把登錄的人、聯絡紀錄與歷程裡的 id 翻成名字）列出能處理案件的人，含櫃台。"""
    desk_user, _ = reception
    other_desk = await _create_user(db_session, "desk-mh@ivy.example", "desk-password-5678", Role.RECEPTION, ["minghua"])
    readonly = await _create_user(db_session, "ro@ivy.example", "readonly-password-1", Role.READONLY, ["yihua"])

    staff = (await admin_client.get(f"{BASE}/visit-staff")).json()
    ids = {s["id"] for s in staff}
    assert str(desk_user.id) in ids and str(other_desk.id) in ids
    assert str(readonly.id) not in ids
    # 分校管理者只看得到跟自己有共同校區的人。
    assert str(desk_user.id) not in {s["id"] for s in (await minghua_client.get(f"{BASE}/visit-staff")).json()}
