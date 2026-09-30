from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, time, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from app.booking import schedule_service, service
from app.booking.models import BookingConfig, BookingMode, VisitRequest, VisitRequestEvent
from app.operations.models import AuditLogEntry
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


async def _config(db_session, campus_key: str, *, mode: BookingMode, message: str | None = None) -> BookingConfig:
    config = await service.get_or_create_config(db_session, campus_key)
    config.mode = mode
    config.message = message
    config.slots_auto_confirm = False
    await db_session.commit()
    return config


@pytest.mark.asyncio
async def test_inquiry_campuses_switch_to_slots_or_paused(db_session):
    await _config(db_session, "yihua", mode=BookingMode.INQUIRY)
    await _config(db_session, "minghua", mode=BookingMode.INQUIRY)
    await _config(db_session, "chongde", mode=BookingMode.INQUIRY, message="暑假暫停參觀")
    await _config(db_session, "renwu", mode=BookingMode.LINE)
    await schedule_service.replace_rules(
        db_session,
        "yihua",
        [{"weekday": 0, "start_time": time(10, 0), "end_time": time(11, 0), "slot_minutes": 60, "capacity": 1}],
        None,
    )
    await db_session.commit()
    versions = {
        key: (await db_session.get(BookingConfig, key)).version for key in ("yihua", "minghua", "chongde", "renwu")
    }

    changes = await _run(db_session, _migration().migrate_booking_modes)

    assert sorted((c["campus_key"], c["mode"]) for c in changes) == [
        ("chongde", "paused"),
        ("minghua", "paused"),
        ("yihua", "slots"),
    ]
    db_session.expire_all()
    yihua = await db_session.get(BookingConfig, "yihua")
    minghua = await db_session.get(BookingConfig, "minghua")
    chongde = await db_session.get(BookingConfig, "chongde")
    renwu = await db_session.get(BookingConfig, "renwu")
    assert yihua.mode == BookingMode.SLOTS
    assert minghua.mode == BookingMode.PAUSED
    assert minghua.message == "線上預約即將開放，歡迎來電洽詢。"
    assert chongde.message == "暑假暫停參觀"
    assert renwu.mode == BookingMode.LINE
    assert all(c.slots_auto_confirm for c in (yihua, minghua, chongde, renwu))
    assert yihua.version > versions["yihua"]
    assert renwu.version > versions["renwu"]  # 自動確認改了也要讓舊表單重新讀設定
    audits = (
        await db_session.execute(
            select(AuditLogEntry).where(AuditLogEntry.action == "booking_config.migrate_self_booking")
        )
    ).scalars().all()
    assert sorted(a.campus_key for a in audits) == ["chongde", "minghua", "yihua"]
    assert all(a.metadata_json["before"] == {"mode": "inquiry"} for a in audits)


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
