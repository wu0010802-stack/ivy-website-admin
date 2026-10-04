"""素材背景處理（app/media/jobs.py）：認領、租約、完成、失敗與重試、回補。"""
from __future__ import annotations

import shutil
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.main import create_app
from app.media import jobs, processing, service
from app.media.models import (
    MediaAsset, MediaJob, MediaJobKind, MediaJobStatus, MediaKind, MediaStatus, MediaVariant, VariantKind,
)
from app.media.processing import ProcessingError, VideoProbe
from tests.conftest import _test_settings
from tests.test_secfix_media import _ffprobe, _make_tagged_video, _rotation

requires_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="需要 ffmpeg")
# 樣本影片由 conftest 的 _ensure_media_fixtures 用 ffmpeg 產生；沒有 ffmpeg 就整檔跳過
# （CI 有裝，website.yml:97-98）。
pytestmark = requires_ffmpeg
FIXTURE_MP4 = Path("/tmp/media-fixtures/test.mp4")


async def _stored_video(app, db, source: Path = FIXTURE_MP4, *, status=MediaStatus.PROCESSING,
                        kind=MediaJobKind.PROCESS) -> tuple[MediaAsset, MediaJob]:
    """模擬上傳請求做完的狀態：乾淨原檔已在儲存體、素材 processing、排了一筆工作。"""
    storage = service.get_storage(app.state.settings)
    key = storage.generate_key(".mp4")
    storage.write_file(key, source)
    probe = processing.probe_video(source)
    asset = MediaAsset(
        id=uuid.uuid4(), campus_key="yihua", kind=MediaKind.VIDEO, status=status, storage_key=key,
        original_filename="clip.mp4", content_type="video/mp4", size_bytes=source.stat().st_size,
        width=probe.width, height=probe.height, duration_seconds=probe.duration_seconds,
        created_at=datetime.now(timezone.utc),
    )
    db.add(asset)
    await db.flush()
    job = await jobs.enqueue(db, asset, kind)
    await db.commit()
    # 之後 _reload／_job 會 expire_all；脫離 session 才能繼續讀 asset.id、job.id。
    db.expunge(asset)
    db.expunge(job)
    return asset, job


async def _reload(db, asset_id) -> MediaAsset:
    db.expire_all()
    result = await db.execute(select(MediaAsset).options(selectinload(MediaAsset.variants)).where(MediaAsset.id == asset_id))
    return result.scalar_one()


async def _job(db, job_id) -> MediaJob:
    db.expire_all()
    return (await db.execute(select(MediaJob).where(MediaJob.id == job_id))).scalar_one()


def _fake_transcode(source, target, edition, color, duration):
    shutil.copyfile(source, target)
    return VideoProbe(width=160, height=120, duration_seconds=duration)


@requires_ffmpeg
@pytest.mark.asyncio
async def test_process_next_makes_video_ready_with_poster_and_two_editions(app, db_session):
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    outcome = await jobs.process_next(app.state.session_factory, storage, worker_id="w1")
    assert outcome == "done"
    done = await _reload(db_session, asset.id)
    assert done.status == MediaStatus.READY and done.processing_error is None
    kinds = {v.kind: v for v in done.variants}
    assert set(kinds) == {VariantKind.POSTER, VariantKind.VIDEO_DESKTOP, VariantKind.VIDEO_MOBILE}
    assert kinds[VariantKind.VIDEO_MOBILE].content_type == "video/mp4"
    assert storage.exists(kinds[VariantKind.VIDEO_MOBILE].storage_key)
    finished = await _job(db_session, job.id)
    assert finished.status == MediaJobStatus.DONE.value and finished.leased_by is None
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") is None


