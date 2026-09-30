from __future__ import annotations

from datetime import date, datetime, time, timezone

import pytest
from sqlalchemy import select

from app.booking.models import OutboxMessage
from app.notifications.parent_email import ParentEmail, build_parent_email, session_label, visit_when
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot, create_slot, open_manage

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
ORIGIN = "https://www.ivy.example"


def test_session_label_splits_at_noon():
    assert session_label(time(9, 59)) == "上午場 09:59"
    assert session_label(time(12, 0)) == "下午場 12:00"
    assert visit_when(date(2026, 10, 2), time(10, 0)) == "10/02（五）上午場 10:00"


def _mail(**changes) -> ParentEmail:
    base = dict(
        kind="parent_visit_booked",
        campus_name="義華校",
        salutation="陳小姐",
        slot_date=date(2026, 10, 2),
        start_time=time(10, 0),
        end_time=time(11, 0),
        party_size=2,
        campus_address="高雄市三民區範例路 1 號",
        campus_phone="07-3000000",
        manage_url=f"{ORIGIN}/visit/manage#token=abc",
        change_deadline=datetime(2026, 10, 1, 2, 0, tzinfo=timezone.utc),
        cancel_reason=None,
        rebook_url=f"{ORIGIN}/visit/yihua",
    )
    base.update(changes)
    return ParentEmail(**base)


def test_booked_mail_has_time_link_and_deadline():
    subject, body = build_parent_email(_mail())

    assert subject == "【常春藤義華】參觀預約成功：10/02（五）上午場 10:00"
    assert body.startswith("陳小姐您好：")
    assert "日期與場次：10/02（五）上午場 10:00（10:00–11:00）" in body
    assert "參觀人數：2 位" in body
    assert f"{ORIGIN}/visit/manage#token=abc" in body
    assert "10/01（四）10:00前可以線上修改" in body


def test_cancelled_mail_says_who_and_has_no_manage_link():
    subject, body = build_parent_email(_mail(kind="parent_visit_cancelled", cancel_reason="staff", manage_url=None))

    assert subject == "【常春藤義華】參觀預約已取消：10/02（五）上午場 10:00"
    assert "園方已取消這次參觀預約" in body
    assert "#token=" not in body
    assert f"{ORIGIN}/visit/yihua" in body


async def _run(db_session, adapter, app):
    return await process_outbox_batch(
        db_session, adapter, limit=50, admin_origin=ORIGIN, access_secret=app.state.settings.session_secret
    )


def _parent_mails(adapter, to="parent@example.com"):
    return [mail for mail in adapter.sent if mail["to"] == to]


@pytest.mark.asyncio
async def test_booking_sends_one_mail_to_the_parent_with_a_working_link(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    booked = await book_slot(admin_client, public_client, child_name="小寶", child_birthdate="2022-05-01")

    await _run(db_session, recording_mail_adapter, app)

    mails = _parent_mails(recording_mail_adapter)
    assert len(mails) == 1
    assert mails[0]["subject"].startswith("【常春藤義華】參觀預約成功：")
    assert f"{ORIGIN}{booked['manage_path']}" in mails[0]["body"]
    for secret in ("2022-05-01", "0912345678", "小寶"):
        assert secret not in mails[0]["body"]
    assert any(mail["to"] != "parent@example.com" for mail in recording_mail_adapter.sent)  # 園方信照寄


@pytest.mark.asyncio
async def test_parent_mail_is_skipped_without_an_adapter(app, admin_client, public_client, db_session):
    await book_slot(admin_client, public_client)

    await process_outbox_batch(db_session, None, limit=50, admin_origin=ORIGIN, access_secret=app.state.settings.session_secret)

    statuses = (
        await db_session.execute(select(OutboxMessage.status).where(OutboxMessage.kind == "parent_visit_booked"))
    ).scalars().all()
    assert statuses == ["skipped"]


@pytest.mark.asyncio
async def test_staff_cancel_and_reschedule_mail_the_parent(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    booked = await book_slot(admin_client, public_client)
    later = await create_slot(admin_client, days_ahead=6, start_time="14:30:00", end_time="15:30:00")
    await _run(db_session, recording_mail_adapter, app)
    recording_mail_adapter.sent.clear()

    await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/reschedule", json={"new_slot_id": later})
    await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})
    await _run(db_session, recording_mail_adapter, app)

    subjects = [mail["subject"] for mail in _parent_mails(recording_mail_adapter)]
    assert any("參觀預約已變更" in s and "下午場 14:30" in s for s in subjects)
    cancelled = [m for m in _parent_mails(recording_mail_adapter) if "參觀預約已取消" in m["subject"]]
    assert len(cancelled) == 1 and "園方已取消" in cancelled[0]["body"]


@pytest.mark.asyncio
async def test_parent_cancel_mail_says_the_parent_cancelled(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    booked = await book_slot(admin_client, public_client)
    await open_manage(public_client, booked["manage_path"])
    await _run(db_session, recording_mail_adapter, app)
    recording_mail_adapter.sent.clear()

    response = await public_client.post(
        f"{API}/public/visit-manage/cancel", json={"visit_request_id": booked["receipt_id"]}
    )
    await _run(db_session, recording_mail_adapter, app)

    assert response.status_code == 200, response.text
    assert "您已取消這次參觀預約" in _parent_mails(recording_mail_adapter)[0]["body"]


@pytest.mark.asyncio
async def test_outbox_payloads_only_carry_ids(admin_client, public_client, db_session):
    await book_slot(admin_client, public_client)

    payloads = (
        await db_session.execute(select(OutboxMessage.payload).where(OutboxMessage.kind.like("parent_%")))
    ).scalars().all()

    assert payloads and all(set(p) == {"campus_key", "receipt_id"} for p in payloads)


@pytest.mark.asyncio
async def test_resend_and_regenerate_queue_parent_mail(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)

    resend = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/resend-confirmation")
    regenerate = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/access-link")

    assert resend.status_code == 202, resend.text
    assert regenerate.json()["emailed"] is True
    kinds = (
        await db_session.execute(select(OutboxMessage.kind).where(OutboxMessage.kind.like("parent_%")))
    ).scalars().all()
    assert sorted(kinds) == ["parent_visit_booked", "parent_visit_booked", "parent_visit_changed"]


@pytest.mark.asyncio
async def test_resend_is_refused_for_a_cancelled_booking(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})

    response = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/resend-confirmation")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "RESEND_NOT_AVAILABLE"


@pytest.mark.asyncio
async def test_booking_config_says_whether_parent_mail_is_on(app, admin_client, public_client):
    off = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"
    on = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    admin = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()

    assert off["parent_email_enabled"] is False
    assert on["parent_email_enabled"] is True
    assert admin["parent_email_enabled"] is True
