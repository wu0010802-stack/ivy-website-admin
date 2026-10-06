"""d65fa082ff87：收掉舊預約流程的殘留資料（舊狀態案件、無場次的已確認案件、舊流程通知）。

migration 檔不在 import 路徑上，用路徑載入後直接呼叫 retire_legacy_data。舊狀態字串寫進
資料庫是合法的（visit_requests.status 沒有 CHECK），ORM 也還能寫。"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select, update

from app.booking.models import OutboxMessage, VisitContactNote, VisitRequest
from app.notifications.models import NotificationInboxItem
from tests.conftest import legacy_request

_MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations" / "versions" / "d65fa082ff87_retire_legacy_visit_flow_data.py"
)

LEGACY_KINDS = ("visit_request_overdue", "visit_request_hold_expired", "visit_request_pending_confirmation")


def _migration():
    spec = importlib.util.spec_from_file_location("retire_legacy_visit_flow_migration", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _inbox(campus_key: str, receipt_id: str | None) -> NotificationInboxItem:
    payload = {"campus_key": campus_key}
    if receipt_id is not None:
        payload["receipt_id"] = receipt_id
    return NotificationInboxItem(
        id=uuid.uuid4(), campus_key=campus_key, kind="visit_request_created", payload=payload,
        created_at=datetime.now(timezone.utc),
    )


def _outbox(receipt_id: str, kind: str, status: str) -> OutboxMessage:
    now = datetime.now(timezone.utc)
    return OutboxMessage(
        id=uuid.uuid4(), visit_request_id=uuid.UUID(receipt_id), kind=kind, payload={}, created_at=now,
        status=status, attempts=0, next_attempt_at=now,
    )


async def _run(db_session) -> dict:
    conn = await db_session.connection()
    result = await conn.run_sync(_migration().retire_legacy_data)
    await db_session.commit()
    db_session.expire_all()
    return result


async def _confirmed_without_slot(db_session, **kwargs) -> str:
    """舊流程資料：已確認卻沒有場次（新流程一定有場次，只能直接改庫）。"""
    case_id = await legacy_request(db_session, status="cancelled", **kwargs)
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(case_id))
        .values(status="confirmed", slot_id=None)
    )
    await db_session.commit()
    return case_id


@pytest.mark.asyncio
async def test_deletes_legacy_status_and_slotless_confirmed_requests_but_keeps_the_rest(db_session):
    new = await legacy_request(db_session, status="new", phone="0911000001")
    contacting = await legacy_request(db_session, status="contacting", campus_key="minghua", phone="0911000002")
    holding = await legacy_request(db_session, status="pending_confirmation", phone="0911000003")
    slotless = await _confirmed_without_slot(db_session, phone="0911000004")
    confirmed = await legacy_request(db_session, status="confirmed", phone="0911000005")
    completed = await legacy_request(db_session, status="completed", phone="0911000006")
    cancelled = await legacy_request(db_session, status="cancelled", phone="0911000007")
    no_show = await legacy_request(db_session, status="no_show", phone="0911000008")
    # 留下的案件指到會被刪的案件：related_request_id 要變 NULL，不能卡住刪除。
    kept = await db_session.get(VisitRequest, uuid.UUID(cancelled))
    kept.related_request_id = uuid.UUID(new)
    db_session.add(VisitContactNote(
        id=uuid.uuid4(), visit_request_id=uuid.UUID(contacting), note="打過電話", created_at=datetime.now(timezone.utc),
    ))
    db_session.add(_outbox(slotless, "visit_request_created", "sent"))
    db_session.add(_outbox(confirmed, "visit_request_created", "sent"))
    await db_session.commit()

    result = await _run(db_session)

    assert result["deleted"] == 4
    remaining = {str(i) for i in (await db_session.execute(select(VisitRequest.id))).scalars()}
    assert remaining == {confirmed, completed, cancelled, no_show}
    assert holding not in remaining and slotless not in remaining
    assert (await db_session.get(VisitRequest, uuid.UUID(cancelled))).related_request_id is None
    # CASCADE：被刪案件的聯絡紀錄與寄送紀錄跟著沒了，留下案件的不動。
    assert (await db_session.execute(select(func.count()).select_from(VisitContactNote))).scalar_one() == 0
    outbox_owners = {str(i) for i in (await db_session.execute(select(OutboxMessage.visit_request_id))).scalars()}
    assert outbox_owners == {confirmed}


@pytest.mark.asyncio
async def test_deletes_only_inbox_items_pointing_at_deleted_requests(db_session):
    new = await legacy_request(db_session, status="new", phone="0911000001")
    slotless = await _confirmed_without_slot(db_session, phone="0911000002")
    confirmed = await legacy_request(db_session, status="confirmed", phone="0911000003")
    cancelled = await legacy_request(db_session, status="cancelled", phone="0911000004")
    db_session.add_all([
        _inbox("yihua", new), _inbox("yihua", slotless), _inbox("yihua", confirmed),
        _inbox("yihua", cancelled), _inbox("yihua", None),
    ])
    await db_session.commit()

    await _run(db_session)

    payloads = (await db_session.execute(select(NotificationInboxItem.payload))).scalars().all()
    # 沒有 receipt_id 的通知（例如系統層級通知）與指到留下案件的通知都保留。
    assert sorted(p.get("receipt_id") or "" for p in payloads) == sorted(["", confirmed, cancelled])


@pytest.mark.asyncio
async def test_marks_only_pending_and_failed_legacy_kind_outbox_as_skipped(db_session):
    case = await legacy_request(db_session, status="confirmed")
    rows = {}
    for kind in LEGACY_KINDS:
        for status in ("pending", "failed", "sent"):
            row = _outbox(case, kind, status)
            rows[(kind, status)] = row.id
            db_session.add(row)
    # 其他種類的通知不是舊流程的：pending／failed 都不動。
    other_pending = _outbox(case, "visit_request_created", "pending")
    other_failed = _outbox(case, "visit_upcoming", "failed")
    db_session.add_all([other_pending, other_failed])
    await db_session.commit()
    other_ids = (other_pending.id, other_failed.id)

    result = await _run(db_session)

    assert result["skipped"] == 6
    for (kind, status), row_id in rows.items():
        row = await db_session.get(OutboxMessage, row_id)
        expected = status if status == "sent" else "skipped"
        assert row.status == expected, (kind, status)
    assert (await db_session.get(OutboxMessage, other_ids[0])).status == "pending"
    assert (await db_session.get(OutboxMessage, other_ids[1])).status == "failed"


@pytest.mark.asyncio
async def test_running_twice_is_a_no_op(db_session):
    await legacy_request(db_session, status="new", phone="0911000001")
    keep = await legacy_request(db_session, status="confirmed", phone="0911000002")

    first = await _run(db_session)
    second = await _run(db_session)

    assert first["deleted"] == 1
    assert second == {"deleted": 0, "skipped": 0}
    assert {str(i) for i in (await db_session.execute(select(VisitRequest.id))).scalars()} == {keep}
