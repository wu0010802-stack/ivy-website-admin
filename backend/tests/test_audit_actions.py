"""2026-09-25 缺口 67：時段、案件狀態轉換、聯絡紀錄、改期核准／退回、素材
上傳／更新／替換都要留稽核，而且 metadata 不含家長個資與自由文字。"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app.operations.models import AuditLogEntry
from tests.conftest import start_visit_slot
from tests.test_visit_case_handling import _parent_asks_for

pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
BASE = f"{API}/admin"
FIXTURES = Path("/tmp/media-fixtures")
PARENT = "稽核測試媽媽"
PHONE = "0911222333"
FREE_TEXT = "家長說孩子叫小明，住在中正路"


async def _entries(db_session, action: str) -> list[AuditLogEntry]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars())


def _assert_no_personal_data(entry: AuditLogEntry) -> None:
    dumped = json.dumps(entry.metadata_json, ensure_ascii=False)
    for text in (PARENT, PHONE, FREE_TEXT, "小明"):
        assert text not in dumped


async def _slot(client, *, days_ahead=3, start="10:00:00", end="11:00:00", capacity=2) -> dict:
    response = await client.post(
        f"{BASE}/slots?campus_key=yihua",
        json={
            "slot_date": (date.today() + timedelta(days=days_ahead)).isoformat(),
            "start_time": start,
            "end_time": end,
            "capacity": capacity,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _manual_case(client, key: str) -> str:
    response = await client.post(
        f"{BASE}/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": PARENT, "phone": PHONE, "consent_given": True},
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.mark.asyncio
async def test_slot_create_and_update_are_audited(admin_client, db_session):
    slot = await _slot(admin_client)
    [created] = await _entries(db_session, "visit_slot.create")
    assert created.target_type == "visit_slot"
    assert created.target_id == slot["id"]
    assert created.campus_key == "yihua"
    assert created.metadata_json["slot"]["start"] == "10:00"

    closed = await admin_client.patch(
        f"{BASE}/slots/{slot['id']}", json={"closed": True, "expected_version": slot["version"]}
    )
    assert closed.status_code == 200, closed.text
    [updated] = await _entries(db_session, "visit_slot.update")
    assert updated.metadata_json["before"] == {"capacity": 2, "closed": False}
    assert updated.metadata_json["after"] == {"capacity": 2, "closed": True}

    # 沒有真的改到東西不另記一筆。
    same = await admin_client.patch(
        f"{BASE}/slots/{slot['id']}", json={"closed": True, "expected_version": closed.json()["version"]}
    )
    assert same.status_code == 200, same.text
    assert len(await _entries(db_session, "visit_slot.update")) == 1


@pytest.mark.asyncio
async def test_case_transitions_and_contact_notes_are_audited(admin_client, db_session):
    slot = await _slot(admin_client)
    other = await _slot(admin_client, days_ahead=4, start="14:00:00", end="15:00:00")
    case_id = await _manual_case(admin_client, "audit-case-01")

    assert (await admin_client.post(f"{BASE}/visit-requests/{case_id}/contacting")).status_code == 200
    # 重送開始聯絡是冪等的，不重複記。
    assert (await admin_client.post(f"{BASE}/visit-requests/{case_id}/contacting")).status_code == 200
    note = await admin_client.post(
        f"{BASE}/visit-requests/{case_id}/contact-notes", json={"note": FREE_TEXT}
    )
    assert note.status_code == 201, note.text
    confirmed = await admin_client.post(f"{BASE}/visit-requests/{case_id}/confirm", json={"slot_id": slot["id"]})
    assert confirmed.status_code == 200, confirmed.text
    moved = await admin_client.post(
        f"{BASE}/visit-requests/{case_id}/reschedule", json={"new_slot_id": other["id"], "reason": FREE_TEXT}
    )
    assert moved.status_code == 200, moved.text
    await start_visit_slot(db_session, case_id)
    done = await admin_client.post(f"{BASE}/visit-requests/{case_id}/complete")
    assert done.status_code == 200, done.text

    [contacting] = await _entries(db_session, "visit_request.contacting")
    assert contacting.metadata_json == {"from_status": "new", "to_status": "contacting"}
    [noted] = await _entries(db_session, "visit_request.add_contact_note")
    assert noted.metadata_json == {"note_id": note.json()["id"], "follow_up_set": False}
    [confirm] = await _entries(db_session, "visit_request.confirm")
    assert confirm.metadata_json["from_status"] == "contacting"
    assert confirm.metadata_json["slot"]["id"] == slot["id"]
    [reschedule] = await _entries(db_session, "visit_request.reschedule")
    assert reschedule.metadata_json["from_slot"]["id"] == slot["id"]
    assert reschedule.metadata_json["to_slot"]["id"] == other["id"]
    assert reschedule.metadata_json["has_reason"] is True
    [complete] = await _entries(db_session, "visit_request.complete")
    assert complete.metadata_json == {"from_status": "confirmed", "to_status": "completed"}

    for entry in (contacting, noted, confirm, reschedule, complete):
        assert entry.target_type == "visit_request"
        assert entry.target_id == case_id
        assert entry.campus_key == "yihua"
        _assert_no_personal_data(entry)


@pytest.mark.asyncio
async def test_cancel_and_no_show_are_audited_without_reason_text(admin_client, db_session):
    slot = await _slot(admin_client)
    cancelled_id = await _manual_case(admin_client, "audit-case-02")
    cancel = await admin_client.post(f"{BASE}/visit-requests/{cancelled_id}/cancel", json={"reason": FREE_TEXT})
    assert cancel.status_code == 200, cancel.text
    # 取消是冪等的：第二次不再記。
    assert (await admin_client.post(f"{BASE}/visit-requests/{cancelled_id}/cancel")).status_code == 200

    no_show_id = await _manual_case(admin_client, "audit-case-03")
    assert (
        await admin_client.post(f"{BASE}/visit-requests/{no_show_id}/confirm", json={"slot_id": slot["id"]})
    ).status_code == 200
    await start_visit_slot(db_session, no_show_id)
    assert (await admin_client.post(f"{BASE}/visit-requests/{no_show_id}/no-show")).status_code == 200

    [cancelled] = await _entries(db_session, "visit_request.cancel")
    assert cancelled.metadata_json == {"from_status": "new", "to_status": "cancelled", "has_reason": True}
    _assert_no_personal_data(cancelled)
    [no_show] = await _entries(db_session, "visit_request.no_show")
    assert no_show.target_id == no_show_id
    assert no_show.metadata_json == {"from_status": "confirmed", "to_status": "no_show"}


@pytest.mark.asyncio
async def test_reschedule_request_decisions_are_audited(app, admin_client, db_session):
    slot_a = await _slot(admin_client)
    slot_b = await _slot(admin_client, days_ahead=4, start="14:00:00", end="15:00:00")
    case_id = await _manual_case(admin_client, "audit-case-04")
    assert (
        await admin_client.post(f"{BASE}/visit-requests/{case_id}/confirm", json={"slot_id": slot_a["id"]})
    ).status_code == 200

    first = await _parent_asks_for(app, admin_client, case_id, slot_b["id"])
    rejected = await admin_client.post(f"{BASE}/reschedule-requests/{first}/reject", json={"reason": FREE_TEXT})
    assert rejected.status_code == 200, rejected.text
    second = await _parent_asks_for(app, admin_client, case_id, slot_b["id"])
    approved = await admin_client.post(f"{BASE}/reschedule-requests/{second}/approve")
    assert approved.status_code == 200, approved.text

    [reject] = await _entries(db_session, "visit_request.reject_reschedule")
    assert reject.metadata_json == {
        "reschedule_request_id": first,
        "requested_slot_id": slot_b["id"],
        "has_reason": True,
    }
    _assert_no_personal_data(reject)
    [approve] = await _entries(db_session, "visit_request.approve_reschedule")
    assert approve.metadata_json == {
        "reschedule_request_id": second,
        "from_slot_id": slot_a["id"],
        "to_slot_id": slot_b["id"],
    }


@pytest.mark.asyncio
async def test_media_upload_update_and_replace_are_audited(admin_client, db_session):
    image = (FIXTURES / "test.jpg").read_bytes()
    uploaded = await admin_client.post(
        f"{BASE}/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("小明的照片.jpg", image, "image/jpeg")},
    )
    assert uploaded.status_code == 201, uploaded.text
    asset = uploaded.json()

    patched = await admin_client.patch(
        f"{BASE}/media/{asset['id']}",
        json={"alt_text": FREE_TEXT, "tags": ["戶外"], "expected_version": asset["version"]},
    )
    assert patched.status_code == 200, patched.text
    replaced = await admin_client.post(
        f"{BASE}/media/{asset['id']}/replace", files={"file": ("new.jpg", image, "image/jpeg")}
    )
    assert replaced.status_code == 201, replaced.text

    [upload] = await _entries(db_session, "media.upload")
    assert upload.target_type == "media_asset"
    assert upload.target_id == asset["id"]
    assert upload.campus_key == "yihua"
    assert upload.metadata_json == {
        "kind": "image",
        "content_type": "image/jpeg",
        "size_bytes": len(image),
        "status": "ready",
    }
    [update] = await _entries(db_session, "media.update")
    assert update.metadata_json == {"fields": ["alt_text", "tags"]}
    [replace] = await _entries(db_session, "media.replace")
    assert replace.target_id == replaced.json()["id"]
    assert replace.metadata_json["replaces_media_id"] == asset["id"]
    for entry in (upload, update, replace):
        _assert_no_personal_data(entry)