@requires_ffmpeg
@pytest.mark.asyncio
async def test_editions_drop_location_tags_and_follow_rotation(app, db_session, tmp_path):
    tagged, rotated = _make_tagged_video(tmp_path)
    storage = service.get_storage(app.state.settings)
    clean = tmp_path / "clean.mp4"
    from app.media import metadata

    metadata.strip_video_file(tagged, clean)  # 上傳請求做的事
    asset, _ = await _stored_video(app, db_session, clean)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "done"
    done = await _reload(db_session, asset.id)
    for variant in done.variants:
        if variant.kind not in (VariantKind.VIDEO_DESKTOP, VariantKind.VIDEO_MOBILE):
            continue
        out = tmp_path / f"{variant.kind.value}.mp4"
        storage.download_file(variant.storage_key, out)
        assert b"25.0330" not in out.read_bytes()
        info = _ffprobe(out)
        tags = {k.lower() for k in info["format"].get("tags", {})}
        assert not tags & {"location", "location-eng", "title", "creation_time"}
        if rotated:
            # 轉正後寫進畫面：沒有旋轉資訊，寬高對調。
            assert not _rotation(info)
            assert variant.width < variant.height


@pytest.mark.asyncio
async def test_retryable_failure_backs_off_then_marks_failed_and_keeps_original(app, db_session, monkeypatch):
    def _boom(*args):
        raise ProcessingError("影片轉檔逾時（120 秒）", retryable=True)

    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _boom)
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    factory = app.state.session_factory

    assert await jobs.process_next(factory, storage, worker_id="w1") == "retry"
    pending = await _job(db_session, job.id)
    assert pending.status == "pending" and pending.attempts == 1
    assert pending.next_attempt_at > datetime.now(timezone.utc) + timedelta(seconds=50)
    assert (await _reload(db_session, asset.id)).status == MediaStatus.PROCESSING

    for expected in ("retry", "failed"):
        await db_session.execute(update(MediaJob).where(MediaJob.id == job.id).values(next_attempt_at=datetime.now(timezone.utc)))
        await db_session.commit()
        assert await jobs.process_next(factory, storage, worker_id="w1") == expected

    failed = await _reload(db_session, asset.id)
    assert failed.status == MediaStatus.FAILED
    assert failed.processing_error == "影片轉檔逾時（120 秒）"
    assert failed.variants == []
    assert storage.exists(failed.storage_key)  # 原檔留著，可以重新處理
    assert (await _job(db_session, job.id)).status == "failed"


@pytest.mark.asyncio
async def test_non_retryable_failure_fails_at_once(app, db_session, monkeypatch):
    def _bad(*args):
        raise ProcessingError("影片轉檔失敗：Invalid data found")

    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _bad)
    asset, _ = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "failed"
    assert (await _reload(db_session, asset.id)).status == MediaStatus.FAILED


@pytest.mark.asyncio
async def test_missing_original_fails_with_reupload_message(app, db_session):
    asset, _ = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    storage.delete(asset.storage_key)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "failed"
    assert (await _reload(db_session, asset.id)).processing_error == jobs.MISSING_ORIGINAL_MESSAGE


@pytest.mark.asyncio
async def test_expired_lease_reclaim_counts_and_stops_after_max(app, db_session):
    asset, job = await _stored_video(app, db_session)
    past = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.execute(
        update(MediaJob).where(MediaJob.id == job.id).values(status="running", leased_by="gone", leased_until=past, attempts=1)
    )
    await db_session.commit()
    async with app.state.session_factory() as db:
        claimed = await jobs.claim_next(db, "w2")
        assert claimed is not None and claimed.attempts == 2 and claimed.leased_by == "w2"
        await db.commit()

    await db_session.execute(
        update(MediaJob).where(MediaJob.id == job.id).values(leased_until=past)
    )
    await db_session.commit()
    async with app.state.session_factory() as db:
        assert await jobs.claim_next(db, "w3") is None  # 第 3 次中斷：不再認領
        await db.commit()
    failed = await _reload(db_session, asset.id)
    assert failed.status == MediaStatus.FAILED and failed.processing_error == jobs.INTERRUPTED_MESSAGE
    assert (await _job(db_session, job.id)).status == "failed"


