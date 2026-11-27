"""2026-11-26 修正：先補 Email、之後才改電話時，通知型訊息送到舊電話的修改連結也要作廢。

_phone_carried_link 原本在「改電話前已有 Email」時直接當成沒送過通知型訊息；但 Email 可以事後才補：沒留 Email
時送出的通知型訊息已經把修改連結送到（可能打錯的）舊電話，家長或園方先存一次補上 Email（不作廢，舊連結也
跟著變更信寄到新信箱），再另一次只改電話時就不查 line_pnp_messages，陌生人手上的連結、session 與他綁上的
LINE 都留著。現在只看「這次改了電話、而且送過可能送達的通知型訊息」。

fixture 與 helper 沿用 test_line_pnp.py（LINE API 全部用 httpx.MockTransport 模擬，不發真的訊息）。"""

from __future__ import annotations

import re
import uuid

import pytest

from tests.conftest import book_slot, open_manage
# fake_line 是 fixture，匯入進來 pytest 才找得到。
from tests.test_line_pnp import (  # noqa: F401
    API,
    MANAGE,
    OTHER_PHONES,
    PARENT,
    PHONE,
    _enable,
    _parent_edit,
    _run_outbox,
    _token_in,
    _webhook,
    fake_line,
)

pytestmark = pytest.mark.usefixtures("booking_consent")

REAL_EMAIL = "real-parent@example.com"


async def _stranger_redeems_and_links_line(app, fake_line, second_public_client) -> str:
    """打錯電話的陌生人點了通知型訊息的「查看詳情」，再用拿到的 session 把自己的 LINE 綁上來。回傳他手上的 token。"""
    stranger_token = _token_in(fake_line.pnp[0])
    assert (await second_public_client.post(f"{MANAGE}/exchange", json={"token": stranger_token})).status_code == 200
    issued = await second_public_client.post(f"{MANAGE}/line-notify/code")
    assert issued.status_code == 201, issued.text
    said = {
        "type": "message",
        "source": {"type": "user", "userId": PARENT},
        "replyToken": uuid.uuid4().hex,
        "timestamp": 0,
        "webhookEventId": uuid.uuid4().hex,
        "message": {"type": "text", "id": "m", "text": issued.json()["text"]},
    }
    assert (await _webhook(app, [said])).status_code == 200
    return stranger_token


async def _staff_edit(admin_client, receipt: str, **changes):
    detail = (await admin_client.get(f"{API}/admin/visit-requests/{receipt}")).json()
    return await admin_client.patch(
        f"{API}/admin/visit-requests/{receipt}/details",
        json={"expected_version": detail["details_version"], **changes},
    )


async def test_parent_adds_email_then_fixes_phone_revokes_the_link_the_stranger_got(
    app, fake_line, admin_client, public_client, second_public_client, db_session, recording_mail_adapter
):
    from app.notifications import line_parent

    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"
    await _enable(admin_client)
    booked = await book_slot(admin_client, public_client, email=None, phone=PHONE)
    receipt = booked["receipt_id"]
    await _run_outbox(app, db_session)
    stranger_token = await _stranger_redeems_and_links_line(app, fake_line, second_public_client)
    assert await line_parent.has_active_link(db_session, uuid.UUID(receipt))

    # 家長先只補 Email（舊的沒有值，不作廢），之後另存一次才把電話改正。
    await open_manage(public_client, booked["manage_path"])
    added = await _parent_edit(public_client, receipt, email=REAL_EMAIL)
    assert added.status_code == 200, added.text
    await _run_outbox(app, db_session, recording_mail_adapter)
    fixed = await _parent_edit(public_client, receipt, phone=OTHER_PHONES[0])
    assert fixed.status_code == 200, fixed.text

    # 陌生人的 session 與舊連結都失效、他綁的 LINE 解除；家長自己正在用的 session 照常。
    db_session.expire_all()
    assert (await second_public_client.get(f"{MANAGE}/me")).status_code == 401
    assert (await second_public_client.post(f"{MANAGE}/exchange", json={"token": stranger_token})).status_code != 200
    assert not await line_parent.has_active_link(db_session, uuid.UUID(receipt))
    assert (await public_client.get(f"{MANAGE}/me")).status_code == 200
    # 換發的新連結跟著變更信寄到補上的 Email，不是陌生人手上那條。
    recording_mail_adapter.sent.clear()
    await _run_outbox(app, db_session, recording_mail_adapter)
    to_parent = [mail for mail in recording_mail_adapter.sent if mail["to"] == REAL_EMAIL]
    assert to_parent, recording_mail_adapter.sent
    new_token = re.search(r"token=([A-Za-z0-9_\-]+)", to_parent[-1]["body"]).group(1)
    assert new_token != stranger_token
    assert (await public_client.post(f"{MANAGE}/exchange", json={"token": new_token})).status_code == 200


