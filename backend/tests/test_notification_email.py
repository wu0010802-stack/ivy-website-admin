"""新案通知信：收件人依 booking.handle（含接待人員）；內文有校名、家長稱呼、
參觀時段與後台連結，但不放手機、Email 與孩子資料。"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.auth.models import Role
from app.notifications.service import parent_salutation
from app.workers.runner import process_outbox_batch
from tests.conftest import _create_user

API = "/api/website/v1"
ADMIN_ORIGIN = "https://www.ivy.example"


async def _set_mode(admin_client, **config):
    current = await admin_client.get(f"{API}/admin/booking-config/yihua")
    await admin_client.patch(
        f"{API}/admin/booking-config/yihua", json={"expected_version": current.json()["version"], **config}
    )
    return (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()["version"]


async def _submit(public_client, version, key, **extra):
    response = await public_client.post(
        f"{API}/public/visit-requests",
        json={
            "campus_key": "yihua",
            "config_version": version,
            "parent_name": "陳媽媽",
            "phone": "0912345678",
            "child_name": "小寶",
            "email": "parent@example.com",
            "consent_given": True,
            **extra,
        },
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 201, response.text
    return response.json()["receipt_id"]


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
    version = await _set_mode(admin_client, mode="inquiry")
    receipt_id = await _submit(public_client, version, "mail-desk-01")

    await process_outbox_batch(db_session, recording_mail_adapter, limit=10, admin_origin=ADMIN_ORIGIN)

    recipients = sorted(mail["to"] for mail in recording_mail_adapter.sent)
    assert recipients == ["admin@ivy.example", "desk@ivy.example"]
    mail = recording_mail_adapter.sent[0]
    assert mail["subject"] == "[常春藤官網] 義華校｜新的參觀需求"
    body = mail["body"]
    assert "校區：義華校" in body
    assert "家長：陳小姐" in body
    assert f"案件：{ADMIN_ORIGIN}/admin/visit-requests/{receipt_id}" in body
    # inquiry 沒有時段，不寫參觀時段那一行。
    assert "參觀時段" not in body
    for secret in ("0912345678", "陳媽媽", "小寶", "parent@example.com"):
        assert secret not in body


@pytest.mark.asyncio
async def test_slot_request_mail_includes_visit_time(admin_client, public_client, db_session, recording_mail_adapter):
    version = await _set_mode(admin_client, mode="slots")
    slot_day = date.today() + timedelta(days=4)
    slot = await admin_client.post(
        f"{API}/admin/slots?campus_key=yihua",
        json={"slot_date": slot_day.isoformat(), "start_time": "10:00:00", "end_time": "11:00:00", "capacity": 2},
    )
    receipt_id = await _submit(public_client, version, "mail-slot-01", slot_id=slot.json()["id"], parent_name="林先生")

    # 沒有設定 admin origin 時退回案件編號。
    await process_outbox_batch(db_session, recording_mail_adapter, limit=10)

    bodies = [mail["body"] for mail in recording_mail_adapter.sent]
    assert bodies, "應該有寄出通知"
    weekday = "一二三四五六日"[slot_day.weekday()]
    expected_when = f"參觀時段：{slot_day:%Y/%m/%d}（週{weekday}）10:00–11:00"
    assert all(expected_when in body for body in bodies)
    assert all("家長：林先生" in body for body in bodies)
    assert all(f"案件編號：{receipt_id}" in body for body in bodies)
    subjects = {mail["subject"] for mail in recording_mail_adapter.sent}
    assert "[常春藤官網] 義華校｜新的時段申請（待園方確認）" in subjects
