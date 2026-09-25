"""案件處理補完（2026-09-25 缺口 B02）：後台改期、名額保留、家長管理連結、
案件歷程、家長改期申請通知與待核准清單。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date, timedelta

import httpx
import pytest
from sqlalchemy import select

from app.auth.models import Role
from app.booking.access_models import RescheduleRequest
from app.booking.models import OutboxMessage, VisitRequest, VisitRequestEvent
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client, set_booking_mode


# 預約表單要有已發布的同意文字（啟用 inquiry／slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
BASE = f"{API}/admin"


async def _set_mode(admin_client, **config) -> int:
    response = await set_booking_mode(admin_client, "yihua", **config)
    assert response.status_code == 200, response.text
    return response.json()["version"]


async def _slot(client, *, days_ahead=3, start="10:00:00", end="11:00:00", capacity=1, campus_key="yihua") -> dict:
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


async def _book(public_client, version: int, slot_id: str, key: str, parent_name="陳媽媽") -> str:
    response = await public_client.post(
        f"{API}/public/visit-requests",
        json={
            "campus_key": "yihua",
            "config_version": version,
            "parent_name": parent_name,
            "phone": "0912345678",
            "consent_given": True,
            "slot_id": slot_id,
        },
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 201, response.text
    return response.json()["receipt_id"]


async def _manual(client, key: str, **extra):
    return await client.post(
        f"{BASE}/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": "王媽媽", "phone": "0912345678",
              "consent_given": True, **extra},
        headers={"Idempotency-Key": key},
    )


async def _history(admin_client, receipt_id: str) -> list[dict]:
    detail = await admin_client.get(f"{BASE}/visit-requests/{receipt_id}")
    assert detail.status_code == 200, detail.text
    return detail.json()["history"]


async def _parent_asks_for(app, admin_client, receipt_id: str, slot_id: str) -> str:
    link = await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/access-link")
    assert link.status_code == 200, link.text
    token = link.json()["manage_url_fragment"].split("token=")[1]
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", headers={"X-Ivy-Parent": "1"}) as parent:
        assert (await parent.post(f"{API}/public/visit-manage/exchange", json={"token": token})).status_code == 200
        asked = await parent.post(f"{API}/public/visit-manage/reschedule-request", json={"new_slot_id": slot_id})
        assert asked.status_code == 201, asked.text
        return asked.json()["id"]


# --- 第 13 條：已確認的案件在後台改期 -----------------------------------------


@pytest.mark.asyncio
async def test_admin_reschedule_keeps_case_and_records_history(admin_client, public_client):
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot_a = await _slot(admin_client, days_ahead=3)
    slot_b = await _slot(admin_client, days_ahead=4, start="14:00:00", end="15:00:00")
    receipt_id = await _book(public_client, version, slot_a["id"], "b02-reschedule-01")

    moved = await admin_client.post(
        f"{BASE}/visit-requests/{receipt_id}/reschedule",
        json={"new_slot_id": slot_b["id"], "reason": "家長來電改到週末"},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["id"] == receipt_id
    assert moved.json()["slot"]["slot_date"] == slot_b["slot_date"]

    event = next(e for e in await _history(admin_client, receipt_id) if e["event_type"] == "rescheduled")
    assert event["source"] == "staff"
    assert event["actor_email"] == "admin@ivy.example"
    assert event["before"]["slot"]["id"] == slot_a["id"]
    assert event["after"]["slot"]["id"] == slot_b["id"]
    assert event["after"]["slot"]["start_time"] == "14:00:00"
    assert event["reason"] == "家長來電改到週末"


@pytest.mark.asyncio
async def test_admin_reschedule_rejects_slot_that_already_started(admin_client, public_client):
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot_a = await _slot(admin_client, days_ahead=3)
    past = await _slot(admin_client, days_ahead=-1, capacity=3)
    receipt_id = await _book(public_client, version, slot_a["id"], "b02-reschedule-past")

    moved = await admin_client.post(
        f"{BASE}/visit-requests/{receipt_id}/reschedule", json={"new_slot_id": past["id"]}
    )
    assert moved.status_code == 409
    assert moved.json()["detail"]["code"] == "SLOT_NOT_BOOKABLE"
    assert "原時段維持不變" in moved.json()["detail"]["message"]
    detail = await admin_client.get(f"{BASE}/visit-requests/{receipt_id}")
    assert detail.json()["slot_id"] == slot_a["id"]


@pytest.mark.asyncio
async def test_reschedule_waits_for_concurrent_cancel_on_the_case_row(app, admin_client, public_client):
    """改期原本沒有鎖案件列：家長取消與園方改期同時發生時，改期會用最初讀到
    的 confirmed 狀態把已取消的案件搬到新時段、重新占名額。"""
    from app.booking import workflow_service

    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot_a = await _slot(admin_client, days_ahead=3, capacity=2)
    slot_b = await _slot(admin_client, days_ahead=4, capacity=2)
    receipt_id = await _book(public_client, version, slot_a["id"], "b02-reschedule-race")

    factory = app.state.session_factory
    async with factory() as parent, factory() as staff:
        parent_view = await parent.get(VisitRequest, uuid.UUID(receipt_id))
        staff_view = await staff.get(VisitRequest, uuid.UUID(receipt_id))
        await workflow_service.cancel(parent, parent_view, actor=workflow_service.PARENT)
        task = asyncio.create_task(workflow_service.reschedule(staff, staff_view, uuid.UUID(slot_b["id"])))
        await asyncio.sleep(0.5)
        assert not task.done(), "改期沒有等取消交易的案件列鎖"
        await parent.commit()
        with pytest.raises(workflow_service.InvalidTransition):
            await task
        await staff.rollback()

    detail = await admin_client.get(f"{BASE}/visit-requests/{receipt_id}")
    assert detail.json()["status"] == "cancelled"
    assert detail.json()["slot_id"] == slot_a["id"]


# --- 第 21 條：completed／no_show 保留名額 -------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("closing", ["complete", "no-show"])
async def test_completed_and_no_show_keep_the_used_seat(admin_client, public_client, closing):
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot = await _slot(admin_client, days_ahead=3, capacity=1)
    receipt_id = await _book(public_client, version, slot["id"], f"b02-keep-{closing}")
    closed = await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/{closing}")
    assert closed.status_code == 200, closed.text

    listed = await admin_client.get(
        f"{BASE}/slots?campus_key=yihua&date_from={slot['slot_date']}&date_to={slot['slot_date']}"
    )
    assert listed.json()[0]["booked_count"] == 1
    calendar = await admin_client.get(
        f"{BASE}/visit-calendar?date_from={slot['slot_date']}&date_to={slot['slot_date']}&campus_key=yihua"
    )
    assert calendar.json()[0]["booked_count"] == 1

    # 後台不能再把別人排進這一格，公開頁也不再列出。
    other = await _manual(admin_client, f"b02-keep-other-{closing}", slot_id=slot["id"])
    assert other.status_code == 409
    assert other.json()["detail"]["code"] == "SLOT_FULL"
    public = await public_client.get(
        f"{API}/public/slots?campus_key=yihua&date_from={slot['slot_date']}&date_to={slot['slot_date']}"
    )
    assert public.json() == []
    shrink = await admin_client.patch(f"{BASE}/slots/{slot['id']}", json={"capacity": 0, "expected_version": 1})
    assert shrink.status_code == 409
    assert shrink.json()["detail"]["booked_count"] == 1


@pytest.mark.asyncio
async def test_staff_cannot_confirm_into_a_slot_that_already_started(admin_client):
    past = await _slot(admin_client, days_ahead=-1, capacity=5)
    created = await _manual(admin_client, "b02-past-manual", slot_id=past["id"])
    assert created.status_code == 409
    assert created.json()["detail"]["code"] == "SLOT_NOT_BOOKABLE"
    assert "案件尚未建立" in created.json()["detail"]["message"]

    case = await _manual(admin_client, "b02-past-confirm")
    assert case.status_code == 201, case.text
    confirm = await admin_client.post(
        f"{BASE}/visit-requests/{case.json()['id']}/confirm", json={"slot_id": past["id"]}
    )
    assert confirm.status_code == 409
    assert confirm.json()["detail"]["code"] == "SLOT_NOT_BOOKABLE"


@pytest.mark.asyncio
async def test_exception_day_counts_only_visits_still_to_come(admin_client, public_client):
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot = await _slot(admin_client, days_ahead=5, capacity=3)
    done = await _book(public_client, version, slot["id"], "b02-exc-done")
    await _book(public_client, version, slot["id"], "b02-exc-coming", parent_name="林爸爸")
    assert (await admin_client.post(f"{BASE}/visit-requests/{done}/no-show")).status_code == 200

    created = await admin_client.post(
        f"{BASE}/visit-schedule/yihua/exceptions", json={"exception_date": slot["slot_date"], "reason": "颱風"}
    )
    assert created.status_code == 201, created.text
    assert created.json()["affected_requests"] == 1


# --- 第 20 條：家長管理連結 ---------------------------------------------------


@pytest.mark.asyncio
async def test_access_link_uses_public_origin_and_regenerating_revokes_the_old_one(
    app, admin_client, public_client, second_public_client, db_session
):
    app.state.settings.admin_origin = "https://www.ivy.example/"
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot = await _slot(admin_client)
    receipt_id = await _book(public_client, version, slot["id"], "b02-link-01")

    first = await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/access-link")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["manage_url"].startswith("https://www.ivy.example/visit/manage#token=")
    assert body["manage_url"].endswith(body["manage_url_fragment"])
    assert body["replaced_previous"] is False
    old_token = body["manage_url_fragment"].split("token=")[1]
    assert (await public_client.post(f"{API}/public/visit-manage/exchange", json={"token": old_token})).status_code == 200

    detail = await admin_client.get(f"{BASE}/visit-requests/{receipt_id}")
    assert detail.json()["access_link"]["expires_at"]

    second = await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/access-link")
    assert second.json()["replaced_previous"] is True
    # 舊連結與它換到的 session 都失效，新連結可用。
    assert (await second_public_client.post(
        f"{API}/public/visit-manage/exchange", json={"token": old_token}
    )).status_code == 401
    assert (await public_client.get(f"{API}/public/visit-manage/me")).status_code == 401
    new_token = second.json()["manage_url_fragment"].split("token=")[1]
    assert (await second_public_client.post(
        f"{API}/public/visit-manage/exchange", json={"token": new_token}
    )).status_code == 200

    assert (await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/revoke-access")).status_code == 204
    detail = await admin_client.get(f"{BASE}/visit-requests/{receipt_id}")
    assert detail.json()["access_link"] is None
    events = [e["event_type"] for e in detail.json()["history"]]
    assert events.count("access_link_created") == 2
    assert "access_link_revoked" in events

    audits = (await db_session.execute(
        select(AuditLogEntry.action, AuditLogEntry.metadata_json).where(AuditLogEntry.target_id == receipt_id)
    )).all()
    actions = [a for a, _ in audits]
    assert actions.count("visit_request.create_access_link") == 2
    assert "visit_request.revoke_access" in actions
    # 稽核與歷程都不能留下可重放的 token。
    for _, metadata in audits:
        assert old_token not in str(metadata) and new_token not in str(metadata)
    stored = (await db_session.execute(
        select(VisitRequestEvent.after).where(VisitRequestEvent.visit_request_id == uuid.UUID(receipt_id))
    )).scalars().all()
    assert all(new_token not in str(after) and old_token not in str(after) for after in stored)


@pytest.mark.asyncio
async def test_access_link_without_origin_and_for_closed_cases(app, admin_client):
    app.state.settings.admin_origin = None
    case = (await _manual(admin_client, "b02-link-origin")).json()
    link = await admin_client.post(f"{BASE}/visit-requests/{case['id']}/access-link")
    assert link.status_code == 200, link.text
    assert link.json()["manage_url"] is None
    assert link.json()["manage_url_fragment"].startswith("/visit/manage#token=")

    await admin_client.post(f"{BASE}/visit-requests/{case['id']}/cancel")
    closed = await admin_client.post(f"{BASE}/visit-requests/{case['id']}/access-link")
    assert closed.status_code == 409
    assert closed.json()["detail"]["code"] == "INVALID_TRANSITION"


# --- 第 15 條：案件歷程 -------------------------------------------------------


@pytest.mark.asyncio
async def test_history_records_actor_source_changes_and_reasons(app, admin_client, public_client, db_session):
    await _create_user(db_session, "desk@ivy.example", "desk-password-1234", Role.RECEPTION, ["yihua"])
    desk = await _logged_in_client(app, "desk@ivy.example", "desk-password-1234")
    try:
        version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=False)
        slot = await _slot(admin_client, capacity=2)
        receipt_id = await _book(public_client, version, slot["id"], "b02-history-01")

        confirmed = await desk.post(f"{BASE}/visit-requests/{receipt_id}/confirm", json={"slot_id": slot["id"]})
        assert confirmed.status_code == 200, confirmed.text
        note = await desk.post(f"{BASE}/visit-requests/{receipt_id}/contact-notes", json={"note": "已致電告知"})
        assert note.json()["created_by_email"] == "desk@ivy.example"
        cancelled = await admin_client.post(
            f"{BASE}/visit-requests/{receipt_id}/cancel", json={"reason": "家長臨時出國"}
        )
        assert cancelled.status_code == 200, cancelled.text
    finally:
        await desk.aclose()

    history = await _history(admin_client, receipt_id)
    by_type = {e["event_type"]: e for e in history}
    assert [e["event_type"] for e in history] == ["created", "confirmed", "contact_logged", "cancelled"]
    assert by_type["created"]["source"] == "parent"
    assert by_type["created"]["actor_user_id"] is None
    assert by_type["created"]["after"]["status"] == "pending_confirmation"
    assert by_type["confirmed"]["actor_email"] == "desk@ivy.example"
    assert by_type["confirmed"]["before"]["status"] == "pending_confirmation"
    assert by_type["confirmed"]["after"]["status"] == "confirmed"
    assert by_type["cancelled"]["actor_email"] == "admin@ivy.example"
    assert by_type["cancelled"]["before"] == {"status": "confirmed", "slot": {
        "id": slot["id"], "slot_date": slot["slot_date"], "start_time": "10:00:00", "end_time": "11:00:00",
    }}
    assert by_type["cancelled"]["after"] == {"status": "cancelled"}
    assert by_type["cancelled"]["reason"] == "家長臨時出國"
    # 歷程不帶家長個資。
    assert "0912345678" not in str(history) and "陳媽媽" not in str(history)

    notes = await admin_client.get(f"{BASE}/visit-requests/{receipt_id}/contact-notes")
    assert notes.json()[0]["created_by_email"] == "desk@ivy.example"


@pytest.mark.asyncio
async def test_parent_and_system_actions_are_attributed(app, admin_client, public_client, db_session):
    from app.booking import workflow_service
    from app.common import timezones

    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot = await _slot(admin_client, capacity=2)
    receipt_id = await _book(public_client, version, slot["id"], "b02-attr-parent")
    link = await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]
    await public_client.post(f"{API}/public/visit-manage/exchange", json={"token": token})
    assert (await public_client.post(f"{API}/public/visit-manage/cancel")).status_code == 200
    cancelled = next(e for e in await _history(admin_client, receipt_id) if e["event_type"] == "cancelled")
    assert cancelled["source"] == "parent"
    assert cancelled["actor_user_id"] is None

    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=False)
    held = await _book(public_client, version, slot["id"], "b02-attr-system")
    row = await db_session.get(VisitRequest, uuid.UUID(held))
    row.hold_expires_at = timezones.now_utc() - timedelta(minutes=1)
    await db_session.commit()
    assert await workflow_service.expire_holds(db_session) == 1
    await db_session.commit()
    expired = next(e for e in await _history(admin_client, held) if e["event_type"] == "hold_expired")
    assert expired["source"] == "system"
    assert expired["before"]["status"] == "pending_confirmation"
    assert expired["after"] == {"status": "cancelled"}


@pytest.mark.asyncio
async def test_retention_clears_history_and_reject_reasons(app, admin_client, public_client, db_session):
    from app.operations import retention_service

    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot_a = await _slot(admin_client, capacity=2)
    slot_b = await _slot(admin_client, days_ahead=4, capacity=2)
    receipt_id = await _book(public_client, version, slot_a["id"], "b02-retention")
    request_id = await _parent_asks_for(app, admin_client, receipt_id, slot_b["id"])
    rejected = await admin_client.post(
        f"{BASE}/reschedule-requests/{request_id}/reject", json={"reason": "陳媽媽說週六要上班"}
    )
    assert rejected.status_code == 200, rejected.text
    await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/cancel", json={"reason": "陳媽媽改讀別校"})

    row = await db_session.get(VisitRequest, uuid.UUID(receipt_id))
    await retention_service.anonymize(db_session, row)
    await db_session.commit()

    reasons = (await db_session.execute(
        select(VisitRequestEvent.reason).where(VisitRequestEvent.visit_request_id == uuid.UUID(receipt_id))
    )).scalars().all()
    assert all(reason is None for reason in reasons)
    record = await db_session.get(RescheduleRequest, uuid.UUID(request_id))
    await db_session.refresh(record)
    assert record.reject_reason is None
    assert record.status == "rejected"


# --- 第 4、19 條：家長改期申請的通知、計數與待核准清單 ---------------------------


@pytest.mark.asyncio
async def test_parent_reschedule_request_notifies_and_shows_details(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    from app.workers.runner import process_outbox_batch

    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot_a = await _slot(admin_client, days_ahead=3, capacity=2)
    slot_b = await _slot(admin_client, days_ahead=4, start="14:00:00", end="15:00:00", capacity=2)
    receipt_id = await _book(public_client, version, slot_a["id"], "b02-parent-ask")
    request_id = await _parent_asks_for(app, admin_client, receipt_id, slot_b["id"])

    kinds = (await db_session.execute(
        select(OutboxMessage.kind, OutboxMessage.payload).where(OutboxMessage.visit_request_id == uuid.UUID(receipt_id))
    )).all()
    payloads = {kind: payload for kind, payload in kinds}
    assert payloads["visit_reschedule_requested"] == {
        "campus_key": "yihua", "receipt_id": receipt_id, "reschedule_request_id": request_id,
    }

    dashboard = await admin_client.get(f"{BASE}/dashboard")
    assert dashboard.json()["pending_reschedule_requests"] == 1

    listed = await admin_client.get(f"{BASE}/reschedule-requests?campus_key=yihua")
    assert listed.status_code == 200, listed.text
    [row] = listed.json()
    assert row["id"] == request_id
    assert row["visit_request_id"] == receipt_id
    assert row["parent_name"] == "陳媽媽"
    assert row["current_slot"]["id"] == slot_a["id"]
    assert row["requested_slot"]["id"] == slot_b["id"]
    assert row["requested_slot"]["start_time"] == "14:00:00"
    assert row["requested_slot_remaining"] == 2
    assert row["requested_slot_available"] is True

    detail = await admin_client.get(f"{BASE}/visit-requests/{receipt_id}")
    assert detail.json()["pending_reschedule"]["id"] == request_id
    asked = next(e for e in detail.json()["history"] if e["event_type"] == "reschedule_requested")
    assert asked["source"] == "parent"
    assert asked["after"]["slot"]["id"] == slot_b["id"]

    await process_outbox_batch(db_session, recording_mail_adapter, limit=20)
    mail = next(m for m in recording_mail_adapter.sent if "家長申請改期" in m["subject"])
    assert mail["subject"] == "[常春藤官網] 義華校｜家長申請改期（待園方核准）"
    assert "申請改到：" in mail["body"] and "14:00–15:00" in mail["body"]
    assert "0912345678" not in mail["body"]


@pytest.mark.asyncio
async def test_approving_records_resolver_and_closing_the_case_withdraws_requests(
    app, admin_client, public_client, db_session
):
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot_a = await _slot(admin_client, days_ahead=3, capacity=2)
    slot_b = await _slot(admin_client, days_ahead=4, capacity=2)
    slot_c = await _slot(admin_client, days_ahead=5, capacity=2)
    receipt_id = await _book(public_client, version, slot_a["id"], "b02-approve")

    first = await _parent_asks_for(app, admin_client, receipt_id, slot_b["id"])
    approved = await admin_client.post(f"{BASE}/reschedule-requests/{first}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["slot_id"] == slot_b["id"]
    record = await db_session.get(RescheduleRequest, uuid.UUID(first))
    assert record.status == "approved" and record.resolved_by is not None
    again = await admin_client.post(f"{BASE}/reschedule-requests/{first}/approve")
    assert again.status_code == 409

    moved = next(e for e in await _history(admin_client, receipt_id) if e["event_type"] == "rescheduled")
    assert moved["reason"] == "核准家長線上申請的改期"
    assert moved["before"]["slot"]["id"] == slot_a["id"]

    second = await _parent_asks_for(app, admin_client, receipt_id, slot_c["id"])
    assert (await admin_client.get(f"{BASE}/dashboard")).json()["pending_reschedule_requests"] == 1
    assert (await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/cancel")).status_code == 200
    assert (await admin_client.get(f"{BASE}/dashboard")).json()["pending_reschedule_requests"] == 0
    assert (await admin_client.get(f"{BASE}/reschedule-requests?campus_key=yihua")).json() == []
    withdrawn = await db_session.get(RescheduleRequest, uuid.UUID(second))
    await db_session.refresh(withdrawn)
    assert withdrawn.status == "closed"
    late = await admin_client.post(f"{BASE}/reschedule-requests/{second}/reject")
    assert late.status_code == 409
    assert late.json()["detail"]["code"] == "INVALID_TRANSITION"


@pytest.mark.asyncio
async def test_rejecting_records_reason_and_resolver(app, admin_client, public_client, db_session):
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot_a = await _slot(admin_client, days_ahead=3, capacity=2)
    slot_b = await _slot(admin_client, days_ahead=4, capacity=2)
    receipt_id = await _book(public_client, version, slot_a["id"], "b02-reject")
    request_id = await _parent_asks_for(app, admin_client, receipt_id, slot_b["id"])

    rejected = await admin_client.post(
        f"{BASE}/reschedule-requests/{request_id}/reject", json={"reason": "當天有校外教學"}
    )
    assert rejected.status_code == 200, rejected.text
    record = await db_session.get(RescheduleRequest, uuid.UUID(request_id))
    assert record.status == "rejected"
    assert record.reject_reason == "當天有校外教學"
    assert record.resolved_by is not None
    event = next(e for e in await _history(admin_client, receipt_id) if e["event_type"] == "reschedule_rejected")
    assert event["actor_email"] == "admin@ivy.example"
    assert event["reason"] == "當天有校外教學"
    assert event["after"]["requested_slot"]["id"] == slot_b["id"]
    detail = await admin_client.get(f"{BASE}/visit-requests/{receipt_id}")
    assert detail.json()["pending_reschedule"] is None
    assert detail.json()["slot_id"] == slot_a["id"]


@pytest.mark.asyncio
async def test_reschedule_requests_stay_inside_campus_scope(app, admin_client, public_client, minghua_client):
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot_a = await _slot(admin_client, days_ahead=3, capacity=2)
    slot_b = await _slot(admin_client, days_ahead=4, capacity=2)
    receipt_id = await _book(public_client, version, slot_a["id"], "b02-scope")
    request_id = await _parent_asks_for(app, admin_client, receipt_id, slot_b["id"])

    assert (await minghua_client.get(f"{BASE}/reschedule-requests?campus_key=yihua")).status_code == 404
    assert (await minghua_client.post(f"{BASE}/reschedule-requests/{request_id}/approve")).status_code == 404
    assert (await minghua_client.get(f"{BASE}/dashboard")).json()["pending_reschedule_requests"] == 0
