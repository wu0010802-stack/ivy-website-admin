"""招生訪視的保存政策（規格 11；R14）：天數設定、試算、只清規格列的欄位、統計欄位
不變、與預約的匿名化互不連動。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.admissions import constants, retention
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.booking.models import VisitRequest
from app.operations import retention_service
from app.operations.models import AuditLogEntry, RetentionPolicy, RetentionRun
from tests.admissions_helpers import API, create_record, record_at_stage
from tests.conftest import legacy_request

POLICY = f"{API}/admin/site-policies/retention"
DRY_RUN = f"{API}/admin/retention/dry-run"
RUN = f"{API}/admin/retention/run"
# 統計會用到、匿名化後必須原封不動的欄位。
STAT_COLUMNS = (
    "campus_key", "visit_request_id", "month", "seq_no", "visit_date", "grade", "source", "referrer",
    "has_deposit", "enrolled", "enrolled_on", "transfer_term", "no_deposit_reason", "provisional_grade",
    "target_school_year", "target_semester", "withdrawn_at", "withdrawn_from", "created_at", "updated_at",
)
# 規格 11 列出要清的欄位（姓名另外換成固定文字）；英文名、父母職業是 2026-10-05 照紙本補的。
CLEARED = (
    "birthday", "phone", "contact_name", "address", "notes", "parent_response", "no_deposit_reason_detail", "withdraw_reason",
    "english_name", "father_occupation", "mother_occupation",
)


def _policy(version: int, **days) -> dict:
    return {
        "expected_version": version,
        "cancelled_days": 365,
        "completed_days": 365,
        "open_overdue_days": 365,
        "auto_run_enabled": False,
        **days,
    }


def _allow_real_run(app) -> None:
    app.state.settings = app.state.settings.model_copy(update={"retention_allow_real_run": True})


async def _set(db_session, visit_id: str, **values) -> None:
    await db_session.execute(update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(visit_id)).values(**values))
    await db_session.commit()


def _days_ago(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


async def _reload(db_session, visit_id: str) -> RecruitmentVisit:
    result = await db_session.execute(
        select(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(visit_id)).execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _audit(db_session, action: str) -> list[dict]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return [entry.metadata_json for entry in result.scalars()]


@pytest.mark.asyncio
async def test_admissions_days_is_optional_and_only_written_when_sent(admin_client, db_session):
    """調整第 15 條：預設 NULL（不自動清理）；請求沒帶這個鍵就不動；範圍與其他天數相同。"""
    assert (await admin_client.get(POLICY)).json()["admissions_days"] is None
    saved = await admin_client.put(POLICY, json=_policy(1, admissions_days=730))
    assert saved.status_code == 200, saved.text
    assert saved.json()["admissions_days"] == 730
    kept = await admin_client.put(POLICY, json=_policy(2, cancelled_days=200))  # 現行保存政策頁的存檔
    assert kept.status_code == 200 and kept.json()["admissions_days"] == 730
    cleared = await admin_client.put(POLICY, json=_policy(3, cancelled_days=200, admissions_days=None))
    assert cleared.json()["admissions_days"] is None
    for bad in (29, 3651):
        assert (await admin_client.put(POLICY, json=_policy(4, admissions_days=bad))).status_code == 422
    entries = await _audit(db_session, "retention_policy.update")
    assert (entries[0]["before"]["admissions_days"], entries[0]["after"]["admissions_days"]) == (None, 730)
    assert entries[1]["after"]["admissions_days"] == 730
    assert entries[2]["after"]["admissions_days"] is None
    # 資料庫層用同一組範圍擋。
    with pytest.raises(IntegrityError):
        await db_session.execute(update(RetentionPolicy).values(admissions_days=10))
    await db_session.rollback()


@pytest.mark.asyncio
async def test_run_clears_only_spec_fields_and_keeps_statistics(app, admin_client, db_session):
    """R14：只清規格 11 的欄位與歷程原因；統計欄位不變；試算不改資料；清理紀錄與稽核只記筆數。"""
    _allow_real_run(app)
    old = await record_at_stage(
        admin_client, "withdrawn",
        child_name="王小明", phone="0912345678", contact_name="王媽媽", address="中正路 1 號", grade="小班",
        english_name="Ming", father_occupation="軍", mother_occupation="教師",
        source="Facebook", referrer="林老師", notes="住附近", parent_response="再想想",
        no_deposit_reason="時程未到／仍在觀望", no_deposit_reason_detail="等搬家",
    )
    recent = await create_record(admin_client, child_name="陳小華", phone="0922333444")
    await _set(db_session, old["id"], updated_at=_days_ago(400))
    await _set(db_session, recent["id"], updated_at=_days_ago(10))
    assert (await admin_client.put(POLICY, json=_policy(1, admissions_days=365))).status_code == 200
    before = await _reload(db_session, old["id"])
    stats_before = {column: getattr(before, column) for column in STAT_COLUMNS}
    version_before = before.version

    preview = (await admin_client.post(DRY_RUN)).json()
    assert (preview["counts"]["admissions"], preview["days"]["admissions_days"]) == (1, 365)
    assert (await _reload(db_session, old["id"])).anonymized_at is None

    ran = await admin_client.post(RUN)
    assert ran.status_code == 200, ran.text
    assert ran.json()["counts"] == {"cancelled": 0, "no_show": 0, "completed": 0, "admissions": 1}
    assert ran.json()["total"] == 1
    after = await _reload(db_session, old["id"])
    assert after.child_name == constants.ANONYMIZED_TEXT
    assert {column: getattr(after, column) for column in CLEARED} == dict.fromkeys(CLEARED)
    assert {column: getattr(after, column) for column in STAT_COLUMNS} == stats_before
    assert after.anonymized_at is not None and after.version == version_before + 1
    events = (
        await db_session.execute(
            select(RecruitmentEventLog)
            .where(RecruitmentEventLog.recruitment_visit_id == uuid.UUID(old["id"]))
            .order_by(RecruitmentEventLog.created_at)
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    assert [e.event_type for e in events] == ["created", "deposit_added", "withdrawn"]  # 歷程本身保留
    assert all(e.reason is None for e in events)
    untouched = await _reload(db_session, recent["id"])
    assert (untouched.child_name, untouched.phone, untouched.anonymized_at) == ("陳小華", "0922333444", None)

    runs = (await admin_client.get(f"{API}/admin/retention-runs")).json()
    assert (runs[0]["counts"]["admissions"], runs[0]["days"]["admissions_days"]) == (1, 365)
    [entry] = await _audit(db_session, "retention.run")
    assert entry["counts"]["admissions"] == 1
    assert "王小明" not in json.dumps(entry, ensure_ascii=False) and old["id"] not in json.dumps(entry)
    assert (await admin_client.post(RUN)).json()["counts"]["admissions"] == 0  # 已匿名化的不再算


@pytest.mark.asyncio
async def test_without_admissions_days_nothing_is_cleared(app, admin_client, db_session):
    """預設不自動執行（規格 11）：沒設定天數，再舊也不清，清理紀錄也沒有這一類。"""
    _allow_real_run(app)
    record = await create_record(admin_client, phone="0912345678")
    await _set(db_session, record["id"], updated_at=_days_ago(5000))
    assert (await admin_client.post(DRY_RUN)).json()["counts"]["admissions"] == 0
    ran = await admin_client.post(RUN)
    assert ran.status_code == 200 and ran.json()["counts"]["admissions"] == 0
    assert (await _reload(db_session, record["id"])).phone == "0912345678"
    run = (await db_session.execute(select(RetentionRun))).scalar_one()
    assert "admissions" not in run.counts and run.policy["admissions_days"] is None
    assert await retention.eligible_count(db_session, None) == 0
    assert await retention.anonymize_due(db_session, None) == 0


@pytest.mark.asyncio
async def test_booking_and_admissions_anonymization_are_independent(app, admin_client, db_session):
    """R14：預約匿名化不連動招生訪視，招生訪視匿名化也不動預約（規格 11）。"""
    _allow_real_run(app)
    old_request = await legacy_request(db_session, status="cancelled", parent_name="要清掉的媽媽")
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(old_request)).values(cancelled_at=_days_ago(400))
    )
    await db_session.commit()
    kept_visit = await create_record(admin_client, child_name="留著的孩子")
    await _set(db_session, kept_visit["id"], visit_request_id=uuid.UUID(old_request), updated_at=_days_ago(10))
    fresh_request = await legacy_request(db_session, status="completed", parent_name="留著的爸爸")
    old_visit = await create_record(admin_client, child_name="要清掉的孩子")
    await _set(db_session, old_visit["id"], visit_request_id=uuid.UUID(fresh_request), updated_at=_days_ago(400))
    assert (await admin_client.put(POLICY, json=_policy(1, admissions_days=365))).status_code == 200

    ran = (await admin_client.post(RUN)).json()
    assert (ran["counts"]["cancelled"], ran["counts"]["admissions"]) == (1, 1)
    assert (await _reload(db_session, kept_visit["id"])).child_name == "留著的孩子"
    assert (await _reload(db_session, old_visit["id"])).child_name == constants.ANONYMIZED_TEXT
    parents = dict(
        (
            await db_session.execute(
                select(VisitRequest.id, VisitRequest.parent_name)
                .where(VisitRequest.id.in_([uuid.UUID(old_request), uuid.UUID(fresh_request)]))
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    assert parents[uuid.UUID(old_request)] == retention_service.ANONYMIZED_NOTE
    assert parents[uuid.UUID(fresh_request)] == "留著的爸爸"


@pytest.mark.asyncio
async def test_eligibility_uses_updated_at_cutoff(admin_client, db_session):
    """調整第 5 條：now 可注入；條件是 anonymized_at IS NULL AND updated_at < now − days。"""
    now = datetime(2026, 10, 1, 4, 0, tzinfo=timezone.utc)
    due = await create_record(admin_client, child_name="剛好過期")
    fresh = await create_record(admin_client, child_name="還沒到期")
    await _set(db_session, due["id"], updated_at=now - timedelta(days=30, seconds=1))
    await _set(db_session, fresh["id"], updated_at=now - timedelta(days=30) + timedelta(seconds=1))
    assert await retention.eligible_count(db_session, 30, now=now) == 1
    assert await retention.anonymize_due(db_session, 30, now=now) == 1
    await db_session.commit()
    assert await retention.eligible_count(db_session, 30, now=now) == 0
    assert (await _reload(db_session, fresh["id"])).child_name == "還沒到期"
