"""案件處理補完（2026-09-25 缺口 B02）：後台改期、名額保留、家長管理連結、
案件歷程、家長改期申請通知與待核准清單。"""

from __future__ import annotations

import asyncio
import importlib.util
import uuid
from datetime import date, time, timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select, update

from app.auth.models import Role
from app.booking.access_models import ParentAccessToken, RescheduleRequest
from app.booking.models import OutboxMessage, VisitRequest, VisitRequestEvent, VisitSlot
from app.common.timezones import today_local
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client, set_booking_mode, start_visit_slot


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
async def test_completed_and_no_show_keep_the_used_seat(admin_client, public_client, db_session, closing):
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot = await _slot(admin_client, days_ahead=3, capacity=1)
    receipt_id = await _book(public_client, version, slot["id"], f"b02-keep-{closing}")
    await start_visit_slot(db_session, receipt_id)
    closed = await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/{closing}")
    assert closed.status_code == 200, closed.text

    day = (today_local() - timedelta(days=1)).isoformat()
    listed = await admin_client.get(f"{BASE}/slots?campus_key=yihua&date_from={day}&date_to={day}")
    assert listed.json()[0]["booked_count"] == 1
    calendar = await admin_client.get(f"{BASE}/visit-calendar?date_from={day}&date_to={day}&campus_key=yihua")
    assert calendar.json()[0]["booked_count"] == 1
    # 月曆的已排數與「容量不得低於已占數」跟實際接待數一致。
    shrink = await admin_client.patch(f"{BASE}/slots/{slot['id']}", json={"capacity": 0, "expected_version": 1})
    assert shrink.status_code == 409
    assert shrink.json()["detail"]["booked_count"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("closing", ["complete", "no-show"])
async def test_future_visit_cannot_be_marked_completed_or_no_show(admin_client, public_client, closing):
    """未到場／完成會保留名額：場次還沒開始就按下去（家長來電說不來，櫃台按了
    「標記未到場」而不是取消），未來那一場的名額會被永久占住、案件也改不回來。"""
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot = await _slot(admin_client, days_ahead=3, capacity=1)
    receipt_id = await _book(public_client, version, slot["id"], f"b02-early-{closing}")

    early = await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/{closing}")
    assert early.status_code == 409
    assert early.json()["detail"]["code"] == "INVALID_TRANSITION"
    assert "參觀時段開始後" in early.json()["detail"]["message"]
    detail = await admin_client.get(f"{BASE}/visit-requests/{receipt_id}")
    assert detail.json()["status"] == "confirmed"
    assert not {"no_show", "completed"} & {e["event_type"] for e in detail.json()["history"]}

    # 事先說不來走取消，名額釋出給別人。
    assert (await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/cancel")).status_code == 200
    other = await _manual(admin_client, f"b02-early-other-{closing}", slot_id=slot["id"])
    assert other.status_code == 201, other.text


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
async def test_exception_day_counts_only_visits_still_to_come(admin_client, public_client, db_session):
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot = await _slot(admin_client, days_ahead=5, capacity=3)
    done = await _book(public_client, version, slot["id"], "b02-exc-done")
    await _book(public_client, version, slot["id"], "b02-exc-coming", parent_name="林爸爸")
    # 當天早上宣布颱風假：清晨那一場已經開始，一組沒來、另一組還沒標記。
    today = today_local()
    await db_session.execute(
        update(VisitSlot)
        .where(VisitSlot.id == uuid.UUID(slot["id"]))
        .values(slot_date=today, start_time=time(0, 0), end_time=time(0, 30))
    )
    await db_session.commit()
    assert (await admin_client.post(f"{BASE}/visit-requests/{done}/no-show")).status_code == 200

    created = await admin_client.post(
        f"{BASE}/visit-schedule/yihua/exceptions", json={"exception_date": today.isoformat(), "reason": "颱風"}
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


@pytest.mark.asyncio
async def test_regenerating_link_concurrently_leaves_one_valid_link(app, admin_client, public_client, db_session):
    """兩位同事同時按「重新產生」：沒有鎖案件列時，兩個交易各自撤銷（看不到
    對方還沒提交的新連結）再各自新增，最後兩條連結都有效。"""
    from app.booking import access_service, workflow_service

    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot = await _slot(admin_client)
    receipt_id = await _book(public_client, version, slot["id"], "b02-link-race")

    async with app.state.session_factory() as first:
        case = await first.get(VisitRequest, uuid.UUID(receipt_id))
        # 第一位同事的交易：鎖住案件、撤銷舊連結、建立新連結，還沒提交。
        await workflow_service.lock_status(first, case)
        await access_service.revoke_access_for_visit_request(first, case.id)
        await access_service.create_access_token(first, case.id)
        task = asyncio.create_task(admin_client.post(f"{BASE}/visit-requests/{receipt_id}/access-link"))
        await asyncio.sleep(0.5)
        assert not task.done(), "產生連結沒有等案件列鎖"
        await first.commit()
    second = await task
    assert second.status_code == 200, second.text
    assert second.json()["replaced_previous"] is True
    active = await db_session.scalar(
        select(func.count()).select_from(ParentAccessToken).where(
            ParentAccessToken.visit_request_id == uuid.UUID(receipt_id), ParentAccessToken.revoked_at.is_(None)
        )
    )
    assert active == 1


@pytest.mark.asyncio
async def test_link_requested_while_cancelling_is_refused(app, admin_client, public_client, db_session):
    """取消與產生連結同時發生：取消先撤銷了連結，產生連結卻用取消前讀到的
    已確認狀態通過檢查再新增，已取消的案件就留下一條還能兌換的連結。"""
    from app.booking import workflow_service

    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot = await _slot(admin_client)
    receipt_id = await _book(public_client, version, slot["id"], "b02-link-cancel-race")

    async with app.state.session_factory() as parent:
        case = await parent.get(VisitRequest, uuid.UUID(receipt_id))
        await workflow_service.cancel(parent, case, actor=workflow_service.PARENT)
        task = asyncio.create_task(admin_client.post(f"{BASE}/visit-requests/{receipt_id}/access-link"))
        await asyncio.sleep(0.5)
        assert not task.done(), "產生連結沒有等取消交易的案件列鎖"
        await parent.commit()
    refused = await task
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "INVALID_TRANSITION"
    active = await db_session.scalar(
        select(func.count()).select_from(ParentAccessToken).where(
            ParentAccessToken.visit_request_id == uuid.UUID(receipt_id), ParentAccessToken.revoked_at.is_(None)
        )
    )
    assert active == 0


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


@pytest.mark.asyncio
async def test_staff_reschedule_withdraws_the_parents_pending_request(app, admin_client, public_client, db_session):
    """家長線上申請改到 B；櫃台電話談好直接改到 C。那筆申請要在同一步失效，
    否則別的同事稍後在站內通知按核准，會把案件搬回 B、蓋掉電話裡的約定。"""
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot_a = await _slot(admin_client, days_ahead=3, capacity=2)
    slot_b = await _slot(admin_client, days_ahead=4, capacity=2)
    slot_c = await _slot(admin_client, days_ahead=5, capacity=2)
    receipt_id = await _book(public_client, version, slot_a["id"], "b02-superseded")
    request_id = await _parent_asks_for(app, admin_client, receipt_id, slot_b["id"])

    moved = await admin_client.post(
        f"{BASE}/visit-requests/{receipt_id}/reschedule",
        json={"new_slot_id": slot_c["id"], "reason": "電話談好改到週五"},
    )
    assert moved.status_code == 200, moved.text

    record = await db_session.get(RescheduleRequest, uuid.UUID(request_id))
    await db_session.refresh(record)
    assert record.status == "closed"
    assert record.resolved_by is not None
    assert (await admin_client.get(f"{BASE}/dashboard")).json()["pending_reschedule_requests"] == 0
    assert (await admin_client.get(f"{BASE}/reschedule-requests")).json() == []
    late = await admin_client.post(f"{BASE}/reschedule-requests/{request_id}/approve")
    assert late.status_code == 409
    assert late.json()["detail"]["code"] == "INVALID_TRANSITION"

    detail = (await admin_client.get(f"{BASE}/visit-requests/{receipt_id}")).json()
    assert detail["slot_id"] == slot_c["id"]
    assert detail["pending_reschedule"] is None
    superseded = next(e for e in detail["history"] if e["event_type"] == "reschedule_superseded")
    assert superseded["actor_email"] == "admin@ivy.example"
    assert superseded["after"]["requested_slot"]["id"] == slot_b["id"]


@pytest.mark.asyncio
async def test_pending_reschedules_without_campus_cover_every_visible_campus(
    app, admin_client, public_client, minghua_client, db_session
):
    """側欄徽章與總覽的待核准數算的是你負責的所有校區；站內通知的清單不帶
    校區時也要列同一批，不能只列校區選單預設的第一校。"""
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot_a = await _slot(admin_client, days_ahead=3, capacity=2)
    slot_b = await _slot(admin_client, days_ahead=4, capacity=2)
    receipt_id = await _book(public_client, version, slot_a["id"], "b02-all-campuses")
    request_id = await _parent_asks_for(app, admin_client, receipt_id, slot_b["id"])

    everything = await admin_client.get(f"{BASE}/reschedule-requests")
    assert everything.status_code == 200, everything.text
    assert [(row["id"], row["campus_key"]) for row in everything.json()] == [(request_id, "yihua")]
    assert (await admin_client.get(f"{BASE}/reschedule-requests?campus_key=minghua")).json() == []

    # 管明華、義華兩校的分校管理者，校區選單預設是明華，也看得到義華的申請。
    await _create_user(db_session, "two-campus@ivy.example", "two-campus-password-1", Role.CAMPUS_ADMIN, ["minghua", "yihua"])
    both = await _logged_in_client(app, "two-campus@ivy.example", "two-campus-password-1")
    try:
        assert [row["id"] for row in (await both.get(f"{BASE}/reschedule-requests")).json()] == [request_id]
    finally:
        await both.aclose()
    # 只管明華的看不到。
    assert (await minghua_client.get(f"{BASE}/reschedule-requests")).json() == []


SUPERSEDED_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "f1b8d3a6c925_close_superseded_reschedule_requests.py"
)


@pytest.mark.asyncio
async def test_migration_closes_requests_superseded_by_staff_reschedule(app, admin_client, public_client, db_session):
    """正式庫的資料修補：舊版程式園方直接改期後，家長先前的申請仍是 pending。
    migration 只把「送出之後案件又被改期過」的申請標成失效並補歷程；改期
    之後才送出的申請維持待核准。"""
    version = await _set_mode(admin_client, mode="slots", slots_auto_confirm=True)
    slot_a = await _slot(admin_client, days_ahead=3, capacity=3)
    slot_b = await _slot(admin_client, days_ahead=4, capacity=3)
    slot_c = await _slot(admin_client, days_ahead=5, capacity=3)

    # 舊資料：申請改到 B 之後，園方直接改到 C，申請卻還是 pending。
    stale_case = await _book(public_client, version, slot_a["id"], "b02-migrate-stale")
    stale_id = await _parent_asks_for(app, admin_client, stale_case, slot_b["id"])
    moved = await admin_client.post(f"{BASE}/visit-requests/{stale_case}/reschedule", json={"new_slot_id": slot_c["id"]})
    assert moved.status_code == 200, moved.text
    await db_session.execute(
        update(RescheduleRequest)
        .where(RescheduleRequest.id == uuid.UUID(stale_id))
        .values(status="pending", resolved_at=None, resolved_by=None)
    )
    await db_session.execute(
        VisitRequestEvent.__table__.delete().where(VisitRequestEvent.event_type == "reschedule_superseded")
    )
    await db_session.commit()
    # 對照組：先被園方改期、之後才送出的申請，不能被誤關。
    fresh_case = await _book(public_client, version, slot_a["id"], "b02-migrate-fresh", parent_name="林爸爸")
    assert (
        await admin_client.post(f"{BASE}/visit-requests/{fresh_case}/reschedule", json={"new_slot_id": slot_c["id"]})
    ).status_code == 200
    fresh_id = await _parent_asks_for(app, admin_client, fresh_case, slot_b["id"])
    assert (await admin_client.get(f"{BASE}/dashboard")).json()["pending_reschedule_requests"] == 2

    spec = importlib.util.spec_from_file_location("close_superseded_reschedules", SUPERSEDED_MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    captured: list = []

    class _Op:
        @staticmethod
        def execute(statement):
            captured.append(statement)

    migration.op = _Op()
    migration.upgrade()
    [statement] = captured
    async with app.state.engine.begin() as conn:
        await conn.execute(statement)

    db_session.expire_all()
    stale = await db_session.get(RescheduleRequest, uuid.UUID(stale_id))
    rescheduled_at = await db_session.scalar(
        select(VisitRequestEvent.created_at).where(
            VisitRequestEvent.visit_request_id == uuid.UUID(stale_case), VisitRequestEvent.event_type == "rescheduled"
        )
    )
    assert stale.status == "closed"
    assert stale.resolved_at == rescheduled_at
    assert stale.resolved_by is not None
    assert (await db_session.get(RescheduleRequest, uuid.UUID(fresh_id))).status == "pending"
    assert [row["id"] for row in (await admin_client.get(f"{BASE}/reschedule-requests")).json()] == [fresh_id]

    # 補的歷程跟程式寫的同一個格式，後台時間軸照常顯示。
    history = await _history(admin_client, stale_case)
    superseded = [e for e in history if e["event_type"] == "reschedule_superseded"]
    assert len(superseded) == 1
    assert superseded[0]["actor_email"] == "admin@ivy.example"
    assert superseded[0]["source"] == "staff"
    assert superseded[0]["after"]["requested_slot"] == {
        "id": slot_b["id"],
        "slot_date": slot_b["slot_date"],
        "start_time": slot_b["start_time"],
        "end_time": slot_b["end_time"],
    }
    assert not [e for e in await _history(admin_client, fresh_case) if e["event_type"] == "reschedule_superseded"]
