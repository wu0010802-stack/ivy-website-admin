"""素材背景處理（2026-10-03）：影片上傳後的 poster 與桌機／手機兩個 H.264 轉檔
版本，以及既有影片補轉檔（`python -m app.cli transcode-media-videos`）。

上傳請求只做驗證、去除拍攝資訊、ffprobe、配額與存檔（media/service.create_media_asset），
儲存體裡從頭到尾只有去掉拍攝資訊的檔案；這裡讀的是那份乾淨原檔。

認領沿用 outbox 的做法（workers/lease_service.py）：FOR UPDATE SKIP LOCKED 認領、
租約到期可被重新認領。轉檔可能跑好幾分鐘，執行期間每 HEARTBEAT_SECONDS 延長租約；
程序被砍掉時最多 LEASE_SECONDS 後由下一個 worker 接手，而且算一次嘗試——同一支
影片一直把程序弄掛時，MAX_ATTEMPTS 次就停。完成與失敗都比對 leased_by：租約已經
被別人接手，這次的結果整批丟掉。

本機開發、測試與指令列匯入用 process_now 在呼叫端交易裡直接做完（同一套產生函式）。
"""
from __future__ import annotations

import asyncio
import logging
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import case, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.common.concurrency import run_in_thread
from app.media import processing
from app.media.models import (
    MediaAsset,
    MediaJob,
    MediaJobKind,
    MediaJobStatus,
    MediaKind,
    MediaStatus,
    MediaVariant,
    VariantKind,
)
from app.media.processing import ProcessingError
from app.media.storage import MediaFileMissing, MediaStorage

logger = logging.getLogger("app.media.jobs")

LEASE_SECONDS = 120
HEARTBEAT_SECONDS = 30
MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = (60, 600)
INLINE_WORKER = "inline"
INTERRUPTED_MESSAGE = "處理中斷太多次（影片可能太大或太長），請剪短或降低解析度後重新上傳"
MISSING_ORIGINAL_MESSAGE = "儲存空間裡找不到原檔，請刪除這支影片後重新上傳"
INLINE_ERROR_MESSAGE = "處理時發生錯誤，請重新處理或換一支影片"
_EDITIONS = (("desktop", VariantKind.VIDEO_DESKTOP), ("mobile", VariantKind.VIDEO_MOBILE))
_ACTIVE = (MediaJobStatus.PENDING.value, MediaJobStatus.RUNNING.value)


class JobAlreadyActive(Exception):
    """這個素材已經有排隊中或處理中的工作。"""


@dataclass(frozen=True)
class StoredVariant:
    kind: VariantKind
    storage_key: str
    content_type: str
    width: int | None
    height: int | None


@dataclass(frozen=True)
class BackfillCandidate:
    asset_id: uuid.UUID
    filename: str
    campus_key: str | None
    duration: float | None
    missing: tuple[str, ...]


@dataclass(frozen=True)
class _Snapshot:
    media_id: uuid.UUID
    kind: MediaKind
    storage_key: str
    duration: float | None
    existing: frozenset[VariantKind]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _snapshot(asset: MediaAsset) -> _Snapshot:
    return _Snapshot(
        asset.id, asset.kind, asset.storage_key, asset.duration_seconds, frozenset(v.kind for v in asset.variants)
    )


async def enqueue(
    db: AsyncSession,
    asset: MediaAsset,
    kind: MediaJobKind,
    *,
    created_by: uuid.UUID | None = None,
    now: datetime | None = None,
) -> MediaJob:
    now = now or _now()
    job = MediaJob(
        id=uuid.uuid4(),
        media_id=asset.id,
        kind=kind.value,
        status=MediaJobStatus.PENDING.value,
        attempts=0,
        next_attempt_at=now,
        created_by=created_by,
        created_at=now,
    )
    # savepoint：撞到 uq_media_jobs_active 時只回滾這一筆，呼叫端的交易照常。
    try:
        async with db.begin_nested():
            db.add(job)
            await db.flush()
    except IntegrityError as exc:
        raise JobAlreadyActive() from exc
    return job


def _mark_failed(asset: MediaAsset | None, job: MediaJob, message: str, now: datetime) -> None:
    job.status = MediaJobStatus.FAILED.value
    job.error = message[:500]
    job.finished_at = now
    job.leased_by = None
    job.leased_until = None
    # backfill 失敗不動素材：既有影片照原檔播放。
    if asset is not None and job.kind == MediaJobKind.PROCESS.value:
        asset.status = MediaStatus.FAILED
        asset.processing_error = message[:500]


