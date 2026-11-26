"""API 程序內的 Meta 名單拉取迴圈（docs/specs/2026-11-26-meta-lead-inbox-design.md §5）。

比照 FacebookSyncLoop：自己一個 asyncio task，不併進 maintenance 每分鐘那一輪（Meta 慢的時候
會拖到排程發布與通知）。WEBSITE_META_LEADS_ENABLED 開著而且 Facebook 同步設定好才啟動（app/main.py）。
每輪：拉名單 → 推 LINE 通知（有設 LINE 才推）。"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.meta_leads.sync import LeadSyncResult, notify_new_leads, sync_leads
from app.notifications.line import LineMessagingClient

logger = logging.getLogger("app.meta_leads.loop")

FIRST_DELAY_SECONDS = 30.0


class MetaLeadSyncLoop:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        interval_seconds: float,
        first_delay_seconds: float = FIRST_DELAY_SECONDS,
        line_transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._settings = settings
        self._line_transport = line_transport
        self.interval_seconds = interval_seconds
        self.first_delay_seconds = first_delay_seconds
        self.last_results: list[LeadSyncResult] = []
        self.last_run_at: datetime | None = None
        self._stopping = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="meta-leads-loop")

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def stop(self, *, timeout: float = 10.0) -> None:
        self._stopping.set()
        if self._task is None:
            return
        try:
            await asyncio.wait_for(asyncio.shield(self._task), timeout=timeout)
        except asyncio.TimeoutError:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    async def run_once(self) -> list[LeadSyncResult]:
        self.last_results = await sync_leads(self._session_factory, self._settings)
        self.last_run_at = datetime.now(timezone.utc)
        line: LineMessagingClient | None = None
        if self._settings.line_messaging_enabled:
            assert self._settings.line_messaging_access_token is not None
            line = LineMessagingClient(self._settings.line_messaging_access_token, transport=self._line_transport)
        try:
            async with self._session_factory() as db:
                await notify_new_leads(db, self._settings, line_client=line)
        finally:
            if line is not None:
                await line.aclose()
        return self.last_results

    async def _sleep(self, seconds: float) -> bool:
        try:
            await asyncio.wait_for(self._stopping.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            return True
        return False

    async def _run(self) -> None:
        if not await self._sleep(self.first_delay_seconds):
            return
        while True:
            try:
                await self.run_once()
            except Exception:  # noqa: BLE001 - 資料庫暫時連不上等，下一輪再試
                logger.exception("Meta 名單拉取：這一輪無法完成")
            if not await self._sleep(self.interval_seconds):
                return