@pytest.mark.asyncio
async def test_lost_lease_discards_results(app, db_session, monkeypatch):
    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _fake_transcode)
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    async with app.state.session_factory() as db:
        claimed = await jobs.claim_next(db, "w1")
        await db.commit()
    # 這台卡太久，租約被另一台接手。
    await db_session.execute(update(MediaJob).where(MediaJob.id == job.id).values(leased_by="w2"))
    await db_session.commit()
    before = set(Path(app.state.settings.media_root).iterdir())
    assert await jobs.run_claimed(app.state.session_factory, storage, claimed.id, worker_id="w1") == "lost"
    assert set(Path(app.state.settings.media_root).iterdir()) == before  # 寫好的衍生檔都刪掉
    still = await _reload(db_session, asset.id)
    assert still.status == MediaStatus.PROCESSING and still.variants == []


@pytest.mark.asyncio
async def test_lease_is_extended_while_running(app, db_session, monkeypatch):
    monkeypatch.setattr(jobs, "HEARTBEAT_SECONDS", 0.05)
    calls: list[uuid.UUID] = []
    real_extend = jobs.extend_lease

    async def _spy(factory, job_id, worker_id):
        calls.append(job_id)
        return await real_extend(factory, job_id, worker_id)

    def _slow(source, target, edition, color, duration):
        time.sleep(0.2)
        return _fake_transcode(source, target, edition, color, duration)

    monkeypatch.setattr(jobs, "extend_lease", _spy)
    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _slow)
    await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "done"
    assert len(calls) >= 2


@pytest.mark.asyncio
async def test_backfill_keeps_asset_ready_even_when_it_fails(app, db_session, monkeypatch):
    def _boom(*args):
        raise ProcessingError("影片轉檔失敗：壞掉")

    monkeypatch.setattr(processing, "transcode_video", _boom)
    asset, job = await _stored_video(app, db_session, status=MediaStatus.READY, kind=MediaJobKind.BACKFILL)
    storage = service.get_storage(app.state.settings)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "failed"
    still = await _reload(db_session, asset.id)
    assert still.status == MediaStatus.READY and still.processing_error is None
    assert (await _job(db_session, job.id)).error == "影片轉檔失敗：壞掉"


@pytest.mark.asyncio
async def test_backfill_candidates_and_enqueue(app, db_session, monkeypatch):
    monkeypatch.setattr(processing, "transcode_video", _fake_transcode)
    asset, job = await _stored_video(app, db_session, status=MediaStatus.READY, kind=MediaJobKind.BACKFILL)
    # 已有排隊中的工作：不列為候選。
    assert [c.asset_id for c in await jobs.backfill_candidates(db_session)] == []
    storage = service.get_storage(app.state.settings)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "done"
    done = await _reload(db_session, asset.id)
    # backfill 不做 poster（既有素材已有或另走 regenerate），只補兩個版本。
    assert {v.kind for v in done.variants} == {VariantKind.VIDEO_DESKTOP, VariantKind.VIDEO_MOBILE}
    assert await jobs.backfill_candidates(db_session) == []

    await db_session.execute(
        MediaVariant.__table__.delete().where(
            MediaVariant.media_id == asset.id, MediaVariant.kind == VariantKind.VIDEO_MOBILE
        )
    )
    await db_session.commit()
    db_session.expire_all()
    candidates = await jobs.backfill_candidates(db_session)
    assert [(c.asset_id, c.missing) for c in candidates] == [(asset.id, ("video_mobile",))]
    queued = await jobs.enqueue_backfill(db_session, [asset.id, asset.id])
    await db_session.commit()
    assert len(queued) == 1  # 同一支只排一筆