def _record_failure(asset: MediaAsset | None, job: MediaJob, message: str, *, retryable: bool, now: datetime) -> str:
    job.attempts += 1
    if retryable and job.attempts < MAX_ATTEMPTS:
        job.status = MediaJobStatus.PENDING.value
        job.error = message[:500]
        job.leased_by = None
        job.leased_until = None
        job.next_attempt_at = now + timedelta(seconds=_BACKOFF_SECONDS[min(job.attempts - 1, len(_BACKOFF_SECONDS) - 1)])
        return "retry"
    _mark_failed(asset, job, message, now)
    return "failed"


def _apply(asset: MediaAsset, job: MediaJob, outputs: list[StoredVariant], now: datetime) -> list[str]:
    """衍生檔記錄寫上素材；新上傳的標成可用。回傳因為已經有同種類而沒用到的檔案。"""
    have = {v.kind for v in asset.variants}
    unused: list[str] = []
    for out in outputs:
        if out.kind in have:
            unused.append(out.storage_key)
            continue
        asset.variants.append(
            MediaVariant(
                id=uuid.uuid4(),
                media_id=asset.id,
                kind=out.kind,
                storage_key=out.storage_key,
                content_type=out.content_type,
                width=out.width,
                height=out.height,
            )
        )
    if job.kind == MediaJobKind.PROCESS.value:
        asset.status = MediaStatus.READY
        asset.processing_error = None
    job.status = MediaJobStatus.DONE.value
    job.finished_at = now
    job.error = None
    job.leased_by = None
    job.leased_until = None
    return unused


async def _delete_files(storage: MediaStorage, keys: list[str]) -> None:
    for key in keys:
        try:
            await run_in_thread(storage.delete, key)
        except Exception:  # noqa: BLE001 - 刪不掉只留下孤兒檔
            logger.warning("背景處理：刪除沒用到的衍生檔 %s 失敗，留下孤兒檔", key)


async def _produce(storage: MediaStorage, snap: _Snapshot, job_kind: MediaJobKind) -> list[StoredVariant]:
    """下載乾淨原檔 → poster（新上傳才做）＋缺少的轉檔版本 → 寫進儲存體。任何一步
    失敗（含被取消）就刪掉這次寫入的檔案再往外丟；DB 記錄由呼叫端寫。"""
    if snap.kind != MediaKind.VIDEO:
        raise ProcessingError("只有影片會排背景處理")
    written: list[StoredVariant] = []
    try:
        with tempfile.TemporaryDirectory(prefix="media-job-") as tmp:
            source = Path(tmp) / "source.mp4"
            try:
                await run_in_thread(storage.download_file, snap.storage_key, source)
            except (MediaFileMissing, FileNotFoundError) as exc:
                raise ProcessingError(MISSING_ORIGINAL_MESSAGE) from exc
            if job_kind == MediaJobKind.PROCESS and VariantKind.POSTER not in snap.existing:
                poster = await processing.run_media_job(processing.extract_video_poster, source)
                key = storage.generate_key(".webp")
                # 先記下再寫：寫到一半被取消也刪得到（thread 會等寫完才讓取消往上丟）。
                written.append(StoredVariant(VariantKind.POSTER, key, "image/webp", poster.width, poster.height))
                await run_in_thread(storage.write_bytes, key, poster.data)
            color = await processing.run_media_job(processing.probe_video_color, source)
            for edition, variant_kind in _EDITIONS:
                if variant_kind in snap.existing:
                    continue
                target = Path(tmp) / f"{edition}.mp4"
                video = await processing.run_transcode_job(
                    processing.transcode_video, source, target, edition, color, snap.duration
                )
                key = storage.generate_key(".mp4")
                written.append(StoredVariant(variant_kind, key, "video/mp4", video.width, video.height))
                await run_in_thread(storage.write_file, key, target)
    except BaseException:
        await _delete_files(storage, [v.storage_key for v in written])
        raise
    return written


