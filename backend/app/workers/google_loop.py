"""API 程序內的 Google 商家檔案與 Keyword Planner 同步迴圈
（2026-11-25，docs/specs/2026-11-25-business-profile-keyword-planner-design.md §6）。

比照 FacebookSyncLoop：自己一個 asyncio task，不併進 maintenance 每分鐘那一輪（Google 慢時不拖到排程發布與通知）。
每 WEBSITE_GOOGLE_SYNC_SECONDS（預設一小時）醒來一次；要不要真的向 Google 要資料由兩個同步自己判斷（商家檔案每天一次、
Keyword Planner 每 7 天或有新關鍵字時，失敗後隔 3 小時再試）。商家檔案或 Keyword Planner 任一個設定好才啟動（app/main.py）。
兩個程序同時同步只是寫兩次一樣的值（全部是 upsert／整月替換），所以不加 advisory lock。CLI `google-sync` 不看迴圈。"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.insights.business_profile import LocationSyncResult, sync_business_profile
from app.insights.google_token import RefreshTokenAuth
from app.insights.search_demand import SearchDemandResult, sync_search_demand

logger = logging.getLogger("app.insights.google_loop")

FIRST_DELAY_SECONDS = 90.0


@dataclass
class GoogleSyncResult:
    business_profile: list[LocationSyncResult] = field(default_factory=list)
    search_demand: SearchDemandResult | None = None


class GoogleSync:
    """兩把 refresh token 的 access token 快取都放這裡；迴圈與 CLI 各自一份。"""

    def __init__(self) -> None:
        self.gbp_auth = RefreshTokenAuth()
        self.ads_auth = RefreshTokenAuth()

    async def run(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        force: bool = False,
    ) -> GoogleSyncResult:
        result = GoogleSyncResult()
        if settings.gbp_enabled:
            result.business_profile = await sync_business_profile(
                session_factory, settings, self.gbp_auth, transport=transport, force=force
            )
        if settings.google_ads_enabled:
            result.search_demand = await sync_search_demand(
                session_factory, settings, self.ads_auth, transport=transport, force=force
            )
        return result


class GoogleSyncLoop:
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
        self._sync = GoogleSync()
        self.interval_seconds = interval_seconds
        self.first_delay_seconds = first_delay_seconds
        self.last_result: GoogleSyncResult | None = None
        self.last_run_at: datetime | None = None
        self._stopping = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="google-sync-loop")

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

    async def run_once(self) -> GoogleSyncResult:
        self.last_result = await self._sync.run(self._session_factory, self._settings)
        self.last_run_at = datetime.now(timezone.utc)
        return self.last_result

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
                logger.exception("Google 商家檔案／Keyword Planner 同步：這一輪無法完成")
            if not await self._sleep(self.interval_seconds):
                return
