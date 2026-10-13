"""API 程序內的公開地理資料同步迴圈（招生區域分析，docs/specs/2026-10-08-admissions-area-design.md §7）。

不併進 maintenance 的 run_cycle：那一輪持全域 advisory lock、每 60 秒一次，下載並匯入
約 100MB 的門牌資料要一兩分鐘，會讓排程發布與通知一起延後。這裡自己一個 asyncio
task，每 check_seconds（預設一天）呼叫一次 run_geo_sync；要不要真的下載由 sync 依
「超過 30 天沒確認過」判斷。同一時間只允許一個同步：互斥由 run_geo_sync 自己的 session
級 advisory lock（sync.LOCK_KEY）負責，多個副本同時醒來時後到者收到 GeoSyncBusy，這裡
把它當成「這一輪跳過」。只在 WEBSITE_ADMISSIONS_ENABLED 與 WEBSITE_GEO_AUTO_SYNC 都開時
啟動（app/main.py）；CLI `geo-sync` 不看這兩個開關。"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.geo.sync import GeoSyncBusy, GeoSyncResult, run_geo_sync
from app.config import Settings

logger = logging.getLogger("app.admissions.geo.loop")

# 第一輪不要跟啟動搶資源：健康檢查先過再開始。
FIRST_DELAY_SECONDS = 30.0


class GeoSyncLoop:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        check_seconds: float,
        first_delay_seconds: float = FIRST_DELAY_SECONDS,
    ) -> None:
        self._session_factory = session_factory
        self._settings = settings
        self.check_seconds = check_seconds
        self.first_delay_seconds = first_delay_seconds
        self.last_result: GeoSyncResult | None = None
        self.last_run_at: datetime | None = None
        self._stopping = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="geo-sync-loop")

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def stop(self, *, timeout: float = 10.0) -> None:
        """停機：下載到一半就取消；沒切換的批次下次同步開頭會清掉。"""
        self._stopping.set()
        if self._task is None:
            return
        try:
            await asyncio.wait_for(asyncio.shield(self._task), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning("公開地理資料同步：停機後 %s 秒內沒有結束，取消這一輪（沒換版的批次下次同步會清掉）", timeout)
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)

    async def run_once(self) -> GeoSyncResult | None:
        """同步一次；別的程序正在同步（GeoSyncBusy）就跳過這一輪，回 None。"""
        try:
            result = await run_geo_sync(self._session_factory, self._settings)
        except GeoSyncBusy:
            logger.info("公開地理資料同步：另一個同步正在進行，這一輪跳過")
            return None
        self.last_result = result
        self.last_run_at = datetime.now(timezone.utc)
        return result

    async def _sleep(self, seconds: float) -> bool:
        """等下一輪；收到停止訊號就提早醒來並回傳 False。"""
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
                result = await self.run_once()
                # 只要有一項真的做了事（更新或失敗）就記摘要；三項都是 skipped（30 天內不看來源）才不吵。
                if result is not None and {result.doorplates, result.kindergartens, result.population} != {"skipped"}:
                    logger.info("公開地理資料同步：%s", result)
            except Exception:  # noqa: BLE001 - 連線失敗等，下一輪再試
                logger.exception("公開地理資料同步：這一輪無法完成")
            if not await self._sleep(self.check_seconds):
                return
