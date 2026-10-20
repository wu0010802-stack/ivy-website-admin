"""停班停課（2026-10-14 規格 §3）：一天停課（可多校）、寄停課通知、停課日不受線上修改期限限制。"""
from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.booking.models import OutboxMessage, VisitException, VisitRequestEvent, VisitSlot
from app.common.timezones import today_local
from app.operations.models import AuditLogEntry
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot, create_slot, legacy_request, open_manage

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
ORIGIN = "https://www.ivy.example"


def _enable_smtp(app) -> None:
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"


async def _close(client, day, campus_keys=("yihua",), *, dry_run=False, notify=True, reason="颱風停班停課"):
    return await client.post(
        f"{API}/admin/visit-closures",
        json={
            "closure_date": day if isinstance(day, str) else day.isoformat(),
            "campus_keys": list(campus_keys),
            "reason": reason,
            "notify_parents": notify,
            "dry_run": dry_run,
        },
    )


async def _day_closed_messages(db_session):
    return (
        await db_session.execute(select(OutboxMessage).where(OutboxMessage.kind == "parent_visit_day_closed"))
    ).scalars().all()


async def _run_outbox(db_session, app, adapter):
    return await process_outbox_batch(
        db_session, adapter, limit=50, admin_origin=ORIGIN, access_secret=app.state.settings.session_secret
    )


@pytest.mark.asyncio
async def test_dry_run_counts_without_writing(app, admin_client, public_client, db_session):
    _enable_smtp(app)
    booked = await book_slot(admin_client, public_client, days_ahead=3)

    response = await _close(admin_client, booked["slot_date"], dry_run=True)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dry_run"] is True and body["parent_email_enabled"] is True
    assert body["campuses"] == [
        {
            "campus_key": "yihua",
            "already_closed": False,
            "closed_slots": 1,
            "confirmed_requests": 1,
            "with_email": 1,
            "notified": 1,
            "already_notified": 0,
            "no_email": 0,
        }
    ]
    assert (await db_session.scalar(select(VisitException.id))) is None
    assert await _day_closed_messages(db_session) == []
    slot = await db_session.get(VisitSlot, booked["slot_id"])
    assert slot.closed is False


@pytest.mark.asyncio
async def test_closure_closes_the_day_and_queues_one_notice_per_booking(app, admin_client, public_client, db_session):
    _enable_smtp(app)
    booked = await book_slot(admin_client, public_client, days_ahead=3)

    first = await _close(admin_client, booked["slot_date"])
    again = await _close(admin_client, booked["slot_date"], reason="颱風停班停課（延長）")

    assert first.status_code == 200, first.text
    assert first.json()["campuses"][0] | {"campus_key": "yihua"} == {
        "campus_key": "yihua",
        "already_closed": False,
        "closed_slots": 1,
        "confirmed_requests": 1,
        "with_email": 1,
        "notified": 1,
        "already_notified": 0,
        "no_email": 0,
    }
    second = again.json()["campuses"][0]
    assert second["already_closed"] is True
    assert second["closed_slots"] == 0
    assert second["notified"] == 0 and second["already_notified"] == 1

    db_session.expire_all()
    exception = (await db_session.execute(select(VisitException))).scalar_one()
    assert exception.reason == "颱風停班停課（延長）"
    slot = await db_session.get(VisitSlot, booked["slot_id"])
    assert slot.closed is True and slot.closed_source == "exception"
    messages = await _day_closed_messages(db_session)
    assert len(messages) == 1
    assert messages[0].payload == {
        "campus_key": "yihua",
        "receipt_id": booked["receipt_id"],
        "closure_date": booked["slot_date"],
        "reason": "颱風停班停課",
    }
    events = (
        await db_session.execute(select(VisitRequestEvent).where(VisitRequestEvent.event_type == "closure_notice"))
    ).scalars().all()
    assert len(events) == 1 and events[0].reason == "颱風停班停課"
    audits = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "visit_closure.create"))
    ).scalars().all()
    assert len(audits) == 2
    assert audits[0].metadata_json["notified"] + audits[1].metadata_json["notified"] == 1
    # 案件仍是已確認，列在待人工處理。
    detail = await admin_client.get(f"{API}/admin/visit-requests/{booked['receipt_id']}")
    assert detail.json()["status"] == "confirmed"
    attention = await admin_client.get(f"{API}/admin/visit-requests?needs_attention=true")
    assert booked["receipt_id"] in {row["id"] for row in attention.json()}


