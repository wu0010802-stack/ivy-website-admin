"""新預約的手機推播（notifications/service.py 的 _dispatch_push，2026-11-05）。

員工訂閱用真的 API 建立；推播服務用 httpx.MockTransport；LINE 與 Email 用假的記錄器。
重點：只推給涵蓋該校且處理案件的人、內容不含個資、去重、舊訊息不外送、
推播的任何失敗都不影響站內通知、LINE、Email，也不讓整筆 outbox 重試。"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, update

from app.auth.models import Role, User
from app.booking.models import OutboxMessage, VisitRequest
from app.notifications import line as line_api
from app.notifications import service as notification_service
from app.notifications import web_push
from app.notifications.models import (
    LineCampusTarget, LineGroup, NotificationDelivery, NotificationInboxItem, PushSubscription,
)
from app.workers.maintenance import run_cycle
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot, parent_client
from tests.push_fixtures import (  # noqa: F401  （pytest fixture）
    admin, campus_admin, clients, editor, login, push_app, readonly, reception,
)
from tests.push_helpers import APPLE, FakePushService, new_device

SUBSCRIPTIONS = "/api/website/v1/admin/push/subscriptions"
WEEKDAYS = "一二三四五六日"


class FakeLine:
    def __init__(self, fail: bool = False) -> None:
        self.pushes: list[str] = []
        self.fail = fail

    async def push_text(self, to: str, text: str, *, key) -> None:
        if self.fail:
            raise line_api.LinePushError("LINE_HTTP_500")
        self.pushes.append(text)


class Recorder:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, *, to: str, subject: str, body: str) -> None:
        self.sent.append({"to": to, "subject": subject, "body": body})


async def _subscribe(client, host: str | None = None):
    device = new_device(host) if host else new_device()
    response = await client.post(SUBSCRIPTIONS, json={"endpoint": device.endpoint, "keys": device.keys})
    assert response.status_code == 201, response.text
    return device


async def _book(push_app, admin, **kwargs) -> dict:
    public = parent_client(push_app)
    try:
        return await book_slot(admin, public, **kwargs)
    finally:
        await public.aclose()


async def _outbox(push_app, kind: str = "visit_request_created") -> OutboxMessage:
    async with push_app.state.session_factory() as db:
        rows = (await db.execute(select(OutboxMessage).where(OutboxMessage.kind == kind))).scalars().all()
    assert len(rows) == 1, [r.kind for r in rows]
    return rows[0]


async def _dispatch(push_app, message: OutboxMessage, *, push="on", adapter=None, line=None, created_at=None, kind=None, payload=None):
    sender = web_push.PushSender(push_app.state.settings, web_push.new_client(push_app.state.push_transport))
    try:
        async with push_app.state.session_factory() as db:
            return await notification_service.dispatch_outbox_message(
                db,
                outbox_message_id=message.id,
                campus_key=message.payload.get("campus_key", ""),
                kind=kind or message.kind,
                payload=payload if payload is not None else message.payload,
                adapter=adapter,
                created_at=created_at if created_at is not None else message.created_at,
                line=line,
                admin_origin="https://ivy.example",
                push=sender if push == "on" else None,
            )
    finally:
        await sender.client.aclose()


async def _deliveries(push_app, channel: str = "push") -> list[str]:
    async with push_app.state.session_factory() as db:
        rows = await db.execute(select(NotificationDelivery.recipient_key).where(NotificationDelivery.channel == channel))
        return sorted(rows.scalars())


async def _user_id(push_app, email: str) -> uuid.UUID:
    async with push_app.state.session_factory() as db:
        return (await db.execute(select(User.id).where(User.email == email))).scalar_one()


async def _link_line_group(push_app) -> None:
    """義華指到一個 LINE 群組，派送時才會走 LINE 這一段。"""
    now = datetime.now(timezone.utc)
    target = "C" + "a" * 32
    async with push_app.state.session_factory() as db:
        db.add(LineGroup(target_id=target, source_type="group", first_seen_at=now, last_seen_at=now, verified_at=now))
        await db.flush()
        db.add(LineCampusTarget(campus_key="yihua", target_id=target, updated_at=now))
        await db.commit()


def _expected_time(slot_date: str) -> str:
    day = date.fromisoformat(slot_date)
    return f"{day.month}/{day.day}（{WEEKDAYS[day.weekday()]}）10:00"


# ----------------------------------------------------------------------------- 收件人與內容


async def test_only_people_covering_the_campus_get_the_push(push_app, admin, campus_admin, reception, editor, readonly):
    devices = {
        "admin": await _subscribe(admin),
        "minghua": await _subscribe(campus_admin, APPLE),
        "reception": await _subscribe(reception),
    }
    booked = await _book(push_app, admin)  # 義華
    message = await _outbox(push_app)
    assert await _dispatch(push_app, message) is True
    service: FakePushService = push_app.state.fake_push

    expected = {
        "title": "新的參觀預約",
        "body": f"義華校｜{_expected_time(booked['slot_date'])}",
        "url": f"/admin/visit-requests/{booked['receipt_id']}",
        "tag": f"visit-{booked['receipt_id']}",
    }
    assert service.bodies_for(devices["admin"]) == [expected]  # 總管理者涵蓋全部校區
    assert service.bodies_for(devices["reception"]) == [expected]  # 義華接待
    assert service.bodies_for(devices["minghua"]) == []  # 明華管理者不涵蓋義華
    assert len(service.requests) == 2
    admin_id = await _user_id(push_app, "push-admin@ivy.example")
    desk_id = await _user_id(push_app, "push-desk@ivy.example")
    assert await _deliveries(push_app) == sorted([f"user:{admin_id}", f"user:{desk_id}"])


async def test_a_campus_admin_gets_pushes_for_their_own_campus(push_app, admin, campus_admin):
    device = await _subscribe(campus_admin)
    await _book(push_app, admin, campus_key="minghua")
    await _dispatch(push_app, await _outbox(push_app))
    [payload] = push_app.state.fake_push.bodies_for(device)
    assert payload["body"].startswith("明華校｜")


async def test_people_without_booking_handle_never_get_pushes(push_app, admin, editor):
    """編輯與唯讀不能訂閱；就算資料庫裡有他們的訂閱（例如角色後來被改掉），也不是收件人。"""
    sneaky = new_device()
    async with push_app.state.session_factory() as db:
        user_id = (await db.execute(select(User.id).where(User.email == "push-editor@ivy.example"))).scalar_one()
        db.add(sneaky.subscription(user_id=user_id))
        await db.commit()
    await _book(push_app, admin)
    await _dispatch(push_app, await _outbox(push_app))
    assert push_app.state.fake_push.requests == []


async def test_deactivated_people_are_skipped(push_app, admin, reception):
    await _subscribe(reception)
    async with push_app.state.session_factory() as db:
        await db.execute(update(User).where(User.email == "push-desk@ivy.example").values(is_active=False))
        await db.commit()
    await _book(push_app, admin)
    await _dispatch(push_app, await _outbox(push_app))
    assert push_app.state.fake_push.requests == []


async def test_push_content_has_no_parent_personal_data(push_app, admin):
    device = await _subscribe(admin)
    await _book(push_app, admin, parent_name="王小明的媽媽", phone="0987654321", email="secret-parent@example.com")
    await _dispatch(push_app, await _outbox(push_app))
    [payload] = push_app.state.fake_push.bodies_for(device)
    text = str(payload)
    for private in ("王小明", "0987654321", "secret-parent", "example.com", "陳媽媽"):
        assert private not in text
    # 送出的位元組裡也沒有（加密前後都不含）。
    assert b"0987654321" not in push_app.state.fake_push.requests[0].content


async def test_body_is_only_the_campus_when_the_case_is_anonymized(push_app, admin):
    device = await _subscribe(admin)
    booked = await _book(push_app, admin)
    async with push_app.state.session_factory() as db:
        await db.execute(update(VisitRequest).values(anonymized_at=datetime.now(timezone.utc)))
        await db.commit()
    await _dispatch(push_app, await _outbox(push_app))
    [payload] = push_app.state.fake_push.bodies_for(device)
    assert payload["body"] == "義華校"
    assert payload["url"] == f"/admin/visit-requests/{booked['receipt_id']}"


async def test_unknown_receipt_ids_fall_back_to_the_list_and_never_reach_the_url(push_app, admin):
    device = await _subscribe(admin)
    await _book(push_app, admin)
    message = await _outbox(push_app)
    for bad in ("../../etc/passwd", "javascript:alert(1)", str(uuid.uuid4()), "", None):
        push_app.state.fake_push.requests.clear()
        async with push_app.state.session_factory() as db:
            await db.execute(NotificationDelivery.__table__.delete())
            await db.commit()
        await _dispatch(push_app, message, payload={**message.payload, "receipt_id": bad})
        [payload] = push_app.state.fake_push.bodies_for(device)
        assert payload["body"] == "義華校"
        assert payload["url"] == "/admin/visit-requests" and "etc" not in payload["url"] and "javascript" not in payload["url"]
        assert payload["tag"] == "visit_request_created-yihua"


# ----------------------------------------------------------------------------- 去重、重試、舊訊息


async def test_redispatching_the_same_message_does_not_push_again(push_app, admin, reception):
    await _subscribe(admin)
    await _subscribe(reception)
    await _book(push_app, admin)
    message = await _outbox(push_app)
    await _dispatch(push_app, message)
    await _dispatch(push_app, message)
    await _dispatch(push_app, message)
    assert len(push_app.state.fake_push.requests) == 2  # 兩個人各一次
    assert len(await _deliveries(push_app)) == 2


async def test_a_failed_push_is_retried_but_a_delivered_one_is_not(push_app, admin, reception):
    ok_device = await _subscribe(admin)
    bad_device = await _subscribe(reception)
    await _book(push_app, admin)
    message = await _outbox(push_app)
    service: FakePushService = push_app.state.fake_push
    service.statuses[bad_device.endpoint] = 503
    assert await _dispatch(push_app, message) is True  # 推播失敗不讓這筆算失敗
    assert len(await _deliveries(push_app)) == 1  # 只記成功的那位
    service.statuses.clear()
    await _dispatch(push_app, message)  # 重試
    assert len(service.bodies_for(ok_device)) == 1  # 成功過的不重推
    assert len(service.bodies_for(bad_device)) == 2  # 失敗過的補推
    assert len(await _deliveries(push_app)) == 2


async def test_messages_older_than_24_hours_write_inbox_but_push_nothing(push_app, admin):
    await _subscribe(admin)
    await _book(push_app, admin)
    message = await _outbox(push_app)
    adapter = Recorder()
    old = datetime.now(timezone.utc) - timedelta(hours=25)
    assert await _dispatch(push_app, message, created_at=old, adapter=adapter) is True
    assert push_app.state.fake_push.requests == [] and adapter.sent == []
    async with push_app.state.session_factory() as db:
        assert (await db.execute(select(NotificationInboxItem))).scalars().first() is not None
    # 剛好在 24 小時內的照推。
    assert await _dispatch(push_app, message, created_at=datetime.now(timezone.utc) - timedelta(hours=23)) is True
    assert len(push_app.state.fake_push.requests) == 1


async def test_only_listed_kinds_are_pushed(push_app, admin):
    await _subscribe(admin)
    await _book(push_app, admin)
    message = await _outbox(push_app)
    assert notification_service.PUSH_KINDS == {"visit_request_created"}
    for kind in ("visit_request_confirmed", "visit_request_cancelled", "visit_request_rescheduled", "upcoming_visit", "visit_request_overdue"):
        await _dispatch(push_app, message, kind=kind)
    assert push_app.state.fake_push.requests == []
    # 家長信不推給員工手機。
    for kind in ("parent_visit_booked", "parent_visit_changed", "parent_visit_reminder"):
        await _dispatch(push_app, message, kind=kind)
    assert push_app.state.fake_push.requests == []


async def test_no_push_when_the_sender_is_missing_or_keys_are_not_configured(push_app, admin):
    await _subscribe(admin)
    await _book(push_app, admin)
    message = await _outbox(push_app)
    assert await _dispatch(push_app, message, push="off") is True
    sender = web_push.PushSender(push_app.state.settings.model_copy(update={"vapid_public_key": None, "vapid_private_key": None}), web_push.new_client(push_app.state.push_transport))
    try:
        async with push_app.state.session_factory() as db:
            assert await notification_service.dispatch_outbox_message(
                db, outbox_message_id=message.id, campus_key="yihua", kind=message.kind, payload=message.payload,
                adapter=None, created_at=message.created_at, push=sender,
            ) is True
    finally:
        await sender.client.aclose()
    assert push_app.state.fake_push.requests == []


async def test_nobody_subscribed_means_no_requests_and_no_records(push_app, admin):
    await _book(push_app, admin)
    await _dispatch(push_app, await _outbox(push_app))
    assert push_app.state.fake_push.requests == [] and await _deliveries(push_app) == []


# ----------------------------------------------------------------------------- 失敗不外溢


async def test_push_failure_never_blocks_inbox_line_or_email(push_app, admin, reception):
    await _subscribe(admin)
    await _subscribe(reception)
    await _link_line_group(push_app)
    await _book(push_app, admin)
    message = await _outbox(push_app)
    push_app.state.fake_push.default_status = 500
    adapter, line = Recorder(), FakeLine()
    assert await _dispatch(push_app, message, adapter=adapter, line=line) is True  # 不丟例外、回傳成功
    assert len(line.pushes) == 1 and "新的參觀預約" in line.pushes[0]
    assert sorted(mail["to"] for mail in adapter.sent) == ["push-admin@ivy.example", "push-desk@ivy.example"]
    async with push_app.state.session_factory() as db:
        assert (await db.execute(select(NotificationInboxItem))).scalars().first() is not None
    assert await _deliveries(push_app, "line") != [] and len(await _deliveries(push_app, "email")) == 2


async def test_unexpected_push_exceptions_are_swallowed_and_logged(push_app, admin, reception, monkeypatch, caplog):
    await _subscribe(admin)
    await _link_line_group(push_app)
    await _book(push_app, admin)
    message = await _outbox(push_app)

    async def boom(*args, **kwargs):
        raise RuntimeError("push exploded: https://fcm.googleapis.com/secret-endpoint")

    monkeypatch.setattr(web_push, "send_all", boom)
    adapter, line = Recorder(), FakeLine()
    caplog.set_level(logging.WARNING)
    assert await _dispatch(push_app, message, adapter=adapter, line=line) is True
    assert line.pushes and adapter.sent
    warning = next(r for r in caplog.records if "手機推播失敗" in r.getMessage())
    assert "RuntimeError" in warning.getMessage() and "secret-endpoint" not in warning.getMessage()  # 只記例外類型


async def test_a_push_database_error_does_not_break_the_following_channels(push_app, admin, monkeypatch):
    """推播區段寫庫時出錯（例如撞到 delivery 的唯一限制）：savepoint 擋下，後面的 Email 與 LINE 照常。"""
    await _subscribe(admin)
    await _link_line_group(push_app)
    await _book(push_app, admin)
    message = await _outbox(push_app)
    original = notification_service._record_delivery

    def duplicate_then_normal(db, outbox_message_id, channel, recipient_key):
        original(db, outbox_message_id, channel, recipient_key)
        if channel == "push":
            original(db, outbox_message_id, channel, recipient_key)  # 同一筆寫兩次：flush 會撞唯一限制

    monkeypatch.setattr(notification_service, "_record_delivery", duplicate_then_normal)
    adapter, line = Recorder(), FakeLine()
    assert await _dispatch(push_app, message, adapter=adapter, line=line) is True
    assert line.pushes and adapter.sent
    assert await _deliveries(push_app, "push") == []  # 沒記到，下次重試會再推


async def test_line_failure_retry_does_not_repeat_the_push(push_app, admin):
    device = await _subscribe(admin)
    await _link_line_group(push_app)
    await _book(push_app, admin)
    message = await _outbox(push_app)
    with pytest.raises(line_api.LinePushError):
        await _dispatch(push_app, message, line=FakeLine(fail=True))
    await _dispatch(push_app, message, line=FakeLine())  # outbox 重試
    assert len(push_app.state.fake_push.bodies_for(device)) == 1


async def test_dead_subscriptions_are_cleaned_up_during_dispatch(push_app, admin):
    device = await _subscribe(admin)
    await _book(push_app, admin)
    push_app.state.fake_push.statuses[device.endpoint] = 410
    await _dispatch(push_app, await _outbox(push_app))
    async with push_app.state.session_factory() as db:
        assert (await db.execute(select(PushSubscription))).scalars().first() is None
    assert await _deliveries(push_app) == []


# ----------------------------------------------------------------------------- 接上定期工作與 runner


async def test_the_outbox_runner_and_the_maintenance_cycle_push_end_to_end(push_app, admin, reception):
    admin_device = await _subscribe(admin)
    await _subscribe(reception)
    booked = await _book(push_app, admin)
    result = await run_cycle(
        push_app.state.session_factory, push_app.state.settings, worker_id="push-test",
        push_transport=push_app.state.push_transport,
    )
    assert result.ran and result.notifications_failed == 0 and result.notifications_sent >= 1
    [payload] = push_app.state.fake_push.bodies_for(admin_device)
    assert payload["url"] == f"/admin/visit-requests/{booked['receipt_id']}"
    assert len(push_app.state.fake_push.requests) == 2
    # 再跑一輪不會重推。
    await run_cycle(push_app.state.session_factory, push_app.state.settings, worker_id="push-test-2", push_transport=push_app.state.push_transport)
    assert len(push_app.state.fake_push.requests) == 2


async def test_process_outbox_batch_passes_the_sender_through(push_app, admin):
    device = await _subscribe(admin)
    await _book(push_app, admin)
    sender = web_push.PushSender(push_app.state.settings, web_push.new_client(push_app.state.push_transport))
    try:
        async with push_app.state.session_factory() as db:
            result = await process_outbox_batch(db, None, limit=50, push=sender)
    finally:
        await sender.client.aclose()
    assert result["failed"] == 0 and result["sent"] >= 1
    assert len(push_app.state.fake_push.bodies_for(device)) == 1


async def test_cycle_without_vapid_keys_builds_no_sender(app, admin_client, public_client):
    """預設設定（沒有金鑰）：定期工作照常，完全不碰推播。"""
    await book_slot(admin_client, public_client)
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(201)

    result = await run_cycle(
        app.state.session_factory, app.state.settings, worker_id="no-keys", push_transport=httpx.MockTransport(handler)
    )
    assert result.ran and result.notifications_failed == 0
    assert requests == []


async def test_a_failing_status_write_inside_push_does_not_poison_the_session(push_app, admin, monkeypatch):
    """推播結果寫回訂閱列時資料庫出錯（這裡用 1/0 模擬）：savepoint 擋下，同一個 session 上後面的 Email 與
    LINE 照常、不丟例外、不讓 outbox 重試。"""
    from sqlalchemy import text

    await _subscribe(admin)
    await _link_line_group(push_app)
    await _book(push_app, admin)
    message = await _outbox(push_app)

    async def broken_apply(db, subscriptions, results):
        await db.execute(text("SELECT 1/0"))

    monkeypatch.setattr(web_push, "apply_results", broken_apply)
    adapter, line = Recorder(), FakeLine()
    assert await _dispatch(push_app, message, adapter=adapter, line=line) is True
    assert line.pushes and adapter.sent
    assert await _deliveries(push_app, "push") == []
