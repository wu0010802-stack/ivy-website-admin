from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.booking.models import VisitRequest, VisitRequestEvent
from tests.conftest import legacy_request

_MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations" / "versions" / "c7d2e9f4a1b8_parent_self_booking.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("parent_self_booking_migration", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


async def _run(db_session, fn):
    conn = await db_session.connection()
    result = await conn.run_sync(fn)
    await db_session.commit()
    return result


# migrate_booking_modes 會寫 booking_configs.slots_auto_confirm；這個欄位 2026-10-06 的
# e870893fac95 拿掉了，那兩支切換預約方式的測試跟著退場（migration 本身已在正式庫跑過）。


@pytest.mark.asyncio
async def test_cancel_reason_is_backfilled_from_history(db_session):
    by_parent = await legacy_request(db_session, status="cancelled", phone="0911000001")
    by_staff = await legacy_request(db_session, status="cancelled", phone="0911000002")
    expired = await legacy_request(db_session, status="cancelled", phone="0911000003")
    unknown = await legacy_request(db_session, status="cancelled", phone="0911000004")
    now = datetime.now(timezone.utc)
    for visit_id, event_type, source in (
        (by_parent, "cancelled", "parent"),
        (by_staff, "cancelled", "staff"),
        (expired, "hold_expired", "system"),
        (unknown, "cancelled", None),
    ):
        db_session.add(
            VisitRequestEvent(
                id=uuid.uuid4(), visit_request_id=uuid.UUID(visit_id), event_type=event_type, created_at=now, source=source
            )
        )
    await db_session.commit()

    await _run(db_session, _migration().backfill_cancel_reasons)

    db_session.expire_all()
    reasons = {
        visit_id: (await db_session.get(VisitRequest, uuid.UUID(visit_id))).cancel_reason
        for visit_id in (by_parent, by_staff, expired, unknown)
    }
    assert reasons == {by_parent: "parent", by_staff: "staff", expired: "hold_expired", unknown: None}
