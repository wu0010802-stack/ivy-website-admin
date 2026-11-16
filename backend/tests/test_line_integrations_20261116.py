"""LINE 串聯（2026-11-16，docs/specs/2026-11-16-line-integrations-design.md）：多個官方帳號、額度、家長 LINE 通知、
「我的預約」、好友數與 LINE 廣告轉換回傳。

LINE API 全部用 httpx.MockTransport 模擬，不連真的 LINE、不發真的訊息。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import unquote

import httpx
import pytest
from sqlalchemy import select

from app.ad_conversions import service as conversions
from app.ad_conversions.models import AdConversionJob
from app.booking import attribution
from app.booking.models import OutboxMessage, VisitRequest
from app.config import Settings
from app.notifications.line_parent import LineClients
from app.notifications.models import LineParentLink, LineParentLinkCode
from app.operations import retention_service
from app.operations.models import AnalyticsEvent, AnalyticsEventType, AuditLogEntry
from app.workers.runner import process_outbox_batch
from tests.conftest import _test_settings, book_slot, open_manage
from tests.test_line_notifications import flex_texts

pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
ORIGIN = "https://www.ivy.example"
MAIN_SECRET, MAIN_TOKEN = "main-secret-for-tests", "main-token-for-tests"
YIHUA_SECRET, YIHUA_TOKEN = "yihua-secret-for-tests", "yihua-token-for-tests"
PARENT = "U" + "1" * 32
OTHER_PARENT = "U" + "2" * 32


class FakeLine:
    """兩個帳號（main、義華）的 LINE API：推播、回覆、帳號資訊、額度、好友數、profile。"""

    def __init__(self) -> None:
        self.pushes: list[dict] = []
        self.replies: list[dict] = []
        self.friends: set[str] = {PARENT}
        self.quota = {MAIN_TOKEN: (200, 12), YIHUA_TOKEN: (200, 170)}
        self.followers: dict[str, dict] = {}
        self.push_status: list[int] = []

    def account(self, request: httpx.Request) -> str:
        token = request.headers["authorization"].removeprefix("Bearer ")
        assert token in (MAIN_TOKEN, YIHUA_TOKEN)
        return "main" if token == MAIN_TOKEN else "yihua"

    def handler(self, request: httpx.Request) -> httpx.Response:
        account = self.account(request)
        token = request.headers["authorization"].removeprefix("Bearer ")
        path = request.url.path
        if path == "/v2/bot/message/push":
            status = self.push_status.pop(0) if self.push_status else 200
            if status != 200:
                return httpx.Response(status, json={"message": "error"})
            self.pushes.append({"account": account, "body": json.loads(request.content)})
            return httpx.Response(200, json={})
        if path == "/v2/bot/message/reply":
            self.replies.append({"account": account, "body": json.loads(request.content)})
            return httpx.Response(200, json={})
        if path == "/v2/bot/info":
            return httpx.Response(
                200,
                json={"userId": "U" + "f" * 32, "basicId": "@ivy-main" if account == "main" else "@ivy-yihua",
                      "displayName": "常春藤官網" if account == "main" else "常春藤義華"},
            )
        if path == "/v2/bot/message/quota":
            limit, _ = self.quota[token]
            return httpx.Response(200, json={"type": "limited", "value": limit} if limit else {"type": "none"})
        if path == "/v2/bot/message/quota/consumption":
            return httpx.Response(200, json={"totalUsage": self.quota[token][1]})
        if path == "/v2/bot/insight/followers":
            day = request.url.params["date"]
            data = self.followers.get(f"{account}:{day}")
            return httpx.Response(200, json=data or {"status": "unready"})
        if path.startswith("/v2/bot/profile/"):
            user = path.rsplit("/", 1)[1]
            return httpx.Response(200, json={"userId": user}) if user in self.friends else httpx.Response(404, json={})
        return httpx.Response(404, json={})

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


@pytest.fixture
def fake_line(app) -> FakeLine:
    fake = FakeLine()
    settings = app.state.settings
    settings.line_messaging_channel_secret = MAIN_SECRET
    settings.line_messaging_access_token = MAIN_TOKEN
    settings.line_yihua_channel_secret = YIHUA_SECRET
    settings.line_yihua_access_token = YIHUA_TOKEN
    settings.admin_origin = "https://admin.ivy.example"
    settings.public_origin = ORIGIN
    app.state.line_transport = fake.transport()
    return fake


def _sign(secret: str, body: bytes) -> str:
    return base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()


async def _webhook(app, events: list[dict], *, account: str = "yihua") -> httpx.Response:
    body = json.dumps({"destination": "U" + "0" * 32, "events": events}).encode()
    secret = MAIN_SECRET if account == "main" else YIHUA_SECRET
    path = f"{API}/line/webhook" if account == "main" else f"{API}/line/webhook/{account}"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post(
            path, content=body, headers={"content-type": "application/json", "x-line-signature": _sign(secret, body)}
        )


def _said(text: str, user: str = PARENT) -> dict:
    return {
        "type": "message",
        "source": {"type": "user", "userId": user},
        "replyToken": uuid.uuid4().hex,
        "timestamp": 0,
        "webhookEventId": uuid.uuid4().hex,
        "message": {"type": "text", "id": "m", "text": text},
    }


def _follow(kind: str, user: str = PARENT) -> dict:
    return {"type": kind, "source": {"type": "user", "userId": user}, "timestamp": 0, "webhookEventId": uuid.uuid4().hex}


def _reply_texts(reply: dict) -> list[str]:
    texts = []
    for message in reply["body"]["messages"]:
        texts += [message["text"]] if message["type"] == "text" else [message["altText"], *flex_texts(message)]
    return texts


async def _enable_parent_line(admin_client, campus: str = "yihua", account: str | None = "yihua") -> httpx.Response:
    return await admin_client.put(f"{API}/admin/line/parent-accounts/{campus}", json={"account_key": account})


async def _link(app, admin_client, public_client, **booking) -> dict:
    """義華開家長 LINE 通知（義華自己的帳號）→ 家長預約（預設沒留 Email）→ 用修改連結取代碼 → 在 LINE 傳出去。"""
    booking.setdefault("email", None)
    assert (await _enable_parent_line(admin_client)).status_code == 200
    booked = await book_slot(admin_client, public_client, **booking)
    await open_manage(public_client, booked["manage_path"])
    issued = await public_client.post(f"{API}/public/visit-manage/line-notify/code")
    assert issued.status_code == 201, issued.text
    assert (await _webhook(app, [_said(issued.json()["text"])])).status_code == 200
    return booked


async def _run_outbox(app, db_session, adapter=None) -> dict:
    async with LineClients(app.state.settings, transport=app.state.line_transport) as clients:
        return await process_outbox_batch(
            db_session, adapter, limit=50, admin_origin=app.state.settings.admin_origin, public_origin=ORIGIN,
            access_secret=app.state.settings.session_secret, line_clients=clients,
        )


# --- 設定 ------------------------------------------------------------------------------------------


def test_line_accounts_lists_configured_accounts_in_order():
    settings = _test_settings().model_copy(update={
        "line_renwu_channel_secret": "s", "line_renwu_access_token": "t",
        "line_messaging_channel_secret": "ms", "line_messaging_access_token": "mt",
    })
    assert list(settings.line_accounts) == ["main", "renwu"]
    assert settings.line_accounts["renwu"].access_token == "t"
    assert repr(settings.line_accounts["renwu"]) == "LineAccountCredentials(renwu)"


def test_campus_account_needs_both_values():
    base = _test_settings().model_dump()
    with pytest.raises(ValueError, match="WEBSITE_LINE_MINGHUA_ACCESS_TOKEN"):
        Settings(**{**base, "line_minghua_channel_secret": "only-secret"})


def test_line_capi_needs_tag_id_and_token_and_uuid_format():
    base = _test_settings().model_dump()
    with pytest.raises(ValueError, match="WEBSITE_LINE_TAG_ID 與 WEBSITE_LINE_CAPI_TOKEN"):
        Settings(**{**base, "line_capi_token": "token"})
    with pytest.raises(ValueError, match="UUID"):
        Settings(**{**base, "line_tag_id": "not-a-uuid", "line_capi_token": "token"})
    ok = Settings(**{**base, "line_tag_id": str(uuid.uuid4()), "line_capi_token": "token"})
    assert "line" in ok.ad_conversion_platforms


# --- 後台：帳號、額度、家長通知帳號 -------------------------------------------------------------------


async def test_admin_line_settings_show_accounts_quota_and_parent_campuses(app, fake_line, admin_client):
    response = await admin_client.get(f"{API}/admin/line")
    assert response.status_code == 200, response.text
    body = response.json()
    accounts = {account["key"]: account for account in body["accounts"]}
    assert accounts["main"]["webhook_url"] == "https://admin.ivy.example/api/website/v1/line/webhook"
    assert accounts["yihua"]["webhook_url"] == "https://admin.ivy.example/api/website/v1/line/webhook/yihua"
    assert accounts["yihua"]["basic_id"] == "@ivy-yihua" and accounts["yihua"]["display_name"] == "常春藤義華"
    assert accounts["main"]["quota"] == {"limit": 200, "used": 12, "warning": False}
    # 用到八成（170/200）就提醒。
    assert accounts["yihua"]["quota"] == {"limit": 200, "used": 170, "warning": True}
    assert {row["campus_key"]: row["account_key"] for row in body["parent_campuses"]}["yihua"] is None


async def test_parent_account_choices_are_limited_to_main_or_own_campus(app, fake_line, admin_client, db_session):
    own = await _enable_parent_line(admin_client)
    assert own.status_code == 200
    assert {row["campus_key"]: row["account_key"] for row in own.json()["parent_campuses"]}["yihua"] == "yihua"
    # 明華沒有自己的帳號，只能用 main；不能借義華的帳號發明華的通知。
    borrowed = await _enable_parent_line(admin_client, "minghua", "yihua")
    assert borrowed.status_code == 409 and borrowed.json()["detail"]["code"] == "LINE_ACCOUNT_UNAVAILABLE"
    assert (await _enable_parent_line(admin_client, "minghua", "main")).status_code == 200
    off = await _enable_parent_line(admin_client, "yihua", None)
    assert {row["campus_key"]: row["account_key"] for row in off.json()["parent_campuses"]}["yihua"] is None
    actions = (await db_session.scalars(select(AuditLogEntry.action))).all()
    assert actions.count("line.parent_account.update") == 3


async def test_public_booking_config_says_whether_line_notify_is_on(app, fake_line, admin_client, public_client):
    before = await public_client.get(f"{API}/public/booking-config/yihua")
    assert before.json()["line_notify_enabled"] is False
    await _enable_parent_line(admin_client)
    after = await public_client.get(f"{API}/public/booking-config/yihua")
    assert after.json()["line_notify_enabled"] is True
    # 拿掉金鑰：後台的選擇還在，但當作沒開。
    app.state.settings.line_yihua_access_token = None
    app.state.settings.line_yihua_channel_secret = None
    assert (await public_client.get(f"{API}/public/booking-config/yihua")).json()["line_notify_enabled"] is False


# --- 家長綁定 -------------------------------------------------------------------------------------


async def test_parent_links_line_by_sending_the_code(app, fake_line, admin_client, public_client, db_session):
    await _enable_parent_line(admin_client)
    booked = await book_slot(admin_client, public_client)
    await open_manage(public_client, booked["manage_path"])
    state = (await public_client.get(f"{API}/public/visit-manage/line-notify")).json()
    assert state == {
        "available": True, "linked": False, "account_name": "常春藤義華", "basic_id": "@ivy-yihua",
        "add_friend_url": "https://line.me/R/ti/p/%40ivy-yihua",
    }
    issued = await public_client.post(f"{API}/public/visit-manage/line-notify/code")
    assert issued.status_code == 201, issued.text
    body = issued.json()
    assert body["code"].startswith("LN-") and body["code"] in body["text"]
    # LINE URL scheme：LINE ID 與預填文字都要 percent-encode（@ → %40）。
    assert body["message_url"].startswith("https://line.me/R/oaMessage/%40ivy-yihua/?")
    assert unquote(body["message_url"].split("/?", 1)[1]) == body["text"]
    # 資料庫只存雜湊。
    stored = (await db_session.scalars(select(LineParentLinkCode.code_hash))).all()
    assert body["code"] not in stored

    assert (await _webhook(app, [_said(body["text"])])).status_code == 200
    link = await db_session.scalar(select(LineParentLink))
    assert link.line_user_id == PARENT and link.account_key == "yihua" and str(link.visit_request_id) == booked["receipt_id"]
    [reply] = fake_line.replies
    assert reply["account"] == "yihua"
    assert any("已開啟 LINE 通知" in text for text in _reply_texts(reply))
    assert (await public_client.get(f"{API}/public/visit-manage/line-notify")).json()["linked"] is True
    assert "line.parent.link" in (await db_session.scalars(select(AuditLogEntry.action))).all()

    # 同一組代碼不能再用。
    await _webhook(app, [_said(body["text"], OTHER_PARENT)])
    assert any("已失效" in text for text in _reply_texts(fake_line.replies[-1]))
    assert (await db_session.scalar(select(LineParentLink.line_user_id))) == PARENT


async def test_code_from_another_account_or_expired_is_rejected(app, fake_line, admin_client, public_client, db_session):
    await _enable_parent_line(admin_client)
    booked = await book_slot(admin_client, public_client)
    await open_manage(public_client, booked["manage_path"])
    text = (await public_client.post(f"{API}/public/visit-manage/line-notify/code")).json()["text"]
    # 代碼是義華帳號發的：傳到 main 帳號不算。
    await _webhook(app, [_said(text)], account="main")
    assert await db_session.scalar(select(LineParentLink)) is None
    # 過期。
    await db_session.execute(
        LineParentLinkCode.__table__.update().values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    )
    await db_session.commit()
    await _webhook(app, [_said(text)])
    assert await db_session.scalar(select(LineParentLink)) is None


async def test_not_yet_friend_gets_a_reminder_in_the_reply(app, fake_line, admin_client, public_client):
    fake_line.friends.clear()
    await _link(app, admin_client, public_client)
    texts = _reply_texts(fake_line.replies[0])
    assert any("加入好友" in text for text in texts)


async def test_line_notify_unavailable_when_campus_not_enabled(app, fake_line, admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    await open_manage(public_client, booked["manage_path"])
    assert (await public_client.get(f"{API}/public/visit-manage/line-notify")).json()["available"] is False
    refused = await public_client.post(f"{API}/public/visit-manage/line-notify/code")
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "LINE_NOTIFY_UNAVAILABLE"


async def test_campus_webhook_needs_configured_account_and_signature(app, fake_line):
    app.state.settings.line_yihua_access_token = None
    app.state.settings.line_yihua_channel_secret = None
    assert (await _webhook(app, [])).status_code == 404
    app.state.settings.line_yihua_channel_secret = YIHUA_SECRET
    app.state.settings.line_yihua_access_token = YIHUA_TOKEN
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        forged = await client.post(
            f"{API}/line/webhook/yihua", content=b'{"events":[]}',
            headers={"x-line-signature": _sign(MAIN_SECRET, b'{"events":[]}')},
        )
    assert forged.status_code == 401
    assert (await _webhook(app, [], account="nosuch")).status_code == 404


# --- 家長通知走 LINE ---------------------------------------------------------------------------------


async def test_parent_without_email_gets_cancel_notice_on_line(app, fake_line, admin_client, public_client, db_session):
    booked = await _link(app, admin_client, public_client)
    cancel = await public_client.post(f"{API}/public/visit-manage/cancel", json={"visit_request_id": booked["receipt_id"]})
    assert cancel.status_code == 200, cancel.text
    # 沒有 Email：以前不排家長信，現在綁了 LINE 就排。
    kinds = (await db_session.scalars(select(OutboxMessage.kind))).all()
    assert "parent_visit_cancelled" in kinds
    result = await _run_outbox(app, db_session)
    assert result["failed"] == 0
    parent_pushes = [push for push in fake_line.pushes if push["body"]["to"] == PARENT]
    assert len(parent_pushes) == 1 and parent_pushes[0]["account"] == "yihua"
    card = parent_pushes[0]["body"]["messages"][0]
    assert card["type"] == "flex" and card["altText"].startswith("【常春藤義華】參觀預約已取消")
    texts = flex_texts(card)
    assert "您已取消這次參觀預約。" in texts
    assert f"{ORIGIN}/visit/yihua" in texts  # 重新預約按鈕
    # 不重送。
    await _run_outbox(app, db_session)
    assert len([push for push in fake_line.pushes if push["body"]["to"] == PARENT]) == 1


async def test_parent_with_email_and_line_gets_both(app, fake_line, admin_client, public_client, db_session, recording_mail_adapter):
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"
    await _link(app, admin_client, public_client, email="parent@example.com")
    await _run_outbox(app, db_session, recording_mail_adapter)
    # 預約成功信在綁定前就排了：信照寄，LINE 也補推（送出當下才看有沒有綁）。
    booked_cards = [
        push for push in fake_line.pushes
        if push["body"]["to"] == PARENT and push["body"]["messages"][0]["altText"].startswith("【常春藤義華】參觀預約成功")
    ]
    assert len(booked_cards) == 1
    texts = flex_texts(booked_cards[0]["body"]["messages"][0])
    manage = next(text for text in texts if text.startswith(f"{ORIGIN}/visit/manage"))
    assert "token=" in manage
    assert any(mail["to"] == "parent@example.com" for mail in recording_mail_adapter.sent)


async def test_line_failure_retries_only_line(app, fake_line, admin_client, public_client, db_session, recording_mail_adapter):
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"
    await _link(app, admin_client, public_client, email="parent@example.com")
    fake_line.push_status = [500]  # 園方群組沒設，這一次是家長的
    first = await _run_outbox(app, db_session, recording_mail_adapter)
    assert first["failed"] >= 1
    mails = len(recording_mail_adapter.sent)
    await db_session.execute(OutboxMessage.__table__.update().values(next_attempt_at=OutboxMessage.created_at))
    await db_session.commit()
    await _run_outbox(app, db_session, recording_mail_adapter)
    assert len(recording_mail_adapter.sent) == mails, "重試不能再寄一次信"
    assert any(push["body"]["to"] == PARENT for push in fake_line.pushes)


async def test_blocked_or_switched_account_is_not_pushed(app, fake_line, admin_client, public_client, db_session):
    booked = await _link(app, admin_client, public_client)
    await _webhook(app, [_follow("unfollow")])
    assert (await db_session.scalar(select(LineParentLink.unfollowed_at))) is not None
    await public_client.post(f"{API}/public/visit-manage/cancel", json={"visit_request_id": booked["receipt_id"]})
    await _run_outbox(app, db_session)
    assert not [push for push in fake_line.pushes if push["body"]["to"] == PARENT]


async def test_follow_again_restores_and_admin_switch_stops_pushes(app, fake_line, admin_client, public_client, db_session):
    booked = await _link(app, admin_client, public_client)
    await _webhook(app, [_follow("unfollow"), _follow("follow")])
    assert (await db_session.scalar(select(LineParentLink.unfollowed_at))) is None
    # 後台把義華換成 main 帳號：綁在義華帳號的 userId 推不到，不推。
    await _enable_parent_line(admin_client, "yihua", "main")
    await public_client.post(f"{API}/public/visit-manage/cancel", json={"visit_request_id": booked["receipt_id"]})
    await _run_outbox(app, db_session)
    assert not [push for push in fake_line.pushes if push["body"]["to"] == PARENT]


async def test_parent_can_unlink(app, fake_line, admin_client, public_client, db_session):
    await _link(app, admin_client, public_client)
    assert (await public_client.delete(f"{API}/public/visit-manage/line-notify")).status_code == 204
    assert await db_session.scalar(select(LineParentLink)) is None
    assert "line.parent.unlink" in (await db_session.scalars(select(AuditLogEntry.action))).all()


async def test_reminder_is_queued_for_line_only_parent(app, fake_line, admin_client, public_client, db_session):
    from app.notifications import reminders

    from app.common.timezones import slot_start_utc

    booked = await _link(app, admin_client, public_client)
    slot_date = date.fromisoformat(booked["slot_date"])
    due = await reminders.due_upcoming(
        db_session, slot_start_utc(slot_date, datetime(2026, 1, 1, 10, 0).time()) - timedelta(hours=1)
    )
    assert any(str(visit_id) == booked["receipt_id"] for visit_id, *_ in due)
    created = await reminders.enqueue_due_parent_reminders(db_session, due=due)
    assert created == 1


async def test_closure_counts_line_parents_separately(app, fake_line, admin_client, public_client, db_session):
    booked = await _link(app, admin_client, public_client)
    response = await admin_client.post(
        f"{API}/admin/visit-closures",
        json={"closure_date": booked["slot_date"], "campus_keys": ["yihua"], "reason": "颱風", "notify_parents": True, "dry_run": False},
    )
    assert response.status_code == 200, response.text
    row = response.json()["campuses"][0]
    # 正式站沒設寄信也照推 LINE：沒有 Email 的家長不用來電。
    assert row["with_line"] == 1 and row["no_email"] == 0 and row["notified"] == 1, json.dumps(row)


async def test_anonymize_deletes_line_link(app, fake_line, admin_client, public_client, db_session):
    booked = await _link(app, admin_client, public_client)
    visit = await db_session.get(VisitRequest, uuid.UUID(booked["receipt_id"]))
    assert await retention_service.anonymize(db_session, visit)
    await db_session.commit()
    assert await db_session.scalar(select(LineParentLink)) is None


# --- 我的預約 -------------------------------------------------------------------------------------


async def test_my_visits_reply_lists_linked_visits(app, fake_line, admin_client, public_client):
    await _link(app, admin_client, public_client)
    await _webhook(app, [_said("我的預約")])
    reply = fake_line.replies[-1]
    texts = _reply_texts(reply)
    assert texts[0] == "您有 1 筆參觀預約"
    assert any(text.startswith(f"{ORIGIN}/visit/manage") for text in texts)
    # 別人的 LINE 問，什麼都沒有。
    await _webhook(app, [_said("我的預約", OTHER_PARENT)])
    assert any("目前沒有綁定" in text for text in _reply_texts(fake_line.replies[-1]))


async def test_ordinary_messages_get_no_reply(app, fake_line):
    await _webhook(app, [_said("請問有幾歲可以入學")])
    assert fake_line.replies == []


# --- 系統狀態、成效統計 ------------------------------------------------------------------------------


async def test_system_status_shows_quota_per_account(app, fake_line, admin_client):
    body = (await admin_client.get(f"{API}/admin/system-status")).json()
    line = next(item for item in body["services"] if item["key"] == "line_messaging")
    assert line["level"] == "attention"  # 義華用到 170/200
    assert {account["key"]: account["used"] for account in line["detail"]["accounts"]} == {"main": 12, "yihua": 170}
    fake_line.quota[YIHUA_TOKEN] = (200, 20)
    from app.notifications import line_accounts

    line_accounts.clear_quota_cache()
    again = (await admin_client.get(f"{API}/admin/system-status")).json()
    assert next(item for item in again["services"] if item["key"] == "line_messaging")["level"] == "ok"


async def test_line_insights_compare_followers_and_count_clicks(app, fake_line, admin_client, db_session):
    from app.common.timezones import today_local

    today = today_local()
    start, end = today - timedelta(days=6), today
    before, last = start - timedelta(days=1), today - timedelta(days=1)
    fake_line.followers[f"yihua:{before:%Y%m%d}"] = {"status": "ready", "followers": 100, "targetedReaches": 80, "blocks": 5}
    fake_line.followers[f"yihua:{last:%Y%m%d}"] = {"status": "ready", "followers": 130, "targetedReaches": 90, "blocks": 7}
    db_session.add(AnalyticsEvent(
        id=uuid.uuid4(), event_type=AnalyticsEventType.CTA_CLICK_LINE, campus_key="yihua", created_at=datetime.now(timezone.utc)
    ))
    await db_session.commit()
    response = await admin_client.get(f"{API}/admin/line-insights", params={"start": start.isoformat(), "end": end.isoformat()})
    assert response.status_code == 200, response.text
    body = response.json()
    yihua = next(account for account in body["accounts"] if account["key"] == "yihua")
    assert yihua["from_date"] == before.isoformat() and yihua["to_date"] == last.isoformat()
    assert yihua["new_followers"] == 30 and yihua["blocks_change"] == 2 and yihua["followers"] == 130
    main = next(account for account in body["accounts"] if account["key"] == "main")
    assert main["ready"] is False and main["new_followers"] is None
    assert next(row for row in body["campuses"] if row["campus_key"] == "yihua")["line_clicks"] == 1


# --- LINE 廣告轉換回傳 -------------------------------------------------------------------------------


def _line_capi_settings() -> Settings:
    return _test_settings().model_copy(update={"line_tag_id": "11111111-2222-3333-4444-555555555555", "line_capi_token": "capi"})


def test_click_ids_collect_line_click_and_browser_id():
    now = datetime.now(timezone.utc)
    raw = base64.urlsafe_b64encode(json.dumps({
        "v": 1, "f": {"s": "line", "d": now.date().isoformat()},
        "n": {"v": "CL.abc-1", "t": int(now.timestamp() * 1000)},
    }).encode()).decode().rstrip("=")
    site = attribution.parse_site_cookie(raw)
    assert site.line_click.value == "CL.abc-1"
    ids = attribution.click_ids({"__lt__cid": "lt-browser-1"}, site, ("line",), now)
    assert ids == {"line_click_id": "CL.abc-1", "line_browser_id": "lt-browser-1"}
    # 沒設定 LINE 回傳就不記。
    assert attribution.click_ids({"__lt__cid": "lt-browser-1"}, site, ("meta",), now) is None
    # 太舊的點擊不記。
    old = attribution.click_ids({}, site, ("line",), now + attribution.LINE_CLICK_MAX_AGE + timedelta(days=1))
    assert old is None


def test_build_line_conversion_request():
    job = AdConversionJob(
        id=uuid.uuid4(), visit_request_id=uuid.uuid4(), event="visit_attended", platform="line",
        occurred_at=datetime(2026, 11, 16, 2, 0, tzinfo=timezone.utc),
    )
    url, headers, body = conversions.build_request(job, {"line_click_id": "CL.1"}, "yihua", _line_capi_settings())
    assert url == "https://conversion-api.tr.line.me/v1/11111111-2222-3333-4444-555555555555/events"
    assert headers == {"X-Line-TagAccessToken": "capi"}
    assert body == [{
        "event": {
            "event_type": "conversion", "event_name": "visit_attended", "source_type": "web",
            "event_timestamp": int(job.occurred_at.timestamp()), "deduplication_key": f"{job.visit_request_id}:visit_attended",
            "test_flag": False,
        },
        "user": {"click_id": "CL.1"},
    }]
    assert conversions.build_request(job, {}, "yihua", _line_capi_settings()) is None


async def test_line_conversion_job_is_queued_and_sent(db_session, app):
    from tests.conftest import legacy_request

    settings = _line_capi_settings()
    request = await db_session.get(VisitRequest, uuid.UUID(str(await legacy_request(db_session, status="confirmed"))))
    request.ad_click_ids = {"line_click_id": "CL.9"}
    await db_session.commit()
    assert await conversions.enqueue(db_session, request, conversions.VISIT_ATTENDED) == 1
    await db_session.commit()
    sent: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        sent.append(req)
        return httpx.Response(202)

    counts = await conversions.process_due(db_session, settings, transport=httpx.MockTransport(handler))
    assert counts["sent"] == 1
    assert json.loads(sent[0].content)[0]["user"] == {"click_id": "CL.9"}
    assert (await db_session.scalar(select(AdConversionJob.status))) == "sent"


def test_line_card_altText_has_no_personal_data():
    from app.notifications.parent_email import ParentEmail, parent_notice
    from app.notifications.line_flex import parent_card

    notice = parent_notice(ParentEmail(
        kind="parent_visit_reminder", campus_name="義華校", salutation="陳媽媽", slot_date=date(2026, 11, 20),
        start_time=datetime(2026, 1, 1, 9, 30).time(), end_time=None, party_size=None, campus_address="高雄市",
        campus_phone="07-123 4567", manage_url=None, change_deadline=None, cancel_reason=None, rebook_url=None,
        day_word="明天",
    ))
    card = parent_card(notice)
    assert "陳媽媽" not in json.dumps(card, ensure_ascii=False)
    # 沒有修改連結：說明請來電，按鈕只有撥打電話（tel: 只留數字）。
    buttons = card["contents"]["footer"]["contents"]
    assert [button["action"]["uri"] for button in buttons] == ["tel:071234567"]


# --- 2026-11-16 審查修正 ---------------------------------------------------------------------------


async def _linked_count(db_session) -> int:
    return len((await db_session.scalars(select(LineParentLink.id))).all())


@pytest.mark.parametrize("action", ["revoke", "regenerate", "staff_email"])
async def test_cutting_a_leaked_link_also_unlinks_line(app, fake_line, admin_client, public_client, db_session, action):
    """連結外流、拿到的人綁了 LINE：園方撤銷、重新產生連結或更正 Email 時，LINE 綁定一起解除，
    新連結不會推到外人的 LINE、外人也不能用「我的預約」拿到新連結。"""
    booked = await _link(app, admin_client, public_client, email="parent@example.com")
    assert await _linked_count(db_session) == 1
    case = f"{API}/admin/visit-requests/{booked['receipt_id']}"
    if action == "revoke":
        response = await admin_client.post(f"{case}/revoke-access")
    elif action == "regenerate":
        response = await admin_client.post(f"{case}/access-link")
    else:
        version = (await admin_client.get(case)).json()["details_version"]
        response = await admin_client.patch(f"{case}/details", json={"expected_version": version, "email": "fixed@example.com"})
    assert response.status_code in (200, 201, 204), response.text
    assert await _linked_count(db_session) == 0
    await _webhook(app, [_said("我的預約")])
    assert any("目前沒有綁定" in text for text in _reply_texts(fake_line.replies[-1]))


async def test_parent_changing_own_email_keeps_their_line(app, fake_line, admin_client, public_client, db_session):
    booked = await _link(app, admin_client, public_client, email="parent@example.com")
    me = (await public_client.get(f"{API}/public/visit-manage/me")).json()
    response = await public_client.patch(
        f"{API}/public/visit-manage/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "email": "new@example.com"},
    )
    assert response.status_code == 200, response.text
    assert await _linked_count(db_session) == 1


async def test_switching_parent_account_drops_old_links_and_pending_codes(app, fake_line, admin_client, public_client, db_session):
    booked = await _link(app, admin_client, public_client)
    # 另一組還沒用掉的代碼（取了沒傳）。
    pending = (await public_client.post(f"{API}/public/visit-manage/line-notify/code")).json()["text"]
    switched = await _enable_parent_line(admin_client, "yihua", "main")
    assert switched.status_code == 200
    assert await _linked_count(db_session) == 0
    # 家長頁不再說已開啟，可以重新綁定（用 main 帳號）。
    state = (await public_client.get(f"{API}/public/visit-manage/line-notify", params={"visit_request_id": booked["receipt_id"]})).json()
    assert state["linked"] is False and state["basic_id"] == "@ivy-main"
    # 換帳號前取的代碼傳到舊帳號：不綁。
    await _webhook(app, [_said(pending)])
    assert await _linked_count(db_session) == 0
    audit = await db_session.scalar(
        select(AuditLogEntry).where(AuditLogEntry.action == "line.parent_account.update").order_by(AuditLogEntry.created_at.desc())
    )
    assert audit.metadata_json["dropped_links"] == 1


async def test_code_issued_before_switch_is_not_bound(app, fake_line, admin_client, public_client, db_session):
    await _enable_parent_line(admin_client)
    booked = await book_slot(admin_client, public_client, email=None)
    await open_manage(public_client, booked["manage_path"])
    text = (await public_client.post(f"{API}/public/visit-manage/line-notify/code")).json()["text"]
    # 關掉再打開（同一個帳號）：舊代碼已作廢。
    await _enable_parent_line(admin_client, "yihua", None)
    await _enable_parent_line(admin_client, "yihua", "yihua")
    await _webhook(app, [_said(text)])
    assert await _linked_count(db_session) == 0


async def test_line_endpoints_reject_another_tabs_visit(app, fake_line, admin_client, public_client):
    booked = await _link(app, admin_client, public_client)
    other = str(uuid.uuid4())
    for response in (
        await public_client.get(f"{API}/public/visit-manage/line-notify", params={"visit_request_id": other}),
        await public_client.post(f"{API}/public/visit-manage/line-notify/code", params={"visit_request_id": other}),
        await public_client.delete(f"{API}/public/visit-manage/line-notify", params={"visit_request_id": other}),
    ):
        assert response.status_code == 409 and response.json()["detail"]["code"] == "PARENT_SESSION_CHANGED"
    ok = await public_client.get(f"{API}/public/visit-manage/line-notify", params={"visit_request_id": booked["receipt_id"]})
    assert ok.json()["linked"] is True


async def test_closure_counts_line_parents_even_when_not_notifying(app, fake_line, admin_client, public_client):
    """取消勾選「通知」時也要知道有幾位 LINE 家長（後台才不會把勾選框鎖死）；正式站沒設寄信時，
    有 Email 又綁了 LINE 的家長算 LINE（停課通知走 LINE、不必來電）。"""
    booked = await _link(app, admin_client, public_client, email="parent@example.com")
    body = {"closure_date": booked["slot_date"], "campus_keys": ["yihua"], "reason": "颱風", "dry_run": True}
    off = (await admin_client.post(f"{API}/admin/visit-closures", json={**body, "notify_parents": False})).json()["campuses"][0]
    assert off["with_line"] == 1 and off["with_email"] == 0 and off["notified"] == 0
    on = (await admin_client.post(f"{API}/admin/visit-closures", json={**body, "notify_parents": True})).json()["campuses"][0]
    assert on["with_line"] == 1 and on["notified"] == 1


async def test_email_failure_does_not_block_line(app, fake_line, admin_client, public_client, db_session, failing_mail_adapter):
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"
    await _link(app, admin_client, public_client, email="parent@example.com")
    result = await _run_outbox(app, db_session, failing_mail_adapter)
    assert result["failed"] >= 1
    assert any(push["body"]["to"] == PARENT for push in fake_line.pushes), "信寄不出去，LINE 照推"


def test_profile_urls_are_kept_out_of_logs():
    import logging

    record = logging.LogRecord(
        "httpx", logging.INFO, "", 0, 'HTTP Request: %s %s "%s"',
        ("GET", f"https://api.line.me/v2/bot/profile/{PARENT}", "HTTP/1.1 200 OK"), None,
    )
    assert not all(f.filter(record) for f in logging.getLogger("httpx").filters)


async def test_failed_lookups_are_held_for_a_minute(app):
    from app.config import LineAccountCredentials
    from app.notifications import line as line_api
    from app.notifications import line_accounts, line_parent

    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(503)

    account = LineAccountCredentials("main", "s", "t")
    transport = httpx.MockTransport(handler)
    assert await line_parent.bot_info(account, transport) is None
    with pytest.raises(line_api.LineApiError):
        await line_accounts.quota(account, transport)
    before = len(calls)
    assert await line_parent.bot_info(account, transport) is None
    with pytest.raises(line_api.LineApiError):
        await line_accounts.quota(account, transport)
    assert len(calls) == before, "1 分鐘內不再打 LINE"


def test_phone_button_only_with_ascii_digits():
    from app.notifications.line_flex import parent_card
    from app.notifications.parent_email import ParentEmail, parent_notice

    def buttons(phone):
        notice = parent_notice(ParentEmail(
            kind="parent_visit_cancelled", campus_name="義華校", salutation="", slot_date=None, start_time=None,
            end_time=None, party_size=None, campus_address=None, campus_phone=phone, manage_url=None,
            change_deadline=None, cancel_reason="parent", rebook_url=None,
        ))
        footer = parent_card(notice)["contents"].get("footer")
        return [b["action"]["uri"] for b in footer["contents"]] if footer else []

    # 分機不撥（tel: 接上分機會撥錯號碼）。
    assert buttons("（07）123-4567 分機 2") == ["tel:071234567"]
    assert buttons("０７１２３４５６７") == []
    assert buttons("請洽櫃台") == []