@pytest.mark.asyncio
async def test_retry_requeues_failed_video_and_rejects_duplicates(app, db_session):
    asset, job = await _stored_video(app, db_session)
    await db_session.execute(update(MediaJob).where(MediaJob.id == job.id).values(status="failed"))
    await db_session.execute(update(MediaAsset).where(MediaAsset.id == asset.id).values(status=MediaStatus.FAILED, processing_error="壞掉"))
    await db_session.commit()
    fresh = await _reload(db_session, asset.id)
    new_job = await jobs.retry(db_session, fresh, actor_id=None)
    await db_session.commit()
    assert new_job.kind == "process"
    again = await _reload(db_session, asset.id)
    assert again.status == MediaStatus.PROCESSING and again.processing_error is None
    with pytest.raises(jobs.JobAlreadyActive):
        await jobs.retry(db_session, again, actor_id=None)
    await db_session.rollback()


@requires_ffmpeg
@pytest.mark.asyncio
async def test_process_now_runs_in_callers_transaction(app, db_session):
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    fresh = await _reload(db_session, asset.id)
    claimed = await _job(db_session, job.id)
    assert await jobs.process_now(db_session, storage, fresh, claimed) == "done"
    await db_session.commit()
    done = await _reload(db_session, asset.id)
    assert done.status == MediaStatus.READY and len(done.variants) == 3


# ---- fix round 1 ----


@pytest.mark.asyncio
async def test_process_now_keeps_callers_unflushed_changes(app, db_session, monkeypatch):
    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _fake_transcode)
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    fresh = await _reload(db_session, asset.id)
    claimed = await _job(db_session, job.id)  # 會 expire_all，先取
    fresh = await _reload(db_session, asset.id)
    fresh.original_filename = "renamed.mp4"  # 還沒 flush
    assert await jobs.process_now(db_session, storage, fresh, claimed) == "done"
    await db_session.commit()
    assert (await _reload(db_session, asset.id)).original_filename == "renamed.mp4"


@pytest.mark.asyncio
async def test_process_now_unexpected_error_marks_failed_not_stuck(app, db_session, monkeypatch):
    def _oops(*args):
        raise RuntimeError("disk exploded")

    monkeypatch.setattr(processing, "extract_video_poster", _oops)
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    fresh = await _reload(db_session, asset.id)
    claimed = await _job(db_session, job.id)
    assert await jobs.process_now(db_session, storage, fresh, claimed) == "failed"
    await db_session.commit()
    failed = await _reload(db_session, asset.id)
    status, error, key = failed.status, failed.processing_error, failed.storage_key
    assert status == MediaStatus.FAILED and error == jobs.INLINE_ERROR_MESSAGE
    done_job = await _job(db_session, job.id)
    assert done_job.status == "failed" and done_job.leased_by is None
    assert storage.exists(key)


@pytest.mark.asyncio
async def test_claim_prefers_process_over_backfill(app, db_session):
    backfill_asset, backfill_job = await _stored_video(app, db_session, status=MediaStatus.READY, kind=MediaJobKind.BACKFILL)
    process_asset, process_job = await _stored_video(app, db_session)
    async with app.state.session_factory() as db:
        first = await jobs.claim_next(db, "w1")
        assert first is not None and first.id == process_job.id
        await db.commit()
    async with app.state.session_factory() as db:
        second = await jobs.claim_next(db, "w1")
        assert second is not None and second.id == backfill_job.id
        await db.commit()


@pytest.mark.asyncio
async def test_run_claimed_with_job_deleted_returns_lost(app, db_session):
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    await db_session.execute(MediaJob.__table__.delete().where(MediaJob.id == job.id))
    await db_session.commit()
    assert await jobs.run_claimed(app.state.session_factory, storage, job.id, worker_id="w1") == "lost"


