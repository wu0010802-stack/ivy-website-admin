"""2026-10-06 拿掉舊流程後，資料庫只收四種案件狀態，已確認一定有場次（e870893fac95）。"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.conftest import legacy_request


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["new", "contacting", "pending_confirmation"])
async def test_retired_statuses_are_rejected(db_session, status):
    with pytest.raises(IntegrityError, match="ck_visit_requests_status"):
        await legacy_request(db_session, status=status)
    await db_session.rollback()


@pytest.mark.asyncio
async def test_confirmed_needs_a_slot(db_session):
    receipt_id = await legacy_request(db_session, status="confirmed")
    with pytest.raises(IntegrityError, match="ck_visit_requests_confirmed_slot"):
        await db_session.execute(text("UPDATE visit_requests SET slot_id = NULL WHERE id = :id"), {"id": receipt_id})
    await db_session.rollback()


@pytest.mark.asyncio
async def test_closed_cases_may_have_no_slot(db_session):
    # 舊流程沒排場次就取消的案件仍是合法資料。
    await legacy_request(db_session, status="cancelled")


@pytest.mark.asyncio
async def test_legacy_columns_are_gone(db_session):
    columns = set(
        (
            await db_session.execute(
                text(
                    "SELECT table_name || '.' || column_name FROM information_schema.columns "
                    "WHERE table_name IN ('visit_requests', 'booking_configs')"
                )
            )
        ).scalars()
    )
    assert "visit_requests.hold_expires_at" not in columns
    assert "booking_configs.slots_auto_confirm" not in columns
