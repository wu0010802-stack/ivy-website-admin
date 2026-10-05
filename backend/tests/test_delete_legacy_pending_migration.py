from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.booking.models import VisitContactNote, VisitRequest
from app.notifications.models import NotificationInboxItem
from tests.conftest import legacy_request

_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "1e5612e187ff_delete_legacy_pending_visit_requests.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("delete_legacy_pending_migration", _MIGRATION)
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


@pytest.mark.asyncio
async def test_deletes_only_legacy_pending_requests_and_their_inbox_items(db_session):
    new = await legacy_request(db_session, status="new", phone="0911000001")
    contacting = await legacy_request(db_session, status="contacting", campus_key="minghua", phone="0911000002")
    holding = await legacy_request(db_session, status="pending_confirmation", phone="0911000003")
    cancelled = await legacy_request(db_session, status="cancelled", phone="0911000004")
    completed = await legacy_request(db_session, status="completed", phone="0911000005")
    kept = await db_session.get(VisitRequest, uuid.UUID(cancelled))
    kept.related_request_id = uuid.UUID(new)
    db_session.add(VisitContactNote(
        id=uuid.uuid4(), visit_request_id=uuid.UUID(contacting), note="打過電話", created_at=datetime.now(timezone.utc),
    ))
    db_session.add_all([
        _inbox("yihua", new), _inbox("minghua", contacting), _inbox("yihua", cancelled), _inbox("yihua", None),
    ])
    await db_session.commit()

    conn = await db_session.connection()
    deleted = await conn.run_sync(_migration().delete_legacy_requests)
    await db_session.commit()

    assert deleted == 3
    db_session.expire_all()
    remaining = set((await db_session.execute(select(VisitRequest.id))).scalars())
    assert {str(i) for i in remaining} == {cancelled, completed}
    assert (await db_session.get(VisitRequest, uuid.UUID(cancelled))).related_request_id is None
    assert (await db_session.execute(select(func.count()).select_from(VisitContactNote))).scalar_one() == 0
    payloads = (await db_session.execute(select(NotificationInboxItem.payload))).scalars().all()
    assert sorted(p.get("receipt_id") or "" for p in payloads) == sorted(["", cancelled])
    assert holding not in {p.get("receipt_id") for p in payloads}
