"""API 程序內的素材背景處理迴圈（app/media/jobs.py）。

不併進 maintenance 的 run_cycle：那一輪持全域 advisory lock、每 60 秒一次，轉一支
影片可能要好幾分鐘，會讓排程發布與通知一起延後。這裡自己一個 asyncio task，一次
處理一件（轉檔本身另有 processing.TRANSCODE_CONCURRENCY 把關），做完馬上找下一件，
沒有工作時每 poll_seconds 看一次。停機時把做到一半的工作放回佇列（不算一次嘗試），
並中止執行中的 ffmpeg。"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.media import jobs as media_jobs
from app.media import processing
from app.media.service import get_storage
from app.media.storage import MediaStorage
from app.workers.maintenance import default_worker_id

logger = logging.getLogger("app.media.loop")

# 停機等迴圈結束時，多久再檢查一次有沒有剛開出來的 ffmpeg。
_STOP_POLL_SECONDS = 0.5


class MediaJobLoop:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        poll_seconds: float,
        worker_id: str | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._settings = settings
        self.poll_seconds = poll_seconds
        # 完成、失敗、放回都比對 leased_by：同一台機器重開後 pid 可能重複，同一個程序
        # 也可能有兩個迴圈（測試），所以再加一段隨機值。
        self.worker_id = worker_id or f"media-{default_worker_id()}-{uuid.uuid4().hex[:8]}"
        self.last_processed_at: datetime | None = None
        self.last_failed_at: datetime | None = None
        self._current_job_id: uuid.UUID | None = None
        self._stopping = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="media-job-loop")

    @property
    def running(self) -> bool:
        """迴圈還活著（health 的 media_jobs.enabled）。啟動時拿不到儲存體、或迴圈異常
        結束，都會變成 False。"""
        return self._task is not None and not self._task.done()

    async def stop(self, *, timeout: float = 10.0) -> None:
        """停機：做到一半的工作先放回佇列（不算一次嘗試）→ 中止執行中的 ffmpeg →
        取消迴圈，最多等 timeout 秒。

        順序不能反過來：轉檔在 thread 裡跑（app/common/concurrency.run_in_thread），被
        取消時要等 thread 結束才會往上丟。先中止 ffmpeg 而工作還沒放回，轉檔失敗會被
        記成一次失敗。先放回之後，被中止的轉檔（processing.TranscodeInterrupted）或任何
        之後才回來的結果，在 jobs._fail／_finish 比對 leased_by 時都會當成 lost，檔案刪掉、
        工作維持 pending。ffmpeg 一定要收掉：不然 asyncio.run 收尾與直譯器結束都會等這個
        thread，程序要撐到轉檔跑完（最長 30 分鐘）或被 SIGKILL。

        取消送出之後、迴圈真的結束之前，每 _STOP_POLL_SECONDS 再收一次：中止的那一刻
        剛好在兩個步驟之間（例如 ffprobe 跑完、轉檔的 thread 正要開 ffmpeg），第一次會
        撲空。"""
        self._stopping.set()
        task = self._task
        if task is None:
            return
        cancelled = False
        interrupted = self._current_job_id
        if interrupted is not None and not task.done():
            await self._release(interrupted)
            await self._terminate_transcodes()
            task.cancel()
            cancelled = True
        # 沒有工作在做：迴圈看到停止訊號就自己結束（認領到一半的，認領完會直接放回）。
        clock = asyncio.get_running_loop().time
        deadline = clock() + timeout
        done: set[asyncio.Task] = set()
        while not done and clock() < deadline:
            done, _ = await asyncio.wait({task}, timeout=min(_STOP_POLL_SECONDS, max(0.0, deadline - clock())))
            if not done and cancelled:
                await self._terminate_transcodes()
        if not done:
            if not cancelled:
                task.cancel()
            # 只取消一次、不無限等（例如還在抽 poster，最多 30 秒）。
            logger.warning("背景處理：迴圈在 %s 秒內沒有結束，不再等待", timeout)
            return
        if not task.cancelled() and task.exception() is not None:
            logger.error("背景處理：迴圈異常結束", exc_info=task.exception())

    async def _terminate_transcodes(self) -> None:
        try:
            await asyncio.to_thread(processing.terminate_running_transcodes)
        except Exception:  # noqa: BLE001 - 收不掉就照舊等 thread
            logger.warning("背景處理：停機時中止 ffmpeg 失敗", exc_info=True)

    async def _release(self, job_id: uuid.UUID) -> None:
        try:
            if await media_jobs.release(self._session_factory, job_id, self.worker_id):
                logger.info("背景處理：停機，工作 %s 放回佇列", job_id)
        except Exception:  # noqa: BLE001 - 放不回去就等租約過期
            logger.warning("背景處理：停機時放回工作 %s 失敗", job_id, exc_info=True)

    async def _sleep(self, seconds: float) -> bool:
        """等下一輪；收到停止訊號就提早醒來並回傳 False。"""
        try:
            await asyncio.wait_for(self._stopping.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            return True
        return False

    async def _process_one(self, storage: MediaStorage) -> str | None:
        async with self._session_factory() as db:
            job = await media_jobs.claim_next(db, self.worker_id)
            job_id = job.id if job is not None else None
            await db.commit()
        if job_id is None:
            return None
        self._current_job_id = job_id
        try:
            if self._stopping.is_set():
                # 認領途中收到停止訊號：不開始轉檔，直接放回。
                await self._release(job_id)
                return None
            return await media_jobs.run_claimed(self._session_factory, storage, job_id, worker_id=self.worker_id)
        finally:
            self._current_job_id = None

    async def _run(self) -> None:
        # 不跟啟動搶資源：健康檢查先過再開始。
        if not await self._sleep(min(self.poll_seconds, 5)):
            return
        try:
            storage = get_storage(self._settings)
        except Exception:
            # 儲存體設定錯：迴圈結束，health 的 media_jobs.enabled 變成 False。
            logger.exception("背景處理：拿不到儲存體，迴圈停止")
            self.last_failed_at = datetime.now(timezone.utc)
            return
        while not self._stopping.is_set():
            outcome: str | None = None
            try:
                outcome = await self._process_one(storage)
            except Exception:  # noqa: BLE001 - DB 暫時連不上等：等一輪再試
                logger.exception("背景處理：這一輪無法完成")
                self.last_failed_at = datetime.now(timezone.utc)
            if outcome == "done":
                self.last_processed_at = datetime.now(timezone.utc)
            elif outcome == "failed":
                self.last_failed_at = datetime.now(timezone.utc)
            # 有做事（含 retry／lost）就馬上找下一件；佇列空了才等。
            if outcome is None and not await self._sleep(self.poll_seconds):
                return
