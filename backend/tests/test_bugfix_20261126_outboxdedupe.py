"""變更信去重不能併進「已有管道送出、等重試」的 pending 訊息（2026-11-26 修正）。

家長同時有 Email 與 LINE 時，一個管道送成、另一個失敗，整筆訊息回到 pending 等重試；重試只補沒送成的管道。
這時再有變更（園方改期、重新產生連結、更正 Email）若被併進這封，送成的那個管道就永遠收不到新內容。
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select

from app.booking.models import OutboxMessage
from app.notifications.models import LinePnpMessage, NotificationDelivery
from tests import test_line_pnp as pnp
from tests.conftest import book_slot, create_slot
from tests.test_line_integrations_20261116 import (  # noqa: F401 —— fake_line 是 fixture
    API,
    PARENT,
    _link,
    _run_outbox,
    fake_line,
)

pytestmark = pytest.mark.usefixtures("booking_consent")

PARENT_EMAIL = "parent@example.com"


class _FlakyMail:
    """寄給家長的信可以指定先失敗幾次（例如 SMTP 暫時連不上），其他照常記下。"""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.parent_failures = 0

    def send(self, *, to: str, subject: str, body: str) -> None:
        if to == PARENT_EMAIL and self.parent_failures:
            self.parent_failures -= 1
            raise RuntimeError("模擬寄信失敗")
        self.sent.append({"to": to, "subject": subject, "body": body})


def _enable_mail(app) -> None:
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"


async def _retry_now(db_session) -> None:
    await db_session.execute(OutboxMessage.__table__.update().values(next_attempt_at=OutboxMessage.created_at))
    await db_session.commit()


async def _changed(db_session, receipt: str) -> list[OutboxMessage]:
    return (
        await db_session.scalars(
            select(OutboxMessage)
            .where(OutboxMessage.visit_request_id == uuid.UUID(receipt), OutboxMessage.kind == "parent_visit_changed")
            .order_by(OutboxMessage.created_at)
            .execution_options(populate_existing=True)
        )
    ).all()


async def _channels(db_session, message_id: uuid.UUID) -> set[str]:
    return set(
        (
            await db_session.scalars(
                select(NotificationDelivery.channel).where(NotificationDelivery.outbox_message_id == message_id)
            )
        ).all()
    )


async def _reschedule(admin_client, receipt: str, slot_id: str) -> None:
    response = await admin_client.post(f"{API}/admin/visit-requests/{receipt}/reschedule", json={"new_slot_id": slot_id})
    assert response.status_code == 200, response.text


async def _email_sent_line_retrying(app, fake_line, admin_client, public_client, db_session, mail) -> str:  # noqa: F811
    """家長留了 Email 也綁了 LINE；園方改到 09:00，信寄出了、LINE 回 429（額度用完），變更信回到 pending。"""
    _enable_mail(app)
    booked = await _link(app, admin_client, public_client, email=PARENT_EMAIL)
    await _run_outbox(app, db_session, mail)  # 預約成功信（Email＋LINE）先送完
    receipt = booked["receipt_id"]
    slot_a = await create_slot(admin_client, days_ahead=5, start_time="09:00:00", end_time="09:30:00")
    await _reschedule(admin_client, receipt, slot_a)
    fake_line.push_status = [429]
    first = await _run_outbox(app, db_session, mail)
    assert first["failed"] == 1
    [m1] = await _changed(db_session, receipt)
    assert m1.status == "pending" and await _channels(db_session, m1.id) == {"email"}
    assert any(m["to"] == PARENT_EMAIL and "09:00" in m["body"] for m in mail.sent)
    return receipt


async def test_second_change_reaches_email_while_line_retries(
    app, fake_line, admin_client, public_client, db_session, recording_mail_adapter  # noqa: F811
):
    """園方發現改錯、再改到 15:00：家長信箱要收到 15:00，不能只收到 09:00 那封。"""
    receipt = await _email_sent_line_retrying(app, fake_line, admin_client, public_client, db_session, recording_mail_adapter)
    slot_b = await create_slot(admin_client, days_ahead=6, start_time="15:00:00", end_time="15:30:00")
    await _reschedule(admin_client, receipt, slot_b)
    assert len(await _changed(db_session, receipt)) == 2, "已寄出 Email 的那封不能再併入新的變更"

    await _retry_now(db_session)
    await _run_outbox(app, db_session, recording_mail_adapter)
    parent_mails = [m for m in recording_mail_adapter.sent if m["to"] == PARENT_EMAIL]
    assert any("15:00" in m["body"] for m in parent_mails), "第二次變更（15:00）要寄到家長 Email"
    parent_pushes = [p for p in fake_line.pushes if p["body"]["to"] == PARENT]
    assert any("15:00" in json.dumps(p["body"], ensure_ascii=False) for p in parent_pushes)


@pytest.mark.parametrize("action", ["regenerate", "staff_email"])
async def test_new_link_is_mailed_while_line_retries(
    app, fake_line, admin_client, public_client, db_session, recording_mail_adapter, action  # noqa: F811
):
    """Email 已送、LINE 待重試時，園方重新產生家長連結或更正 Email：新連結要真的寄出去。"""
    receipt = await _email_sent_line_retrying(app, fake_line, admin_client, public_client, db_session, recording_mail_adapter)
    before = len(recording_mail_adapter.sent)
    case = f"{API}/admin/visit-requests/{receipt}"
    if action == "regenerate":
        response = await admin_client.post(f"{case}/access-link")
        assert response.status_code == 200, response.text
        assert response.json()["emailed"] is True
        token = response.json()["manage_url_fragment"].split("token=", 1)[1]
        to = PARENT_EMAIL
    else:
        version = (await admin_client.get(case)).json()["details_version"]
        response = await admin_client.patch(f"{case}/details", json={"expected_version": version, "email": "fixed@example.com"})
        assert response.status_code == 200, response.text
        token = None
        to = "fixed@example.com"

    await _retry_now(db_session)
    await _run_outbox(app, db_session, recording_mail_adapter)
    later = [m for m in recording_mail_adapter.sent[before:] if m["to"] == to]
    assert later, "新連結沒有寄給家長"
    assert any((token in m["body"]) if token else ("token=" in m["body"]) for m in later)


async def test_second_change_reaches_line_while_email_retries(app, fake_line, admin_client, public_client, db_session):  # noqa: F811
    """反過來：LINE 推成、Email 失敗等重試時再改期，家長的 LINE 也要收到新的時間。"""
    _enable_mail(app)
    mail = _FlakyMail()
    booked = await _link(app, admin_client, public_client, email=PARENT_EMAIL)
    await _run_outbox(app, db_session, mail)
    receipt = booked["receipt_id"]
    slot_a = await create_slot(admin_client, days_ahead=5, start_time="09:00:00", end_time="09:30:00")
    slot_b = await create_slot(admin_client, days_ahead=6, start_time="15:00:00", end_time="15:30:00")
    await _reschedule(admin_client, receipt, slot_a)
    mail.parent_failures = 1
    first = await _run_outbox(app, db_session, mail)
    assert first["failed"] == 1
    [m1] = await _changed(db_session, receipt)
    assert m1.status == "pending" and await _channels(db_session, m1.id) == {"line"}

    await _reschedule(admin_client, receipt, slot_b)
    await _retry_now(db_session)
    await _run_outbox(app, db_session, mail)
    parent_pushes = [p for p in fake_line.pushes if p["body"]["to"] == PARENT]
    assert any("15:00" in json.dumps(p["body"], ensure_ascii=False) for p in parent_pushes), "LINE 要收到 15:00"
    assert any(m["to"] == PARENT_EMAIL and "15:00" in m["body"] for m in mail.sent)


async def test_changes_still_coalesce_before_anything_is_sent(app, admin_client, public_client, db_session):
    """還沒有任何管道送出的變更信照舊合併：連續改兩次只排一封（內容在寄件當下才組）。"""
    _enable_mail(app)
    booked = await book_slot(admin_client, public_client, email=PARENT_EMAIL)
    receipt = booked["receipt_id"]
    slot_a = await create_slot(admin_client, days_ahead=5, start_time="09:00:00", end_time="09:30:00")
    slot_b = await create_slot(admin_client, days_ahead=6, start_time="15:00:00", end_time="15:30:00")
    await _reschedule(admin_client, receipt, slot_a)
    await _reschedule(admin_client, receipt, slot_b)
    assert len(await _changed(db_session, receipt)) == 1


@pytest.fixture
def pnp_line(app) -> pnp.FakeLine:
    """通知型訊息用的 LINE（hq 帳號開通通知型訊息），同 tests/test_line_pnp.py 的 fake_line。"""
    fake = pnp.FakeLine()
    settings = app.state.settings
    settings.line_hq_channel_secret = pnp.HQ_SECRET
    settings.line_hq_access_token = pnp.HQ_TOKEN
    settings.line_yihua_channel_secret = pnp.YIHUA_SECRET
    settings.line_yihua_access_token = pnp.YIHUA_TOKEN
    settings.line_pnp_accounts = "hq"
    settings.admin_origin = "https://admin.ivy.example"
    settings.public_origin = pnp.ORIGIN
    app.state.line_transport = fake.transport()
    return fake


async def test_second_change_reaches_pnp_after_an_attempted_pnp(app, pnp_line, admin_client, public_client, db_session):
    """通知型訊息已經嘗試過（呼叫 LINE 時出了不是「確定沒送出」的錯，line_pnp_messages 那列留著、整筆回到 pending）：
    重試不再送通知型訊息，之後的變更要另排一則，家長才收得到新的時間。"""
    assert (await pnp._enable(admin_client)).status_code == 200
    booked = await book_slot(admin_client, public_client, email=None, phone=pnp.PHONE)
    await pnp._run_outbox(app, db_session)
    assert len(pnp_line.pnp) == 1
    receipt = booked["receipt_id"]
    slot_a = await create_slot(admin_client, days_ahead=5, start_time="09:00:00", end_time="09:30:00")
    slot_b = await create_slot(admin_client, days_ahead=6, start_time="15:00:00", end_time="15:30:00")
    await _reschedule(admin_client, receipt, slot_a)
    pnp_line.pnp_results = [RuntimeError("預期外的錯")]
    first = await pnp._run_outbox(app, db_session)
    assert first["failed"] == 1
    [m1] = await _changed(db_session, receipt)
    assert m1.status == "pending"
    assert await db_session.scalar(select(LinePnpMessage.id).where(LinePnpMessage.outbox_message_id == m1.id))

    await _reschedule(admin_client, receipt, slot_b)
    await _retry_now(db_session)
    await pnp._run_outbox(app, db_session)
    when = [sent["body"]["body"].get("emphasizedItem", {}).get("content", "") for sent in pnp_line.pnp]
    assert any("15:00" in text for text in when), f"通知型訊息要送出 15:00：{when}"
