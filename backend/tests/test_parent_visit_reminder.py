"""參觀前 24 小時的家長提醒信（2026-10-15 規格 docs/specs/2026-10-15-parent-visit-reminder-design.md）。

前半（Task 4）：信件內容與寄送判斷，outbox 列直接寫入；後半（Task 5）：維護排程的排入。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app import cli
from app.booking.models import BookingConfig, OutboxMessage, VisitException, VisitRequest, VisitSlot
from app.booking.outbox import PARENT_KINDS, PARENT_VISIT_REMINDER, enqueue_parent_email
from app.common.timezones import OPERATING_TZ, today_local
from app.notifications import reminders
from app.notifications import service as notification_service
from app.notifications.models import NotificationInboxItem
from app.notifications.parent_email import ParentEmail, build_parent_email
from app.notifications.service import notification_label
from app.workers import maintenance
from app.workers.maintenance import run_cycle
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot, create_slot, legacy_request
from tests.test_notification_retry_reminders import _fail_until_given_up

pytestmark = pytest.mark.usefixtures("booking_consent")
ORIGIN = "https://www.ivy.example"
PARENT_EMAIL = "parent@example.com"
# 對照組家長：同一批寄送裡一定會收到信，用來證明「沒寄」不是整條寄送線壞了。
CONTROL_EMAIL = "control@example.com"
WEEKDAYS = "一二三四五六日"


def _mail(**changes) -> ParentEmail:
    base = dict(
        kind=PARENT_VISIT_REMINDER,
        campus_name="義華校",
        salutation="陳小姐",
        slot_date=date(2026, 10, 16),
        start_time=time(9, 30),
        end_time=time(10, 30),
        party_size=None,
        campus_address="高雄市三民區範例路 1 號",
        campus_phone="07-3000000",
        manage_url=None,
        change_deadline=datetime(2026, 10, 15, 1, 30, tzinfo=timezone.utc),
        cancel_reason=None,
        rebook_url=None,
        day_word="明天",
    )
    base.update(changes)
    return ParentEmail(**base)


def test_reminder_kind_is_a_parent_mail_with_its_label():
    assert PARENT_VISIT_REMINDER in PARENT_KINDS
    assert notification_label(PARENT_VISIT_REMINDER) == "參觀提醒（家長）"


async def test_enqueue_parent_email_refuses_the_reminder_kind(db_session):
    with pytest.raises(ValueError):
        await enqueue_parent_email(db_session, object(), PARENT_VISIT_REMINDER)


def test_reminder_subject_intro_and_call_us():
    subject, body = build_parent_email(_mail())
    assert subject == "【常春藤義華】參觀提醒：明天 10/16（五）上午場 09:30"
    assert body.startswith("陳小姐您好：")
    assert "提醒您，明天 10/16（五）上午場 09:30 在常春藤義華校參觀。" in body
    assert "地址：高雄市三民區範例路 1 號" in body
    assert "要改期或取消，請來電 07-3000000。" in body
    assert "#token=" not in body


def test_reminder_inside_the_deadline_has_the_link_and_deadline():
    _, body = build_parent_email(_mail(
        manage_url=f"{ORIGIN}/visit/manage#token=abc", change_deadline=datetime(2026, 10, 15, 13, 30, tzinfo=timezone.utc),
    ))
    assert "要改期或取消，請在 10/15（四）21:30 前使用這個連結：" in body
    assert f"{ORIGIN}/visit/manage#token=abc" in body
    assert "請來電" not in body


def test_reminder_today_and_without_a_phone():
    subject, body = build_parent_email(_mail(day_word="今天", campus_phone=None))
    assert subject == "【常春藤義華】參觀提醒：今天 10/16（五）上午場 09:30"
    assert "要改期或取消，請來電洽詢。" in body


def test_day_word_follows_the_taipei_date_at_send_time(monkeypatch):
    monkeypatch.setattr(notification_service, "today_local", lambda: date(2026, 10, 15))
    assert notification_service._day_word(date(2026, 10, 15)) == "今天"
    assert notification_service._day_word(date(2026, 10, 16)) == "明天"
    assert notification_service._day_word(date(2026, 10, 17)) is None
    assert notification_service._day_word(date(2026, 10, 14)) is None


# --- 寄送判斷（真資料庫） -----------------------------------------------------------


async def _move_slot_start(db_session, slot_id: str, *, hours: float) -> datetime:
    """把場次挪到現在起 hours 小時後開始（台北時間、捨去秒），回傳開始時間。
    結束時間固定 23:59：只看開始時間，不管場次長度。"""
    starts = (datetime.now(timezone.utc) + timedelta(hours=hours)).astimezone(OPERATING_TZ).replace(second=0, microsecond=0)
    await db_session.execute(
        update(VisitSlot)
        .where(VisitSlot.id == uuid.UUID(slot_id))
        .values(slot_date=starts.date(), start_time=time(starts.hour, starts.minute), end_time=time(23, 59))
    )
    await db_session.commit()
    return starts


async def _confirmed_days_ago(db_session, receipt_id: str) -> None:
    """確認時間改成 5 天前：確認時還沒進提醒範圍，到點才需要提醒。"""
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(receipt_id))
        .values(confirmed_at=datetime.now(timezone.utc) - timedelta(days=5))
    )
    await db_session.commit()


async def _visit_starting_in(
    admin_client, public_client, db_session, hours: float, *, email: str = PARENT_EMAIL
) -> tuple[str, str, datetime]:
    """官網預約一筆（Email 預設 parent@example.com），把場次挪到 hours 小時後開始；確認時間改成 5 天前
    （確認時還沒進提醒範圍）。回傳（案件 id、場次 id、場次開始的台北時間）。"""
    booked = await book_slot(admin_client, public_client, email=email)
    starts = await _move_slot_start(db_session, booked["slot_id"], hours=hours)
    await _confirmed_days_ago(db_session, booked["receipt_id"])
    return booked["receipt_id"], booked["slot_id"], starts


async def _queue_reminder(db_session, receipt_id: str, slot_id: str, *, queued_ago: timedelta = timedelta()) -> uuid.UUID:
    """直接寫一列，形狀與 enqueue_due_parent_reminders 相同；要指定「排進佇列多久了」才用它
    （排入函式只在到點時寫、時間固定是現在）。"""
    queued_at = datetime.now(timezone.utc) - queued_ago
    message_id = uuid.uuid4()
    db_session.add(OutboxMessage(
        id=message_id,
        visit_request_id=uuid.UUID(receipt_id),
        kind=PARENT_VISIT_REMINDER,
        payload={"campus_key": "yihua", "receipt_id": receipt_id, "slot_id": slot_id},
        created_at=queued_at,
        next_attempt_at=datetime.now(timezone.utc),
        status="pending",
        attempts=0,
        dedupe_key=reminders.parent_reminder_key(uuid.UUID(receipt_id), uuid.UUID(slot_id)),
    ))
    await db_session.commit()
    return message_id


async def _queue_control(admin_client, public_client, db_session) -> uuid.UUID:
    """會寄出的對照組：另一位家長（control@example.com）、參觀前 20 小時，提醒已排入。"""
    receipt, slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=20, email=CONTROL_EMAIL)
    return await _queue_reminder(db_session, receipt, slot)


async def _run(app, db_session, adapter, *, origin: str | None = ORIGIN):
    return await process_outbox_batch(
        db_session, adapter, limit=50, admin_origin=origin, access_secret=app.state.settings.session_secret,
    )


def _reminder_mails(adapter) -> list[dict]:
    return [mail for mail in adapter.sent if "參觀提醒" in mail["subject"]]


async def _status(db_session, message_id: uuid.UUID) -> str:
    return (await db_session.execute(select(OutboxMessage.status).where(OutboxMessage.id == message_id))).scalar_one()


async def _assert_only_the_control_was_mailed(db_session, adapter, control_id: uuid.UUID) -> None:
    assert [mail["to"] for mail in _reminder_mails(adapter)] == [CONTROL_EMAIL]
    assert await _status(db_session, control_id) == "sent"


async def _send_one_reminder(
    app, admin_client, public_client, db_session, adapter, *, deadline_hours: int | None = None, origin: str | None = ORIGIN
) -> tuple[dict, datetime]:
    """參觀前 23 小時的預約、排一封提醒並寄出，回傳（那封信、場次開始時間）。
    deadline_hours 不是 None 時先把該校的線上修改期限改成這個小時數（預設 24）。"""
    receipt, slot, starts = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    if deadline_hours is not None:
        await db_session.execute(
            update(BookingConfig).where(BookingConfig.campus_key == "yihua").values(parent_change_deadline_hours=deadline_hours)
        )
        await db_session.commit()
    message_id = await _queue_reminder(db_session, receipt, slot)
    await _run(app, db_session, adapter, origin=origin)
    assert await _status(db_session, message_id) == "sent"
    [mail] = _reminder_mails(adapter)
    return mail, starts


async def test_reminder_past_the_default_deadline_asks_to_call(app, admin_client, public_client, db_session, recording_mail_adapter):
    mail, starts = await _send_one_reminder(app, admin_client, public_client, db_session, recording_mail_adapter)
    assert mail["to"] == PARENT_EMAIL
    days_until = (starts.date() - today_local()).days
    assert days_until in (0, 1)
    word = ("今天", "明天")[days_until]
    assert mail["subject"].startswith(f"【常春藤義華】參觀提醒：{word} {starts:%m/%d}（{WEEKDAYS[starts.weekday()]}）")
    # 預設期限是參觀前 24 小時：寄出時已過，不附連結。
    assert "#token=" not in mail["body"]
    assert "要改期或取消，請來電" in mail["body"]
    assert "0912345678" not in mail["body"]


async def test_reminder_inside_a_shorter_deadline_links_the_manage_page(app, admin_client, public_client, db_session, recording_mail_adapter):
    mail, starts = await _send_one_reminder(app, admin_client, public_client, db_session, recording_mail_adapter, deadline_hours=12)
    deadline = starts - timedelta(hours=12)
    assert f"要改期或取消，請在 {deadline:%m/%d}（{WEEKDAYS[deadline.weekday()]}）{deadline:%H:%M} 前使用這個連結：" in mail["body"]
    assert f"{ORIGIN}/visit/manage#token=" in mail["body"]
    assert "請來電" not in mail["body"]


async def test_reminder_inside_the_deadline_without_admin_origin_asks_to_call(app, admin_client, public_client, db_session, recording_mail_adapter):
    mail, _ = await _send_one_reminder(
        app, admin_client, public_client, db_session, recording_mail_adapter, deadline_hours=12, origin=None
    )
    assert "#token=" not in mail["body"]
    assert "前使用這個連結" not in mail["body"]
    assert "要改期或取消，請來電" in mail["body"]


async def test_reminder_inside_the_deadline_without_a_derivable_link_asks_to_call(
    app, admin_client, public_client, db_session, recording_mail_adapter, monkeypatch
):
    async def _no_link(*_args, **_kwargs):
        return None

    monkeypatch.setattr(notification_service.access_service, "current_manage_path", _no_link)
    mail, _ = await _send_one_reminder(app, admin_client, public_client, db_session, recording_mail_adapter, deadline_hours=12)
    assert "#token=" not in mail["body"]
    assert "前使用這個連結" not in mail["body"]
    assert "要改期或取消，請來電" in mail["body"]


async def test_reminder_queued_before_a_reschedule_is_skipped_but_the_new_slot_still_gets_one(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    receipt, old_slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    stale_id = await _queue_reminder(db_session, receipt, old_slot)
    new_slot = await create_slot(admin_client, days_ahead=5)
    new_starts = await _move_slot_start(db_session, new_slot, hours=22)
    moved = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt}/reschedule", json={"new_slot_id": new_slot})
    assert moved.status_code == 200, moved.text
    current_id = await _queue_reminder(db_session, receipt, new_slot)

    await _run(app, db_session, recording_mail_adapter)

    assert await _status(db_session, stale_id) == "skipped"
    assert await _status(db_session, current_id) == "sent"
    [mail] = _reminder_mails(recording_mail_adapter)
    assert mail["subject"].endswith(f"{new_starts:%H:%M}")


async def test_reminder_after_cancel_is_skipped(app, admin_client, public_client, db_session, recording_mail_adapter):
    receipt, slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    cancelled_id = await _queue_reminder(db_session, receipt, slot)
    control_id = await _queue_control(admin_client, public_client, db_session)
    cancelled = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt}/cancel")
    assert cancelled.status_code == 200, cancelled.text

    await _run(app, db_session, recording_mail_adapter)

    assert await _status(db_session, cancelled_id) == "skipped"
    await _assert_only_the_control_was_mailed(db_session, recording_mail_adapter, control_id)


async def test_reminder_on_a_closed_day_is_skipped(app, admin_client, public_client, db_session, recording_mail_adapter):
    receipt, slot, starts = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    closed_id = await _queue_reminder(db_session, receipt, slot)
    control_id = await _queue_control(admin_client, public_client, db_session)
    await db_session.execute(update(VisitSlot).where(VisitSlot.id == uuid.UUID(slot)).values(closed=True))
    db_session.add(VisitException(
        id=uuid.uuid4(), campus_key="yihua", exception_date=starts.date(), reason="颱風停班停課", created_at=datetime.now(timezone.utc),
    ))
    await db_session.commit()

    await _run(app, db_session, recording_mail_adapter)

    assert await _status(db_session, closed_id) == "skipped"
    await _assert_only_the_control_was_mailed(db_session, recording_mail_adapter, control_id)


async def test_reminder_after_the_visit_started_is_skipped(app, admin_client, public_client, db_session, recording_mail_adapter):
    receipt, slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=-1)
    started_id = await _queue_reminder(db_session, receipt, slot)
    control_id = await _queue_control(admin_client, public_client, db_session)

    await _run(app, db_session, recording_mail_adapter)

    assert await _status(db_session, started_id) == "skipped"
    await _assert_only_the_control_was_mailed(db_session, recording_mail_adapter, control_id)


async def test_reminder_queued_over_a_day_ago_is_skipped(app, admin_client, public_client, db_session, recording_mail_adapter):
    receipt, slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    stale_id = await _queue_reminder(db_session, receipt, slot, queued_ago=timedelta(hours=25))
    control_id = await _queue_control(admin_client, public_client, db_session)

    await _run(app, db_session, recording_mail_adapter)

    assert await _status(db_session, stale_id) == "skipped"
    await _assert_only_the_control_was_mailed(db_session, recording_mail_adapter, control_id)


async def test_reminder_after_anonymizing_is_skipped(app, admin_client, public_client, db_session, recording_mail_adapter):
    receipt, slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    await db_session.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(receipt)).values(anonymized_at=datetime.now(timezone.utc)))
    await db_session.commit()
    anonymized_id = await _queue_reminder(db_session, receipt, slot)
    control_id = await _queue_control(admin_client, public_client, db_session)

    await _run(app, db_session, recording_mail_adapter)

    assert await _status(db_session, anonymized_id) == "skipped"
    await _assert_only_the_control_was_mailed(db_session, recording_mail_adapter, control_id)


async def test_reminder_without_mail_settings_is_skipped_and_not_sent_later(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    receipt, slot, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    unsent_id = await _queue_reminder(db_session, receipt, slot)
    await _run(app, db_session, None)
    assert await _status(db_session, unsent_id) == "skipped"

    # 設好寄信之後同樣的提醒會寄出；之前跳過的那一筆不會補寄。
    control_id = await _queue_control(admin_client, public_client, db_session)
    await _run(app, db_session, recording_mail_adapter)
    await _assert_only_the_control_was_mailed(db_session, recording_mail_adapter, control_id)
    assert await _status(db_session, unsent_id) == "skipped"


async def test_scanned_reminder_that_keeps_failing_lands_in_the_failed_list_with_its_label(
    app, admin_client, public_client, db_session, failing_mail_adapter
):
    await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    assert await reminders.enqueue_due_parent_reminders(db_session) == 1
    await db_session.commit()
    [queued] = await _queued(db_session)
    message = await _fail_until_given_up(db_session, queued.id, failing_mail_adapter, None)
    assert message.status == "failed"
    listed = await admin_client.get("/api/website/v1/admin/notification-outbox")
    assert listed.status_code == 200, listed.text
    [item] = [item for item in listed.json()["items"] if item["kind"] == PARENT_VISIT_REMINDER]
    assert item["id"] == str(queued.id)
    assert notification_label(item["kind"]) == "參觀提醒（家長）"


# --- 排入（Task 5） ------------------------------------------------------------------


async def _queued(db_session) -> list[OutboxMessage]:
    """已排入的家長提醒，依排入順序。"""
    rows = await db_session.execute(
        select(OutboxMessage).where(OutboxMessage.kind == PARENT_VISIT_REMINDER).order_by(OutboxMessage.created_at)
    )
    return list(rows.scalars())


async def _manual_visit_starting_in(admin_client, db_session, hours: float, *, email: str | None) -> str:
    """後台補登一筆已確認的案件（補登不發修改連結），場次挪到 hours 小時後開始、確認時間改成 5 天前。
    回傳案件 id。"""
    slot = await create_slot(admin_client, capacity=2)
    receipt = await legacy_request(db_session, status="confirmed", slot_id=slot, email=email)
    await _move_slot_start(db_session, slot, hours=hours)
    await _confirmed_days_ago(db_session, receipt)
    return receipt


def _settings_without_mail(app):
    return app.state.settings.model_copy(update={"notification_email_sink_dir": None, "smtp_host": None})


async def test_parent_reminder_queued_once_at_24_hours(admin_client, public_client, db_session):
    receipt, slot, starts = await _visit_starting_in(admin_client, public_client, db_session, hours=48)
    assert await reminders.enqueue_due_parent_reminders(db_session, now=starts - timedelta(hours=24, minutes=1)) == 0
    assert await reminders.enqueue_due_parent_reminders(db_session, now=starts - timedelta(hours=24)) == 1
    # 同一個場次重跑掃描不重複寫；開始之後也不排。
    assert await reminders.enqueue_due_parent_reminders(db_session, now=starts - timedelta(hours=23)) == 0
    assert await reminders.enqueue_due_parent_reminders(db_session, now=starts) == 0
    await db_session.commit()
    [row] = await _queued(db_session)
    assert row.payload == {"campus_key": "yihua", "receipt_id": receipt, "slot_id": slot}
    assert row.dedupe_key == f"parent_visit_reminder:{receipt}:{slot}"
    # 員工提醒不受影響：同一個時間點照樣一則（P6）。
    assert await reminders.enqueue_due_reminders(db_session, now=starts - timedelta(hours=23)) == 1


async def test_visit_without_an_email_gets_no_parent_reminder(admin_client, public_client, db_session):
    # 官網預約一定有 Email，後台補登可以沒有：沒收件人就不排。同一刻到點、有 Email 的那位照排。
    await _manual_visit_starting_in(admin_client, db_session, hours=23, email=None)
    with_email, _, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    assert await reminders.enqueue_due_parent_reminders(db_session) == 1
    await db_session.commit()
    [row] = await _queued(db_session)
    assert str(row.visit_request_id) == with_email
    # 員工提醒不看 Email：兩筆都排，證明沒有 Email 的那筆確實到點了。
    assert await reminders.enqueue_due_reminders(db_session) == 2


async def test_anonymized_visit_gets_no_parent_reminder(admin_client, public_client, db_session):
    anonymized, _, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(anonymized)).values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()
    control, _, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=23, email=CONTROL_EMAIL)
    assert await reminders.enqueue_due_parent_reminders(db_session) == 1
    await db_session.commit()
    [row] = await _queued(db_session)
    assert str(row.visit_request_id) == control


async def test_confirmed_or_rescheduled_inside_the_window_gets_no_parent_reminder(admin_client, public_client, db_session):
    # 三筆都在參觀前 20 小時、都有 Email。只有早就確認、之後沒動過的那筆（對照）會排。
    control, _, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=20, email=CONTROL_EMAIL)
    # 補登臨時約：確認時間（現在）晚於開始前 24 小時，確認那封就是提醒（R4）。
    late_slot = await create_slot(admin_client, capacity=2)
    await legacy_request(db_session, status="confirmed", slot_id=late_slot, email=PARENT_EMAIL)
    await _move_slot_start(db_session, late_slot, hours=20)
    # 早就確認、參觀前才改期到這一場：改期那封就是提醒（確認時間還是當初的，不能拿它判斷）。
    moved, _, _ = await _visit_starting_in(admin_client, public_client, db_session, hours=72, email="moved@example.com")
    new_slot = await create_slot(admin_client, capacity=2, days_ahead=5)
    await _move_slot_start(db_session, new_slot, hours=20)
    rescheduled = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{moved}/reschedule", json={"new_slot_id": new_slot}
    )
    assert rescheduled.status_code == 200, rescheduled.text

    assert await reminders.enqueue_due_parent_reminders(db_session) == 1
    await db_session.commit()
    [row] = await _queued(db_session)
    assert str(row.visit_request_id) == control


async def test_reschedule_gives_the_new_slot_its_own_reminder(admin_client, public_client, db_session):
    receipt, old_slot, first = await _visit_starting_in(admin_client, public_client, db_session, hours=48)
    assert await reminders.enqueue_due_parent_reminders(db_session, now=first - timedelta(hours=23)) == 1
    await db_session.commit()
    new_slot = await create_slot(admin_client, capacity=2, days_ahead=5)
    second = await _move_slot_start(db_session, new_slot, hours=96)
    moved = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt}/reschedule", json={"new_slot_id": new_slot}
    )
    assert moved.status_code == 200, moved.text
    # 改期在新場次開始前 4 天完成，到點照常提醒（新的去重鍵）。
    assert await reminders.enqueue_due_parent_reminders(db_session, now=second - timedelta(hours=23)) == 1
    await db_session.commit()
    assert [row.payload["slot_id"] for row in await _queued(db_session)] == [old_slot, new_slot]


async def test_maintenance_cycle_queues_the_parent_reminder_even_without_mail_settings(app, admin_client, db_session):
    await _manual_visit_starting_in(admin_client, db_session, hours=23, email=PARENT_EMAIL)
    settings = _settings_without_mail(app)
    result = await run_cycle(app.state.session_factory, settings, worker_id="test")
    assert result.failed_steps == []
    assert (result.reminders_enqueued, result.parent_reminders_enqueued) == (1, 1)
    # 沒有寄信管道：家長提醒照排、寄送時 skipped（不報錯、不重試）。
    [row] = await _queued(db_session)
    assert await _status(db_session, row.id) == "skipped"
    again = await run_cycle(app.state.session_factory, settings, worker_id="test")
    assert again.parent_reminders_enqueued == 0


async def test_maintenance_cycle_mails_the_parent_reminder_and_the_staff_reminder(
    app, admin_client, public_client, db_session, recording_mail_adapter, monkeypatch
):
    monkeypatch.setattr(maintenance, "get_email_adapter", lambda *_args: recording_mail_adapter)
    await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    result = await run_cycle(app.state.session_factory, app.state.settings, worker_id="test")
    assert result.failed_steps == []
    assert (result.reminders_enqueued, result.parent_reminders_enqueued) == (1, 1)
    assert result.notifications_failed == 0
    [mail] = _reminder_mails(recording_mail_adapter)
    assert mail["to"] == PARENT_EMAIL
    assert mail["subject"].startswith("【常春藤義華】參觀提醒：")
    # 同一輪裡員工的即將參觀提醒也寄出。
    assert "[常春藤官網] 義華校｜即將參觀（24 小時內）" in [sent["subject"] for sent in recording_mail_adapter.sent]
    [row] = await _queued(db_session)
    assert await _status(db_session, row.id) == "sent"


async def test_parent_reminder_failure_keeps_the_staff_reminder(app, admin_client, public_client, db_session, monkeypatch):
    async def _broken(*_args, **_kwargs):
        raise RuntimeError("模擬家長提醒排入失敗")

    monkeypatch.setattr(reminders, "enqueue_due_parent_reminders", _broken)
    await _visit_starting_in(admin_client, public_client, db_session, hours=23)
    result = await run_cycle(app.state.session_factory, _settings_without_mail(app), worker_id="test")
    # 只把「提醒」步驟記成失敗（不新增步驟名）；員工提醒已先寫入、計數照實。
    assert result.failed_steps == ["reminders"]
    assert (result.reminders_enqueued, result.parent_reminders_enqueued) == (1, 0)
    kinds = set((await db_session.execute(select(NotificationInboxItem.kind))).scalars())
    assert reminders.UPCOMING_VISIT_KIND in kinds
    assert await _queued(db_session) == []


async def test_cli_reports_how_many_parent_reminders_were_queued(
    app, admin_client, public_client, db_session, monkeypatch, capsys
):
    async def _factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "get_settings", lambda: _settings_without_mail(app))
    monkeypatch.setattr(cli, "_session_factory", _factory)
    await _visit_starting_in(admin_client, public_client, db_session, hours=23)

    await cli.process_notifications_once()
    assert "已排 1 封家長參觀提醒信。" in capsys.readouterr().out

    await cli.process_notifications_once()
    assert "家長參觀提醒信" not in capsys.readouterr().out