async def test_staff_adds_email_then_fixes_phone_revokes_link_and_unlinks_strangers_line(
    app, fake_line, admin_client, public_client, second_public_client, db_session
):
    from app.notifications import line_parent

    await _enable(admin_client)
    booked = await book_slot(admin_client, public_client, email=None, phone=PHONE)
    receipt = booked["receipt_id"]
    await _run_outbox(app, db_session)
    stranger_token = await _stranger_redeems_and_links_line(app, fake_line, second_public_client)

    # 櫃台先只補 Email：原本沒有 Email，連結照舊不動。
    added = await _staff_edit(admin_client, receipt, email=REAL_EMAIL)
    assert added.status_code == 200, added.text
    assert added.json()["access_link_reset"] is False
    # 另存一次只改電話：通知型訊息送過舊電話，比照一次改兩欄作廢。
    fixed = await _staff_edit(admin_client, receipt, phone=OTHER_PHONES[0])
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["access_link_reset"] is True

    db_session.expire_all()
    assert not await line_parent.has_active_link(db_session, uuid.UUID(receipt))
    assert (await second_public_client.get(f"{MANAGE}/me")).status_code == 401
    assert (await second_public_client.post(f"{MANAGE}/exchange", json={"token": stranger_token})).status_code != 200


async def test_stranger_adding_own_email_does_not_shield_the_link_from_a_phone_fix(
    app, fake_line, admin_client, public_client, second_public_client, db_session
):
    """拿到連結的陌生人自己補上 Email（舊的沒有值，不作廢），之後園方只改電話也要作廢。"""
    await _enable(admin_client)
    booked = await book_slot(admin_client, public_client, email=None, phone=PHONE)
    receipt = booked["receipt_id"]
    await _run_outbox(app, db_session)
    stranger_token = _token_in(fake_line.pnp[0])
    assert (await second_public_client.post(f"{MANAGE}/exchange", json={"token": stranger_token})).status_code == 200
    assert (await _parent_edit(second_public_client, receipt, email="stranger@example.com")).status_code == 200

    fixed = await _staff_edit(admin_client, receipt, phone=OTHER_PHONES[0])
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["access_link_reset"] is True
    assert (await second_public_client.get(f"{MANAGE}/me")).status_code == 401
    assert (await second_public_client.post(f"{MANAGE}/exchange", json={"token": stranger_token})).status_code != 200


async def test_phone_change_on_booking_that_had_email_from_the_start_keeps_the_link(
    app, fake_line, admin_client, public_client, db_session
):
    """一開始就留 Email 的預約不送通知型訊息，改電話（家長或園方）都不動連結。"""
    await _enable(admin_client)
    booked = await book_slot(admin_client, public_client, email=REAL_EMAIL, phone=PHONE)
    receipt = booked["receipt_id"]
    await _run_outbox(app, db_session)
    assert not fake_line.pnp
    await open_manage(public_client, booked["manage_path"])
    assert (await _parent_edit(public_client, receipt, phone=OTHER_PHONES[0])).status_code == 200
    fixed = await _staff_edit(admin_client, receipt, phone=OTHER_PHONES[1])
    assert fixed.status_code == 200 and fixed.json()["access_link_reset"] is False
    token = booked["manage_path"].split("token=", 1)[1]
    assert (await public_client.post(f"{MANAGE}/exchange", json={"token": token})).status_code == 200
