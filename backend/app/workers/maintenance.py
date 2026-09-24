"""API 內建的定期工作：排程發布、釋放逾期占位、處理通知 outbox、清過期限流計數。

原本只能靠外部 cron 呼叫 `python -m app.cli process-notifications`，但 repo 與
部署設定裡都沒有這個 cron——排程發布永遠不會到點上線，後台也收不到任何通知。
改成 API 啟動後自己每隔一段時間跑一輪（`WEBSITE_BACKGROUND_JOBS_INTERVAL_SECONDS`，
production 預設 60 秒）；CLI 保留，呼叫的是同一個 `run_cycle`。

同一時間全域只會有一輪在跑：以 PostgreSQL advisory lock 互斥，多個 worker／
副本、或有人同時手動執行 CLI，後到者直接跳過這一輪。各步驟本身也都冪等
（outbox 租約、排程 SKIP LOCKED、占位依狀態鎖列），這把鎖只是避免重複白工。
用交易層級的鎖：交易結束（含例外）就自動釋放，不會卡在連線池裡的連線上。"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.booking.workflow_service import expire_holds
from app.common.ratelimit import purge_expired_counters
from app.config import Settings
from app.notifications.email_adapter import EmailNotConfigured, get_email_adapter
from app.workers.runner import process_outbox_batch

logger = logging.getLogger("app.maintenance")

_LOCK_KEY = "ivy-website:maintenance"


@dataclass
class CycleResult:
    ran: bool
    published: int = 0
    publish_failed: int = 0
    expired_holds: int = 0
    email_configured: bool = False
    notifications_sent: int = 0
    notifications_failed: int = 0
    rate_limit_rows_purged: int = 0
    failed_steps: list[str] = field(default_factory=list)

    @property
    def did_anything(self) -> bool:
        return any(
            (
                self.published,
                self.publish_failed,
                self.expired_holds,
                self.notifications_sent,
                self.notifications_failed,
                self.rate_limit_rows_purged,
                self.failed_steps,
            )
        )


def default_worker_id() -> str:
    return f"api-{socket.gethostname()}-{os.getpid()}"


async def run_cycle(
    session_factory: async_sessionmaker[AsyncSession], settings: Settings, *, worker_id: str
) -> CycleResult:
    """跑一輪。每一步用自己的 session，某一步失敗只記下來，不擋後面的步驟。"""
    async with session_factory() as lock_db:
        acquired = (
            await lock_db.execute(text("SELECT pg_try_advisory_xact_lock(hashtext(:key))"), {"key": _LOCK_KEY})
        ).scalar_one()
        if not acquired:
            await lock_db.rollback()
            return CycleResult(ran=False)
        try:
            return await _run_steps(session_factory, settings, worker_id=worker_id)
        finally:
            await lock_db.rollback()


async def _run_steps(
    session_factory: async_sessionmaker[AsyncSession], settings: Settings, *, worker_id: str
) -> CycleResult:
    result = CycleResult(ran=True)

    # 到期的排程發布。每筆自己一個交易，失敗記在排程上，後台看得到原因。
    try:
        from app.content.publish_jobs import run_due_jobs

        async with session_factory() as db:
            scheduled = await run_due_jobs(db)
        result.published = scheduled["published"]
        result.publish_failed = scheduled["failed"]
    except Exception:  # noqa: BLE001 - 一步失敗不擋後面的步驟
        logger.exception("定期工作：排程發布失敗")
        result.failed_steps.append("publish_jobs")

    # 先釋放逾期占位再處理 outbox：它會寫進 outbox，這一輪就能一起通知。
    # 釋放占位與寄信設定無關，一定要跑。
    try:
        async with session_factory() as db:
            result.expired_holds = await expire_holds(db)
            await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("定期工作：釋放逾期占位失敗")
        result.failed_steps.append("expire_holds")

    try:
        adapter = get_email_adapter(settings.notification_email_sink_dir, settings)
        result.email_configured = True
    except EmailNotConfigured:
        adapter = None
    try:
        async with session_factory() as db:
            outbox = await process_outbox_batch(db, adapter, worker_id=worker_id)
        result.notifications_sent = outbox["sent"]
        result.notifications_failed = outbox["failed"]
    except Exception:  # noqa: BLE001
        logger.exception("定期工作：處理通知失敗")
        result.failed_steps.append("outbox")

    try:
        async with session_factory() as db:
            result.rate_limit_rows_purged = await purge_expired_counters(db, datetime.now(timezone.utc))
            await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("定期工作：清除過期限流計數失敗")
        result.failed_steps.append("rate_limits")

    return result


class MaintenanceLoop:
    """在 API 程序內定期呼叫 run_cycle。停止時等目前這一輪跑完（寄到一半的
    信不要被硬砍：已寄出卻沒記下來的收件人，下一輪會再收到一封）。"""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        interval_seconds: float,
        worker_id: str | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._settings = settings
        self.interval_seconds = interval_seconds
        self.worker_id = worker_id or default_worker_id()
        self.last_completed_at: datetime | None = None
        self._stopping = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="maintenance-loop")

    async def stop(self, *, timeout: float = 30.0) -> None:
        self._stopping.set()
        if self._task is None:
            return
        try:
            await asyncio.wait_for(asyncio.shield(self._task), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("定期工作在 %s 秒內沒有結束，強制取消", timeout)
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    async def _sleep(self, seconds: float) -> bool:
        """睡到下一輪；收到停止訊號就提早醒來並回傳 False。"""
        try:
            await asyncio.wait_for(self._stopping.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            return True
        return False

    async def _run(self) -> None:
        # 第一輪不要跟啟動搶資源：健康檢查先過，再開始跑。
        if not await self._sleep(min(self.interval_seconds, 10)):
            return
        while True:
            try:
                result = await run_cycle(self._session_factory, self._settings, worker_id=self.worker_id)
            except Exception:  # noqa: BLE001 - 取鎖本身失敗（例如 DB 暫時連不上），下一輪再試
                logger.exception("定期工作：這一輪無法開始")
            else:
                if result.ran:
                    self.last_completed_at = datetime.now(timezone.utc)
                    if result.did_anything:
                        logger.info("定期工作：%s", result)
            if not await self._sleep(self.interval_seconds):
                return
