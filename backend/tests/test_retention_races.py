"""保存政策清理與後台補填個資的交錯（2026-10-13 深度掃描第 8 項）。

候選案件是不上鎖的查詢載入的；載入時 Email、孩子姓名、生日若是 NULL，之後後台人員補填並提交，
清理再賦值 None 時 SQLAlchemy 看不到淨變更、不會寫進 UPDATE，補填的個資就留在已標記匿名化的案件上。
清理要先鎖住案件列、整列重讀。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text, update

from app.booking.models import VisitRequest
from app.operations import retention_service
from app.operations.models import RetentionRunTrigger
from tests.conftest import legacy_request

DAYS = {"cancelled_days": 30, "completed_days": 30, "open_overdue_days": 30, "admissions_days": None}


async def _expired_cancelled_case(db_session) -> uuid.UUID:
    case_id = await legacy_request(db_session, status="cancelled", email=None, parent_name="王媽媽")
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(case_id))
        .values(cancelled_at=datetime.now(timezone.utc) - timedelta(days=400))
    )
    await db_session.commit()
    return uuid.UUID(case_id)


async def _fill_pii(app, case_id: uuid.UUID) -> None:
    """另一個連線：後台人員補填並提交（對應 PATCH /admin/visit-requests/{id}/details）。"""
    async with app.state.session_factory() as other:
        await other.execute(
            update(VisitRequest)
            .where(VisitRequest.id == case_id)
            .values(email="late@example.com", child_name="小明", child_birthdate=date(2022, 1, 1))
        )
        await other.commit()


async def _row(app, case_id: uuid.UUID) -> dict:
    async with app.state.engine.connect() as conn:
        result = await conn.execute(
            text("SELECT email, child_name, child_birthdate, parent_name, anonymized_at FROM visit_requests WHERE id = :id"),
            {"id": str(case_id)},
        )
        return dict(result.mappings().one())


@pytest.mark.asyncio
async def test_pii_filled_after_the_candidate_was_loaded_is_cleared_too(app, db_session):
    case_id = await _expired_cancelled_case(db_session)
    found = await retention_service.find_candidates(db_session, DAYS)
    [candidate] = found["cancelled"]
    assert candidate.email is None and candidate.child_name is None

    await _fill_pii(app, case_id)
    assert await retention_service.anonymize(db_session, candidate) is True
    await db_session.commit()

    row = await _row(app, case_id)
    assert row["anonymized_at"] is not None
    assert row["email"] is None and row["child_name"] is None and row["child_birthdate"] is None
    assert row["parent_name"] == retention_service.ANONYMIZED_NOTE


@pytest.mark.asyncio
async def test_a_case_anonymized_by_someone_else_in_the_meantime_is_left_alone(app, db_session):
    case_id = await _expired_cancelled_case(db_session)
    found = await retention_service.find_candidates(db_session, DAYS)
    [candidate] = found["cancelled"]
    async with app.state.session_factory() as other:
        stale = await other.get(VisitRequest, case_id)
        await retention_service.anonymize(other, stale)
        await other.commit()
    first = (await _row(app, case_id))["anonymized_at"]

    assert await retention_service.anonymize(db_session, candidate) is False
    await db_session.commit()

    assert (await _row(app, case_id))["anonymized_at"] == first


@pytest.mark.asyncio
async def test_sweep_counts_only_the_cases_it_really_anonymized(app, db_session):
    await _expired_cancelled_case(db_session)

    report = await retention_service.run_sweep(db_session, DAYS, trigger=RetentionRunTrigger.MANUAL)
    await db_session.commit()

    assert report.counts["cancelled"] == 1


@pytest.mark.asyncio
async def test_sweep_clears_pii_left_on_cases_already_marked_anonymized(app, db_session):
    """修正之前被並行補填、已經標記匿名化的案件，下一次清理補清。"""
    case_id = await _expired_cancelled_case(db_session)
    await retention_service.run_sweep(db_session, DAYS, trigger=RetentionRunTrigger.MANUAL)
    await db_session.commit()
    await _fill_pii(app, case_id)
    assert (await _row(app, case_id))["child_name"] == "小明"

    await retention_service.run_sweep(db_session, DAYS, trigger=RetentionRunTrigger.MANUAL)
    await db_session.commit()

    row = await _row(app, case_id)
    assert row["email"] is None and row["child_name"] is None and row["child_birthdate"] is None
