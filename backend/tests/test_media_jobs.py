"""素材背景處理（app/media/jobs.py）：認領、租約、完成、失敗與重試、回補。"""
from __future__ import annotations

import shutil
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.media import jobs, processing, service
from app.media.models import (
    MediaAsset, MediaJob, MediaJobKind, MediaJobStatus, MediaKind, MediaStatus, MediaVariant, VariantKind,
)
from app.media.processing import ProcessingError, VideoProbe
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
