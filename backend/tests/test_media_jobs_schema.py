"""素材背景處理的資料表與衍生檔種類（migration e5b9c3a7d214）。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.media.models import MediaAsset, MediaJob, MediaJobKind, MediaJobStatus, MediaKind, MediaStatus


def _video(storage_key: str) -> MediaAsset:
    return MediaAsset(
        id=uuid.uuid4(), campus_key="yihua", kind=MediaKind.VIDEO, status=MediaStatus.PROCESSING,
        storage_key=storage_key, original_filename="clip.mp4", content_type="video/mp4", size_bytes=10,
        created_at=datetime.now(timezone.utc),
    )


def _job(media_id: uuid.UUID, status: MediaJobStatus = MediaJobStatus.PENDING) -> MediaJob:
    now = datetime.now(timezone.utc)
    return MediaJob(
        id=uuid.uuid4(), media_id=media_id, kind=MediaJobKind.PROCESS.value, status=status.value,
        attempts=0, next_attempt_at=now, created_at=now,
    )


@pytest.mark.asyncio
async def test_variant_kind_enum_has_new_values(db_session):
    rows = (await db_session.execute(text("SELECT unnest(enum_range(NULL::media_variant_kind))::text"))).scalars().all()
    assert {"THUMBNAIL", "POSTER", "LARGE", "MEDIUM", "VIDEO_DESKTOP", "VIDEO_MOBILE"} <= set(rows)


@pytest.mark.asyncio
async def test_only_one_active_job_per_media(db_session):
    asset = _video("schema-a.mp4")
    db_session.add(asset)
    await db_session.flush()
    db_session.add(_job(asset.id))
    await db_session.flush()
    # 已完成的工作不算：同一支影片可以有很多筆歷史。
    db_session.add(_job(asset.id, MediaJobStatus.DONE))
    await db_session.flush()
    db_session.add(_job(asset.id, MediaJobStatus.RUNNING))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_jobs_are_deleted_with_their_media(db_session):
    asset = _video("schema-b.mp4")
    db_session.add(asset)
    await db_session.flush()
    db_session.add(_job(asset.id))
    await db_session.commit()
    await db_session.execute(text("DELETE FROM media_assets WHERE id = :id"), {"id": asset.id})
    await db_session.commit()
    left = (await db_session.execute(text("SELECT count(*) FROM media_jobs"))).scalar_one()
    assert left == 0