@pytest.mark.asyncio
async def test_release_then_finish_discards_files_and_keeps_job_pending(app, db_session, monkeypatch):
    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _fake_transcode)
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    factory = app.state.session_factory
    async with factory() as db:
        claimed = await jobs.claim_next(db, "w1")
        await db.commit()
    before = set(Path(app.state.settings.media_root).iterdir())
    outputs = await jobs._produce(storage, jobs._Snapshot(asset.id, MediaKind.VIDEO, asset.storage_key, asset.duration_seconds, frozenset()), MediaJobKind.PROCESS)
    assert outputs and set(Path(app.state.settings.media_root).iterdir()) != before
    assert await jobs.release(factory, claimed.id, "w1") is True
    assert await jobs._finish(factory, storage, claimed.id, "w1", outputs) == "lost"
    assert set(Path(app.state.settings.media_root).iterdir()) == before
    pending = await _job(db_session, job.id)
    assert pending.status == "pending" and pending.attempts == 0 and pending.leased_by is None
    still = await _reload(db_session, asset.id)
    assert still.status == MediaStatus.PROCESSING and still.variants == []


@pytest.mark.asyncio
async def test_two_sessions_claim_different_jobs(app, db_session):
    _, job_a = await _stored_video(app, db_session)
    _, job_b = await _stored_video(app, db_session)
    async with app.state.session_factory() as db1, app.state.session_factory() as db2:
        first = await jobs.claim_next(db1, "w1")  # 還沒 commit，列鎖著
        second = await jobs.claim_next(db2, "w2")
        assert first is not None and second is not None and first.id != second.id
        assert {first.id, second.id} == {job_a.id, job_b.id}
        await db1.commit()
        await db2.commit()


@pytest.mark.asyncio
async def test_cancel_during_file_write_leaves_no_orphans(app, db_session, monkeypatch):
    import asyncio
    import threading

    started = threading.Event()
    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _fake_transcode)
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    real_write = storage.write_bytes

    def _slow_write(key, data):
        started.set()
        time.sleep(0.3)
        real_write(key, data)

    monkeypatch.setattr(storage, "write_bytes", _slow_write)
    async with app.state.session_factory() as db:
        claimed = await jobs.claim_next(db, "w1")
        await db.commit()
    def _files() -> set[Path]:
        return {p for p in Path(app.state.settings.media_root).rglob("*") if p.is_file()}

    before = _files()
    task = asyncio.ensure_future(jobs.run_claimed(app.state.session_factory, storage, claimed.id, worker_id="w1"))
    while not started.is_set():
        await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(0.5)  # 舊寫法的 thread 會在取消後才寫完，孤兒檔此時才出現
    assert _files() == before


async def _finish_cancelled_twice_during_commit(app, db_session, monkeypatch, *, commit_fails: bool):
    """_finish 正在 commit 時被取消，等 commit 結束的時候又被取消一次（例如停機時
    連續收到兩次訊號）。commit_fails=False：commit 已經在資料庫生效、只是結果還沒
    回到呼叫端；True：commit 失敗。"""
    import asyncio

    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _fake_transcode)
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    factory = app.state.session_factory
    async with factory() as db:
        claimed = await jobs.claim_next(db, "w1")
        await db.commit()
    snap = jobs._Snapshot(asset.id, MediaKind.VIDEO, asset.storage_key, asset.duration_seconds, frozenset())
    outputs = await jobs._produce(storage, snap, MediaJobKind.PROCESS)
    entered, gate = asyncio.Event(), asyncio.Event()

    def _gated_factory():
        session = factory()
        real_commit = session.commit

        async def _commit():
            entered.set()
            if commit_fails:
                await gate.wait()
                raise RuntimeError("commit 失敗")
            await real_commit()
            await gate.wait()  # 已經提交，但呼叫端還不知道

        session.commit = _commit
        return session

    task = asyncio.ensure_future(jobs._finish(_gated_factory, storage, claimed.id, "w1", outputs))
    await asyncio.wait_for(entered.wait(), 5)
    await asyncio.sleep(0.05)
    task.cancel()
    await asyncio.sleep(0.05)  # 第一次取消落地：_finish 改成等 commit 結束
    task.cancel()
    await asyncio.sleep(0.05)
    gate.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    return asset, job, outputs, storage


