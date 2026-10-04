"""新案通知信：收件人依 booking.handle（含接待人員）；內文有校名、家長稱呼、
參觀時段與後台連結，但不放手機、Email 與孩子資料。"""

from __future__ import annotations

from datetime import date

import pytest

from app.auth.models import Role
from app.notifications.service import parent_salutation
from app.workers.runner import process_outbox_batch
from tests.conftest import _create_user, book_slot


# 預約表單要有已發布的同意文字（切 slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
ADMIN_ORIGIN = "https://www.ivy.example"


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("陳媽媽", "陳小姐"),
        ("林先生", "林先生"),
        ("王爸爸", "王先生"),
        ("張小姐", "張小姐"),
        ("歐陽媽咪", "歐陽小姐"),
        ("陳怡君媽媽", "陳小姐"),
        ("陳怡君", "家長"),
        ("媽媽", "家長"),
        ("Amy 媽媽", "家長"),
        ("", "家長"),
        (None, "家長"),
    ],
)
def test_parent_salutation_only_uses_surname_and_title(name, expected):
    assert parent_salutation(name) == expected


@pytest.mark.asyncio
async def test_reception_receives_new_request_mail(
    admin_client, public_client, db_session, recording_mail_adapter
):
    await _create_user(db_session, "desk@ivy.example", "desk-password-1234", Role.RECEPTION, ["yihua"])
    await _create_user(db_session, "desk-mh@ivy.example", "desk-password-5678", Role.RECEPTION, ["minghua"])
    await _create_user(db_session, "ed@ivy.example", "editor-password-12", Role.EDITOR, ["yihua"])
    await _create_user(db_session, "ro@ivy.example", "readonly-password-1", Role.READONLY, ["yihua"])
    booked = await book_slot(
        admin_client, public_client, days_ahead=4, child_name="小寶", email="parent@example.com"
    )
    receipt_id = booked["receipt_id"]

    await process_outbox_batch(db_session, recording_mail_adapter, limit=10, admin_origin=ADMIN_ORIGIN)

    # 園方信不寄給家長；家長確認信另有 Email 通道，這裡只看園方收件人。
    staff_mails = [mail for mail in recording_mail_adapter.sent if mail["to"] != "parent@example.com"]
    created_mails = [mail for mail in staff_mails if mail["subject"] == "[常春藤官網] 義華校｜新的參觀預約"]
    assert sorted(mail["to"] for mail in created_mails) == ["admin@ivy.example", "desk@ivy.example"]
    assert sorted({mail["to"] for mail in staff_mails}) == ["admin@ivy.example", "desk@ivy.example"]
    body = created_mails[0]["body"]
    assert "校區：義華校" in body
    assert "家長：陳小姐" in body
    assert f"案件：{ADMIN_ORIGIN}/admin/visit-requests/{receipt_id}" in body
    # 家長選了場次，園方信要寫參觀時段。
    slot_day = date.fromisoformat(booked["slot_date"])
    weekday = "一二三四五六日"[slot_day.weekday()]
    assert f"參觀時段：{slot_day:%Y/%m/%d}（週{weekday}）10:00–11:00" in body
    for mail in staff_mails:
        for secret in ("0912345678", "陳媽媽", "小寶", "parent@example.com"):
            assert secret not in mail["body"]


@pytest.mark.asyncio
async def test_slot_request_mail_includes_visit_time(admin_client, public_client, db_session, recording_mail_adapter):
    booked = await book_slot(admin_client, public_client, days_ahead=4, parent_name="林先生")
    slot_day = date.fromisoformat(booked["slot_date"])
    receipt_id = booked["receipt_id"]

    # 沒有設定 admin origin 時退回案件編號。
    await process_outbox_batch(db_session, recording_mail_adapter, limit=10)

    staff_mails = [mail for mail in recording_mail_adapter.sent if mail["to"] != "parent@example.com"]
    bodies = [mail["body"] for mail in staff_mails]
    assert bodies, "應該有寄出通知"
    weekday = "一二三四五六日"[slot_day.weekday()]
    expected_when = f"參觀時段：{slot_day:%Y/%m/%d}（週{weekday}）10:00–11:00"
    assert all(expected_when in body for body in bodies)
    assert all("家長：林先生" in body for body in bodies)
    assert all(f"案件編號：{receipt_id}" in body for body in bodies)
    # 送單即預約成立：園方每人只收一封「新的參觀預約」，不再另寄「已確認」。
    assert sorted(mail["subject"] for mail in staff_mails) == ["[常春藤官網] 義華校｜新的參觀預約"]
    subjects = {mail["subject"] for mail in staff_mails}
    assert not any("待園方確認" in subject for subject in subjects)
