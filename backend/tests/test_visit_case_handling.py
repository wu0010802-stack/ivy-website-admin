"""案件處理補完（2026-09-25 缺口 B02）：後台改期、名額保留、家長管理連結、
案件歷程。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date, time, timedelta

import pytest
from sqlalchemy import func, select, update

from app.auth.models import Role
from app.booking.access_models import ParentAccessToken
from app.booking.models import VisitRequest, VisitRequestEvent, VisitSlot
from app.common.timezones import today_local
from app.operations.models import AuditLogEntry
from tests.conftest import (
    _create_user,
    _logged_in_client,
    book_slot,
    legacy_request,
    open_manage,
    set_booking_mode,
    start_visit_slot,
)


# 預約表單要有已發布的同意文字（啟用 slots、官網送單）。
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


async def _manual(client, key: str, *, slot_id: str, **extra):
    """櫃台補登（電話／現場）：一定要選場次，送出即確認。"""
    return await client.post(
        f"{BASE}/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": "王媽媽", "phone": "0912345678",
              "consent_given": True, "slot_id": slot_id, **extra},
        headers={"Idempotency-Key": key},
    )


async def _history(admin_client, receipt_id: str) -> list[dict]:
    detail = await admin_client.get(f"{BASE}/visit-requests/{receipt_id}")
    assert detail.status_code == 200, detail.text
    return detail.json()["history"]


# --- 第 13 條：已確認的案件在後台改期 -----------------------------------------


@pytest.mark.asyncio
async def test_admin_reschedule_keeps_case_and_records_history(admin_client, public_client):
    version = await _set_mode(admin_client, mode="slots")
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
    version = await _set_mode(admin_client, mode="slots")
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

    version = await _set_mode(admin_client, mode="slots")
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
    version = await _set_mode(admin_client, mode="slots")
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
    version = await _set_mode(admin_client, mode="slots")
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
async def test_staff_cannot_confirm_into_a_slot_that_already_started(admin_client, db_session):
    past = await _slot(admin_client, days_ahead=-1, capacity=5)
    created = await _manual(admin_client, "b02-past-manual", slot_id=past["id"])
    assert created.status_code == 409
    assert created.json()["detail"]["code"] == "SLOT_NOT_BOOKABLE"
    assert "案件尚未建立" in created.json()["detail"]["message"]

    # 補登失敗不會留下半成品案件。
    assert (await db_session.execute(select(func.count()).select_from(VisitRequest))).scalar_one() == 0

    # 人工確認（先收需求、之後再確認排入）的端點已退場。
    case_id = await legacy_request(db_session, status="confirmed", parent_name="王媽媽")
    confirm = await admin_client.post(f"{BASE}/visit-requests/{case_id}/confirm", json={"slot_id": past["id"]})
    assert confirm.status_code in (404, 405)


@pytest.mark.asyncio
async def test_exception_day_counts_only_visits_still_to_come(admin_client, public_client, db_session):
    version = await _set_mode(admin_client, mode="slots")
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
    version = await _set_mode(admin_client, mode="slots")
    slot = await _slot(admin_client)
    receipt_id = await _book(public_client, version, slot["id"], "b02-link-01")

    # 沒有連結的舊案：第一次產生不算取代舊連結。
    legacy_id = await legacy_request(db_session, status="confirmed", parent_name="舊案家長")
    fresh = await admin_client.post(f"{BASE}/visit-requests/{legacy_id}/access-link")
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["replaced_previous"] is False

    first = await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/access-link")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["manage_url"].startswith("https://www.ivy.example/visit/manage#token=")
    assert body["manage_url"].endswith(body["manage_url_fragment"])
    # 送單時已經發過一條連結，重新產生會取代它。
    assert body["replaced_previous"] is True
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
async def test_access_link_without_origin_and_for_closed_cases(app, admin_client, public_client):
    app.state.settings.admin_origin = None
    case = {"id": (await book_slot(admin_client, public_client, idempotency_key="b02-link-origin"))["receipt_id"]}
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

    version = await _set_mode(admin_client, mode="slots")
    slot = await _slot(admin_client)
    receipt_id = await _book(public_client, version, slot["id"], "b02-link-race")

    async with app.state.session_factory() as first:
        case = await first.get(VisitRequest, uuid.UUID(receipt_id))
        # 第一位同事的交易：鎖住案件、撤銷舊連結、建立新連結，還沒提交。
        await workflow_service.lock_status(first, case)
        await access_service.revoke_access_for_visit_request(first, case.id)
        await access_service.create_access_token(
            first, case.id, secret=app.state.settings.session_secret, slot=None
        )
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

    version = await _set_mode(admin_client, mode="slots")
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
        version = await _set_mode(admin_client, mode="slots")
        slot = await _slot(admin_client, capacity=2)
        booked_id = await _book(public_client, version, slot["id"], "b02-history-01")
        # 櫃台補登（選場次即確認）、記聯絡、取消，整條歷程都要有人與來源。
        confirmed = await desk.post(
            f"{BASE}/visit-requests",
            json={"campus_key": "yihua", "source": "phone", "parent_name": "陳媽媽", "phone": "0912345678",
                  "consent_given": True, "slot_id": slot["id"]},
            headers={"Idempotency-Key": "b02-history-desk"},
        )
        assert confirmed.status_code == 201, confirmed.text
        receipt_id = confirmed.json()["id"]
        note = await desk.post(f"{BASE}/visit-requests/{receipt_id}/contact-notes", json={"note": "已致電告知"})
        assert note.json()["created_by_email"] == "desk@ivy.example"
        cancelled = await admin_client.post(
            f"{BASE}/visit-requests/{receipt_id}/cancel", json={"reason": "家長臨時出國"}
        )
        assert cancelled.status_code == 200, cancelled.text
    finally:
        await desk.aclose()

    # 家長自選場次送單：一開始就是 confirmed，來源是家長、沒有操作人。
    booked_history = await _history(admin_client, booked_id)
    created = next(e for e in booked_history if e["event_type"] == "created")
    assert created["source"] == "parent"
    assert created["actor_user_id"] is None
    assert created["after"]["status"] == "confirmed"

    history = await _history(admin_client, receipt_id)
    by_type = {e["event_type"]: e for e in history}
    # 補登直接建立成 confirmed：歷程只有一筆 created，沒有另外的 confirmed 事件。
    assert [e["event_type"] for e in history] == ["created", "contact_logged", "cancelled"]
    assert by_type["created"]["actor_email"] == "desk@ivy.example"
    assert by_type["created"]["source"] == "staff"
    assert by_type["created"]["after"]["status"] == "confirmed"
    assert by_type["created"]["after"]["slot"]["id"] == slot["id"]
    assert by_type["cancelled"]["actor_email"] == "admin@ivy.example"
    assert by_type["cancelled"]["before"] == {"status": "confirmed", "slot": {
        "id": slot["id"], "slot_date": slot["slot_date"], "start_time": "10:00:00", "end_time": "11:00:00",
    }}
    assert by_type["cancelled"]["after"] == {"status": "cancelled"}
    assert by_type["cancelled"]["reason"] == "家長臨時出國"
    # 歷程不帶家長個資。
    assert "0912345678" not in str(history) and "陳媽媽" not in str(history)
    assert "0912345678" not in str(booked_history) and "陳媽媽" not in str(booked_history)

    notes = await admin_client.get(f"{BASE}/visit-requests/{receipt_id}/contact-notes")
    assert notes.json()[0]["created_by_email"] == "desk@ivy.example"


@pytest.mark.asyncio
async def test_parent_and_system_actions_are_attributed(app, admin_client, public_client, db_session):
    from app.booking import workflow_service

    version = await _set_mode(admin_client, mode="slots")
    slot = await _slot(admin_client, capacity=2)
    receipt_id = await _book(public_client, version, slot["id"], "b02-attr-parent")
    link = await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/access-link")
    await open_manage(public_client, link.json()["manage_url_fragment"])
    cancelled = await public_client.post(f"{API}/public/visit-manage/cancel", json={"visit_request_id": receipt_id})
    assert cancelled.status_code == 200
    cancelled = next(e for e in await _history(admin_client, receipt_id) if e["event_type"] == "cancelled")
    assert cancelled["source"] == "parent"
    assert cancelled["actor_user_id"] is None

    # 占位逾期自動取消的流程已刪除：沒有這個函式，歷程也不會再出現 hold_expired。
    assert not hasattr(workflow_service, "expire_holds")
    assert all(e["event_type"] != "hold_expired" for e in await _history(admin_client, receipt_id))


@pytest.mark.asyncio
async def test_retention_clears_history_reasons(app, admin_client, public_client, db_session):
    from app.operations import retention_service

    version = await _set_mode(admin_client, mode="slots")
    slot = await _slot(admin_client, capacity=2)
    receipt_id = await _book(public_client, version, slot["id"], "b02-retention")
    await admin_client.post(f"{BASE}/visit-requests/{receipt_id}/cancel", json={"reason": "陳媽媽改讀別校"})

    row = await db_session.get(VisitRequest, uuid.UUID(receipt_id))
    await retention_service.anonymize(db_session, row)
    await db_session.commit()

    reasons = (await db_session.execute(
        select(VisitRequestEvent.reason).where(VisitRequestEvent.visit_request_id == uuid.UUID(receipt_id))
    )).scalars().all()
    assert reasons and all(reason is None for reason in reasons)


# --- 家長改期申請（2026-10-08 刪除）-----------------------------------------------


@pytest.mark.asyncio
async def test_reschedule_request_review_routes_are_gone(admin_client, public_client):
    """家長改期申請自 09-30 起停用，後台的待核准清單、核准、退回與資料表都已刪除：
    後台路徑不存在（404）；公開的舊端點留著，舊快取頁面打進來要拿到清楚的 410。"""
    request_id = uuid.uuid4()
    assert (await admin_client.get(f"{BASE}/reschedule-requests")).status_code == 404
    assert (await admin_client.get(f"{BASE}/reschedule-requests?campus_key=yihua")).status_code == 404
    assert (await admin_client.post(f"{BASE}/reschedule-requests/{request_id}/approve")).status_code == 404
    assert (
        await admin_client.post(f"{BASE}/reschedule-requests/{request_id}/reject", json={"reason": "x"})
    ).status_code == 404

    retired = await public_client.post(
        f"{API}/public/visit-manage/reschedule-request", json={"visit_request_id": str(request_id)}
    )
    assert retired.status_code == 410
    assert retired.json()["detail"]["code"] == "ENDPOINT_RETIRED"