@pytest.mark.asyncio
async def test_finish_cancelled_twice_keeps_files_when_commit_landed(app, db_session, monkeypatch):
    asset, job, outputs, storage = await _finish_cancelled_twice_during_commit(
        app, db_session, monkeypatch, commit_fails=False
    )
    done = await _reload(db_session, asset.id)
    assert done.status == MediaStatus.READY
    assert {v.storage_key for v in done.variants} == {o.storage_key for o in outputs}
    # 資料庫已經指向這些檔案：不能當成沒提交刪掉。
    assert all(storage.exists(o.storage_key) for o in outputs)
    assert (await _job(db_session, job.id)).status == "done"


@pytest.mark.asyncio
async def test_finish_cancelled_twice_deletes_files_when_commit_failed(app, db_session, monkeypatch):
    asset, job, outputs, storage = await _finish_cancelled_twice_during_commit(
        app, db_session, monkeypatch, commit_fails=True
    )
    assert not any(storage.exists(o.storage_key) for o in outputs)
    still = await _reload(db_session, asset.id)
    assert still.status == MediaStatus.PROCESSING and still.variants == []
    back = await _job(db_session, job.id)
    assert back.status == "running" and back.leased_by == "w1"  # 沒提交：租約到期再由別人接手


@pytest_asyncio.fixture
async def bg_app():
    return create_app(_test_settings().model_copy(update={"media_video_processing": "background"}))


@pytest_asyncio.fixture
async def bg_admin(bg_app, db_session):
    # 照 conftest 的 admin_client（conftest.py:342-347），只是換成背景模式的 app。
    from app.auth.models import Role
    from tests.conftest import _create_user, _logged_in_client

    await _create_user(db_session, "bg-admin@ivy.example", "bg-admin-password-123", Role.SUPER_ADMIN)
    client = await _logged_in_client(bg_app, "bg-admin@ivy.example", "bg-admin-password-123")
    yield client
    await client.aclose()


CONTENT = "/api/website/v1/admin/content-items"


