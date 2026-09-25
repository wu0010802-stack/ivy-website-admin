"""2026-09-25 缺口 64：個資保存政策持久化、依結案時間起算、已結案才清、清理紀錄
與定期工作（政策開啟且部署允許時，每個台北日期最多一次）。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.booking.models import VisitRequest, VisitRequestEvent
from app.operations import retention_service
from app.operations.models import AuditLogEntry, RetentionPolicy, RetentionRun
from app.workers.maintenance import run_cycle

pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
BASE = f"{API}/admin"
POLICY = f"{BASE}/site-policies/retention"


def _ago(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


async def _case(client, key: str, name: str = "王媽媽") -> str:
    response = await client.post(
        f"{BASE}/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": name, "phone": "0912345678", "consent_given": True},
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _slot(client) -> str:
    response = await client.post(
        f"{BASE}/slots?campus_key=yihua",
        json={
            "slot_date": (datetime.now().date() + timedelta(days=3)).isoformat(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "capacity": 10,
        },
    )
    return response.json()["id"]


async def _age(db_session, case_id: str, *, created: int | None = None, cancelled: int | None = None,
               events: int | None = None, event_types: tuple[str, ...] | None = None):
    """把案件的時間往前調：created／cancelled 改案件欄位，events 改歷程時間
    （event_types 限定只改哪幾種）。"""
    values = {}
    if created is not None:
        values["created_at"] = _ago(created)
    if cancelled is not None:
        values["cancelled_at"] = _ago(cancelled)
    if values:
        await db_session.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(case_id)).values(**values))
    if events is not None:
        stmt = update(VisitRequestEvent).where(VisitRequestEvent.visit_request_id == uuid.UUID(case_id))
        if event_types:
            stmt = stmt.where(VisitRequestEvent.event_type.in_(event_types))
        await db_session.execute(stmt.values(created_at=_ago(events)))
    await db_session.commit()


def _allow_real_run(app) -> None:
    app.state.settings = app.state.settings.model_copy(update={"retention_allow_real_run": True})


def _policy(version: int, **days) -> dict:
    return {
        "expected_version": version,
        "cancelled_days": 365,
        "completed_days": 365,
        "open_overdue_days": 365,
        "auto_run_enabled": False,
        **days,
    }


@pytest.mark.asyncio
async def test_policy_defaults_update_and_version(admin_client, db_session):
    policy = await admin_client.get(POLICY)
    assert policy.status_code == 200, policy.text
    body = policy.json()
    # 使用者裁定：各類預設 365 天，自動清理預設關閉。
    assert (body["cancelled_days"], body["completed_days"], body["open_overdue_days"]) == (365, 365, 365)
    assert body["auto_run_enabled"] is False
    assert body["real_run_allowed"] is False
    assert body["version"] == 1
    assert body["preview"]["total"] == 0
    assert body["preview"]["open_overdue_count"] == 0

    saved = await admin_client.put(
        POLICY, json=_policy(1, cancelled_days=180, completed_days=730, open_overdue_days=90, auto_run_enabled=True)
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] == 2
    assert saved.json()["cancelled_days"] == 180
    assert saved.json()["updated_by_email"] == "admin@ivy.example"

    stale = await admin_client.put(POLICY, json=_policy(1))
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "RETENTION_POLICY_VERSION_CONFLICT"

    for bad in (29, 3651):
        out_of_range = await admin_client.put(POLICY, json=_policy(2, cancelled_days=bad))
        assert out_of_range.status_code == 422

    [entry] = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "retention_policy.update"))
    ).scalars().all()
    assert entry.metadata_json["before"]["cancelled_days"] == 365
    assert entry.metadata_json["after"] == {
        "cancelled_days": 180, "completed_days": 730, "open_overdue_days": 90, "auto_run_enabled": True,
    }


@pytest.mark.asyncio
async def test_policy_is_super_admin_only(minghua_client):
    assert (await minghua_client.get(POLICY)).status_code == 403
    assert (await minghua_client.get(f"{BASE}/retention-runs")).status_code == 403
    assert (await minghua_client.post(f"{BASE}/retention/dry-run")).status_code == 403


@pytest.mark.asyncio
async def test_closing_time_decides_expiry_and_open_cases_are_only_counted(admin_client, db_session):
    slot_id = await _slot(admin_client)

    # 很早建立、最近才取消：看 cancelled_at，還不到期。
    recent_cancel = await _case(admin_client, "ret-01")
    await admin_client.post(f"{BASE}/visit-requests/{recent_cancel}/cancel")
    await _age(db_session, recent_cancel, created=800, events=800)
    # 取消超過一年。
    old_cancel = await _case(admin_client, "ret-02")
    await admin_client.post(f"{BASE}/visit-requests/{old_cancel}/cancel")
    await _age(db_session, old_cancel, created=500, cancelled=400)
    # 完成：看歷程裡 completed 那一筆。很早建立、最近才完成的不到期。
    completed_recent, completed_old = await _case(admin_client, "ret-03"), await _case(admin_client, "ret-04")
    for case_id in (completed_recent, completed_old):
        confirmed = await admin_client.post(f"{BASE}/visit-requests/{case_id}/confirm", json={"slot_id": slot_id})
        assert confirmed.status_code == 200, confirmed.text
        await _complete(db_session, case_id)
    await _age(db_session, completed_recent, created=900, events=900)
    await _age(db_session, completed_recent, events=10, event_types=("completed",))
    await _age(db_session, completed_old, created=900, events=400)
    # 未到場：看歷程裡 no_show 那一筆。
    no_show = await _case(admin_client, "ret-05")
    await db_session.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(no_show)).values(status="no_show"))
    await db_session.commit()
    await _record(db_session, no_show, "no_show")
    await _age(db_session, no_show, created=30, events=400, event_types=("no_show",))
    # 沒有結案歷程的舊資料：退回 created_at。
    legacy = await _case(admin_client, "ret-06")
    await db_session.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(legacy)).values(status="no_show"))
    await db_session.commit()
    await _age(db_session, legacy, created=400)
    # 還沒結案的：不論多舊都不清，只算進提醒。
    stale_new = await _case(admin_client, "ret-07")
    await _age(db_session, stale_new, created=400, events=400)
    stale_confirmed = await _case(admin_client, "ret-08")
    await admin_client.post(f"{BASE}/visit-requests/{stale_confirmed}/confirm", json={"slot_id": slot_id})
    await _age(db_session, stale_confirmed, created=900, events=900)
    fresh_new = await _case(admin_client, "ret-09")
    assert fresh_new

    report = (await admin_client.post(f"{BASE}/retention/dry-run")).json()
    assert report["counts"] == {"cancelled": 1, "no_show": 2, "completed": 1}
    assert report["total"] == 4
    assert report["open_overdue_count"] == 2
    assert report["dry_run"] is True

    found = await retention_service.find_candidates(db_session, report["days"])
    assert [str(v.id) for v in found["cancelled"]] == [old_cancel]
    assert sorted(str(v.id) for v in found["no_show"]) == sorted([no_show, legacy])
    assert [str(v.id) for v in found["completed"]] == [completed_old]
    # 試算不留紀錄、不改資料。
    assert (await admin_client.get(f"{BASE}/retention-runs")).json() == []
    assert (await db_session.get(VisitRequest, uuid.UUID(old_cancel))).anonymized_at is None


async def _record(db_session, case_id: str, event_type: str) -> None:
    db_session.add(
        VisitRequestEvent(
            id=uuid.uuid4(),
            visit_request_id=uuid.UUID(case_id),
            event_type=event_type,
            created_at=datetime.now(timezone.utc),
        )
    )
    await db_session.commit()


async def _complete(db_session, case_id: str) -> None:
    """標完成要等參觀時間過後；測試直接改狀態並補一筆 completed 歷程。"""
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(case_id)).values(status="completed")
    )
    await db_session.commit()
    await _record(db_session, case_id, "completed")


@pytest.mark.asyncio
async def test_manual_run_anonymizes_closed_cases_and_is_recorded(app, admin_client, db_session):
    _allow_real_run(app)
    old_cancel = await _case(admin_client, "ret-11", name="要清掉的媽媽")
    await admin_client.post(f"{BASE}/visit-requests/{old_cancel}/cancel")
    await _age(db_session, old_cancel, cancelled=400)
    stale = await _case(admin_client, "ret-12", name="很久沒聯絡的爸爸")
    await _age(db_session, stale, created=400, events=400)

    ran = await admin_client.post(f"{BASE}/retention/run")
    assert ran.status_code == 200, ran.text
    assert ran.json()["dry_run"] is False
    assert ran.json()["counts"] == {"cancelled": 1, "no_show": 0, "completed": 0}
    assert ran.json()["open_overdue_count"] == 1
    assert ran.json()["run_id"]

    detail = (await admin_client.get(f"{BASE}/visit-requests/{old_cancel}")).json()
    assert detail["parent_name"] == retention_service.ANONYMIZED_NOTE
    assert detail["status"] == "cancelled"
    # 未結案的不清、不改狀態。
    untouched = (await admin_client.get(f"{BASE}/visit-requests/{stale}")).json()
    assert untouched["parent_name"] == "很久沒聯絡的爸爸"
    assert untouched["status"] == "new"

    runs = (await admin_client.get(f"{BASE}/retention-runs")).json()
    assert len(runs) == 1
    assert runs[0]["trigger"] == "manual"
    assert runs[0]["actor_email"] == "admin@ivy.example"
    assert runs[0]["total"] == 1
    assert runs[0]["open_overdue_count"] == 1
    assert runs[0]["days"] == {"cancelled_days": 365, "completed_days": 365, "open_overdue_days": 365}
    # 紀錄不存案件 id。
    row = (await db_session.execute(select(RetentionRun))).scalar_one()
    assert old_cancel not in str(row.counts) and old_cancel not in str(row.policy)

    [entry] = (await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "retention.run"))).scalars().all()
    assert entry.metadata_json["trigger"] == "manual"
    assert entry.metadata_json["total"] == 1
    assert old_cancel not in str(entry.metadata_json)
    # 再跑一次：已匿名化的不再算。
    again = await admin_client.post(f"{BASE}/retention/run")
    assert again.json()["total"] == 0


@pytest.mark.asyncio
async def test_scheduled_run_needs_policy_and_deployment_flag_once_per_day(app, admin_client, db_session):
    old_cancel = await _case(admin_client, "ret-21", name="定期清理的媽媽")
    await admin_client.post(f"{BASE}/visit-requests/{old_cancel}/cancel")
    await _age(db_session, old_cancel, cancelled=400)

    async def cycle():
        result = await run_cycle(app.state.session_factory, app.state.settings, worker_id="test")
        assert result.failed_steps == []
        return result

    # 部署沒允許、政策也沒開：什麼都不做、不留紀錄。
    assert not (await cycle()).retention_ran
    # 政策開了但部署沒允許：仍不執行。
    policy = (await admin_client.get(POLICY)).json()
    await admin_client.put(POLICY, json=_policy(policy["version"], auto_run_enabled=True))
    assert not (await cycle()).retention_ran
    # 部署允許但政策關著：也不執行。
    _allow_real_run(app)
    policy = (await admin_client.get(POLICY)).json()
    await admin_client.put(POLICY, json=_policy(policy["version"], auto_run_enabled=False))
    assert not (await cycle()).retention_ran
    assert (await db_session.execute(select(RetentionRun))).scalars().all() == []
    assert (await admin_client.get(f"{BASE}/visit-requests/{old_cancel}")).json()["parent_name"] == "定期清理的媽媽"

    # 兩個都開：真的匿名化，稽核記成系統執行；同一天不再跑第二次。
    policy = (await admin_client.get(POLICY)).json()
    await admin_client.put(POLICY, json=_policy(policy["version"], auto_run_enabled=True))
    real = await cycle()
    assert real.retention_ran and real.retention_anonymized == 1
    assert not (await cycle()).retention_ran
    assert (await admin_client.get(f"{BASE}/visit-requests/{old_cancel}")).json()["parent_name"] == retention_service.ANONYMIZED_NOTE
    [entry] = (await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "retention.run"))).scalars().all()
    assert entry.actor_user_id is None
    assert entry.metadata_json["trigger"] == "scheduled"
    runs = (await admin_client.get(f"{BASE}/retention-runs")).json()
    assert [(r["trigger"], r["total"], r["actor_email"]) for r in runs] == [("scheduled", 1, None)]
    assert (await admin_client.get(POLICY)).json()["last_scheduled_on"] is not None

    # 隔天再跑一次（沒有新的到期案件也留紀錄）。
    await db_session.execute(update(RetentionPolicy).where(RetentionPolicy.id == 1).values(last_scheduled_on=None))
    await db_session.commit()
    assert (await cycle()).retention_ran
    rows = (await db_session.execute(select(RetentionRun).order_by(RetentionRun.created_at))).scalars().all()
    assert [r.total for r in rows] == [1, 0]
