from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.booking import access_service, workflow_service
from app.booking.history import PARENT
from app.booking.models import OutboxMessage, OutboxStatus, VisitRequest, VisitRequestEvent, VisitSlot
from app.common.timezones import today_local
from tests.conftest import (
    VISIT_SUBMIT_PATH,
    book_slot,
    create_slot,
    freeze_rate_limit_clock,
    open_manage,
    set_booking_mode,
)

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
MANAGE = f"{API}/public/visit-manage"


async def _booked_and_open(admin_client, public_client, **kwargs) -> dict:
    booked = await book_slot(admin_client, public_client, **kwargs)
    await open_manage(public_client, booked["manage_path"])
    return booked


@pytest.mark.asyncio
async def test_me_returns_the_editable_details(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client, child_name="小寶")

    me = (await public_client.get(f"{MANAGE}/me")).json()

    assert me["parent_name"] == "陳媽媽"
    assert me["phone"] == "0912345678"
    assert me["email"] == "parent@example.com"
    assert me["child_name"] == "小寶"
    assert me["can_edit"] is True and me["can_reschedule"] is True
    assert "phone_masked" not in me
    assert me["version"] >= 1
    assert me["id"] == booked["receipt_id"]


@pytest.mark.asyncio
async def test_parent_reschedules_directly(admin_client, public_client, db_session):
    booked = await _booked_and_open(admin_client, public_client)
    other = await create_slot(admin_client, days_ahead=5, start_time="14:30:00", end_time="15:30:00")

    response = await public_client.post(
        f"{MANAGE}/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": other}
    )

    assert response.status_code == 200, response.text
    assert response.json()["slot"]["id"] == other
    assert response.json()["status"] == "confirmed"
    event = (
        await db_session.execute(select(VisitRequestEvent).where(VisitRequestEvent.event_type == "rescheduled"))
    ).scalar_one()
    assert event.source == "parent"
    kinds = (await db_session.execute(select(OutboxMessage.kind))).scalars().all()
    assert "parent_visit_changed" in kinds and "visit_request_rescheduled" in kinds


@pytest.mark.asyncio
async def test_last_seat_goes_to_exactly_one_of_parent_reschedule_and_new_booking(
    admin_client, public_client, second_public_client
):
    booked = await _booked_and_open(admin_client, public_client)
    last = await create_slot(admin_client, days_ahead=6, capacity=1)
    version = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()["version"]

    reschedule, submit = await asyncio.gather(
        public_client.post(f"{MANAGE}/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": last}),
        second_public_client.post(
            VISIT_SUBMIT_PATH,
            json={
                "campus_key": "yihua",
                "config_version": version,
                "parent_name": "林媽媽",
                "phone": "0922333444",
                "email": "lin@example.com",
                "consent_given": True,
                "slot_id": last,
            },
            headers={"Idempotency-Key": "race-last-seat"},
        ),
    )

    assert sorted([reschedule.status_code, submit.status_code]) in ([200, 409], [201, 409])
    loser = reschedule if reschedule.status_code == 409 else submit
    assert loser.json()["detail"]["code"] == "SLOT_FULL"
    today = today_local()
    slots = (
        await admin_client.get(
            f"{API}/admin/slots",
            params={
                "campus_key": "yihua",
                "date_from": today.isoformat(),
                "date_to": (today + timedelta(days=10)).isoformat(),
            },
        )
    ).json()
    assert next(s for s in slots if s["id"] == last)["booked_count"] == 1


@pytest.mark.asyncio
async def test_reschedule_after_deadline_is_refused(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client, days_ahead=3)
    other = await create_slot(admin_client, days_ahead=5)
    await set_booking_mode(admin_client, "yihua", mode="slots", parent_change_deadline_hours=336)

    response = await public_client.post(
        f"{MANAGE}/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": other}
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "CHANGE_DEADLINE_PASSED"


@pytest.mark.asyncio
async def test_reschedule_request_endpoint_is_retired(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client)
    other = await create_slot(admin_client, days_ahead=5)

    response = await public_client.post(
        f"{MANAGE}/reschedule-request", json={"visit_request_id": booked["receipt_id"], "new_slot_id": other}
    )

    assert response.status_code == 410
    assert response.json()["detail"]["code"] == "ENDPOINT_RETIRED"