async def _hero_draft(client, media_id: str, expected_version: int = 0) -> dict:
    response = await client.post(
        f"{CONTENT}/home_hero/revisions",
        json={"expected_version": expected_version, "payload": {"eyebrow": "小標", "copy_lines": ["一"], "video_desktop": {"media_id": media_id}}},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_processing_mode_defaults():
    base = _test_settings()
    assert base.media_video_processing_mode == "inline"
    assert base.model_copy(update={"environment": "production"}).media_video_processing_mode == "background"
    assert base.model_copy(update={"media_video_processing": "background"}).media_video_processing_mode == "background"


@pytest.mark.asyncio
async def test_background_upload_returns_processing_and_queues_one_job(bg_app, bg_admin, db_session):
    response = await bg_admin.post(
        "/api/website/v1/admin/media",
        data={"kind": "video", "campus_key": "yihua"},
        files={"file": ("test.mp4", FIXTURE_MP4.read_bytes(), "video/mp4")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "processing" and body["variants"] == []
    assert body["duration_seconds"]  # ffprobe 仍在請求內做，片段秒數檢查才有長度
    queued = (await db_session.execute(select(MediaJob))).scalars().all()
    assert [(j.kind, j.status) for j in queued] == [("process", "pending")]
    # 後台看得到乾淨原檔（預覽），官網拿不到。
    assert (await bg_admin.get(f"/api/website/v1/admin/media/{body['id']}/file")).status_code == 200
    from httpx import ASGITransport, AsyncClient

    async with AsyncClient(transport=ASGITransport(app=bg_app), base_url="http://test") as anon:
        assert (await anon.get(f"/api/website/v1/public/media/{body['id']}/file")).status_code == 404

    storage = service.get_storage(bg_app.state.settings)
    assert await jobs.process_next(bg_app.state.session_factory, storage, worker_id="w1") == "done"
    ranged = await bg_admin.get(
        f"/api/website/v1/admin/media/{body['id']}/variants/video_mobile", headers={"Range": "bytes=0-99"}
    )
    assert ranged.status_code == 206 and ranged.headers["content-type"] == "video/mp4"


@pytest.mark.asyncio
async def test_processing_video_can_be_drafted_but_not_published(bg_admin, db_session):
    upload = await bg_admin.post(
        "/api/website/v1/admin/media",
        data={"kind": "video"},
        files={"file": ("hero.mp4", FIXTURE_MP4.read_bytes(), "video/mp4")},
    )
    media_id = upload.json()["id"]
    draft = await _hero_draft(bg_admin, media_id)  # 存草稿不檢查素材狀態
    published = await bg_admin.post(
        f"{CONTENT}/home_hero/publish", json={"revision_id": draft["latest_revision"]["id"]}
    )
    assert published.status_code == 409
    assert published.json()["detail"]["code"] == "MEDIA_NOT_READY"


@pytest.mark.asyncio
async def test_replace_references_accepts_processing_video(bg_admin, db_session):
    async def _upload() -> str:
        response = await bg_admin.post(
            "/api/website/v1/admin/media",
            data={"kind": "video"},
            files={"file": ("clip.mp4", FIXTURE_MP4.read_bytes(), "video/mp4")},
        )
        assert response.status_code == 201, response.text
        return response.json()["id"]

    old, new = await _upload(), await _upload()  # 背景模式：兩支都還在 processing
    draft = await _hero_draft(bg_admin, old)
    response = await bg_admin.post(
        f"/api/website/v1/admin/media/{old}/replace-references",
        json={"replacement_id": new, "items": [{"content_item_id": draft["id"], "expected_version": 1}]},
    )
    assert response.status_code == 200, response.text

    await db_session.execute(update(MediaAsset).where(MediaAsset.id == uuid.UUID(new)).values(status=MediaStatus.FAILED))
    await db_session.commit()
    rejected = await bg_admin.post(
        f"/api/website/v1/admin/media/{new}/replace-references",
        json={"replacement_id": old, "items": [{"content_item_id": draft["id"], "expected_version": 2}]},
    )
    assert rejected.status_code == 200, rejected.text  # 換回處理中的 old：可以
    failed_target = await bg_admin.post(
        f"/api/website/v1/admin/media/{old}/replace-references",
        json={"replacement_id": new, "items": [{"content_item_id": draft["id"], "expected_version": 3}]},
    )
    assert failed_target.status_code == 422
    assert failed_target.json()["detail"]["message"] == "替換用的素材處理失敗或已刪除"


@pytest.mark.asyncio
async def test_retry_endpoint(bg_app, bg_admin, db_session):
    asset, job = await _stored_video(bg_app, db_session)
    url = f"/api/website/v1/admin/media/{asset.id}/retry"
    not_failed = await bg_admin.post(url)
    assert not_failed.status_code == 409 and not_failed.json()["detail"]["code"] == "MEDIA_NOT_RETRYABLE"

    await db_session.execute(update(MediaJob).where(MediaJob.id == job.id).values(status="failed"))
    await db_session.execute(update(MediaAsset).where(MediaAsset.id == asset.id).values(status=MediaStatus.FAILED, processing_error="壞掉"))
    await db_session.commit()
    ok = await bg_admin.post(url)
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "processing" and ok.json()["processing_error"] is None

    from app.operations.models import AuditLogEntry

    actions = (await db_session.execute(select(AuditLogEntry.action))).scalars().all()
    assert "media.retry" in actions

    await db_session.execute(update(MediaAsset).where(MediaAsset.id == asset.id).values(status=MediaStatus.FAILED))
    await db_session.commit()
    busy = await bg_admin.post(url)
    assert busy.status_code == 409 and busy.json()["detail"]["code"] == "MEDIA_ALREADY_PROCESSING"


@pytest.mark.asyncio
async def test_retry_is_only_for_videos(admin_client):
    image = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", Path("/tmp/media-fixtures/test.jpg").read_bytes(), "image/jpeg")},
    )
    response = await admin_client.post(f"/api/website/v1/admin/media/{image.json()['id']}/retry")
    assert response.status_code == 409