async def claim_next(db: AsyncSession, worker_id: str, *, now: datetime | None = None) -> MediaJob | None:
    """認領一筆該做的工作（呼叫端 commit）。租約過期的算一次中斷；中斷到第
    MAX_ATTEMPTS 次直接標失敗、改認領下一筆。"""
    now = now or _now()
    while True:
        result = await db.execute(
            select(MediaJob)
            .where(
                ((MediaJob.status == MediaJobStatus.PENDING.value) & (MediaJob.next_attempt_at <= now))
                | ((MediaJob.status == MediaJobStatus.RUNNING.value) & (MediaJob.leased_until < now))
            )
            .order_by(
                # 新上傳先於整批回補，各自再依排程時間。
                case((MediaJob.kind == MediaJobKind.BACKFILL.value, 1), else_=0),
                MediaJob.next_attempt_at,
                MediaJob.created_at,
            )
            .limit(1)
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
        job = result.scalar_one_or_none()
        if job is None:
            return None
        if job.status == MediaJobStatus.RUNNING.value:
            job.attempts += 1
            if job.attempts >= MAX_ATTEMPTS:
                asset = await db.get(MediaAsset, job.media_id, with_for_update=True)
                _mark_failed(asset, job, INTERRUPTED_MESSAGE, now)
                logger.warning("背景處理：素材 %s 中斷 %s 次，標成失敗", job.media_id, job.attempts)
                await db.flush()
                continue
        job.status = MediaJobStatus.RUNNING.value
        job.leased_by = worker_id
        job.leased_until = now + timedelta(seconds=LEASE_SECONDS)
        await db.flush()
        return job


async def extend_lease(session_factory: async_sessionmaker[AsyncSession], job_id: uuid.UUID, worker_id: str) -> bool:
    async with session_factory() as db:
        result = await db.execute(
            update(MediaJob)
            .where(MediaJob.id == job_id, MediaJob.leased_by == worker_id, MediaJob.status == MediaJobStatus.RUNNING.value)
            .values(leased_until=_now() + timedelta(seconds=LEASE_SECONDS))
        )
        await db.commit()
        return result.rowcount == 1


async def release(session_factory: async_sessionmaker[AsyncSession], job_id: uuid.UUID, worker_id: str) -> bool:
    """程序要結束：做到一半的工作放回佇列（不算一次嘗試），下一個程序馬上接手。"""
    async with session_factory() as db:
        result = await db.execute(
            update(MediaJob)
            .where(MediaJob.id == job_id, MediaJob.leased_by == worker_id, MediaJob.status == MediaJobStatus.RUNNING.value)
            .values(status=MediaJobStatus.PENDING.value, leased_by=None, leased_until=None, next_attempt_at=_now())
        )
        await db.commit()
        return result.rowcount == 1


async def _keep_lease(session_factory, job_id: uuid.UUID, worker_id: str) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        try:
            await extend_lease(session_factory, job_id, worker_id)
        except Exception:  # noqa: BLE001 - DB 暫時連不上：下一次再延
            logger.warning("背景處理：延長租約失敗", exc_info=True)


async def _locked_job(db: AsyncSession, job_id: uuid.UUID, worker_id: str) -> MediaJob | None:
    job = await db.get(MediaJob, job_id, with_for_update=True, populate_existing=True)
    if job is None or job.status != MediaJobStatus.RUNNING.value or job.leased_by != worker_id:
        return None
    return job


async def _finish(session_factory, storage: MediaStorage, job_id: uuid.UUID, worker_id: str, outputs: list[StoredVariant]) -> str:
    keys = [o.storage_key for o in outputs]
    unused: list[str] = []
    committed = False
    try:
        async with session_factory() as db:
            job = await _locked_job(db, job_id, worker_id)
            if job is None:
                await db.rollback()
                await _delete_files(storage, keys)
                return "lost"
            result = await db.execute(
                select(MediaAsset)
                .options(selectinload(MediaAsset.variants))
                .where(MediaAsset.id == job.media_id)
                .with_for_update(of=MediaAsset)
            )
            asset = result.scalar_one_or_none()
            if asset is None:
                unused = keys
                job.status = MediaJobStatus.DONE.value
                job.finished_at = _now()
            else:
                unused = _apply(asset, job, outputs, _now())
            # commit 不能被取消打斷到不知道成沒成：等它結束，再判斷檔案要不要留。
            commit = asyncio.ensure_future(db.commit())
            try:
                await asyncio.shield(commit)
            except asyncio.CancelledError:
                await asyncio.wait({commit})
                committed = not commit.cancelled() and commit.exception() is None
                raise
            committed = True
    except BaseException:
        # 取消與例外都一樣：沒提交就刪光這次寫的；已提交只刪沒用到的。
        await _delete_files(storage, unused if committed else keys)
        raise
    await _delete_files(storage, unused)
    return "done"


async def _fail(session_factory, job_id: uuid.UUID, worker_id: str, message: str, *, retryable: bool) -> str:
    async with session_factory() as db:
        job = await _locked_job(db, job_id, worker_id)
        if job is None:
            await db.rollback()
            return "lost"
        asset = await db.get(MediaAsset, job.media_id, with_for_update=True)
        outcome = _record_failure(asset, job, message, retryable=retryable, now=_now())
        await db.commit()
    if outcome == "failed":
        logger.warning("背景處理：工作 %s 失敗：%s", job_id, message)
    return outcome


async def run_claimed(session_factory, storage: MediaStorage, job_id: uuid.UUID, *, worker_id: str) -> str:
    async with session_factory() as db:
        job = await db.get(MediaJob, job_id)
        if job is None:  # 素材被實體刪除，CASCADE 帶走了工作
            await db.rollback()
            return "lost"
        result = await db.execute(
            select(MediaAsset).options(selectinload(MediaAsset.variants)).where(MediaAsset.id == job.media_id)
        )
        asset = result.scalar_one_or_none()
        job_kind = MediaJobKind(job.kind)
        snap = _snapshot(asset) if asset is not None else None
        await db.rollback()
    if snap is None:
        return await _finish(session_factory, storage, job_id, worker_id, [])
    heartbeat = asyncio.create_task(_keep_lease(session_factory, job_id, worker_id))
    try:
        outputs = await _produce(storage, snap, job_kind)
    except ProcessingError as exc:
        return await _fail(session_factory, job_id, worker_id, str(exc), retryable=exc.retryable)
    except Exception as exc:  # noqa: BLE001 - 儲存體暫時錯誤等：下一次再試
        logger.exception("背景處理：素材 %s 發生未預期錯誤", snap.media_id)
        return await _fail(session_factory, job_id, worker_id, f"處理時發生錯誤（{type(exc).__name__}）", retryable=True)
    finally:
        heartbeat.cancel()
        await asyncio.gather(heartbeat, return_exceptions=True)
    return await _finish(session_factory, storage, job_id, worker_id, outputs)


async def process_next(session_factory, storage: MediaStorage, *, worker_id: str) -> str | None:
    async with session_factory() as db:
        job = await claim_next(db, worker_id)
        job_id = job.id if job is not None else None
        await db.commit()
    if job_id is None:
        return None
    return await run_claimed(session_factory, storage, job_id, worker_id=worker_id)


async def process_now(db: AsyncSession, storage: MediaStorage, asset: MediaAsset, job: MediaJob) -> str:
    """在呼叫端交易裡做完（本機開發、測試、指令列匯入；正式站走背景）。上傳的人
    正在等結果，失敗不排重試，直接標成處理失敗（原檔留著，可以重新處理）。"""
    # 呼叫端的物件可能已被 expire：整個重讀，async 下不能靠隱式 lazy load。
    await db.flush()  # refresh 會先 expire：呼叫端還沒 flush 的修改要先寫出去
    await db.refresh(asset)
    await db.refresh(asset, attribute_names=["variants"])
    await db.refresh(job)
    job.status = MediaJobStatus.RUNNING.value
    job.leased_by = INLINE_WORKER
    try:
        outputs = await _produce(storage, _snapshot(asset), MediaJobKind(job.kind))
    except ProcessingError as exc:
        _record_failure(asset, job, str(exc), retryable=False, now=_now())
        await db.flush()
        return "failed"
    except Exception:  # 其他例外也不能讓工作卡在 running／素材卡在 processing
        logger.exception("背景處理：素材 %s 就地處理發生未預期錯誤", asset.id)
        _record_failure(asset, job, INLINE_ERROR_MESSAGE, retryable=False, now=_now())
        await db.flush()
        return "failed"
    unused = _apply(asset, job, outputs, _now())
    await db.flush()
    await _delete_files(storage, unused)
    return "done"


async def retry(db: AsyncSession, asset: MediaAsset, *, actor_id: uuid.UUID | None) -> MediaJob:
    """處理失敗的影片重新排入（呼叫端先檢查是失敗的影片、commit）。"""
    job = await enqueue(db, asset, MediaJobKind.PROCESS, created_by=actor_id)
    asset.status = MediaStatus.PROCESSING
    asset.processing_error = None
    await db.flush()
    return job


async def backfill_candidates(db: AsyncSession) -> list[BackfillCandidate]:
    """可用、沒有待清理、還缺轉檔版本、也沒有排隊中工作的影片（含已封存：可能被還原）。"""
    active = select(MediaJob.media_id).where(MediaJob.status.in_(_ACTIVE))
    result = await db.execute(
        select(MediaAsset)
        .options(selectinload(MediaAsset.variants))
        .where(
            MediaAsset.kind == MediaKind.VIDEO,
            MediaAsset.status == MediaStatus.READY,
            MediaAsset.deleted_at.is_(None),
            MediaAsset.id.not_in(active),
        )
        .order_by(MediaAsset.created_at, MediaAsset.id)
    )
    out: list[BackfillCandidate] = []
    for asset in result.scalars():
        have = {v.kind for v in asset.variants}
        missing = tuple(kind.value for _, kind in _EDITIONS if kind not in have)
        if missing:
            out.append(BackfillCandidate(asset.id, asset.original_filename, asset.campus_key, asset.duration_seconds, missing))
    return out


async def enqueue_backfill(
    db: AsyncSession, asset_ids: list[uuid.UUID], *, created_by: uuid.UUID | None = None
) -> list[MediaJob]:
    queued: list[MediaJob] = []
    for asset_id in dict.fromkeys(asset_ids):
        asset = await db.get(MediaAsset, asset_id)
        if asset is None:
            continue
        try:
            queued.append(await enqueue(db, asset, MediaJobKind.BACKFILL, created_by=created_by))
        except JobAlreadyActive:
            continue
    return queued
