"""LINE 通知型訊息（用電話號碼送，2026-11-25，docs/specs/2026-11-25-line-notification-messages-research.md）。

沒留 Email、也沒綁 LINE 的家長，這校開了通知型訊息就用範本型 API 送；有 Email 的只收信。
LINE API 全部用 httpx.MockTransport 模擬，不連真的 LINE、不發真的訊息。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from datetime import date, datetime, time, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select

from app.booking.models import OutboxMessage
from app.booking.outbox import (
    PARENT_VISIT_BOOKED,
    PARENT_VISIT_CANCELLED,
    PARENT_VISIT_CHANGED,
    PARENT_VISIT_DAY_CLOSED,
    PARENT_VISIT_REMINDER,
)
from app.config import Settings
from app.notifications import line as line_api
from app.notifications import line_pnp
from app.notifications.line_parent import LineClients
from app.notifications.models import LinePnpMessage, NotificationDelivery
from app.notifications.parent_email import ParentEmail
from app.workers.runner import process_outbox_batch
from tests.conftest import _test_settings, book_slot, open_manage

pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
ORIGIN = "https://www.ivy.example"
HQ_SECRET, HQ_TOKEN = "hq-secret-for-tests", "hq-token-for-tests"
YIHUA_SECRET, YIHUA_TOKEN = "yihua-secret-for-tests", "yihua-token-for-tests"
PHONE = "0912345678"
PHONE_HASH = hashlib.sha256(b"+886912345678").hexdigest()
PARENT = "U" + "1" * 32


class FakeLine:
    """hq 與義華兩個帳號：通知型訊息、一般推播、回覆、帳號資訊、額度、profile。"""

    def __init__(self) -> None:
        self.pnp: list[dict] = []
        self.pushes: list[dict] = []
        self.replies: list[dict] = []
        # 下一次通知型訊息的結果：HTTP 狀態碼，或要丟的 httpx 例外。
        self.pnp_results: list[int | Exception] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        token = request.headers["authorization"].removeprefix("Bearer ")
        assert token in (HQ_TOKEN, YIHUA_TOKEN)
        account = "hq" if token == HQ_TOKEN else "yihua"
        path = request.url.path
        if path == "/v2/bot/message/pnp/templated/push":
            result = self.pnp_results.pop(0) if self.pnp_results else 202
            if isinstance(result, Exception):
                raise result
            if result in (200, 202):
                self.pnp.append(
                    {"account": account, "body": json.loads(request.content), "tag": request.headers.get("x-line-delivery-tag")}
                )
                return httpx.Response(result, json={})
            return httpx.Response(result, json={"message": "Failed to send messages"})
        if path == "/v2/bot/message/push":
            self.pushes.append({"account": account, "body": json.loads(request.content)})
            return httpx.Response(200, json={})
        if path == "/v2/bot/message/reply":
            self.replies.append({"account": account, "body": json.loads(request.content)})
            return httpx.Response(200, json={})
        if path == "/v2/bot/info":
            return httpx.Response(200, json={"basicId": f"@ivy-{account}", "displayName": f"常春藤{account}"})
        if path == "/v2/bot/message/quota":
            return httpx.Response(200, json={"type": "none"})
        if path == "/v2/bot/message/quota/consumption":
            return httpx.Response(200, json={"totalUsage": 0})
        if path.startswith("/v2/bot/profile/"):
            return httpx.Response(200, json={"userId": path.rsplit("/", 1)[1]})
        return httpx.Response(404, json={})

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


@pytest.fixture
def fake_line(app) -> FakeLine:
    fake = FakeLine()
    settings = app.state.settings
    settings.line_hq_channel_secret = HQ_SECRET
    settings.line_hq_access_token = HQ_TOKEN
    settings.line_yihua_channel_secret = YIHUA_SECRET
    settings.line_yihua_access_token = YIHUA_TOKEN
    settings.line_pnp_accounts = "hq"
    settings.admin_origin = "https://admin.ivy.example"
    settings.public_origin = ORIGIN
    app.state.line_transport = fake.transport()
    return fake


async def _enable(admin_client, campus: str = "yihua", account: str | None = "hq", pnp: bool = True) -> httpx.Response:
    return await admin_client.put(
        f"{API}/admin/line/parent-accounts/{campus}", json={"account_key": account, "pnp_enabled": pnp}
    )


async def _run_outbox(app, db_session, adapter=None) -> dict:
    async with LineClients(app.state.settings, transport=app.state.line_transport) as clients:
        return await process_outbox_batch(
            db_session, adapter, limit=50, admin_origin=app.state.settings.admin_origin, public_origin=ORIGIN,
            access_secret=app.state.settings.session_secret, line_clients=clients,
        )


async def _retry_now(db_session) -> None:
    await db_session.execute(OutboxMessage.__table__.update().values(next_attempt_at=OutboxMessage.created_at))
    await db_session.commit()


def _sign(secret: str, body: bytes) -> str:
    return base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()


async def _webhook(app, events: list[dict], *, account: str = "hq", secret: str = HQ_SECRET) -> httpx.Response:
    body = json.dumps({"destination": "U" + "0" * 32, "events": events}).encode()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post(
            f"{API}/line/webhook/{account}",
            content=body,
            headers={"content-type": "application/json", "x-line-signature": _sign(secret, body)},
        )


def _delivery(data: str) -> dict:
    return {
        "type": "delivery",
        "delivery": {"data": data},
        "webhookEventId": uuid.uuid4().hex,
        "deliveryContext": {"isRedelivery": False},
        "timestamp": 0,
        "mode": "active",
    }


def _mail(kind: str = PARENT_VISIT_BOOKED, **overrides) -> ParentEmail:
    fields = dict(
        kind=kind,
        campus_name="義華校",
        salutation="陳媽媽",
        slot_date=date(2026, 12, 3),
        start_time=time(9, 30),
        end_time=time(10, 30),
        party_size=2,
        campus_address="高雄市三民區某某路 1 號",
        campus_phone="07-1234567",
        manage_url=f"{ORIGIN}/visit/manage?token=abc",
        change_deadline=datetime(2026, 12, 2, 1, 30, tzinfo=timezone.utc),
        cancel_reason=None,
        rebook_url=f"{ORIGIN}/visit/yihua",
    )
    fields.update(overrides)
    return ParentEmail(**fields)


# --- 純函式 ------------------------------------------------------------------------------------------


def test_phone_hash_is_sha256_of_e164():
    assert line_api.tw_mobile_e164(PHONE) == "+886912345678"
    assert line_api.pnp_phone_hash(PHONE) == PHONE_HASH
    # LINE 文件的範例（+818000001234）用同一個算法算得出文件寫的值。
    assert hashlib.sha256(b"+818000001234").hexdigest() == (
        "d41e0ad70dddfeb68f149ad6fc61574b9c5780ab7bcb2fba5517771ffbb2409c"
    )
    for bad in (None, "", "0212345678", "+886912345678", "09123456789", "0912-345-678"):
        assert line_api.pnp_phone_hash(bad) is None


def test_delivery_tag_round_trips_and_ignores_others():
    outbox_id = uuid.uuid4()
    tag = line_api.pnp_delivery_tag(outbox_id)
    assert 16 <= len(tag) <= 100
    assert line_api.parse_pnp_delivery_tag(tag) == outbox_id
    for other in (None, 5, PHONE_HASH, "menu01", tag.upper()):
        assert line_api.parse_pnp_delivery_tag(other) is None


def test_templates_follow_the_notice_kind():
    assert line_pnp.template_for(_mail(PARENT_VISIT_BOOKED)) == "reservation_completed_zh"
    assert line_pnp.template_for(_mail(PARENT_VISIT_CHANGED)) == "reservation_completed_zh"
    assert line_pnp.template_for(_mail(PARENT_VISIT_CANCELLED)) == "reservation_cancellation_zh"
    assert line_pnp.template_for(_mail(PARENT_VISIT_REMINDER)) == "reservation_reminder_zh"
    # 停課沒有合適範本（取消範本會說預約已取消）。
    assert line_pnp.template_for(_mail(PARENT_VISIT_DAY_CLOSED)) is None
    assert line_pnp.template_for(_mail(PARENT_VISIT_BOOKED, day_closed=True)) is None
    assert line_pnp.template_for(_mail(PARENT_VISIT_REMINDER, day_closed=True)) is None


def test_template_body_fits_line_limits():
    body = line_pnp.template_body(_mail(campus_address="地" * 400))
    assert body["emphasizedItem"] == {"itemKey": "reservation_date_time_zh", "content": "12/03（四）09:30"}
    assert len(body["emphasizedItem"]["content"]) <= 15
    keys = [item["itemKey"] for item in body["items"]]
    assert keys == ["reservation_detail_zh", "reservation_count_zh", "contact_phone_zh"]
    assert all(len(item["content"]) <= 300 for item in body["items"])
    assert body["items"][1]["content"] == "2 位"
    assert body["buttons"] == [{"buttonKey": "check_details_zh", "url": f"{ORIGIN}/visit/manage?token=abc"}]
    # 不放家長稱呼。
    assert "陳媽媽" not in json.dumps(body, ensure_ascii=False)


def test_template_body_detail_text():
    detail = line_pnp.template_body(_mail())["items"][0]["content"]
    assert detail.startswith("常春藤義華校 校園參觀（09:30–10:30）；地址：高雄市三民區某某路 1 號；")
    assert "前可按「查看詳情」改期或取消" in detail
    # 過了修改期限：沒有按鈕，請家長來電。
    late = line_pnp.template_body(_mail(manage_url=None))
    assert "buttons" not in late
    assert late["items"][0]["content"].endswith("要改期或取消，請來電洽詢")
    # 取消：按鈕開重新預約頁，不寫地址、人數。
    cancelled = line_pnp.template_body(_mail(PARENT_VISIT_CANCELLED, manage_url=None))
    assert cancelled["buttons"] == [{"buttonKey": "check_details_zh", "url": f"{ORIGIN}/visit/yihua"}]
    assert [item["itemKey"] for item in cancelled["items"]] == ["reservation_detail_zh", "contact_phone_zh"]
    assert "地址" not in cancelled["items"][0]["content"]


# --- 設定 ------------------------------------------------------------------------------------------


def test_hq_account_needs_both_values_and_pnp_accounts_must_be_configured():
    base = _test_settings().model_dump()
    with pytest.raises(ValueError, match="WEBSITE_LINE_HQ"):
        Settings(**{**base, "line_hq_channel_secret": "s"})
    with pytest.raises(ValueError, match="還沒設定"):
        Settings(**{**base, "line_pnp_accounts": "hq"})
    with pytest.raises(ValueError, match="不認得"):
        Settings(**{**base, "line_hq_channel_secret": "s", "line_hq_access_token": "t", "line_pnp_accounts": "hq,nope"})
    settings = Settings(
        **{**base, "line_hq_channel_secret": "s", "line_hq_access_token": "t", "line_pnp_accounts": " HQ , "}
    )
    assert settings.line_pnp_account_keys == frozenset({"hq"})
    assert list(settings.line_accounts) == ["hq"]


async def test_admin_can_pick_hq_for_any_campus_and_turn_on_pnp(app, fake_line, admin_client, db_session):
    response = await _enable(admin_client, "minghua", "hq")
    assert response.status_code == 200, response.text
    data = response.json()
    accounts = {account["key"]: account for account in data["accounts"]}
    assert accounts["hq"]["pnp_available"] is True and accounts["yihua"]["pnp_available"] is False
    assert accounts["hq"]["webhook_url"] == "https://admin.ivy.example/api/website/v1/line/webhook/hq"
    campuses = {row["campus_key"]: row for row in data["parent_campuses"]}
    assert campuses["minghua"]["account_key"] == "hq" and campuses["minghua"]["pnp_enabled"] is True
    # 義華自己的帳號沒開通通知型訊息：不能打開。
    refused = await _enable(admin_client, "yihua", "yihua", pnp=True)
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "LINE_PNP_UNAVAILABLE"
    assert (await _enable(admin_client, "yihua", "yihua", pnp=False)).status_code == 200
    # 帳號拿掉開通（設定改了）：後台顯示關、也不會送。
    app.state.settings.line_pnp_accounts = None
    again = (await admin_client.get(f"{API}/admin/line")).json()
    assert {row["campus_key"]: row for row in again["parent_campuses"]}["minghua"]["pnp_enabled"] is False


async def test_public_booking_config_says_whether_pnp_is_on(app, fake_line, admin_client, public_client):
    before = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    assert before["line_pnp_enabled"] is False
    await _enable(admin_client)
    after = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    assert after["line_pnp_enabled"] is True


# --- 送出 ------------------------------------------------------------------------------------------


async def test_parent_without_email_gets_booking_notice_by_phone(app, fake_line, admin_client, public_client, db_session):
    await _enable(admin_client)
    booked = await book_slot(admin_client, public_client, email=None, phone=PHONE)
    result = await _run_outbox(app, db_session)
    assert result["failed"] == 0
    assert len(fake_line.pnp) == 1 and not fake_line.pushes
    sent = fake_line.pnp[0]
    assert sent["account"] == "hq"
    assert sent["body"]["to"] == PHONE_HASH
    assert sent["body"]["templateKey"] == "reservation_completed_zh"
    button = sent["body"]["body"]["buttons"][0]
    assert button["buttonKey"] == "check_details_zh"
    assert button["url"].startswith(f"{ORIGIN}/visit/manage") and "token=" in button["url"]
    message_id = await db_session.scalar(
        select(OutboxMessage.id).where(OutboxMessage.visit_request_id == uuid.UUID(booked["receipt_id"]))
        .where(OutboxMessage.kind == PARENT_VISIT_BOOKED)
    )
    assert sent["tag"] == message_id.hex
    row = await db_session.scalar(select(LinePnpMessage))
    assert row.accepted_at is not None and row.rejected_at is None and row.delivered_at is None
    assert str(row.visit_request_id) == booked["receipt_id"]
    deliveries = (await db_session.scalars(select(NotificationDelivery.recipient_key))).all()
    assert f"pnp:{booked['receipt_id']}" in deliveries
    # 不重送。
    await _retry_now(db_session)
    await _run_outbox(app, db_session)
    assert len(fake_line.pnp) == 1


async def test_parent_with_email_only_gets_email(app, fake_line, admin_client, public_client, db_session, recording_mail_adapter):
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"
    await _enable(admin_client)
    await book_slot(admin_client, public_client, email="parent@example.com", phone=PHONE)
    await _run_outbox(app, db_session, recording_mail_adapter)
    assert any(mail["to"] == "parent@example.com" for mail in recording_mail_adapter.sent)
    assert not fake_line.pnp
    assert await db_session.scalar(select(LinePnpMessage)) is None


async def test_campus_without_pnp_does_not_queue_or_send(app, fake_line, admin_client, public_client, db_session):
    await _enable(admin_client, pnp=False)
    await book_slot(admin_client, public_client, email=None, phone=PHONE)
    kinds = (await db_session.scalars(select(OutboxMessage.kind))).all()
    assert PARENT_VISIT_BOOKED not in kinds
    await _run_outbox(app, db_session)
    assert not fake_line.pnp


async def test_account_no_longer_approved_skips_queued_notice(app, fake_line, admin_client, public_client, db_session):
    await _enable(admin_client)
    await book_slot(admin_client, public_client, email=None, phone=PHONE)
    app.state.settings.line_pnp_accounts = None
    result = await _run_outbox(app, db_session)
    assert result["skipped"] >= 1 and result["failed"] == 0
    assert not fake_line.pnp


async def test_linked_parent_gets_the_card_not_pnp(app, fake_line, admin_client, public_client, db_session):
    # 義華用自己的帳號，這個帳號也開通了通知型訊息；家長已經綁 LINE → 照舊推卡片。
    app.state.settings.line_pnp_accounts = "hq,yihua"
    assert (await _enable(admin_client, "yihua", "yihua")).status_code == 200
    booked = await book_slot(admin_client, public_client, email=None, phone=PHONE)
    await open_manage(public_client, booked["manage_path"])
    issued = await public_client.post(f"{API}/public/visit-manage/line-notify/code")
    assert issued.status_code == 201, issued.text
    said = {
        "type": "message",
        "source": {"type": "user", "userId": PARENT},
        "replyToken": uuid.uuid4().hex,
        "timestamp": 0,
        "webhookEventId": uuid.uuid4().hex,
        "message": {"type": "text", "id": "m", "text": issued.json()["text"]},
    }
    assert (await _webhook(app, [said], account="yihua", secret=YIHUA_SECRET)).status_code == 200
    await _run_outbox(app, db_session)
    assert [push for push in fake_line.pushes if push["body"]["to"] == PARENT]
    assert not fake_line.pnp


async def test_rejected_phone_is_recorded_and_not_retried(app, fake_line, admin_client, public_client, db_session):
    await _enable(admin_client)
    await book_slot(admin_client, public_client, email=None, phone=PHONE)
    fake_line.pnp_results = [422]
    result = await _run_outbox(app, db_session)
    assert result["failed"] == 0
    row = await db_session.scalar(select(LinePnpMessage))
    assert row.rejected_at is not None and row.accepted_at is None
    await _retry_now(db_session)
    await _run_outbox(app, db_session)
    assert fake_line.pnp_results == [] and not fake_line.pnp


async def test_definite_failure_retries_once_sent(app, fake_line, admin_client, public_client, db_session):
    await _enable(admin_client)
    await book_slot(admin_client, public_client, email=None, phone=PHONE)
    fake_line.pnp_results = [500]
    first = await _run_outbox(app, db_session)
    assert first["failed"] == 1
    assert await db_session.scalar(select(LinePnpMessage)) is None
    await _retry_now(db_session)
    second = await _run_outbox(app, db_session)
    assert second["sent"] == 1
    assert len(fake_line.pnp) == 1


async def test_connect_error_retries(app, fake_line, admin_client, public_client, db_session):
    await _enable(admin_client)
    await book_slot(admin_client, public_client, email=None, phone=PHONE)
    fake_line.pnp_results = [httpx.ConnectError("down")]
    assert (await _run_outbox(app, db_session))["failed"] == 1
    await _retry_now(db_session)
    await _run_outbox(app, db_session)
    assert len(fake_line.pnp) == 1


async def test_timeout_after_sending_is_not_resent(app, fake_line, admin_client, public_client, db_session):
    await _enable(admin_client)
    await book_slot(admin_client, public_client, email=None, phone=PHONE)
    fake_line.pnp_results = [httpx.ReadTimeout("slow")]
    result = await _run_outbox(app, db_session)
    assert result["failed"] == 0
    row = await db_session.scalar(select(LinePnpMessage))
    assert row is not None and row.accepted_at is None and row.rejected_at is None
    await _retry_now(db_session)
    await _run_outbox(app, db_session)
    assert not fake_line.pnp, "逾時後不重送（通知型訊息沒有 retry key）"


async def test_cancel_notice_uses_cancellation_template(app, fake_line, admin_client, public_client, db_session):
    await _enable(admin_client)
    booked = await book_slot(admin_client, public_client, email=None, phone=PHONE)
    await _run_outbox(app, db_session)
    await open_manage(public_client, booked["manage_path"])
    cancel = await public_client.post(f"{API}/public/visit-manage/cancel", json={"visit_request_id": booked["receipt_id"]})
    assert cancel.status_code == 200, cancel.text
    await _run_outbox(app, db_session)
    assert [sent["body"]["templateKey"] for sent in fake_line.pnp] == [
        "reservation_completed_zh",
        "reservation_cancellation_zh",
    ]
    assert fake_line.pnp[1]["body"]["body"]["buttons"] == [{"buttonKey": "check_details_zh", "url": f"{ORIGIN}/visit/yihua"}]


async def test_reminder_is_queued_and_sent_for_pnp_parent(app, fake_line, admin_client, public_client, db_session):
    from app.common.timezones import slot_start_utc
    from app.notifications import reminders

    await _enable(admin_client)
    booked = await book_slot(admin_client, public_client, email=None, phone=PHONE)
    await _run_outbox(app, db_session)
    slot_date = date.fromisoformat(booked["slot_date"])
    due = await reminders.due_upcoming(db_session, slot_start_utc(slot_date, time(10, 0)) - timedelta(hours=1))
    assert any(str(visit_id) == booked["receipt_id"] for visit_id, *_ in due)
    assert await reminders.enqueue_due_parent_reminders(db_session, due=due) == 1
    await db_session.commit()


# --- 送達事件 --------------------------------------------------------------------------------------


async def test_delivery_webhook_marks_delivered(app, fake_line, admin_client, public_client, db_session):
    await _enable(admin_client)
    await book_slot(admin_client, public_client, email=None, phone=PHONE)
    await _run_outbox(app, db_session)
    tag = fake_line.pnp[0]["tag"]
    response = await _webhook(app, [_delivery(uuid.uuid4().hex), _delivery("menu01"), _delivery(tag)])
    assert response.status_code == 200
    row = await db_session.scalar(select(LinePnpMessage).execution_options(populate_existing=True))
    assert row.delivered_at is not None


async def test_hq_webhook_needs_configured_account_and_signature(app, fake_line):
    assert (await _webhook(app, [_delivery("a" * 32)], secret="wrong")).status_code == 401
    app.state.settings.line_hq_channel_secret = None
    app.state.settings.line_hq_access_token = None
    app.state.settings.line_pnp_accounts = None
    assert (await _webhook(app, [_delivery("a" * 32)])).status_code == 404
