"""API 程序內的素材背景迴圈（app/workers/media_loop.py）。"""
from __future__ import annotations

import asyncio
import os
import shutil
import threading
from pathlib import Path

import httpx
import pytest

from app.main import create_app
from app.media import processing
from app.media.models import MediaAsset, MediaStatus
from app.media.processing import VideoProbe
from app.workers.media_loop import MediaJobLoop
from tests.conftest import _test_settings
from tests.test_media_jobs import _job, _reload, _stored_video, requires_ffmpeg

pytestmark = requires_ffmpeg


async def _wait_for(predicate, timeout: float = 5.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not await predicate():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("等不到預期狀態")
        await asyncio.sleep(0.05)


def _files(app) -> set[Path]:
    return {p for p in Path(app.state.settings.media_root).rglob("*") if p.is_file()}


@pytest.mark.asyncio
async def test_loop_processes_queued_video(app, db_session, monkeypatch):
    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(
        processing, "transcode_video",
        lambda s, t, e, c, d: (shutil.copyfile(s, t), VideoProbe(160, 120, d))[1],
    )
    asset, _ = await _stored_video(app, db_session)
    loop = MediaJobLoop(app.state.session_factory, app.state.settings, poll_seconds=0.05)
    loop.start()

    async def ready() -> bool:
        db_session.expire_all()
        return (await db_session.get(MediaAsset, asset.id)).status == MediaStatus.READY

    try:
        await _wait_for(ready)
    finally:
        await loop.stop()
    assert loop.last_processed_at is not None
    assert loop.last_failed_at is None


@pytest.mark.asyncio
async def test_stop_puts_unfinished_job_back_without_counting(app, db_session, monkeypatch):
    """停機時轉檔還卡在 thread 裡（ffmpeg 停不下來）：stop 先把工作放回佇列就返回，
    不等 thread；thread 之後才跑完，這次的結果整批丟掉，不會把工作改成 done。"""
    started, finish = threading.Event(), threading.Event()

    def _blocking(source, target, edition, color, duration):
        started.set()
        finish.wait(5)  # 只是保險：正常流程裡測試會在 stop 返回後馬上放行
        shutil.copyfile(source, target)
        return VideoProbe(160, 120, duration)

    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _blocking)
    asset, job = await _stored_video(app, db_session)
    before = _files(app)
    loop = MediaJobLoop(app.state.session_factory, app.state.settings, poll_seconds=0.05)
    loop.start()
    clock = asyncio.get_running_loop().time
    try:
        assert await asyncio.to_thread(started.wait, 5)
        stop_began = clock()
        await loop.stop(timeout=0.2)
        assert clock() - stop_began < 1.0  # 沒有等 thread 跑完
        back = await _job(db_session, job.id)
        assert (back.status, back.attempts, back.leased_by) == ("pending", 0, None)
    finally:
        finish.set()
    # thread 跑完，取消才真正落地，迴圈結束。
    done, _ = await asyncio.wait({loop._task}, timeout=2)
    assert done
    back = await _job(db_session, job.id)
    assert (back.status, back.attempts, back.leased_by) == ("pending", 0, None)
    still = await _reload(db_session, asset.id)
    assert still.status == MediaStatus.PROCESSING and still.variants == []
    assert _files(app) == before  # 寫到一半的 poster 也刪掉
    assert loop.last_processed_at is None


@pytest.mark.asyncio
async def test_stop_while_idle_returns_promptly(app):
    loop = MediaJobLoop(app.state.session_factory, app.state.settings, poll_seconds=30)
    loop.start()
    clock = asyncio.get_running_loop().time
    stop_began = clock()
    await loop.stop()
    assert clock() - stop_began < 1.0
    # 沒有工作在做：迴圈看到停止訊號自己結束，不必取消。
    assert loop._task.done() and not loop._task.cancelled()


def test_worker_id_is_unique_per_loop():
    settings = _test_settings()
    first = MediaJobLoop(None, settings, poll_seconds=1)  # type: ignore[arg-type]
    second = MediaJobLoop(None, settings, poll_seconds=1)  # type: ignore[arg-type]
    assert first.worker_id != second.worker_id
    assert str(os.getpid()) in first.worker_id
    assert len(first.worker_id) <= 128  # media_jobs.leased_by 的長度
    assert MediaJobLoop(None, settings, poll_seconds=1, worker_id="w1").worker_id == "w1"  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_lifespan_starts_loop_only_in_background_mode():
    inline = create_app(_test_settings())
    async with inline.router.lifespan_context(inline):
        assert inline.state.media_jobs is None
    background = create_app(_test_settings().model_copy(update={"media_video_processing": "background"}))
    async with background.router.lifespan_context(background):
        assert isinstance(background.state.media_jobs, MediaJobLoop)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=background), base_url="http://test") as client:
            body = (await client.get("/api/website/v1/health")).json()
        assert body["media_jobs"] == {"enabled": True, "last_processed_at": None, "last_failed_at": None}
    assert background.state.media_jobs._task.done()


@pytest.mark.asyncio
async def test_health_reports_media_jobs():
    app = create_app(_test_settings())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        body = (await client.get("/api/website/v1/health")).json()
    assert body["media_jobs"] == {"enabled": False, "last_processed_at": None, "last_failed_at": None}