@pytest.mark.asyncio
async def test_without_smtp_nothing_is_queued(app, admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client, days_ahead=3)

    response = await _close(admin_client, booked["slot_date"])

    body = response.json()
    assert body["parent_email_enabled"] is False
    assert body["campuses"][0]["with_email"] == 1
    assert body["campuses"][0]["notified"] == 0
    assert await _day_closed_messages(db_session) == []


@pytest.mark.asyncio
async def test_bookings_without_email_are_left_for_phone_calls(app, admin_client, db_session):
    _enable_smtp(app)
    slot_id = await create_slot(admin_client, days_ahead=4)
    await legacy_request(db_session, status="confirmed", slot_id=slot_id, email=None)
    day = (today_local() + timedelta(days=4)).isoformat()

    response = await _close(admin_client, day)

    assert response.json()["campuses"][0]["no_email"] == 1
    assert response.json()["campuses"][0]["notified"] == 0


@pytest.mark.asyncio
async def test_several_campuses_at_once_and_scope(admin_client, minghua_client, db_session):
    day = today_local() + timedelta(days=2)
    both = await _close(admin_client, day, ("yihua", "minghua"))
    assert both.status_code == 200, both.text
    assert [c["campus_key"] for c in both.json()["campuses"]] == ["minghua", "yihua"]
    db_session.expire_all()
    assert {e.campus_key for e in (await db_session.execute(select(VisitException))).scalars()} == {"yihua", "minghua"}

    assert (await _close(minghua_client, day, ("yihua",))).status_code == 404
    assert (await _close(minghua_client, day, ("minghua",), dry_run=True)).status_code == 200


@pytest.mark.asyncio
async def test_closure_date_and_reason_are_validated(admin_client):
    yesterday = await _close(admin_client, today_local() - timedelta(days=1))
    assert yesterday.status_code == 422
    assert yesterday.json()["detail"]["code"] == "INVALID_CLOSURE_DATE"
    too_far = await _close(admin_client, today_local() + timedelta(days=61))
    assert too_far.json()["detail"]["code"] == "INVALID_CLOSURE_DATE"
    assert (await _close(admin_client, today_local(), reason="  ")).status_code == 422
    assert (await _close(admin_client, today_local(), ("yihua", "yihua"))).status_code == 422


