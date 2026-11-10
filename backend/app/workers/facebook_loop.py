"""API 程序內的 Facebook 粉專貼文同步迴圈（docs/specs/2026-10-28-facebook-news-sync-design.md §4）。

比照 GeoSyncLoop：自己一個 asyncio task，不併進 maintenance 每分鐘那一輪（Meta 慢的時候
會拖到排程發布與通知）。WEBSITE_FACEBOOK_ACCESS_TOKEN 與 WEBSITE_FACEBOOK_PAGES 都設了
才啟動（app/main.py）；CLI `facebook-sync` 不看迴圈。"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.facebook.sync import PageSyncResult, sync_pages

logger = logging.getLogger("app.facebook.loop")

FIRST_DELAY_SECONDS = 60.0


class FacebookSyncLoop:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        interval_seconds: float,
        first_delay_seconds: float = FIRST_DELAY_SECONDS,
    ) -> None:
        self._session_factory = session_factory
        self._settings = settings
        self.interval_seconds = interval_seconds
        self.first_delay_seconds = first_delay_seconds
        self.last_results: list[PageSyncResult] = []
        self.last_run_at: datetime | None = None
        self._stopping = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="facebook-sync-loop")

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

    async def run_once(self) -> list[PageSyncResult]:
        self.last_results = await sync_pages(self._session_factory, self._settings)
        self.last_run_at = datetime.now(timezone.utc)
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
                logger.exception("Facebook 粉專同步：這一輪無法完成")
            if not await self._sleep(self.interval_seconds):
                return
