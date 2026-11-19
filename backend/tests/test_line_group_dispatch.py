"""園方 LINE 群組推播：多目標（校區群組＋總部群組）、種類開關、即將參觀只給沒開摘要的群組、
當天異動的 @所有人（設計 §4.1、§4.4、§4.5）。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select, update

from app.booking.models import OutboxMessage, VisitRequest, VisitSlot
from app.common.timezones import today_local
from app.notifications import reminders
from app.notifications.line import LineMessagingClient
from app.notifications.models import LineGroupSetting, NotificationDelivery
from app.notifications.service import dispatch_outbox_message
from tests.test_line_notifications import (  # noqa: F401  (fixtures)
    GROUP,
    OTHER_GROUP,
    TOKEN,
    FakeLine,
    _event,
    _setup_case,
    _webhook,
    fake_line,
    line_app,
)
from tests.conftest import book_slot

ALL_KINDS = [
    "visit_request_created",
    "visit_request_confirmed",
    "visit_request_rescheduled",
    "visit_request_cancelled",
]


async def _case(line_app, *, hq: bool = True, slot_today: bool = False) -> str:
    """義華一筆預約；校區群組是 GROUP，hq 為真時 OTHER_GROUP 是總部群組。回傳 receipt_id。"""
    admin, public = await _setup_case(line_app)
    try:
        receipt_id = (await book_slot(admin, public))["receipt_id"]
    finally:
        await admin.aclose()
        await public.aclose()
    await _webhook(line_app, [_event("join", OTHER_GROUP)])
    async with line_app.state.session_factory() as db:
        if hq:
            await db.merge(LineGroupSetting(target_id=OTHER_GROUP, is_hq=True, kinds=ALL_KINDS, updated_at=datetime.now(timezone.utc)))
        if slot_today:
            await db.execute(update(VisitSlot).values(slot_date=today_local()))
        await db.commit()
    return receipt_id


async def _setting(line_app, target_id: str, **fields) -> None:
    async with line_app.state.session_factory() as db:
        await db.merge(LineGroupSetting(target_id=target_id, updated_at=datetime.now(timezone.utc), **fields))
        await db.commit()


async def _outbox(line_app, receipt_id: str, kind: str = "visit_request_created") -> uuid.UUID:
    """dispatch 會寫 notification_deliveries（外鍵指向 outbox），所以要有真的 outbox 列。"""
    now = datetime.now(timezone.utc)
    row = OutboxMessage(
        id=uuid.uuid4(), visit_request_id=uuid.UUID(receipt_id), kind=kind,
        payload={"receipt_id": receipt_id}, created_at=now, next_attempt_at=now,
    )
    async with line_app.state.session_factory() as db:
        db.add(row)
        await db.commit()
    return row.id


async def _dispatch(line_app, fake_line, receipt_id: str, kind: str = "visit_request_created", outbox_id=None):
    outbox_id = outbox_id or await _outbox(line_app, receipt_id, kind)
    line = LineMessagingClient(TOKEN, transport=fake_line.transport())
    try:
        async with line_app.state.session_factory() as db:
            return await dispatch_outbox_message(
                db,
                outbox_message_id=outbox_id,
                campus_key="yihua",
                kind=kind,
                payload={"receipt_id": receipt_id},
                adapter=None,
                line=line,
                admin_origin="https://ivy.example",
            )
    finally:
        await line.aclose()


def _targets(fake_line) -> list[str]:
    return [p["body"]["to"] for p in fake_line.pushes]


async def test_campus_and_hq_group_both_receive_new_booking(line_app, fake_line):
    receipt = await _case(line_app)
    await _dispatch(line_app, fake_line, receipt)
    assert sorted(_targets(fake_line)) == sorted([GROUP, OTHER_GROUP])


async def test_kind_toggle_off_skips_that_group_only(line_app, fake_line):
    receipt = await _case(line_app)
    await _setting(line_app, OTHER_GROUP, is_hq=True, kinds=[k for k in ALL_KINDS if k != "visit_request_cancelled"])
    await _dispatch(line_app, fake_line, receipt, "visit_request_cancelled")
    assert _targets(fake_line) == [GROUP]
    async with line_app.state.session_factory() as db:
        keys = (await db.execute(select(NotificationDelivery.recipient_key).where(NotificationDelivery.channel == "line"))).scalars().all()
    assert OTHER_GROUP not in keys


async def test_upcoming_visit_not_pushed_to_digest_group_but_pushed_when_digest_off(line_app, fake_line):
    receipt = await _case(line_app)
    await _setting(line_app, OTHER_GROUP, is_hq=True, kinds=ALL_KINDS, digest_enabled=False)
    await _setting(line_app, GROUP, kinds=ALL_KINDS, digest_enabled=True)
    async with line_app.state.session_factory() as db:
        request = (await db.execute(select(VisitRequest).where(VisitRequest.id == uuid.UUID(receipt)))).scalar_one()
        payload = {"receipt_id": receipt, "visit_request_id": str(request.id), "slot_id": str(request.slot_id)}
    line = LineMessagingClient(TOKEN, transport=fake_line.transport())
    try:
        async with line_app.state.session_factory() as db:
            await dispatch_outbox_message(
                db, outbox_message_id=await _outbox(line_app, receipt, reminders.UPCOMING_VISIT_KIND), campus_key="yihua", kind=reminders.UPCOMING_VISIT_KIND,
                payload=payload, adapter=None, line=line, admin_origin="https://ivy.example",
            )
    finally:
        await line.aclose()
    assert _targets(fake_line) == [OTHER_GROUP]


async def test_same_day_booking_adds_everyone_mention_as_second_message(line_app, fake_line):
    receipt = await _case(line_app, slot_today=True)
    await _dispatch(line_app, fake_line, receipt)
    assert len(fake_line.pushes) == 2
    for push in fake_line.pushes:
        messages = push["body"]["messages"]
        assert len(messages) == 2
        assert messages[1]["type"] == "textV2"
        assert messages[1]["substitution"]["everyone"]["mentionee"]["type"] == "all"


async def test_future_slot_has_no_mention(line_app, fake_line):
    receipt = await _case(line_app)
    await _dispatch(line_app, fake_line, receipt)
    assert all(len(p["body"]["messages"]) == 1 for p in fake_line.pushes)


async def test_confirmed_kind_never_mentions(line_app, fake_line):
    receipt = await _case(line_app, slot_today=True)
    await _dispatch(line_app, fake_line, receipt, "visit_request_confirmed")
    assert all(len(p["body"]["messages"]) == 1 for p in fake_line.pushes)


async def test_mention_all_off_sends_card_only(line_app, fake_line):
    receipt = await _case(line_app, slot_today=True)
    await _setting(line_app, OTHER_GROUP, is_hq=True, kinds=ALL_KINDS, mention_all_same_day=False)
    await _dispatch(line_app, fake_line, receipt)
    by_target = {p["body"]["to"]: len(p["body"]["messages"]) for p in fake_line.pushes}
    assert by_target == {GROUP: 2, OTHER_GROUP: 1}


async def test_retry_only_resends_failed_group(line_app, fake_line):
    receipt = await _case(line_app)
    outbox_id = await _outbox(line_app, receipt)
    fake_line.push_status = [200, 429]
    with pytest.raises(Exception):
        await _dispatch(line_app, fake_line, receipt, outbox_id=outbox_id)
    assert len(fake_line.pushes) == 1
    done = fake_line.pushes[0]["body"]["to"]
    await _dispatch(line_app, fake_line, receipt, outbox_id=outbox_id)
    assert len(fake_line.pushes) == 2
    assert fake_line.pushes[1]["body"]["to"] != done


async def test_failing_group_does_not_block_other_group_or_email(line_app, fake_line, recording_mail_adapter):
    receipt = await _case(line_app)
    fake_line.push_status = [429]
    outbox_id = await _outbox(line_app, receipt)
    line = LineMessagingClient(TOKEN, transport=fake_line.transport())
    try:
        async with line_app.state.session_factory() as db:
            with pytest.raises(Exception):
                await dispatch_outbox_message(
                    db, outbox_message_id=outbox_id, campus_key="yihua", kind="visit_request_created",
                    payload={"receipt_id": receipt}, adapter=recording_mail_adapter, line=line,
                    admin_origin="https://ivy.example",
                )
    finally:
        await line.aclose()
    assert len(fake_line.pushes) == 1  # 第一個失敗、第二個照推
    assert recording_mail_adapter.sent


async def test_group_that_left_gets_nothing(line_app, fake_line):
    receipt = await _case(line_app)
    await _webhook(line_app, [_event("leave", OTHER_GROUP)])
    await _dispatch(line_app, fake_line, receipt)
    assert _targets(fake_line) == [GROUP]


async def test_non_staff_kinds_still_reach_the_campus_group(line_app, fake_line):
    receipt = await _case(line_app, hq=False)
    await _setting(line_app, GROUP, kinds=[])
    await _dispatch(line_app, fake_line, receipt, "visit_request_hold_expired")
    assert _targets(fake_line) == [GROUP]


@pytest.mark.parametrize("kind", ["visit_request_rescheduled", "visit_request_cancelled"])
async def test_same_day_reschedule_and_cancel_add_everyone_mention(line_app, fake_line, kind):
    receipt = await _case(line_app, slot_today=True)
    await _dispatch(line_app, fake_line, receipt, kind)
    assert len(fake_line.pushes) == 2
    for push in fake_line.pushes:
        messages = push["body"]["messages"]
        assert len(messages) == 2
        assert messages[1]["type"] == "textV2"
        assert messages[1]["substitution"]["everyone"]["mentionee"]["type"] == "all"