@pytest.mark.asyncio
async def test_parent_updates_details_without_leaking_them_into_history(admin_client, public_client, db_session):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()

    response = await public_client.patch(
        f"{MANAGE}/me",
        json={
            "visit_request_id": booked["receipt_id"],
            "expected_version": me["version"],
            "phone": "0922-333-444",
            "email": "new@example.com",
            "party_size": 3,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "0922333444"
    assert response.json()["email"] == "new@example.com"
    assert response.json()["version"] == me["version"] + 1
    event = (
        await db_session.execute(select(VisitRequestEvent).where(VisitRequestEvent.event_type == "details_updated"))
    ).scalar_one()
    assert event.source == "parent"
    assert sorted(event.after["fields"]) == ["email", "party_size", "phone"]
    assert "0922333444" not in str(event.after) and "new@example.com" not in str(event.after)
    kinds = (await db_session.execute(select(OutboxMessage.kind))).scalars().all()
    assert kinds.count("parent_visit_changed") == 1


@pytest.mark.asyncio
async def test_same_details_write_nothing(admin_client, public_client, db_session):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()

    response = await public_client.patch(
        f"{MANAGE}/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "phone": me["phone"]},
    )

    assert response.status_code == 200
    assert response.json()["version"] == me["version"]
    events = (
        await db_session.execute(select(VisitRequestEvent).where(VisitRequestEvent.event_type == "details_updated"))
    ).scalars().all()
    assert events == []


@pytest.mark.asyncio
async def test_details_version_conflict_and_required_fields(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()

    stale = await public_client.patch(
        f"{MANAGE}/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"] - 1, "party_size": 4},
    )
    cleared = await public_client.patch(
        f"{MANAGE}/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "email": None},
    )

    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "VISIT_REQUEST_VERSION_CONFLICT"
    assert cleared.status_code == 422
    # 逐欄位回報：loc 指到被清空的那一欄，官網才能把錯誤標在欄位旁。
    [error] = cleared.json()["detail"]
    assert error["loc"] == ["body", "email"]
    assert "Email 不能清空" in error["msg"]


@pytest.mark.asyncio
async def test_each_cleared_required_field_is_reported_on_its_own(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()

    cleared = await public_client.patch(
        f"{MANAGE}/me",
        json={
            "visit_request_id": booked["receipt_id"],
            "expected_version": me["version"],
            "parent_name": None,
            "party_size": None,
        },
    )

    assert cleared.status_code == 422
    errors = {tuple(error["loc"]): error["msg"] for error in cleared.json()["detail"]}
    assert set(errors) == {("body", "parent_name"), ("body", "party_size")}
    assert "家長稱呼不能清空" in errors[("body", "parent_name")]
    assert "參觀人數不能清空" in errors[("body", "party_size")]


@pytest.mark.asyncio
async def test_details_update_checks_the_session_matches(admin_client, public_client):
    first = await _booked_and_open(admin_client, public_client, phone="0912000001")
    await _booked_and_open(admin_client, public_client, phone="0912000002", days_ahead=4)

    response = await public_client.patch(
        f"{MANAGE}/me", json={"visit_request_id": first["receipt_id"], "expected_version": 1, "party_size": 4}
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PARENT_SESSION_CHANGED"


async def _load_visit(db, visit_id):
    return (
        await db.execute(
            select(VisitRequest).options(selectinload(VisitRequest.slot)).where(VisitRequest.id == visit_id)
        )
    ).scalar_one()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"closed": True, "closed_source": "manual"}, workflow_service.SlotClosed),
        ({"capacity": 0}, workflow_service.SlotFull),
    ],
)
async def test_reschedule_rereads_a_slot_changed_after_validation(
    app, admin_client, public_client, db_session, change, expected
):
    """validate_parent_reschedule 不上鎖讀進新場次；另一個交易在上鎖前把它停止申請或
    把名額降到已占數時，reschedule 上鎖後必須以資料庫為準，不能沿用 identity map 裡的舊值。"""
    booked = await book_slot(admin_client, public_client)
    target = uuid.UUID(await create_slot(admin_client, days_ahead=6, capacity=2))
    visit_request = await _load_visit(db_session, uuid.UUID(booked["receipt_id"]))
    stale = await access_service.validate_parent_reschedule(db_session, visit_request, target)
    assert stale.closed is False and stale.capacity == 2

    async with app.state.session_factory() as other:
        await other.execute(update(VisitSlot).where(VisitSlot.id == target).values(**change))
        await other.commit()

    with pytest.raises(expected):
        await workflow_service.reschedule(db_session, visit_request, target, actor=PARENT)
    await db_session.rollback()


async def _reschedule(public_client, visit_request_id: str, slot_id: str):
    return await public_client.post(
        f"{MANAGE}/reschedule", json={"visit_request_id": visit_request_id, "slot_id": slot_id}
    )


async def _edit(public_client, visit_request_id: str, version: int, **changes):
    return await public_client.patch(
        f"{MANAGE}/me", json={"visit_request_id": visit_request_id, "expected_version": version, **changes}
    )


async def _pending_changed_mails(db_session) -> int:
    return len(
        (
            await db_session.execute(
                select(OutboxMessage.id).where(
                    OutboxMessage.kind == "parent_visit_changed",
                    OutboxMessage.status == OutboxStatus.PENDING.value,
                )
            )
        ).scalars().all()
    )


