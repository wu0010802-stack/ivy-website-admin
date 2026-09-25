"""API 內建定期工作（app/workers/maintenance.py）。

原本排程發布、逾期占位、通知都只能靠外部 cron 呼叫 CLI，但沒有任何排程在
呼叫——正式站上這些事情從來沒發生過。"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select, text

from app.booking.models import OutboxMessage, OutboxStatus, VisitRequestStatus
from app.common.models import RateLimitCounter
from app.config import Settings
from app.main import create_app
from app.notifications.models import NotificationInboxItem
from app.workers import maintenance
from app.workers.maintenance import MaintenanceLoop, run_cycle
from tests.test_security_hardening import _create_slot, _enable_slots, _expire_hold, _payload


# 預約表單要有已發布的同意文字（啟用 inquiry／slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")


async def _expired_hold(admin_client, public_client, db_session, key: str) -> str:
    version = await _enable_slots(admin_client, auto_confirm=False)
    slot = await _create_slot(admin_client, capacity=1)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": key},
    )
    assert created.status_code == 201, created.text
    receipt_id = created.json()["receipt_id"]
    await _expire_hold(db_session, receipt_id)
    return receipt_id


def _without_email(app) -> Settings:
    return app.state.settings.model_copy(update={"notification_email_sink_dir": None, "smtp_host": None})


async def test_cycle_releases_holds_and_writes_inbox_even_without_email(app, admin_client, public_client, db_session):
    receipt_id = await _expired_hold(admin_client, public_client, db_session, "maint-hold")

    result = await run_cycle(app.state.session_factory, _without_email(app), worker_id="test")

    assert result.ran
    assert result.expired_holds == 1
    assert not result.email_configured
    assert result.failed_steps == []
    detail = await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt_id}")
    assert detail.json()["status"] == VisitRequestStatus.CANCELLED.value

    # 寄信沒設定，站內通知還是要到：原本整批 outbox 停著，後台一則都看不到。
    kinds = set((await db_session.execute(select(NotificationInboxItem.kind))).scalars())
    assert "visit_request_hold_expired" in kinds
    pending = (
        await db_session.execute(
            select(func.count()).select_from(OutboxMessage).where(OutboxMessage.status != OutboxStatus.SENT.value)
        )
    ).scalar_one()
    assert pending == 0


async def test_cycle_skips_while_another_cycle_holds_the_lock(app):
    async with app.state.session_factory() as other:
        held = (
            await other.execute(
                text("SELECT pg_try_advisory_xact_lock(hashtext(:key))"), {"key": maintenance._LOCK_KEY}
            )
        ).scalar_one()
        assert held
        result = await run_cycle(app.state.session_factory, _without_email(app), worker_id="second")
        assert result.ran is False
        await other.rollback()

    # 鎖隨交易結束釋放，下一輪照常。
    assert (await run_cycle(app.state.session_factory, _without_email(app), worker_id="third")).ran


async def test_cycle_purges_expired_rate_limit_rows(app, db_session):
    db_session.add(
        RateLimitCounter(
            bucket="login_source",
            key_hash="0" * 64,
            window_start=0,
            hits=3,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
    )
    await db_session.commit()

    result = await run_cycle(app.state.session_factory, _without_email(app), worker_id="test")

    assert result.rate_limit_rows_purged == 1
    assert (await db_session.execute(select(func.count()).select_from(RateLimitCounter))).scalar_one() == 0


async def test_a_failing_step_does_not_block_the_others(app, admin_client, public_client, db_session, monkeypatch):
    receipt_id = await _expired_hold(admin_client, public_client, db_session, "maint-step")

    async def broken(db, **kwargs):
        raise RuntimeError("排程發布壞掉")

    monkeypatch.setattr("app.content.publish_jobs.run_due_jobs", broken)
    result = await run_cycle(app.state.session_factory, _without_email(app), worker_id="test")

    assert result.failed_steps == ["publish_jobs"]
    assert result.expired_holds == 1
    detail = await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt_id}")
    assert detail.json()["status"] == VisitRequestStatus.CANCELLED.value


async def test_slow_smtp_does_not_block_the_event_loop(admin_client, public_client, db_session, run_outbox_once):
    """定期工作跑在 API 的 event loop 上；SMTP 若直接同步呼叫，寄信期間
    所有請求都會卡住。"""
    await _expired_hold(admin_client, public_client, db_session, "maint-smtp")
    await run_outbox_once(None)  # 先把建立案件那則通知消化掉，只留逾期這則

    class SlowAdapter:
        def send(self, *, to: str, subject: str, body: str) -> None:
            time.sleep(0.3)

    from app.booking.workflow_service import expire_holds

    await expire_holds(db_session)
    await db_session.commit()

    ticks = 0

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.02)
            ticks += 1

    task = asyncio.create_task(ticker())
    try:
        result = await run_outbox_once(SlowAdapter())
    finally:
        task.cancel()
    assert result["sent"] == 1
    assert ticks >= 5, "寄信期間 event loop 被卡住了"


async def test_loop_runs_cycles_and_stops_cleanly(app):
    loop = MaintenanceLoop(app.state.session_factory, _without_email(app), interval_seconds=0.05, worker_id="loop")
    loop.start()
    try:
        for _ in range(100):
            if loop.last_completed_at is not None:
                break
            await asyncio.sleep(0.05)
        assert loop.last_completed_at is not None
    finally:
        await loop.stop(timeout=5)
    assert loop._task is not None and loop._task.done()


def _settings(**overrides) -> Settings:
    return Settings(
        database_url="postgresql+asyncpg://localhost/ivy_website_dev",
        session_secret="test-only-secret-please-rotate",
        **overrides,
    )


def test_interval_defaults_on_in_production_and_off_elsewhere():
    assert _settings(environment="production").background_jobs_interval == 60
    assert _settings(environment="development").background_jobs_interval == 0
    assert _settings(environment="production", background_jobs_interval_seconds=0).background_jobs_interval == 0
    assert _settings(environment="development", background_jobs_interval_seconds=30).background_jobs_interval == 30


@pytest.mark.parametrize("value", [1, 9, 3601, -5])
def test_interval_rejects_values_that_would_hammer_or_stall(value):
    with pytest.raises(ValueError):
        _settings(background_jobs_interval_seconds=value)


async def test_lifespan_starts_loop_and_health_reports_it(app):
    settings = app.state.settings.model_copy(update={"background_jobs_interval_seconds": 10})
    loop_app = create_app(settings)
    try:
        async with loop_app.router.lifespan_context(loop_app):
            assert loop_app.state.maintenance is not None
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=loop_app), base_url="http://test") as c:
                body = (await c.get("/api/website/v1/health")).json()
            assert body["background_jobs"] == {"enabled": True, "last_completed_at": None}
        assert loop_app.state.maintenance._task.done()
    finally:
        await loop_app.state.engine.dispose()


async def test_health_reports_disabled_when_loop_is_off(public_client):
    body = (await public_client.get("/api/website/v1/health")).json()
    assert body["background_jobs"] == {"enabled": False, "last_completed_at": None}


async def test_stale_backlog_writes_inbox_but_does_not_email(
    admin_client, public_client, db_session, run_outbox_once, recording_mail_adapter
):
    """定期工作第一次上線時，積壓好幾天的 outbox 不該一口氣寄給所有人。"""
    from sqlalchemy import update

    await _expired_hold(admin_client, public_client, db_session, "maint-stale")
    await db_session.execute(
        update(OutboxMessage).values(created_at=datetime.now(timezone.utc) - timedelta(days=3))
    )
    await db_session.commit()

    result = await run_outbox_once(recording_mail_adapter)

    assert result["sent"] >= 1
    assert recording_mail_adapter.sent == []
    assert (await db_session.execute(select(func.count()).select_from(NotificationInboxItem))).scalar_one() >= 1
