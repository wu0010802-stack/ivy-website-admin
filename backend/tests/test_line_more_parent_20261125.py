"""LINE 家長一對一再加的三項（docs/specs/2026-11-25-line-more-features-design.md §6–§8）：卡片的「導航到園所」、
參觀提醒的「會準時到」、「我的預約」直接取消（二次確認）。LINE API 用 httpx.MockTransport 模擬。"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.booking.models import OutboxMessage, VisitRequest, VisitRequestEvent, VisitSlot
from app.common.timezones import slot_start_utc, today_local
from app.notifications import line_flex, line_parent_actions as pa
from app.notifications import reminders
from app.notifications.line_group_actions import encode, make_token
from app.notifications.parent_email import ParentEmail, parent_notice
from app.notifications.service import campus_map_url
from app.operations.models import AuditLogEntry
from tests.test_line_integrations_20261116 import (  # noqa: F401  (fixture)
    OTHER_PARENT, PARENT, _enable_parent_line, _link, _reply_texts, _run_outbox, _said, _webhook, fake_line,
)
from tests.test_line_notifications import flex_texts

pytestmark = pytest.mark.usefixtures("booking_consent")


def _postback(data: str, user: str = PARENT) -> dict:
    return {
        "type": "postback",
        "source": {"type": "user", "userId": user},
        "replyToken": uuid.uuid4().hex,
        "timestamp": 0,
        "webhookEventId": uuid.uuid4().hex,
        "postback": {"data": data},
    }


def _datas(node) -> list[tuple[str, str | None]]:
    """卡片上 postback 按鈕的 (data, displayText)。"""
    found: list[tuple[str, str | None]] = []
    if isinstance(node, dict):
        action = node.get("action")
        if isinstance(action, dict) and action.get("type") == "postback":
            found.append((action["data"], action.get("displayText")))
        for value in node.values():
            found += _datas(value)
    elif isinstance(node, list):
        for item in node:
            found += _datas(item)
    return found


def _labels(node) -> list[str]:
    """卡片上所有按鈕的文字。"""
    found: list[str] = []
    if isinstance(node, dict):
        action = node.get("action")
        if isinstance(action, dict) and "label" in action:
            found.append(action["label"])
        for value in node.values():
            found += _labels(value)
    elif isinstance(node, list):
        for item in node:
            found += _labels(item)
    return found


async def _visit(app, receipt: str) -> VisitRequest:
    async with app.state.session_factory() as db:
        return await db.get(VisitRequest, uuid.UUID(receipt))


async def _events(app, receipt: str, event_type: str) -> list[VisitRequestEvent]:
    async with app.state.session_factory() as db:
        return list(
            (
                await db.execute(
                    select(VisitRequestEvent).where(
                        VisitRequestEvent.visit_request_id == uuid.UUID(receipt), VisitRequestEvent.event_type == event_type
                    )
                )
            ).scalars()
        )


def _ok(app, receipt: str, *, now: datetime | None = None) -> str:
    token = make_token(app.state.settings.session_secret, pa.CANCEL_OK, receipt, now=now or datetime.now(timezone.utc))
    return encode(pa.CANCEL_OK, receipt, token)


def _last_texts(fake_line) -> list[str]:
    return _reply_texts(fake_line.replies[-1])


# --- 導航到園所（§6） -------------------------------------------------------------------------------


def _mail(kind: str, **fields) -> ParentEmail:
    base = dict(
        kind=kind, campus_name="義華校", salutation="陳小姐", slot_date=date(2026, 11, 28), start_time=datetime(2026, 1, 1, 10).time(),
        end_time=datetime(2026, 1, 1, 11).time(), party_size=2, campus_address="高雄市三民區範例路 1 號", campus_phone="07-3000000",
        manage_url="https://www.ivy.example/visit/manage#t", change_deadline=None, cancel_reason=None, rebook_url=None,
        campus_map_url="https://www.google.com/maps/search/?api=1&query=x",
    )
    base.update(fields)
    return ParentEmail(**base)


def test_map_button_only_on_booked_changed_and_reminder():
    for kind in ("parent_visit_booked", "parent_visit_changed", "parent_visit_reminder"):
        card = line_flex.parent_card(parent_notice(_mail(kind)))
        assert "導航到園所" in _labels(card) and "https://www.google.com/maps/search/?api=1&query=x" in flex_texts(card), kind
    for mail in (_mail("parent_visit_cancelled"), _mail("parent_visit_day_closed"), _mail("parent_visit_booked", day_closed=True)):
        assert "導航到園所" not in _labels(line_flex.parent_card(parent_notice(mail))), mail.kind
    # 沒有地圖網址就不放。
    assert "導航到園所" not in _labels(line_flex.parent_card(parent_notice(_mail("parent_visit_booked", campus_map_url=None))))


def test_campus_map_url_prefers_checked_map_link_then_address():
    assert campus_map_url({"map_url": "https://maps.app.goo.gl/abc", "address": "高雄市"}) == "https://maps.app.goo.gl/abc"
    assert campus_map_url({"map_url": "https://evil.example/maps", "address": "高雄市 1 號"}) == (
        "https://www.google.com/maps/search/?api=1&query=%E9%AB%98%E9%9B%84%E5%B8%82%201%20%E8%99%9F"
    )
    assert campus_map_url({}) is None


# --- 會準時到（§7） ---------------------------------------------------------------------------------


async def _reminder_card(app, fake_line, db_session, booked: dict, monkeypatch) -> dict:
    from app.notifications import service

    async def profile(db, kind, key):
        return {"address": "高雄市三民區範例路 1 號", "phone": "07-3000000"} if kind == "campus_profile" else None

    monkeypatch.setattr(service.content_service, "published_payload", profile)
    slot_date = date.fromisoformat(booked["slot_date"])
    due = await reminders.due_upcoming(db_session, slot_start_utc(slot_date, datetime(2026, 1, 1, 10).time()) - timedelta(hours=1))
    assert await reminders.enqueue_due_parent_reminders(db_session, due=due) == 1
    await db_session.commit()
    await _run_outbox(app, db_session)
    pushes = [p for p in fake_line.pushes if p["body"]["to"] == PARENT]
    assert len(pushes) == 1
    return pushes[0]["body"]["messages"][0]


async def test_reminder_card_has_attendance_and_map_buttons(app, fake_line, admin_client, public_client, db_session, monkeypatch):
    booked = await _link(app, admin_client, public_client)
    card = await _reminder_card(app, fake_line, db_session, booked, monkeypatch)
    assert _datas(card) == [(pa.attendance_data(booked["receipt_id"]), "會準時到")]
    texts = flex_texts(card)
    labels = _labels(card)
    assert labels[0] == "會準時到" and "導航到園所" in labels
    assert any(text.startswith("https://www.google.com/maps/search/?api=1&query=") for text in texts)


async def test_attendance_reply_records_once_and_shows_in_admin_and_group_list(app, fake_line, admin_client, public_client):
    booked = await _link(app, admin_client, public_client)
    receipt = booked["receipt_id"]
    await _webhook(app, [_postback(pa.attendance_data(receipt))])
    assert _last_texts(fake_line) == [pa.ATTENDANCE_REPLY]
    visit = await _visit(app, receipt)
    assert visit.parent_attendance_confirmed_at is not None and visit.attendance_confirmed_slot_id == visit.slot_id
    events = await _events(app, receipt, pa.ATTENDANCE_EVENT)
    assert len(events) == 1 and events[0].source == "line_parent" and events[0].actor_user_id is None
    # 再按一次：同一句，不再寫歷程。
    await _webhook(app, [_postback(pa.attendance_data(receipt))])
    assert _last_texts(fake_line) == [pa.ATTENDANCE_REPLY]
    assert len(await _events(app, receipt, pa.ATTENDANCE_EVENT)) == 1
    detail = (await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt}")).json()
    assert detail["parent_attendance_confirmed_at"] is not None
    # 群組名單每筆標出來。
    from app.notifications import line_digest

    async with app.state.session_factory() as db:
        rows = await line_digest.rows_between(db, ["yihua"], date.fromisoformat(booked["slot_date"]), date.fromisoformat(booked["slot_date"]))
    assert [row.attendance_confirmed for row in rows] == [True]


async def test_attendance_is_dropped_after_reschedule(app, fake_line, admin_client, public_client):
    """改期換了場次：回覆時記的場次對不上目前場次，就不算（模擬：把記下的場次換成別的）。"""
    booked = await _link(app, admin_client, public_client)
    receipt = booked["receipt_id"]
    await _webhook(app, [_postback(pa.attendance_data(receipt))])
    other_slot = uuid.uuid4()
    async with app.state.session_factory() as db:
        await db.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(receipt)).values(attendance_confirmed_slot_id=other_slot))
        await db.commit()
    assert (await _visit(app, receipt)).parent_attendance_confirmed_at is None
    detail = (await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt}")).json()
    assert detail["parent_attendance_confirmed_at"] is None


async def test_attendance_refused_for_other_line_cancelled_or_past(app, fake_line, admin_client, public_client):
    booked = await _link(app, admin_client, public_client)
    receipt = booked["receipt_id"]
    await _webhook(app, [_postback(pa.attendance_data(receipt), OTHER_PARENT)])
    assert _last_texts(fake_line) == [pa.ATTENDANCE_GONE_REPLY]
    async with app.state.session_factory() as db:
        await db.execute(update(VisitSlot).values(slot_date=today_local() - timedelta(days=1)))
        await db.commit()
    await _webhook(app, [_postback(pa.attendance_data(receipt))])
    assert _last_texts(fake_line) == [pa.ATTENDANCE_GONE_REPLY]
    assert (await _visit(app, receipt)).attendance_confirmed_at is None
    # 亂編的 data：不回應。
    count = len(fake_line.replies)
    await _webhook(app, [_postback("ivy:pa"), _postback("ivy:pa:not-a-uuid:x"), _postback("hello")])
    assert len(fake_line.replies) == count


async def test_attendance_refused_after_admin_switches_parent_account(app, fake_line, admin_client, public_client):
    booked = await _link(app, admin_client, public_client)
    assert (await _enable_parent_line(admin_client, account=None)).status_code == 200
    await _webhook(app, [_postback(pa.attendance_data(booked["receipt_id"]))])
    assert _last_texts(fake_line) == [pa.ATTENDANCE_GONE_REPLY]


# --- 我的預約直接取消（§8） -------------------------------------------------------------------------


async def test_my_visits_card_has_cancel_button(app, fake_line, admin_client, public_client):
    booked = await _link(app, admin_client, public_client)
    await _webhook(app, [_said("我的預約")])
    card = fake_line.replies[-1]["body"]["messages"][0]
    assert (pa.cancel_data(booked["receipt_id"]), None) in _datas(card)


async def test_cancel_needs_confirmation_then_cancels_as_parent(app, fake_line, admin_client, public_client):
    booked = await _link(app, admin_client, public_client)
    receipt = booked["receipt_id"]
    await _webhook(app, [_postback(pa.cancel_data(receipt))])
    confirm = fake_line.replies[-1]["body"]["messages"][0]
    assert confirm["altText"] == "確定取消這次參觀？"
    datas = _datas(confirm)
    assert datas[0][0].startswith(f"ivy:pcok:{receipt}:") and datas[0][1] == "確定取消"
    assert datas[1] == (encode(pa.CANCEL_KEEP), None)
    assert (await _visit(app, receipt)).status == "confirmed"

    await _webhook(app, [_postback(encode(pa.CANCEL_KEEP))])
    assert _last_texts(fake_line) == [pa.CANCEL_KEEP_REPLY]
    assert (await _visit(app, receipt)).status == "confirmed"

    await _webhook(app, [_postback(datas[0][0])])
    assert _last_texts(fake_line) == [pa.CANCEL_DONE_REPLY]
    visit = await _visit(app, receipt)
    assert visit.status == "cancelled" and visit.cancel_reason == "parent"
    (event,) = await _events(app, receipt, "cancelled")
    assert event.source == "line_parent"
    async with app.state.session_factory() as db:
        kinds = set((await db.execute(select(OutboxMessage.kind).where(OutboxMessage.visit_request_id == visit.id))).scalars())
        audit = await db.scalar(select(AuditLogEntry).where(AuditLogEntry.action == "line.parent.cancel"))
    assert {"visit_request_cancelled", "parent_visit_cancelled"} <= kinds
    assert audit is not None and audit.metadata_json == {"account_key": "yihua"} and audit.actor_user_id is None
    # 再按一次確定：已取消，不重複寫。
    await _webhook(app, [_postback(datas[0][0])])
    assert _last_texts(fake_line) == [pa.CANCEL_GONE_REPLY]
    assert len(await _events(app, receipt, "cancelled")) == 1


async def test_cancel_refused_with_bad_token_other_line_or_past_deadline(app, fake_line, admin_client, public_client):
    booked = await _link(app, admin_client, public_client)
    receipt = booked["receipt_id"]
    await _webhook(app, [_postback(_ok(app, receipt, now=datetime.now(timezone.utc) - timedelta(minutes=10)))])
    assert _last_texts(fake_line) == [pa.CANCEL_EXPIRED_REPLY]
    await _webhook(app, [_postback(encode(pa.CANCEL_OK, receipt, "123.abcdefabcdefabcd"))])
    assert _last_texts(fake_line) == [pa.CANCEL_EXPIRED_REPLY]
    await _webhook(app, [_postback(_ok(app, receipt), OTHER_PARENT)])
    assert _last_texts(fake_line) == [pa.CANCEL_GONE_REPLY]
    assert (await _visit(app, receipt)).status == "confirmed"

    # 場次移到兩小時後：過了線上異動期限（預設 24 小時），問與確定都改請來電，「我的預約」不放取消鈕。
    soon = datetime.now(timezone.utc) + timedelta(hours=2)
    async with app.state.session_factory() as db:
        from app.common.timezones import OPERATING_TZ

        local = soon.astimezone(OPERATING_TZ)
        await db.execute(
            update(VisitSlot).values(
                slot_date=local.date(), start_time=local.time().replace(microsecond=0),
                end_time=(local + timedelta(minutes=30)).time().replace(microsecond=0),
            )
        )
        await db.commit()
    if soon.astimezone(OPERATING_TZ).date() != (soon + timedelta(minutes=30)).astimezone(OPERATING_TZ).date():
        pytest.skip("場次跨日")
    for data in (pa.cancel_data(receipt), _ok(app, receipt)):
        await _webhook(app, [_postback(data)])
        assert _last_texts(fake_line)[0].startswith("已過線上修改期限")
    assert (await _visit(app, receipt)).status == "confirmed"
    await _webhook(app, [_said("我的預約")])
    card = fake_line.replies[-1]["body"]["messages"][0]
    assert _datas(card) == []
    assert any(text.startswith("已過線上修改期限") for text in flex_texts(card))


async def test_cancel_when_group_account_is_the_parent_account(app, fake_line, admin_client, public_client):
    """main 帳號被選為家長通知帳號時，一對一的按鈕走同一個 webhook，不會被當成群組按鈕。"""
    booked = await _link_main(app, admin_client, public_client)
    await _webhook(app, [_postback(_ok(app, booked["receipt_id"]))], account="main")
    assert _last_texts(fake_line) == [pa.CANCEL_DONE_REPLY]
    assert fake_line.replies[-1]["account"] == "main"


async def _link_main(app, admin_client, public_client) -> dict:
    from tests.conftest import book_slot, open_manage

    assert (await _enable_parent_line(admin_client, account="main")).status_code == 200
    booked = await book_slot(admin_client, public_client, email=None)
    await open_manage(public_client, booked["manage_path"])
    issued = await public_client.post("/api/website/v1/public/visit-manage/line-notify/code")
    assert issued.status_code == 201, issued.text
    assert (await _webhook(app, [_said(issued.json()["text"])], account="main")).status_code == 200
    return booked


def test_parent_cancel_confirm_card_keeps_alt_text_free_of_details():
    card = line_flex.parent_cancel_confirm("常春藤義華校", "11/28（五）上午場 10:00", ok_data="ivy:pcok:a:b", keep_data="ivy:pcno")
    assert card["altText"] == "確定取消這次參觀？"
    assert "11/28（五）上午場 10:00" in json.dumps(card, ensure_ascii=False)