@pytest.mark.asyncio
async def test_parent_reschedules_are_capped_per_case_per_day(app, admin_client, public_client):
    """每案每日最多改期 5 次；失敗的嘗試不吃額度；別的案件不受影響。"""
    freeze_rate_limit_clock(app)
    booked = await _booked_and_open(admin_client, public_client)
    receipt = booked["receipt_id"]
    first, second = booked["slot_id"], await create_slot(admin_client, days_ahead=5)

    failed = await _reschedule(public_client, receipt, first)
    assert failed.json()["detail"]["code"] == "SAME_SLOT"
    statuses = [(await _reschedule(public_client, receipt, slot)).status_code for slot in [second, first] * 2 + [second]]
    blocked = await _reschedule(public_client, receipt, first)

    assert statuses == [200] * 5
    assert blocked.status_code == 429
    assert blocked.json()["detail"]["code"] == "RATE_LIMITED"
    assert blocked.json()["detail"]["message"] == "這筆預約今天已經修改很多次了，請明天再試，或直接聯絡園所"
    assert blocked.headers["Retry-After"] == "86400"
    me = (await public_client.get(f"{MANAGE}/me")).json()
    assert me["slot"]["id"] == second

    other = await _booked_and_open(admin_client, public_client, phone="0912000002", days_ahead=4)
    moved = await _reschedule(public_client, other["receipt_id"], first)
    assert moved.status_code == 200, moved.text


@pytest.mark.asyncio
async def test_parent_detail_edits_are_capped_per_case_per_day(app, admin_client, public_client, db_session):
    """每案每日最多改資料 10 次；連續改好幾次也只有一封未寄的變更信；別的案件不受影響。"""
    freeze_rate_limit_clock(app)
    booked = await _booked_and_open(admin_client, public_client)
    receipt = booked["receipt_id"]
    version = (await public_client.get(f"{MANAGE}/me")).json()["version"]

    statuses = []
    for attempt in range(10):
        response = await _edit(public_client, receipt, version, questions=f"第 {attempt + 1} 個問題")
        statuses.append(response.status_code)
        version = response.json()["version"]
    blocked = await _edit(public_client, receipt, version, questions="第 11 個問題")

    assert statuses == [200] * 10
    assert blocked.status_code == 429
    assert blocked.json()["detail"]["code"] == "RATE_LIMITED"
    assert blocked.json()["detail"]["message"] == "這筆預約今天已經修改很多次了，請明天再試，或直接聯絡園所"
    assert blocked.headers["Retry-After"] == "86400"
    assert await _pending_changed_mails(db_session) == 1

    other = await _booked_and_open(admin_client, public_client, phone="0912000002", days_ahead=4)
    other_version = (await public_client.get(f"{MANAGE}/me")).json()["version"]
    edited = await _edit(public_client, other["receipt_id"], other_version, party_size=3)
    assert edited.status_code == 200, edited.text


@pytest.mark.asyncio
async def test_changed_mail_is_not_queued_twice_while_one_is_unsent(admin_client, public_client, db_session):
    """變更信內容在寄件當下才組：還有一封未寄的就不再排；已寄出後的新變更要另外排。"""
    booked = await _booked_and_open(admin_client, public_client)
    receipt = booked["receipt_id"]
    version = (await public_client.get(f"{MANAGE}/me")).json()["version"]

    first = await _edit(public_client, receipt, version, party_size=3)
    second = await _edit(public_client, receipt, first.json()["version"], party_size=4)

    assert (first.status_code, second.status_code) == (200, 200)
    assert await _pending_changed_mails(db_session) == 1

    await db_session.execute(
        update(OutboxMessage)
        .where(OutboxMessage.kind == "parent_visit_changed")
        .values(status=OutboxStatus.SENT.value)
    )
    await db_session.commit()
    third = await _edit(public_client, receipt, second.json()["version"], party_size=5)

    assert third.status_code == 200, third.text
    assert await _pending_changed_mails(db_session) == 1
    kinds = (await db_session.execute(select(OutboxMessage.kind))).scalars().all()
    assert kinds.count("parent_visit_changed") == 2


@pytest.mark.asyncio
async def test_details_cannot_be_edited_once_the_campus_is_deactivated(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()
    off = await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": False, "reason": "整修"})
    assert off.status_code == 200, off.text

    response = await _edit(public_client, booked["receipt_id"], me["version"], party_size=3)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "BOOKING_UNAVAILABLE"
    assert (await public_client.get(f"{MANAGE}/me")).json()["can_edit"] is False


@pytest.mark.asyncio
async def test_no_online_reschedule_when_the_campus_no_longer_takes_slot_bookings(admin_client, public_client):
    """分校預約方式改成電話（非 slots）：官網沒有場次可選，不能線上改場次；取消照常。"""
    booked = await _booked_and_open(admin_client, public_client)
    other = await create_slot(admin_client, days_ahead=5)
    switched = await set_booking_mode(admin_client, "yihua", mode="phone", phone="07-3800000")
    assert switched.status_code == 200, switched.text

    me = (await public_client.get(f"{MANAGE}/me")).json()
    blocked = await _reschedule(public_client, booked["receipt_id"], other)
    cancelled = await public_client.post(f"{MANAGE}/cancel", json={"visit_request_id": booked["receipt_id"]})

    assert me["can_reschedule"] is False and me["can_cancel"] is True
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "BOOKING_UNAVAILABLE"
    assert blocked.json()["detail"]["message"] == "本校目前暫停線上預約，要改時間請來電"
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
