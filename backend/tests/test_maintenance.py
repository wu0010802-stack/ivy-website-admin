"""API 內建定期工作（app/workers/maintenance.py）。

原本排程發布、通知都只能靠外部 cron 呼叫 CLI，但沒有任何排程在
呼叫——正式站上這些事情從來沒發生過。"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select, text

from app.booking.models import OutboxMessage, OutboxStatus
from app.common.models import RateLimitCounter
from app.config import Settings
from app.db import create_engine, create_session_factory
from app.main import create_app
from app.notifications.models import NotificationInboxItem
from app.workers import maintenance
from app.workers.maintenance import MaintenanceLoop, run_cycle
from tests.conftest import book_slot


# 預約表單要有已發布的同意文字（切 slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")


async def _booking(admin_client, public_client) -> str:
    """官網家長自選場次預約；送出即 confirmed，並排入「新的參觀預約」通知。"""
    return (await book_slot(admin_client, public_client))["receipt_id"]


def _without_email(app) -> Settings:
    return app.state.settings.model_copy(update={"notification_email_sink_dir": None, "smtp_host": None})


async def test_cycle_writes_inbox_even_without_email(app, admin_client, public_client, db_session):
    await _booking(admin_client, public_client)

    result = await run_cycle(app.state.session_factory, _without_email(app), worker_id="test")

    assert result.ran
    assert not result.email_configured
    assert result.failed_steps == []
    # 逾期占位的步驟已隨舊流程刪除：結果與步驟清單都不再有它。
    assert not hasattr(result, "expired_holds")
    assert not hasattr(maintenance, "expire_holds")

    # 寄信沒設定，站內通知還是要到：原本整批 outbox 停著，後台一則都看不到。
    kinds = set((await db_session.execute(select(NotificationInboxItem.kind))).scalars())
    assert "visit_request_created" in kinds
    pending = (
        await db_session.execute(
            select(func.count())
            .select_from(OutboxMessage)
            .where(OutboxMessage.kind == "visit_request_created", OutboxMessage.status != OutboxStatus.SENT.value)
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


async def test_cycle_keeps_its_lock_beyond_the_idle_in_transaction_timeout(app, monkeypatch):
    """持鎖的交易整輪都閒置。執行期連線帶 idle_in_transaction 逾時，一輪跑得比
    逾時久時，原本連線會被 DB 砍掉：鎖提早釋放，finally 的 rollback 也拋例外。"""
    settings = _without_email(app).model_copy(update={"db_idle_in_transaction_timeout_ms": 200})
    engine = create_engine(settings)
    observed: dict[str, bool] = {}

    async def slow_steps(session_factory, settings, *, worker_id, line_transport):
        await asyncio.sleep(0.8)
        async with app.state.session_factory() as other:
            observed["other_got_lock"] = (
                await other.execute(
                    text("SELECT pg_try_advisory_xact_lock(hashtext(:key))"), {"key": maintenance._LOCK_KEY}
                )
            ).scalar_one()
            await other.rollback()
        return maintenance.CycleResult(ran=True)

    monkeypatch.setattr(maintenance, "_run_steps", slow_steps)
    try:
        result = await run_cycle(create_session_factory(engine), settings, worker_id="slow")
    finally:
        await engine.dispose()

    assert result.ran
    assert observed["other_got_lock"] is False


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


async def test_cycle_in_production_does_not_write_mail_to_the_sink_dir_without_smtp(
    app, admin_client, public_client, db_session, tmp_path
):
    """正式環境沒設 SMTP 但留著 sink 資料夾：家長信不能寫成檔案並當成已寄出，要走「未配置」。"""
    await _booking(admin_client, public_client)
    settings = app.state.settings.model_copy(
        update={"environment": "production", "smtp_host": None, "notification_email_sink_dir": str(tmp_path)}
    )

    result = await run_cycle(app.state.session_factory, settings, worker_id="test")

    assert result.ran
    assert not result.email_configured
    assert list(tmp_path.iterdir()) == []
    sent_parent_mail = (
        await db_session.execute(
            select(func.count())
            .select_from(OutboxMessage)
            .where(OutboxMessage.kind == "parent_visit_booked", OutboxMessage.status == OutboxStatus.SENT.value)
        )
    ).scalar_one()
    assert sent_parent_mail == 0


async def test_cycle_outside_production_still_writes_mail_to_the_sink_dir(
    app, admin_client, public_client, tmp_path
):
    await _booking(admin_client, public_client)
    settings = app.state.settings.model_copy(
        update={"environment": "development", "smtp_host": None, "notification_email_sink_dir": str(tmp_path)}
    )

    result = await run_cycle(app.state.session_factory, settings, worker_id="test")

    assert result.email_configured
    assert list(tmp_path.iterdir()) != []


async def test_a_failing_step_does_not_block_the_others(app, admin_client, public_client, db_session, monkeypatch):
    await _booking(admin_client, public_client)

    async def broken(db, **kwargs):
        raise RuntimeError("排程發布壞掉")

    monkeypatch.setattr("app.content.publish_jobs.run_due_jobs", broken)
    result = await run_cycle(app.state.session_factory, _without_email(app), worker_id="test")

    assert result.failed_steps == ["publish_jobs"]
    # 後面的步驟照常跑：outbox 發出了站內通知。
    kinds = set((await db_session.execute(select(NotificationInboxItem.kind))).scalars())
    assert "visit_request_created" in kinds


async def test_slow_smtp_does_not_block_the_event_loop(admin_client, public_client, run_outbox_once):
    """定期工作跑在 API 的 event loop 上；SMTP 若直接同步呼叫，寄信期間
    所有請求都會卡住。"""
    await _booking(admin_client, public_client)

    class SlowAdapter:
        def send(self, *, to: str, subject: str, body: str) -> None:
            time.sleep(0.3)

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
    assert result["sent"] >= 1
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


async def test_loop_reports_failed_steps_instead_of_looking_healthy(app, monkeypatch):
    """每一步都失敗時 last_completed_at 照樣更新；健康狀態要能看出來。"""

    async def broken(db, **kwargs):
        raise RuntimeError("模擬 DB 失敗")

    monkeypatch.setattr("app.content.publish_jobs.run_due_jobs", broken)
    loop = MaintenanceLoop(app.state.session_factory, _without_email(app), interval_seconds=0.05, worker_id="loop")
    loop.start()
    try:
        for _ in range(100):
            if loop.last_completed_at is not None:
                break
            await asyncio.sleep(0.05)
    finally:
        await loop.stop(timeout=5)
    assert loop.last_completed_at is not None
    assert "publish_jobs" in loop.last_failed_steps
    assert loop.last_clean_at is None


def _settings(**overrides) -> Settings:
    if overrides.get("environment") == "production":
        # production 一定要有 HTTPS 的 WEBSITE_ADMIN_ORIGIN（config 的正式環境檢查）。
        overrides.setdefault("admin_origin", "https://ivy.example")
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


async def test_lifespan_starts_loop_but_public_health_does_not_report_it(app):
    """背景工作的狀態只在總管理者的系統狀態頁看（test_system_status.py）；公開的 health
    不帶失敗步驟與時間，外部不能輪詢得知哪個定期工作正在失敗（2026-10-22 資安稽核）。"""
    settings = app.state.settings.model_copy(update={"background_jobs_interval_seconds": 10})
    loop_app = create_app(settings)
    try:
        async with loop_app.router.lifespan_context(loop_app):
            assert loop_app.state.maintenance is not None
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=loop_app), base_url="http://test") as c:
                body = (await c.get("/api/website/v1/health")).json()
            assert set(body) == {"status", "environment", "fixture_enabled"}
        assert loop_app.state.maintenance._task.done()
    finally:
        await loop_app.state.engine.dispose()


async def test_stale_backlog_writes_inbox_but_does_not_email(
    admin_client, public_client, db_session, run_outbox_once, recording_mail_adapter
):
    """定期工作第一次上線時，積壓好幾天的 outbox 不該一口氣寄給所有人。"""
    from sqlalchemy import update

    await _booking(admin_client, public_client)
    await db_session.execute(
        update(OutboxMessage).values(created_at=datetime.now(timezone.utc) - timedelta(days=3))
    )
    await db_session.commit()

    result = await run_outbox_once(recording_mail_adapter)

    assert result["sent"] >= 1
    assert recording_mail_adapter.sent == []
    assert (await db_session.execute(select(func.count()).select_from(NotificationInboxItem))).scalar_one() >= 1


async def test_cycle_drains_more_than_one_batch_of_outbox(app, admin_client, public_client, db_session):
    """一輪不再只處理 10 筆（2026-10-20）：積壓超過一批時，同一輪一批一批清到空。"""
    import uuid

    await _booking(admin_client, public_client)
    [original] = (
        await db_session.execute(select(OutboxMessage).where(OutboxMessage.kind == "visit_request_created"))
    ).scalars().all()
    for _ in range(14):
        db_session.add(
            OutboxMessage(
                id=uuid.uuid4(), visit_request_id=original.visit_request_id, kind=original.kind,
                payload=dict(original.payload), created_at=original.created_at,
                next_attempt_at=original.next_attempt_at, status=OutboxStatus.PENDING.value, attempts=0,
            )
        )
    await db_session.commit()
    total = (await db_session.execute(select(func.count()).select_from(OutboxMessage))).scalar_one()
    assert total > 10

    result = await run_cycle(app.state.session_factory, _without_email(app), worker_id="test")

    assert result.failed_steps == []
    assert result.notifications_sent + result.notifications_skipped + result.notifications_failed == total
    left = (
        await db_session.execute(
            select(func.count()).select_from(OutboxMessage).where(OutboxMessage.status == OutboxStatus.PENDING.value)
        )
    ).scalar_one()
    assert left == 0


async def test_drain_stops_at_a_short_batch_or_the_time_budget(monkeypatch):
    from app.workers import runner

    batches = [{"sent": 10, "failed": 0, "skipped": 0}, {"sent": 7, "failed": 2, "skipped": 1}, {"sent": 3, "failed": 0, "skipped": 0}]
    calls = []

    async def _fake_batch(db, adapter, *, worker_id, limit, **kwargs):
        calls.append((worker_id, limit, kwargs))
        return batches[len(calls) - 1]

    monkeypatch.setattr(runner, "process_outbox_batch", _fake_batch)
    totals = await runner.process_outbox_until_drained(None, None, worker_id="w", line=None)
    # 前兩批都滿 10 筆，第三批不滿就停。
    assert totals == {"sent": 20, "failed": 2, "skipped": 1}
    assert [c[:2] for c in calls] == [("w", 10)] * 3
    assert calls[0][2] == {"line": None}

    # 一直有滿批的工作時，用完時間預算就停（批與批之間檢查）。
    calls.clear()
    batches[:] = [{"sent": 10, "failed": 0, "skipped": 0}] * 100
    ticks = iter(range(0, 1000, 20))
    totals = await runner.process_outbox_until_drained(
        None, None, worker_id="w", time_budget_seconds=30, clock=lambda: next(ticks)
    )
    assert len(calls) == 2
    assert totals["sent"] == 20


async def test_cycle_queries_due_reminders_once_for_staff_and_parent(app, monkeypatch):
    from app.notifications import reminders

    real = reminders.due_upcoming
    calls = []

    async def _counting(db, now=None):
        calls.append(now)
        return await real(db, now)

    monkeypatch.setattr(reminders, "due_upcoming", _counting)
    result = await run_cycle(app.state.session_factory, _without_email(app), worker_id="test")
    assert result.failed_steps == []
    assert len(calls) == 1
