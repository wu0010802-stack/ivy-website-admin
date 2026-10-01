from __future__ import annotations

from datetime import date, datetime, time, timezone

import pytest
from sqlalchemy import select

from app.booking.models import OutboxMessage
from app.notifications.parent_email import ParentEmail, build_parent_email, session_label, visit_when
from app.operations.models import AuditLogEntry
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot, create_slot, legacy_request, open_manage

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
    # 變更信要在取消前寄出：寄件當下案件已取消的話，變更信會略過（test_booked_mail_still_queued_at_cancel_is_not_sent）。
    await _run(db_session, recording_mail_adapter, app)
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


def _enable_smtp(app) -> None:
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"


@pytest.mark.asyncio
async def test_resend_and_regenerate_queue_parent_mail(app, admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)
    _enable_smtp(app)

    resend = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/resend-confirmation")
    regenerate = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/access-link")

    assert resend.status_code == 202, resend.text
    assert resend.json() == {"queued": True}
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


@pytest.mark.asyncio
async def test_booked_mail_still_queued_at_cancel_is_not_sent(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    """「預約成功」還沒寄出案件就取消了：寄件當下案件已非 confirmed，只寄「已取消」。"""
    booked = await book_slot(admin_client, public_client)
    cancelled = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})
    assert cancelled.status_code == 200, cancelled.text

    await _run(db_session, recording_mail_adapter, app)

    subjects = [mail["subject"] for mail in _parent_mails(recording_mail_adapter)]
    assert len(subjects) == 1 and "參觀預約已取消" in subjects[0]
    statuses = dict(
        (
            await db_session.execute(
                select(OutboxMessage.kind, OutboxMessage.status).where(OutboxMessage.kind.like("parent_%"))
            )
        ).tuples().all()
    )
    assert statuses == {"parent_visit_booked": "skipped", "parent_visit_cancelled": "sent"}


async def _parent_kinds(db_session) -> list[str]:
    return sorted(
        (await db_session.execute(select(OutboxMessage.kind).where(OutboxMessage.kind.like("parent_%")))).scalars().all()
    )


@pytest.mark.asyncio
async def test_without_smtp_staff_is_told_the_parent_gets_no_mail(admin_client, public_client, db_session):
    """沒設 SMTP：重新產生連結不能說「已寄出」（仍排信，之後設好會寄）；重寄確認信直接拒絕、不排信、不記稽核。"""
    booked = await book_slot(admin_client, public_client)

    regenerate = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/access-link")
    resend = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/resend-confirmation")

    assert regenerate.status_code == 200, regenerate.text
    assert regenerate.json()["emailed"] is False
    assert resend.status_code == 409
    detail = resend.json()["detail"]
    assert detail["code"] == "PARENT_EMAIL_DISABLED"
    assert detail["message"] == "尚未設定寄信，無法寄出確認信；請把修改連結直接交給家長"
    assert await _parent_kinds(db_session) == ["parent_visit_booked", "parent_visit_changed"]
    audits = (
        await db_session.execute(
            select(AuditLogEntry.action).where(AuditLogEntry.action == "visit_request.resend_confirmation")
        )
    ).scalars().all()
    assert audits == []


@pytest.mark.asyncio
async def test_regenerating_a_link_without_a_slot_does_not_mail_the_parent(app, admin_client, db_session):
    """沒有場次的舊案件：信裡沒有日期只會讓家長困惑，不排變更信，emailed 為 False。"""
    visit_id = await legacy_request(db_session, email="legacy@example.com")
    _enable_smtp(app)

    regenerate = await admin_client.post(f"{API}/admin/visit-requests/{visit_id}/access-link")

    assert regenerate.status_code == 200, regenerate.text
    assert regenerate.json()["emailed"] is False
    assert regenerate.json()["manage_url_fragment"].startswith("/visit/manage#token=")
    assert await _parent_kinds(db_session) == []
