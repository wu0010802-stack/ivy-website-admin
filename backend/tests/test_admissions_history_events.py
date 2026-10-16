"""招生歷程加「修改招生資料」「排下次聯絡」（docs/specs/2026-10-15-admissions-history-events-design.md）。

兩種都是官網專用事件：只記欄位名與日期，不記內容；匯出給園務時不轉。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.admissions import constants, export, retention
from app.admissions.models import RecruitmentEventLog
from app.auth.models import User
from tests.admissions_helpers import ADMISSIONS, create_record, reception_yihua_client, record_at_stage  # noqa: F401

RECORDS = f"{ADMISSIONS}/records"


def _in(**delta) -> str:
    return (datetime.now(timezone.utc) + timedelta(**delta)).isoformat()


async def _events(client, record: dict, event_type: str | None = None) -> list[dict]:
    response = await client.get(f"{RECORDS}/{record['id']}/events")
    assert response.status_code == 200, response.text
    return [event for event in response.json() if event_type is None or event["event_type"] == event_type]


async def _event_types(client, record: dict) -> list[str]:
    return [event["event_type"] for event in await _events(client, record)]


async def _patch(client, record: dict, **changes):
    return await client.patch(f"{RECORDS}/{record['id']}", json={"expected_version": record["version"], **changes})


async def _follow_up(client, record: dict, **changes):
    return await client.patch(
        f"{RECORDS}/{record['id']}/follow-up", json={"expected_version": record["version"], **changes}
    )


async def _history_rows(db_session, record: dict) -> list:
    """資料庫裡這筆訪視的歷程（舊到新），只取類型與 metadata。"""
    result = await db_session.execute(
        select(RecruitmentEventLog.event_type, RecruitmentEventLog.metadata_json)
        .where(RecruitmentEventLog.recruitment_visit_id == uuid.UUID(record["id"]))
        .order_by(RecruitmentEventLog.created_at)
    )
    return list(result.all())


def test_both_types_are_website_only():
    assert constants.EVENT_TYPES[-2:] == ("details_updated", "follow_up_updated")
    assert constants.WEBSITE_ONLY_EVENT_TYPES == ("created", "details_updated", "follow_up_updated")
    assert constants.DETAILS_ORIGIN_SYNC == "visit_request_sync"


@pytest.mark.asyncio
async def test_details_updated_records_only_field_names(admin_client):
    record = await create_record(admin_client, address="中正路 1 號", notes="想了解午睡")
    response = await _patch(admin_client, record, address="民族路 2 號", contact_name="王媽媽")
    assert response.status_code == 200, response.text
    [event] = await _events(admin_client, record, "details_updated")
    assert (event["from_stage"], event["to_stage"], event["reason"]) == ("visited", "visited", None)
    assert event["metadata_json"] == {"fields": ["address", "contact_name"]}
    assert event["actor_name"] == "admin@ivy.example"
    dumped = json.dumps(event, ensure_ascii=False)
    assert "民族路" not in dumped and "王媽媽" not in dumped


@pytest.mark.asyncio
async def test_unchanged_patch_writes_no_event_but_a_real_change_does(admin_client):
    record = await create_record(admin_client, notes="想了解午睡")
    unchanged = await _patch(admin_client, record, notes="想了解午睡")
    assert unchanged.status_code == 200, unchanged.text
    assert unchanged.json()["version"] == record["version"]
    assert await _event_types(admin_client, record) == ["created"]

    changed = await _patch(admin_client, unchanged.json(), notes="改問接送時間")
    assert changed.status_code == 200, changed.text
    assert await _event_types(admin_client, record) == ["created", "details_updated"]


@pytest.mark.asyncio
async def test_details_updated_uses_the_current_stage(admin_client):
    record = await record_at_stage(admin_client, "deposited", notes="舊備註")
    response = await _patch(admin_client, record, notes="新備註")
    assert response.status_code == 200, response.text
    [event] = await _events(admin_client, record, "details_updated")
    assert (event["from_stage"], event["to_stage"]) == ("deposited", "deposited")


@pytest.mark.asyncio
async def test_follow_up_updated_records_before_and_after(admin_client):
    record = await create_record(admin_client)
    scheduled = await _follow_up(admin_client, record, follow_up_at=_in(days=3))
    assert scheduled.status_code == 200, scheduled.text
    cleared = await _follow_up(admin_client, scheduled.json(), follow_up_at=None)
    assert cleared.status_code == 200, cleared.text
    first, second = await _events(admin_client, record, "follow_up_updated")
    when = datetime.fromisoformat(scheduled.json()["follow_up_at"])
    assert first["metadata_json"]["previous_follow_up_at"] is None
    assert datetime.fromisoformat(first["metadata_json"]["follow_up_at"]) == when
    assert first["metadata_json"]["owner_changed"] is False
    assert second["metadata_json"]["follow_up_at"] is None
    assert datetime.fromisoformat(second["metadata_json"]["previous_follow_up_at"]) == when
    assert second["metadata_json"]["owner_changed"] is False
    assert (first["from_stage"], first["to_stage"]) == ("visited", "visited")
    assert first["actor_name"] == "admin@ivy.example" and first["reason"] is None


@pytest.mark.asyncio
async def test_unchanged_follow_up_writes_no_event_but_a_real_change_does(admin_client):
    record = await create_record(admin_client)
    scheduled = await _follow_up(admin_client, record, follow_up_at=_in(days=3))
    assert scheduled.status_code == 200, scheduled.text
    unchanged = await _follow_up(admin_client, scheduled.json(), follow_up_at=scheduled.json()["follow_up_at"])
    assert unchanged.status_code == 200, unchanged.text
    assert unchanged.json()["version"] == scheduled.json()["version"]
    assert len(await _events(admin_client, record, "follow_up_updated")) == 1

    moved = await _follow_up(admin_client, unchanged.json(), follow_up_at=_in(days=5))
    assert moved.status_code == 200, moved.text
    assert len(await _events(admin_client, record, "follow_up_updated")) == 2


@pytest.mark.asyncio
async def test_owner_change_only_marks_owner_changed(admin_client, reception_yihua_client, db_session):
    record = await create_record(admin_client)
    reception_id = await db_session.scalar(select(User.id).where(User.email == "admissions-reception-yihua@ivy.example"))
    response = await _follow_up(admin_client, record, follow_up_owner_id=str(reception_id))
    assert response.status_code == 200, response.text
    [event] = await _events(admin_client, record, "follow_up_updated")
    assert event["metadata_json"] == {"follow_up_at": None, "previous_follow_up_at": None, "owner_changed": True}
    assert str(reception_id) not in json.dumps(event["metadata_json"])


@pytest.mark.asyncio
async def test_contact_log_does_not_write_follow_up_event_but_a_direct_change_does(admin_client):
    record = await create_record(admin_client)
    logged = await admin_client.post(
        f"{RECORDS}/{record['id']}/contact-logs",
        json={
            "expected_version": record["version"], "channel": "phone", "reached": True,
            "note": "下週再談", "next_follow_up_at": _in(days=2),
        },
    )
    assert logged.status_code == 201, logged.text
    scheduled_by_log = logged.json()["visit"]
    assert scheduled_by_log["follow_up_at"] is not None
    assert await _event_types(admin_client, record) == ["created"]

    moved = await _follow_up(admin_client, scheduled_by_log, follow_up_at=_in(days=6))
    assert moved.status_code == 200, moved.text
    [event] = await _events(admin_client, record, "follow_up_updated")
    # 記錄聯絡順便排的那次沒寫事件，之後直接改才寫，前一個值就是它排的時間。
    assert datetime.fromisoformat(event["metadata_json"]["previous_follow_up_at"]) == datetime.fromisoformat(
        scheduled_by_log["follow_up_at"]
    )


@pytest.mark.asyncio
async def test_stage_change_clearing_follow_up_writes_no_follow_up_event(admin_client):
    record = await record_at_stage(admin_client, "deposited")
    scheduled = await _follow_up(admin_client, record, follow_up_at=_in(days=1))
    assert scheduled.status_code == 200, scheduled.text
    enrolled = await admin_client.post(
        f"{RECORDS}/{record['id']}/transition",
        json={
            "to_stage": "enrolled", "expected_version": scheduled.json()["version"],
            "grade": "小班", "target_school_year": 115, "target_semester": 1,
        },
    )
    assert enrolled.status_code == 200, enrolled.text
    assert enrolled.json()["follow_up_at"] is None
    assert len(await _events(admin_client, record, "follow_up_updated")) == 1


@pytest.mark.asyncio
async def test_export_skips_both_types(admin_client, db_session):
    record = await record_at_stage(admin_client, "deposited", notes="舊")
    patched = await _patch(admin_client, record, notes="新")
    assert patched.status_code == 200, patched.text
    assert (await _follow_up(admin_client, patched.json(), follow_up_at=_in(days=2))).status_code == 200
    assert {"details_updated", "follow_up_updated"} <= set(await _event_types(admin_client, record))
    result = await export.export_campus(db_session, "yihua", tenant_id=1)
    types = [row["columns"]["event_type"] for row in result["recruitment_event_log"]]
    assert types == ["deposit_added"]


@pytest.mark.asyncio
async def test_anonymization_keeps_history_events_and_their_metadata(admin_client, db_session):
    record = await create_record(admin_client, notes="舊")
    patched = await _patch(admin_client, record, notes="新")
    assert (await _follow_up(admin_client, patched.json(), follow_up_at=_in(days=2))).status_code == 200
    before = await _history_rows(db_session, record)
    assert [row.event_type for row in before] == ["created", "details_updated", "follow_up_updated"]

    assert await retention.anonymize_due(db_session, 1, now=datetime.now(timezone.utc) + timedelta(days=2)) >= 1
    await db_session.commit()

    after = await _history_rows(db_session, record)
    assert [(row.event_type, row.metadata_json) for row in after] == [(row.event_type, row.metadata_json) for row in before]
    assert after[1].metadata_json == {"fields": ["notes"]}
    assert set(after[2].metadata_json) == {"follow_up_at", "previous_follow_up_at", "owner_changed"}
    assert after[2].metadata_json["follow_up_at"] is not None