@pytest.mark.asyncio
async def test_notice_mail_has_reason_and_link_and_the_parent_can_move_past_the_deadline(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    _enable_smtp(app)
    booked = await book_slot(admin_client, public_client, days_ahead=3)
    other_slot = await create_slot(admin_client, days_ahead=6, start_time="14:00:00", end_time="15:00:00")
    # 參觀在三天後；改成參觀前 14 天截止，線上本來已經不能改。
    config = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()
    patched = await admin_client.patch(
        f"{API}/admin/booking-config/yihua",
        json={"expected_version": config["version"], "mode": "slots", "parent_change_deadline_hours": 336},
    )
    assert patched.status_code == 200, patched.text
    before = await open_manage(public_client, booked["manage_path"])
    assert before["can_reschedule"] is False and before["day_closed"] is False
    await _close(admin_client, booked["slot_date"])
    await _run_outbox(db_session, app, recording_mail_adapter)

    # 預約成功信還排著就停課：只寄停課通知，不再多一封改寫成停課內容的預約成功信（2026-10-20 稽核）。
    assert len([m for m in recording_mail_adapter.sent if m["to"] == "parent@example.com"]) == 1
    mails = [m for m in recording_mail_adapter.sent if m["to"] == "parent@example.com" and "停課" in m["subject"]]
    assert len(mails) == 1
    assert mails[0]["subject"].startswith("【常春藤義華】參觀日停課，請改約時間：")
    body = mails[0]["body"]
    assert "因颱風停班停課，常春藤義華校這天停課" in body
    assert "前可以線上修改" not in body
    link = next(line for line in body.splitlines() if "#token=" in line)
    assert link.startswith(f"{ORIGIN}/visit/manage#token=")

    me = await open_manage(public_client, link.removeprefix(ORIGIN))
    assert me["day_closed"] is True
    assert me["change_deadline"] is None
    assert me["can_reschedule"] is True and me["can_cancel"] is True
    moved = await public_client.post(
        f"{API}/public/visit-manage/reschedule", json={"slot_id": other_slot, "visit_request_id": booked["receipt_id"]}
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["day_closed"] is False
    # 改到新場次後，原本的期限規則照常適用（新場次也在 14 天內）。
    assert moved.json()["can_reschedule"] is False
    attention = await admin_client.get(f"{API}/admin/visit-requests?needs_attention=true")
    assert booked["receipt_id"] not in {row["id"] for row in attention.json()}


@pytest.mark.asyncio
async def test_parent_can_cancel_a_closed_day_past_the_deadline(app, admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client, days_ahead=2)
    config = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()
    await admin_client.patch(
        f"{API}/admin/booking-config/yihua",
        json={"expected_version": config["version"], "mode": "slots", "parent_change_deadline_hours": 336},
    )
    await open_manage(public_client, booked["manage_path"])
    blocked = await public_client.post(f"{API}/public/visit-manage/cancel", json={"visit_request_id": booked["receipt_id"]})
    assert blocked.json()["detail"]["code"] == "CHANGE_DEADLINE_PASSED"

    # 月曆上一般的「整天休假」也算停課日。
    holiday = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": booked["slot_date"], "reason": "教師研習"}
    )
    assert holiday.status_code == 201

    cancelled = await public_client.post(f"{API}/public/visit-manage/cancel", json={"visit_request_id": booked["receipt_id"]})
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_notice_is_skipped_when_the_parent_already_moved(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    _enable_smtp(app)
    booked = await book_slot(admin_client, public_client, days_ahead=3)
    other_slot = await create_slot(admin_client, days_ahead=6, start_time="14:00:00", end_time="15:00:00")
    await _close(admin_client, booked["slot_date"])
    await open_manage(public_client, booked["manage_path"])
    moved = await public_client.post(
        f"{API}/public/visit-manage/reschedule", json={"slot_id": other_slot, "visit_request_id": booked["receipt_id"]}
    )
    assert moved.status_code == 200, moved.text

    await _run_outbox(db_session, app, recording_mail_adapter)

    assert not [m for m in recording_mail_adapter.sent if "停課" in m["subject"]]
    db_session.expire_all()
    (message,) = await _day_closed_messages(db_session)
    assert message.status == "skipped"


@pytest.mark.asyncio
async def test_manually_stopped_slot_on_a_day_off_needs_attention(admin_client, public_client, db_session):
    """先「停止申請」（已約的照常參觀），之後那天整天休假：已約的家長一樣不能來。"""
    booked = await book_slot(admin_client, public_client, days_ahead=3)
    slot = (await admin_client.get(f"{API}/admin/visit-calendar?campus_key=yihua&date_from={booked['slot_date']}&date_to={booked['slot_date']}")).json()[0]
    stopped = await admin_client.patch(
        f"{API}/admin/slots/{booked['slot_id']}", json={"closed": True, "expected_version": slot["version"]}
    )
    assert stopped.status_code == 200, stopped.text
    attention = await admin_client.get(f"{API}/admin/visit-requests?needs_attention=true")
    assert booked["receipt_id"] not in {row["id"] for row in attention.json()}

    await _close(admin_client, booked["slot_date"], notify=False)

    attention = await admin_client.get(f"{API}/admin/visit-requests?needs_attention=true")
    assert booked["receipt_id"] in {row["id"] for row in attention.json()}
    db_session.expire_all()
    assert (await db_session.get(VisitSlot, booked["slot_id"])).closed_source == "manual"
