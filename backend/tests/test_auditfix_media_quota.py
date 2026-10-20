"""素材配額算進衍生檔（2026-10-20 稽核 #03）。

以前配額只加總原檔 size_bytes；背景轉檔寫入的 poster 與桌機／手機版完全不算，
HEVC 這類一律採用轉檔輸出的來源可以讓實際用量超過配額好幾倍。現在衍生檔記下
大小，上傳時一起算；背景轉檔寫入前在同一把配額鎖內重算，超過就讓工作失敗。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from app.media import jobs, service
from app.media.models import MediaAsset, MediaJob, MediaJobStatus, MediaKind, MediaStatus, MediaVariant, VariantKind
from app.workers.media_loop import MediaJobLoop
from tests.test_media_jobs import _job, _reload, _stored_video, requires_ffmpeg

MEDIA = "/api/website/v1/admin/media"


async def _ready_image_with_variant(db, *, original: int, variant: int, campus_key: str = "yihua") -> None:
    asset_id = uuid.uuid4()
    db.add(
        MediaAsset(
            id=asset_id, campus_key=campus_key, kind=MediaKind.IMAGE, status=MediaStatus.READY,
            storage_key=uuid.uuid4().hex, original_filename="a.jpg", content_type="image/jpeg",
            size_bytes=original, created_at=datetime.now(timezone.utc),
        )
    )
    await db.flush()
    db.add(
        MediaVariant(
            id=uuid.uuid4(), media_id=asset_id, kind=VariantKind.THUMBNAIL, storage_key=uuid.uuid4().hex,
            content_type="image/webp", size_bytes=variant,
        )
    )
    await db.commit()


@pytest.mark.asyncio
async def test_upload_quota_counts_variant_bytes(app, admin_client, db_session):
    image = Path("/tmp/media-fixtures/test.jpg").read_bytes()
    app.state.settings.media_quota_bytes_per_campus = 1_000_000
    # 100 + 999_500 + 這張 768 bytes 超過；只算原檔的話 100 + 768 放得下。
    await _ready_image_with_variant(db_session, original=100, variant=999_500)
    blocked = await admin_client.post(
        MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.jpg", image, "image/jpeg")}
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"]["code"] == "MEDIA_QUOTA_EXCEEDED"


@pytest.mark.asyncio
async def test_other_campus_variants_do_not_count(app, admin_client, db_session):
    image = Path("/tmp/media-fixtures/test.jpg").read_bytes()
    app.state.settings.media_quota_bytes_per_campus = 1_000_000
    await _ready_image_with_variant(db_session, original=100, variant=999_000, campus_key="minghua")
    ok = await admin_client.post(
        MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.jpg", image, "image/jpeg")}
    )
    assert ok.status_code == 201, ok.text


@pytest.mark.asyncio
async def test_image_upload_records_variant_sizes(app, admin_client, db_session):
    image = Path("/tmp/media-fixtures/test.jpg").read_bytes()
    response = await admin_client.post(
        MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.jpg", image, "image/jpeg")}
    )
    assert response.status_code == 201, response.text
    storage = service.get_storage(app.state.settings)
    variants = (await db_session.execute(select(MediaVariant))).scalars().all()
    assert variants
    for variant in variants:
        assert variant.size_bytes == len(storage.read_bytes(variant.storage_key))


@requires_ffmpeg
@pytest.mark.asyncio
async def test_background_job_records_variant_sizes(app, db_session):
    asset, _ = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    outcome = await jobs.process_next(
        app.state.session_factory, storage, worker_id="w1", quota_bytes=1024 * 1024 * 1024
    )
    assert outcome == "done"
    done = await _reload(db_session, asset.id)
    assert {v.kind for v in done.variants} == {VariantKind.POSTER, VariantKind.VIDEO_DESKTOP, VariantKind.VIDEO_MOBILE}
    for variant in done.variants:
        assert variant.size_bytes == len(storage.read_bytes(variant.storage_key))


def _record_writes(storage, monkeypatch) -> list[str]:
    keys: list[str] = []
    for name in ("write_bytes", "write_file"):
        original = getattr(storage, name)

        def _wrapped(key, data, _original=original):
            keys.append(key)
            return _original(key, data)

        monkeypatch.setattr(storage, name, _wrapped)
    return keys


@requires_ffmpeg
@pytest.mark.asyncio
async def test_background_job_over_quota_fails_and_removes_outputs(app, db_session, monkeypatch):
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    written = _record_writes(storage, monkeypatch)
    # 原檔放得下，轉出的版本放不下。
    outcome = await jobs.process_next(
        app.state.session_factory, storage, worker_id="w1", quota_bytes=asset.size_bytes + 1
    )
    assert outcome == "failed"
    failed = await _reload(db_session, asset.id)
    assert failed.status == MediaStatus.FAILED
    assert "上限" in failed.processing_error
    assert failed.variants == []
    finished = await _job(db_session, job.id)
    assert finished.status == MediaJobStatus.FAILED.value
    assert written and not any(storage.exists(key) for key in written)
    assert storage.exists(asset.storage_key)  # 原檔留著，刪掉別的素材後可以重新處理


@requires_ffmpeg
@pytest.mark.asyncio
async def test_background_job_counts_other_assets_and_their_variants(app, db_session):
    asset, _ = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    await _ready_image_with_variant(db_session, original=100, variant=5_000_000)
    outcome = await jobs.process_next(
        app.state.session_factory, storage, worker_id="w1", quota_bytes=asset.size_bytes + 5_000_100 + 1
    )
    assert outcome == "failed"


@requires_ffmpeg
@pytest.mark.asyncio
async def test_inline_processing_over_quota_marks_video_failed(app, db_session):
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    fresh = await db_session.get(MediaAsset, asset.id)
    claimed = await db_session.get(MediaJob, job.id)
    outcome = await jobs.process_now(db_session, storage, fresh, claimed, quota_bytes=asset.size_bytes + 1)
    assert outcome == "failed"
    await db_session.commit()
    failed = await _reload(db_session, asset.id)
    assert failed.status == MediaStatus.FAILED and "上限" in failed.processing_error
    assert failed.variants == []


@pytest.mark.asyncio
async def test_media_loop_passes_campus_quota(app, monkeypatch):
    seen: dict = {}

    async def _claim(db, worker_id):
        class _Job:
            id = uuid.uuid4()

        return _Job()

    async def _run_claimed(session_factory, storage, job_id, *, worker_id, quota_bytes=None):
        seen["quota_bytes"] = quota_bytes
        return "done"

    monkeypatch.setattr(jobs, "claim_next", _claim)
    monkeypatch.setattr(jobs, "run_claimed", _run_claimed)
    app.state.settings.media_quota_bytes_per_campus = 123_456
    loop = MediaJobLoop(app.state.session_factory, app.state.settings, poll_seconds=30)
    assert await loop._process_one(service.get_storage(app.state.settings)) == "done"
    assert seen["quota_bytes"] == 123_456


@requires_ffmpeg
@pytest.mark.asyncio
async def test_background_job_waiting_too_long_for_quota_lock_retries_later(app, db_session, monkeypatch):
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    written = _record_writes(storage, monkeypatch)

    async def _busy(db, campus_key):
        raise service.MediaBusy()

    monkeypatch.setattr(service, "lock_quota", _busy)
    outcome = await jobs.process_next(app.state.session_factory, storage, worker_id="w1", quota_bytes=10**9)
    assert outcome == "retry"
    pending = await _job(db_session, job.id)
    assert pending.status == MediaJobStatus.PENDING.value
    assert written and not any(storage.exists(key) for key in written)
    still = await _reload(db_session, asset.id)
    assert still.status == MediaStatus.PROCESSING and still.variants == []


@requires_ffmpeg
@pytest.mark.asyncio
async def test_quota_lock_busy_on_last_attempt_message_still_true(app, db_session, monkeypatch):
    """最後一次等不到配額鎖時工作會直接失敗、不再自動重做；素材上的訊息不能說「稍後會重新處理」。"""
    asset, job = await _stored_video(app, db_session)
    stored = await _job(db_session, job.id)
    stored.attempts = jobs.MAX_ATTEMPTS - 1
    await db_session.commit()
    storage = service.get_storage(app.state.settings)

    async def _busy(db, campus_key):
        raise service.MediaBusy()

    monkeypatch.setattr(service, "lock_quota", _busy)
    outcome = await jobs.process_next(app.state.session_factory, storage, worker_id="w1", quota_bytes=10**9)
    assert outcome == "failed"
    failed = await _reload(db_session, asset.id)
    assert failed.status == MediaStatus.FAILED
    assert "稍後會重新處理" not in failed.processing_error
    assert "重新處理" in failed.processing_error
