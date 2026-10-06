"""寄送失敗通知的查詢與重新寄送（規格 L271、L331），以及定期工作產生的提醒：
即將參觀、逾期未處理（規格 L268、L272）。

LINE 用 httpx.MockTransport 模擬，不連真的 LINE；寄信用記錄型 adapter。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, update

from app.booking.models import OutboxMessage, OutboxStatus, VisitRequest, VisitRequestEvent, VisitSlot
from app.common.timezones import slot_start_utc
from app.notifications import outbox_admin, reminders
from app.notifications.line import LineMessagingClient
from app.notifications.models import LineCampusTarget, LineGroup, NotificationInboxItem
from app.notifications.service import notification_label
from app.operations.models import AuditLogEntry
from app.workers import lease_service
from app.workers.maintenance import run_cycle
from app.workers.runner import process_outbox_batch
from tests.test_line_notifications import GROUP, TOKEN, FakeLine
from tests.conftest import book_slot, create_slot, legacy_request

pytestmark = pytest.mark.usefixtures("booking_consent")

OUTBOX = "/api/website/v1/admin/notification-outbox"


async def _route_line_to_group(db_session, campus_key: str = "yihua") -> None:
    now = datetime.now(timezone.utc)
    db_session.add(LineGroup(target_id=GROUP, source_type="group", name="義華校務群", first_seen_at=now, last_seen_at=now))
    await db_session.flush()
    db_session.add(LineCampusTarget(campus_key=campus_key, target_id=GROUP, updated_at=now))
    await db_session.commit()


async def _fail_until_given_up(db_session, message_id, adapter, line) -> OutboxMessage:
    """讓這筆通知一直寄失敗，直到達重試上限變成 failed。"""
    for _ in range(lease_service.MAX_ATTEMPTS):
        await db_session.execute(
            update(OutboxMessage)
            .where(OutboxMessage.id == message_id)
            .values(next_attempt_at=datetime.now(timezone.utc) - timedelta(seconds=1))
        )
        await db_session.commit()
        await process_outbox_batch(db_session, adapter, limit=5, line=line)
    message = await db_session.get(OutboxMessage, message_id)
    await db_session.refresh(message)
    return message


async def _book_created_only(admin_client, public_client, db_session, **fields) -> uuid.UUID:
    """book_slot 後只留園方「新的參觀預約」那一筆待處理：家長確認信
    標成已寄出，讓失敗、重送的計數只看這一筆。回傳它的 outbox id。"""
    await book_slot(admin_client, public_client, **fields)
    await db_session.execute(
        update(OutboxMessage)
        .where(OutboxMessage.kind != "visit_request_created")
        .values(status=OutboxStatus.SENT.value)
    )
    await db_session.commit()
    return (
        await db_session.execute(select(OutboxMessage.id).where(OutboxMessage.kind == "visit_request_created"))
    ).scalar_one()


async def _inbox_count(db_session) -> int:
    return (await db_session.execute(select(func.count()).select_from(NotificationInboxItem))).scalar_one()


# --- 寄送失敗與重新寄送 ------------------------------------------------------


async def test_failed_notification_listed_and_retry_only_resends_missing_channels(
    admin_client, minghua_client, public_client, db_session, failing_mail_adapter, recording_mail_adapter
):
    await _route_line_to_group(db_session)
    message_id = await _book_created_only(admin_client, public_client, db_session)
    fake = FakeLine()
    line = LineMessagingClient(TOKEN, transport=fake.transport())
    try:
        message = await _fail_until_given_up(db_session, message_id, failing_mail_adapter, line)
        assert message.status == OutboxStatus.FAILED.value
        # 站內通知與 LINE 第一次就送到了，只有寄信一直失敗。
        assert await _inbox_count(db_session) == 1
        assert len(fake.pushes) == 1

        listed = await admin_client.get(OUTBOX)
        assert listed.status_code == 200, listed.text
        assert listed.json()["total"] == 1
        [item] = listed.json()["items"]
        assert item["id"] == str(message_id)
        assert item["campus_key"] == "yihua"
        assert item["kind"] == "visit_request_created"
        assert item["attempts"] == lease_service.MAX_ATTEMPTS
        assert item["error_code"] == "RuntimeError"
        assert item["delivered"] == {"inbox": True, "line": True, "email": 0}
        assert item["parent_name"] == "陳媽媽"

        # 別校帳號看不到、也重送不了（404，不洩漏存在）。
        assert (await minghua_client.get(OUTBOX)).json() == {"items": [], "total": 0}
        assert (await minghua_client.get(f"{OUTBOX}?campus_key=yihua")).status_code == 404
        assert (await minghua_client.post(f"{OUTBOX}/{message_id}/retry")).status_code == 404

        retried = await admin_client.post(f"{OUTBOX}/{message_id}/retry")
        assert retried.status_code == 200, retried.text
        body = retried.json()
        assert body["status"] == OutboxStatus.PENDING.value
        assert body["attempts"] == 0
        assert body["error_code"] is None
        assert body["requeued_at"] is not None
        assert (await admin_client.get(OUTBOX)).json() == {"items": [], "total": 0}

        again = await admin_client.post(f"{OUTBOX}/{message_id}/retry")
        assert again.status_code == 409
        assert again.json()["detail"]["code"] == "INVALID_TRANSITION"

        audit = (
            await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "notification_outbox.retry"))
        ).scalar_one()
        assert audit.target_type == "notification_outbox"
        assert audit.campus_key == "yihua"
        assert audit.metadata_json["previous_attempts"] == lease_service.MAX_ATTEMPTS
        assert audit.metadata_json["previous_error_code"] == "RuntimeError"
        assert audit.metadata_json["source"] == "admin"

        # 通知本身已經是三天前的：人工重送要照寄，不能被「太舊不再寄信」擋掉。
        await db_session.execute(
            update(OutboxMessage)
            .where(OutboxMessage.id == message_id)
            .values(created_at=datetime.now(timezone.utc) - timedelta(days=3))
        )
        await db_session.commit()
        result = await process_outbox_batch(db_session, recording_mail_adapter, limit=5, line=line)
        assert result["sent"] == 1
    finally:
        await line.aclose()

    assert [mail["to"] for mail in recording_mail_adapter.sent] == ["admin@ivy.example"]
    # 重送只補寄信：站內通知不多一則、LINE 群組不再推一次。
    assert await _inbox_count(db_session) == 1
    assert len(fake.pushes) == 1
    await db_session.refresh(message)
    assert message.status == OutboxStatus.SENT.value


async def test_batch_retry_skips_other_campus_and_non_failed(
    admin_client, minghua_client, editor_client, public_client, db_session, failing_mail_adapter
):
    message_id = await _book_created_only(admin_client, public_client, db_session)
    await _fail_until_given_up(db_session, message_id, failing_mail_adapter, None)
    ids = [str(message_id), str(uuid.uuid4())]

    # 內容編輯不能處理案件。
    assert (await editor_client.post(f"{OUTBOX}/retry", json={"ids": ids})).status_code == 403
    assert (await editor_client.get(OUTBOX)).status_code == 403

    other = await minghua_client.post(f"{OUTBOX}/retry", json={"ids": ids})
    assert other.status_code == 200, other.text
    assert other.json() == {"requeued": 0, "skipped": 2}

    mine = await admin_client.post(f"{OUTBOX}/retry", json={"ids": ids})
    assert mine.json() == {"requeued": 1, "skipped": 1}
    # 已經重新排入的再按一次：不是失敗狀態了，算略過。
    assert (await admin_client.post(f"{OUTBOX}/retry", json={"ids": ids[:1]})).json() == {"requeued": 0, "skipped": 1}
    assert (await admin_client.post(f"{OUTBOX}/retry", json={"ids": []})).status_code == 422


async def test_cli_requeue_respects_campus(admin_client, public_client, db_session, failing_mail_adapter):
    message_id = await _book_created_only(admin_client, public_client, db_session)
    await _fail_until_given_up(db_session, message_id, failing_mail_adapter, None)

    assert await outbox_admin.requeue_all_failed(db_session, {"minghua"}, actor_user_id=None, source="cli") == 0
    assert await outbox_admin.requeue_all_failed(db_session, None, actor_user_id=None, source="cli") == 1
    await db_session.commit()

    message = await db_session.get(OutboxMessage, message_id)
    await db_session.refresh(message)
    assert message.status == OutboxStatus.PENDING.value
    audit = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "notification_outbox.retry"))
    ).scalar_one()
    assert audit.actor_user_id is None
    assert audit.metadata_json["source"] == "cli"


async def test_dashboard_failed_count_matches_outbox_list(
    admin_client, public_client, db_session, failing_mail_adapter
):
    message_id = await _book_created_only(admin_client, public_client, db_session)
    await _fail_until_given_up(db_session, message_id, failing_mail_adapter, None)

    summary = (await admin_client.get("/api/website/v1/admin/dashboard")).json()
    assert summary["failed_notifications"] == (await admin_client.get(OUTBOX)).json()["total"] == 1


async def test_outbox_list_reports_total_beyond_limit(admin_client, public_client, db_session, monkeypatch):
    for index in range(3):
        await book_slot(
            admin_client, public_client, days_ahead=3 + index, capacity=2, phone=f"091234567{index}"
        )
    # 每筆預約有兩則通知（園方、家長）；只把園方「新的參觀預約」三則標成失敗。
    await db_session.execute(
        update(OutboxMessage)
        .where(OutboxMessage.kind == "visit_request_created")
        .values(status=OutboxStatus.FAILED.value, attempts=lease_service.MAX_ATTEMPTS)
    )
    await db_session.execute(
        update(OutboxMessage)
        .where(OutboxMessage.kind != "visit_request_created")
        .values(status=OutboxStatus.SENT.value)
    )
    await db_session.commit()
    monkeypatch.setattr(outbox_admin, "LIST_LIMIT", 2)

    # SMTP 掛很久時失敗數會超過列表上限：列表只給最新的幾則，total 仍是全部，
    # 和總覽的失敗數對得上，後台才能提示「另有幾則」。
    body = (await admin_client.get(OUTBOX)).json()
    assert len(body["items"]) == 2
    assert body["total"] == 3
    summary = (await admin_client.get("/api/website/v1/admin/dashboard")).json()
    assert summary["failed_notifications"] == 3


# --- 即將參觀 ---------------------------------------------------------------


async def _confirmed_visit(admin_client, public_client, days_ahead: int = 3) -> tuple[str, dict]:
    booked = await book_slot(admin_client, public_client, days_ahead=days_ahead)
    return booked["receipt_id"], {"id": booked["slot_id"]}


async def _slot_start(db_session, slot_id: str) -> datetime:
    slot = await db_session.get(VisitSlot, uuid.UUID(slot_id))
    return slot_start_utc(slot.slot_date, slot.start_time)


async def _reminders(db_session, kind: str) -> list[OutboxMessage]:
    result = await db_session.execute(
        select(OutboxMessage).where(OutboxMessage.kind == kind).order_by(OutboxMessage.created_at)
    )
    return list(result.scalars())


async def test_upcoming_visit_reminded_once_within_lead(
    admin_client, public_client, db_session, recording_mail_adapter
):
    receipt_id, slot = await _confirmed_visit(admin_client, public_client)
    starts = await _slot_start(db_session, slot["id"])

    # 還沒到提醒時間。
    assert await reminders.enqueue_due_reminders(db_session, now=starts - timedelta(hours=25)) == 0
    # 到了：只寫一次，重跑不重複。
    assert await reminders.enqueue_due_reminders(db_session, now=starts - timedelta(hours=23)) == 1
    assert await reminders.enqueue_due_reminders(db_session, now=starts - timedelta(hours=22)) == 0
    await db_session.commit()

    [reminder] = await _reminders(db_session, reminders.UPCOMING_VISIT_KIND)
    assert reminder.payload == {"campus_key": "yihua", "receipt_id": receipt_id, "slot_id": slot["id"]}

    result = await process_outbox_batch(db_session, recording_mail_adapter, limit=20)
    assert result["failed"] == 0
    subjects = [mail["subject"] for mail in recording_mail_adapter.sent]
    assert "[常春藤官網] 義華校｜即將參觀（24 小時內）" in subjects
    kinds = set((await db_session.execute(select(NotificationInboxItem.kind))).scalars())
    assert reminders.UPCOMING_VISIT_KIND in kinds


async def test_upcoming_reminder_reevaluated_after_reschedule(
    admin_client, public_client, db_session, recording_mail_adapter
):
    receipt_id, first_slot = await _confirmed_visit(admin_client, public_client)
    first_start = await _slot_start(db_session, first_slot["id"])
    assert await reminders.enqueue_due_reminders(db_session, now=first_start - timedelta(hours=23)) == 1
    await db_session.commit()

    # 提醒還沒送出就改期：舊時段那則到寄送時不再成立，標成 skipped。
    second_slot = {"id": await create_slot(admin_client, capacity=2, days_ahead=5)}
    moved = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/reschedule", json={"new_slot_id": second_slot["id"]}
    )
    assert moved.status_code == 200, moved.text

    result = await process_outbox_batch(db_session, recording_mail_adapter, limit=20)
    assert result["skipped"] == 1
    [old] = await _reminders(db_session, reminders.UPCOMING_VISIT_KIND)
    await db_session.refresh(old)
    assert old.status == OutboxStatus.SKIPPED.value
    kinds = list((await db_session.execute(select(NotificationInboxItem.kind))).scalars())
    assert reminders.UPCOMING_VISIT_KIND not in kinds

    # 依新時段重新判斷：新時段到點時另外提醒一次。
    second_start = await _slot_start(db_session, second_slot["id"])
    assert await reminders.enqueue_due_reminders(db_session, now=second_start - timedelta(hours=23)) == 1
    await db_session.commit()
    latest = (await _reminders(db_session, reminders.UPCOMING_VISIT_KIND))[-1]
    assert latest.payload["slot_id"] == second_slot["id"]
    result = await process_outbox_batch(db_session, recording_mail_adapter, limit=20)
    assert result["sent"] >= 1
    kinds = list((await db_session.execute(select(NotificationInboxItem.kind))).scalars())
    assert kinds.count(reminders.UPCOMING_VISIT_KIND) == 1


async def test_visit_confirmed_inside_lead_is_not_reminded_again(admin_client, public_client, db_session):
    receipt_id, slot = await _confirmed_visit(admin_client, public_client)
    starts = await _slot_start(db_session, slot["id"])
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(receipt_id))
        .values(confirmed_at=starts - timedelta(hours=2))
    )
    await db_session.commit()
    # 參觀前 2 小時才確認：「已確認」那則就是提醒，不再多發一則。
    assert await reminders.enqueue_due_reminders(db_session, now=starts - timedelta(hours=1)) == 0


async def test_rescheduled_inside_lead_is_not_reminded_again(admin_client, public_client, db_session):
    receipt_id, _ = await _confirmed_visit(admin_client, public_client)
    second_slot = {"id": await create_slot(admin_client, capacity=2, days_ahead=5)}
    moved = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/reschedule", json={"new_slot_id": second_slot["id"]}
    )
    assert moved.status_code == 200, moved.text
    starts = await _slot_start(db_session, second_slot["id"])

    async def _rescheduled_at(when: datetime) -> None:
        await db_session.execute(
            update(VisitRequestEvent)
            .where(
                VisitRequestEvent.visit_request_id == uuid.UUID(receipt_id),
                VisitRequestEvent.event_type == "rescheduled",
            )
            .values(created_at=when)
        )
        await db_session.commit()

    # 很早就確認，參觀前 2 小時才改到這一場：「已改期」那則就是提醒，
    # confirmed_at 還是當初確認的時間，不能拿它判斷。
    await _rescheduled_at(starts - timedelta(hours=2))
    assert await reminders.enqueue_due_reminders(db_session, now=starts - timedelta(hours=1)) == 0
    # 提早兩天就改好的：到點照常提醒。
    await _rescheduled_at(starts - timedelta(hours=48))
    assert await reminders.enqueue_due_reminders(db_session, now=starts - timedelta(hours=1)) == 1


# --- 逾期未處理、占位到期提醒已刪除 -----------------------------------------------


async def _set_created_at(db_session, receipt_id: str, when: datetime) -> None:
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(receipt_id)).values(created_at=when)
    )
    await db_session.commit()


def test_only_the_upcoming_visit_reminder_remains():
    """「新案逾期未處理」「占位快到期」都隨舊流程刪除，提醒只剩即將參觀。"""
    assert reminders.REMINDER_KINDS == {reminders.UPCOMING_VISIT_KIND}
    for name in ("OVERDUE_KIND", "REASON_NEW_UNHANDLED", "REASON_HOLD_EXPIRING", "REASON_LABELS", "HOLD_EXPIRING_WITHIN"):
        assert not hasattr(reminders, name), name


async def test_old_unhandled_cases_are_no_longer_reported_overdue(admin_client, db_session):
    # 送出超過 24 小時、沒人聯絡的案件：不再有「逾期未處理」提醒（已確認的案件由即將參觀提醒負責）。
    confirmed = await legacy_request(db_session, status="confirmed")
    await _set_created_at(db_session, confirmed, datetime.now(timezone.utc) - timedelta(hours=30))
    # 上線前留下的舊狀態案件即使還在資料庫，也不會被拿來產生提醒（migration 會把它們清掉）。
    leftover = await legacy_request(db_session, status="new")
    await _set_created_at(db_session, leftover, datetime.now(timezone.utc) - timedelta(hours=30))

    assert await reminders.enqueue_due_reminders(db_session) == 0
    await db_session.commit()
    assert (await db_session.execute(select(func.count()).select_from(OutboxMessage))).scalar_one() == 0


async def test_maintenance_cycle_enqueues_and_sends_reminders(app, admin_client, db_session):
    from datetime import time

    from app.common.timezones import OPERATING_TZ

    slot_id = await create_slot(admin_client, capacity=2)
    receipt_id = await legacy_request(db_session, status="confirmed", slot_id=slot_id)
    # 早就確認的案件（確認時還沒進提醒範圍，到點才需要提醒）。
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(receipt_id))
        .values(confirmed_at=datetime.now(timezone.utc) - timedelta(days=5))
    )
    # 把場次挪到 23 小時後開始：落在「24 小時內」的提醒範圍。
    starts = (datetime.now(timezone.utc) + timedelta(hours=23)).astimezone(OPERATING_TZ)
    await db_session.execute(
        update(VisitSlot)
        .where(VisitSlot.id == uuid.UUID(slot_id))
        .values(slot_date=starts.date(), start_time=time(starts.hour, starts.minute), end_time=time(23, 59))
    )
    await db_session.commit()

    settings = app.state.settings.model_copy(update={"notification_email_sink_dir": None, "smtp_host": None})
    result = await run_cycle(app.state.session_factory, settings, worker_id="test")
    assert result.failed_steps == []
    assert result.reminders_enqueued == 1
    kinds = set((await db_session.execute(select(NotificationInboxItem.kind))).scalars())
    assert reminders.UPCOMING_VISIT_KIND in kinds

    again = await run_cycle(app.state.session_factory, settings, worker_id="test")
    assert again.reminders_enqueued == 0


def test_notification_labels_cover_reminder_kinds():
    assert notification_label("visit_upcoming") == "即將參觀（24 小時內）"
    # 逾期、占位到期通知已不會再產生，只留標題給資料庫裡的舊通知；不再依 reason 加細項。
    assert notification_label("visit_request_overdue", {"reason": "new_unhandled"}) == "案件逾期未處理"
    assert notification_label("visit_request_overdue", {"reason": "weird"}) == "案件逾期未處理"
    assert notification_label("visit_request_hold_expired") == notification_label("visit_request_hold_expired", {})
    assert notification_label("unknown_kind") == "unknown_kind"
