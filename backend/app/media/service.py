from __future__ import annotations

import asyncio
import functools
import hashlib
import logging
import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.content.models import ContentItem, ContentRevision, SiteReleaseEntry, SiteState
from app.content.registry import CONTENT_KIND_REGISTRY
from app.content.registry import MediaRef
from app.media import jobs as media_jobs
from app.media import metadata as media_metadata
from app.media import references as media_references
from app.media.models import MediaAsset, MediaJobKind, MediaKind, MediaStatus, MediaVariant, MediaUsage, VariantKind
from app.media.schemas import PublicMediaOut, PublicMediaVariantOut
from app.media.processing import (
    IMAGE_FORMATS,
    LARGE_SIDE,
    MEDIUM_SIDE,
    THUMBNAIL_SIZE,
    ProcessingError,
    Rendition,
    extract_video_poster,
    make_webp,
    needs_large_rendition,
    needs_medium_rendition,
    probe_video,
    run_media_job,
)
from app.media.storage import LocalMediaStorage, MediaStorage, S3MediaStorage
from app.media.validation import MediaValidationError, sniff_and_validate
from app.operations import audit_service

logger = logging.getLogger("app.media")

# 新上傳只會是這四種（見 validation._IMAGE_CONTENT_TYPES）；2026-09-25 以前的
# GIF 素材已經有 storage_key，不再經過這裡。
_EXTENSION_BY_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
}


class MediaInUse(Exception):
    """草稿、官網、排程或可還原的舊版本仍引用這個素材。"""

    def __init__(self, found: media_references.MediaReferences | None = None) -> None:
        self.references = found
        super().__init__("media in use")


class MediaQuotaExceeded(Exception):
    pass


class MediaBusy(Exception):
    """同校（或共用素材）另一個上傳握著配額鎖太久，這次等不到：請稍後重試。"""


# 等同校配額鎖的上限。持鎖的上傳在交易內還要寫儲存體與產生衍生檔（影片
# 150 MB、S3、ffmpeg poster 最長 30 秒，還可能排處理名額），執行期連線預設的
# lock_timeout（WEBSITE_DB_LOCK_TIMEOUT_MS，10 秒）與 statement_timeout（30 秒，
# app/db.py）對這把鎖都太短，第二個檔案會變成 500（稽核
# media-quota-lock-timeout-500）。這條交易只屬於後台上傳，兩個都用 SET LOCAL
# 放寬：等鎖最多 QUOTA_LOCK_TIMEOUT，沿用 PR #14 讓後面的上傳排隊的 5 分鐘，
# 等不到回 409 MEDIA_BUSY 請使用者重傳；statement_timeout 再多 30 秒
# （QUOTA_STATEMENT_TIMEOUT），等鎖逾時一定先到，不會變成 500。持鎖方閒置在
# 交易中時另受 idle_in_transaction_session_timeout 限制，所以等待仍有上限。
QUOTA_LOCK_TIMEOUT = "300s"
QUOTA_STATEMENT_TIMEOUT = "330s"
_LOCK_NOT_AVAILABLE = "55P03"


async def _ensure_quota(
    db: AsyncSession, campus_key: str | None, incoming_bytes: int, quota_bytes: int
) -> None:
    """同一校區的上傳用 advisory lock 排隊，才不會兩個並行請求都看到
    「還有空間」而一起超過。處理失敗的素材原檔會被刪掉，不計入。"""
    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        # 前一筆上傳可能還在鎖內寫檔、跑 ffmpeg，排隊可以超過連線預設的逾時（見
        # QUOTA_LOCK_TIMEOUT）。SET LOCAL 只到這個交易結束，連線還回池後恢復預設。
        await db.execute(text(f"SET LOCAL statement_timeout = '{QUOTA_STATEMENT_TIMEOUT}'"))
        await db.execute(text(f"SET LOCAL lock_timeout = '{QUOTA_LOCK_TIMEOUT}'"))
        try:
            await db.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
                {"key": f"media-quota:{campus_key or '__shared__'}"},
            )
        except DBAPIError as exc:
            if getattr(exc.orig, "sqlstate", None) == _LOCK_NOT_AVAILABLE:
                raise MediaBusy() from exc
            raise
    scope = MediaAsset.campus_key.is_(None) if campus_key is None else MediaAsset.campus_key == campus_key
    used = await db.execute(
        select(func.coalesce(func.sum(MediaAsset.size_bytes), 0)).where(
            scope, MediaAsset.status != MediaStatus.FAILED
        )
    )
    if used.scalar_one() + incoming_bytes > quota_bytes:
        raise MediaQuotaExceeded()


@functools.lru_cache(maxsize=4)
def _s3_storage(
    bucket: str, access_key_id: str, secret_access_key: str, endpoint_url: str | None, region: str | None, prefix: str
) -> S3MediaStorage:
    # boto3 client 建立一次要幾十毫秒，而且本身 thread-safe：同一組設定共用。
    return S3MediaStorage(
        bucket=bucket,
        access_key_id=access_key_id,
        secret_access_key=secret_access_key,
        endpoint_url=endpoint_url,
        region=region,
        prefix=prefix,
    )


def s3_storage(settings: Settings) -> S3MediaStorage:
    assert settings.s3_bucket and settings.s3_access_key_id and settings.s3_secret_access_key
    return _s3_storage(
        settings.s3_bucket,
        settings.s3_access_key_id,
        settings.s3_secret_access_key,
        settings.s3_endpoint_url,
        settings.s3_region,
        settings.s3_prefix,
    )


def file_sha256(path: Path) -> str:
    """逐塊算，不把影片整份讀進記憶體。"""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def image_renditions(
    source: bytes | Path, width: int | None, height: int | None, *, formats: tuple[str, ...] = IMAGE_FORMATS
) -> list[tuple[VariantKind, Rendition]]:
    out = [(VariantKind.THUMBNAIL, make_webp(source, THUMBNAIL_SIZE[0], formats=formats))]
    if needs_medium_rendition(width, height):
        out.append((VariantKind.MEDIUM, make_webp(source, MEDIUM_SIDE, quality=82, formats=formats)))
    if needs_large_rendition(width, height):
        out.append((VariantKind.LARGE, make_webp(source, LARGE_SIDE, quality=82, formats=formats)))
    return out


def strip_to_temp(source_path: Path, content_type: str) -> tuple[Path, tuple[int, int] | None]:
    """去掉拍攝資訊的複本寫進新的暫存檔，回傳 (路徑, 圖片實際寬高或 None)；呼叫端
    負責刪掉。不改 source_path：匯入官網內建素材時它是 repo 裡的檔案。"""
    fd, name = tempfile.mkstemp(prefix="media-clean-", suffix=_EXTENSION_BY_CONTENT_TYPE[content_type])
    os.close(fd)
    clean_path = Path(name)
    try:
        size = media_metadata.strip_file(source_path, clean_path, content_type)
    except BaseException:
        clean_path.unlink(missing_ok=True)
        raise
    return clean_path, size


async def stored_sha256(path: Path, kind: MediaKind) -> str:
    """這個檔案上傳後素材庫會記的 sha256（去掉拍攝資訊之後的位元組）。匯入官網
    內建素材時用它去重；驗證不過的檔案回原檔雜湊（真的匯入時照樣會被擋下）。"""
    try:
        content_type, _, _ = await run_media_job(sniff_and_validate, path, kind)
        clean_path, _ = await run_media_job(strip_to_temp, path, content_type)
    except MediaValidationError:
        return await asyncio.to_thread(file_sha256, path)
    try:
        return await asyncio.to_thread(file_sha256, clean_path)
    finally:
        clean_path.unlink(missing_ok=True)


def get_storage(settings: Settings) -> MediaStorage:
    if settings.media_storage == "s3":
        return s3_storage(settings)
    return LocalMediaStorage(settings.media_root)


async def create_media_asset(
    db: AsyncSession,
    storage: MediaStorage,
    *,
    source_path: Path,
    declared_kind: MediaKind,
    original_filename: str,
    campus_key: str | None,
    created_by: uuid.UUID,
    alt_text: str | None = None,
    source_attribution: str | None = None,
    quota_bytes: int | None = None,
    video_processing: Literal["inline", "background"] = "inline",
) -> MediaAsset:
    """驗證 → 去除拍攝資訊 → 存檔 →（圖片）產生縮圖、中圖、大圖／（影片）排背景
    工作 → 寫入 metadata。上傳本體已經由路由邊收邊寫進暫存檔（source_path），這裡
    全程讀檔，影片不會整份進記憶體。

    存進儲存體的是去掉 EXIF／GPS 等拍攝資訊的複本（見 metadata 模組）：原檔會
    公開在官網上，所以這一步一定在請求裡、存檔之前做完，背景工作只讀這份乾淨檔。

    影片的 poster 與桌機／手機轉檔交給 app/media/jobs.py：video_processing 為
    background 時素材回傳時還是 processing，由 API 程序內的背景迴圈處理；inline
    時在這個交易裡直接做完（本機開發、測試、指令列匯入）。"""
    content_type, width, height = await run_media_job(sniff_and_validate, source_path, declared_kind)
    clean_path, clean_size = await run_media_job(strip_to_temp, source_path, content_type)
    try:
        size_bytes = clean_path.stat().st_size
        sha256 = await asyncio.to_thread(file_sha256, clean_path)
        if clean_size is not None:
            width, height = clean_size
        duration: float | None = None
        if declared_kind == MediaKind.VIDEO:
            probe = await run_media_job(probe_video, clean_path)
            width, height, duration = probe.width, probe.height, probe.duration_seconds
        if quota_bytes is not None:
            await _ensure_quota(db, campus_key, size_bytes, quota_bytes)

        extension = _EXTENSION_BY_CONTENT_TYPE[content_type]
        storage_key = storage.generate_key(extension)
        await asyncio.to_thread(storage.write_file, storage_key, clean_path)
        # 從這裡開始儲存空間裡已經有檔案了；後面任何一步失敗都必須把它刪掉，
        # 否則會累積永遠沒有 DB 記錄指向的孤兒檔。
        asset = MediaAsset(
            id=uuid.uuid4(),
            campus_key=campus_key,
            kind=declared_kind,
            status=MediaStatus.PROCESSING,
            storage_key=storage_key,
            original_filename=original_filename,
            content_type=content_type,
            size_bytes=size_bytes,
            sha256=sha256,
            width=width,
            height=height,
            duration_seconds=duration,
            alt_text=alt_text,
            source_attribution=source_attribution,
            created_by=created_by,
            created_at=datetime.now(timezone.utc),
        )
        db.add(asset)
        try:
            await db.flush()
        except Exception:
            await asyncio.to_thread(storage.delete, storage_key)
            raise

        if declared_kind == MediaKind.VIDEO:
            job = await media_jobs.enqueue(db, asset, MediaJobKind.PROCESS, created_by=created_by)
            if video_processing == "inline":
                await media_jobs.process_now(db, storage, asset, job)
            await db.flush()
            return asset

        written: list[str] = []
        try:
            renditions = await run_media_job(image_renditions, clean_path, width, height)
            for variant_kind, rendition in renditions:
                variant_key = storage.generate_key(".webp")
                await asyncio.to_thread(storage.write_bytes, variant_key, rendition.data)
                written.append(variant_key)
                db.add(
                    MediaVariant(
                        id=uuid.uuid4(),
                        media_id=asset.id,
                        kind=variant_kind,
                        storage_key=variant_key,
                        content_type="image/webp",
                        width=rendition.width,
                        height=rendition.height,
                    )
                )
            asset.status = MediaStatus.READY
        except ProcessingError as exc:
            asset.status = MediaStatus.FAILED
            asset.processing_error = str(exc)[:500]
            # 處理失敗的原檔永遠不會被公開，留著只會佔儲存空間；保留紀錄
            # 讓使用者看到失敗原因，但刪掉檔案（配額也不計 FAILED）。
            for key in [storage_key, *written]:
                await asyncio.to_thread(storage.delete, key)

        await db.flush()
        return asset
    finally:
        clean_path.unlink(missing_ok=True)


async def find_by_sha256(db: AsyncSession, sha256: str, campus_key: str | None) -> MediaAsset | None:
    """同一校區（或共用）裡內容相同、可用的素材；匯入既有素材時去重用。"""
    scope = MediaAsset.campus_key.is_(None) if campus_key is None else MediaAsset.campus_key == campus_key
    result = await db.execute(
        select(MediaAsset)
        .where(
            MediaAsset.sha256 == sha256,
            scope,
            MediaAsset.status == MediaStatus.READY,
            MediaAsset.deleted_at.is_(None),
        )
        .order_by(MediaAsset.created_at)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def is_referenced_by_current_release(db: AsyncSession, media_id: uuid.UUID) -> bool:
    """這個素材是否被「目前線上生效的 release」引用。

    MediaUsage 只反映**最新草稿**的引用（sync_content_item_usages 每次存檔
    都整批重建），所以只看 usages 會讓「線上版還在用、草稿已經換掉」的圖
    可以被刪掉，公開官網當場破圖。發布過的 revision payload 才是線上事實
    來源，這裡直接對 current release 的 manifest 重新解析一次。"""
    return media_id in await current_release_media_ids(db)


_release_media_cache: tuple[uuid.UUID, frozenset[uuid.UUID]] | None = None


async def current_release_media_ids(db: AsyncSession) -> frozenset[uuid.UUID]:
    """目前線上 release 引用的全部素材 id。公開素材路由每張圖都要問一次，
    release 不變時結果也不變，所以依 release id 快取（只留最新一份）。"""
    global _release_media_cache
    release_id = (
        await db.execute(select(SiteState.current_release_id).where(SiteState.id == 1))
    ).scalar_one_or_none()
    if release_id is None:
        return frozenset()
    if _release_media_cache is not None and _release_media_cache[0] == release_id:
        return _release_media_cache[1]
    result = await db.execute(
        select(ContentRevision.payload, ContentItem.kind)
        .select_from(SiteReleaseEntry)
        .join(ContentRevision, ContentRevision.id == SiteReleaseEntry.revision_id)
        .join(ContentItem, ContentItem.id == SiteReleaseEntry.content_item_id)
        .where(SiteReleaseEntry.release_id == release_id)
    )
    ids: set[uuid.UUID] = set()
    for payload, kind in result.all():
        config = CONTENT_KIND_REGISTRY.get(kind)
        if config is None or not isinstance(payload, dict):
            continue
        ids.update(config.extract_media_ids(payload))
    media_ids = frozenset(ids)
    _release_media_cache = (release_id, media_ids)
    return media_ids


def _percent(value: float | None) -> float | None:
    return None if value is None else round(value * 100, 2)


async def public_media(db: AsyncSession, media_ids: set[uuid.UUID]) -> dict[str, PublicMediaOut]:
    """公開內容引用到的素材資訊，只給處理完成、沒被刪除的（其他的官網照樣
    只拿得到 404，不必替它組 srcset）。"""
    if not media_ids:
        return {}
    result = await db.execute(
        select(MediaAsset)
        .options(selectinload(MediaAsset.variants))
        .where(
            MediaAsset.id.in_(media_ids),
            MediaAsset.status == MediaStatus.READY,
            MediaAsset.deleted_at.is_(None),
        )
    )
    out: dict[str, PublicMediaOut] = {}
    for asset in result.scalars():
        out[str(asset.id)] = PublicMediaOut(
            id=asset.id,
            kind=asset.kind,
            content_type=asset.content_type,
            width=asset.width,
            height=asset.height,
            alt_text=asset.alt_text,
            focus_x=_percent(asset.crop_focus_x),
            focus_y=_percent(asset.crop_focus_y),
            variants=[
                PublicMediaVariantOut(kind=v.kind, width=v.width, height=v.height, version=v.id.hex[:12])
                for v in sorted(asset.variants, key=lambda v: (v.width or 0, v.kind.value))
            ],
        )
    return out


async def _lock(db: AsyncSession, asset: MediaAsset) -> None:
    # 重新以 FOR UPDATE 鎖住這一列，引用數用即時查詢算，不用 eager load 的
    # 快照——否則「A 正在刪、B 同時把這張圖加進內容」會兩邊都成功。
    locked = await db.execute(
        select(MediaAsset.id).where(MediaAsset.id == asset.id).with_for_update()
    )
    if locked.scalar_one_or_none() is None:
        raise MediaInUse()


async def mark_deleted(db: AsyncSession, asset: MediaAsset, *, actor_id: uuid.UUID) -> None:
    """刪除＝標記待清理（規格 L143、L322-327）：從素材庫收起來、內容不能再
    選用，過了保留天數才由定期工作刪檔（purge_due）。仍被任何一版內容引用
    （含可還原的舊版本與排程）時拒絕：刪掉之後還原、排程都會失敗。"""
    await _lock(db, asset)
    found = await media_references.find_references(db, asset.id)
    if found.referenced or await is_referenced_by_current_release(db, asset.id):
        raise MediaInUse(found)
    asset.deleted_at = datetime.now(timezone.utc)
    await audit_service.log_action(
        db,
        actor_user_id=actor_id,
        action="media.delete",
        target_type="media_asset",
        target_id=str(asset.id),
        campus_key=asset.campus_key,
        metadata={"filename": asset.original_filename, "size_bytes": asset.size_bytes},
    )
    await db.flush()


async def restore_deleted(db: AsyncSession, asset: MediaAsset, *, actor_id: uuid.UUID) -> None:
    asset.deleted_at = None
    await audit_service.log_action(
        db,
        actor_user_id=actor_id,
        action="media.restore",
        target_type="media_asset",
        target_id=str(asset.id),
        campus_key=asset.campus_key,
        metadata={"filename": asset.original_filename},
    )
    await db.flush()


async def set_archived(db: AsyncSession, asset: MediaAsset, archived: bool, *, actor_id: uuid.UUID) -> None:
    """封存只是從素材庫與選圖器收起來；只有沒被草稿、官網或排程用到的
    素材可以封存（規格 L143）。舊版本還在用沒關係，檔案照樣保留。"""
    if archived:
        await _lock(db, asset)
        found = await media_references.find_references(db, asset.id)
        if found.in_use:
            raise MediaInUse(found)
    asset.archived_at = datetime.now(timezone.utc) if archived else None
    await audit_service.log_action(
        db,
        actor_user_id=actor_id,
        action="media.archive" if archived else "media.unarchive",
        target_type="media_asset",
        target_id=str(asset.id),
        campus_key=asset.campus_key,
        metadata={"filename": asset.original_filename},
    )
    await db.flush()


async def due_for_purge(db: AsyncSession, now: datetime, delay_days: int, *, limit: int = 50) -> list[uuid.UUID]:
    cutoff = now - timedelta(days=delay_days)
    result = await db.execute(
        select(MediaAsset.id)
        .where(MediaAsset.deleted_at.is_not(None), MediaAsset.deleted_at <= cutoff)
        .order_by(MediaAsset.deleted_at)
        .limit(limit)
    )
    return list(result.scalars())


async def purge_one(
    db: AsyncSession, media_id: uuid.UUID, now: datetime, delay_days: int
) -> list[str] | None:
    """刪掉一筆到期的待清理素材的 DB 記錄，回傳要刪的 storage key；**檔案
    由呼叫端在 commit 成功之後才刪**（交易回滾時才不會出現「DB 有記錄、
    檔案沒了」的破圖）。已經被復原、還沒到期或又被引用（不應該發生：內容
    不能選用待清理的素材）時不刪，回傳 None；又被引用的順便取消待清理。"""
    result = await db.execute(select(MediaAsset).where(MediaAsset.id == media_id).with_for_update())
    asset = result.scalar_one_or_none()
    if asset is None or asset.deleted_at is None or asset.deleted_at > now - timedelta(days=delay_days):
        return None
    found = await media_references.find_references(db, asset.id)
    if found.referenced or await is_referenced_by_current_release(db, asset.id):
        logger.warning("待清理的素材 %s 仍被內容引用，取消清理", asset.id)
        asset.deleted_at = None
        await audit_service.log_action(
            db,
            actor_user_id=None,
            action="media.restore",
            target_type="media_asset",
            target_id=str(asset.id),
            campus_key=asset.campus_key,
            metadata={"filename": asset.original_filename, "reason": "still_referenced"},
        )
        await db.flush()
        return None
    variants = (
        await db.execute(select(MediaVariant.storage_key).where(MediaVariant.media_id == asset.id))
    ).scalars().all()
    storage_keys = [*variants, asset.storage_key]
    await audit_service.log_action(
        db,
        actor_user_id=None,
        action="media.purge",
        target_type="media_asset",
        target_id=str(asset.id),
        campus_key=asset.campus_key,
        metadata={
            "filename": asset.original_filename,
            "size_bytes": asset.size_bytes,
            "deleted_at": asset.deleted_at.isoformat(),
        },
    )
    # 縮圖與引用記錄由外鍵 ON DELETE CASCADE 一併刪掉。
    await db.execute(delete(MediaAsset).where(MediaAsset.id == asset.id))
    return storage_keys


async def purge_due(session_factory, storage: MediaStorage, *, delay_days: int, now: datetime | None = None) -> int:
    """定期工作：把標記待清理超過 delay_days 天的素材真的刪掉。每筆自己一個
    交易，某筆失敗不影響其他筆；刪檔失敗只留下孤兒檔，不影響官網。"""
    now = now or datetime.now(timezone.utc)
    async with session_factory() as db:
        due = await due_for_purge(db, now, delay_days)
        await db.rollback()
    purged = 0
    for media_id in due:
        async with session_factory() as db:
            try:
                keys = await purge_one(db, media_id, now, delay_days)
                await db.commit()
            except Exception:  # noqa: BLE001
                await db.rollback()
                logger.exception("清理素材 %s 失敗", media_id)
                continue
        if keys is None:
            continue
        purged += 1
        for key in keys:
            try:
                await asyncio.to_thread(storage.delete, key)
            except Exception:  # noqa: BLE001
                logger.exception("刪除素材檔 %s 失敗，留下孤兒檔", key)
    return purged


async def replace_media_asset(
    db: AsyncSession,
    storage: MediaStorage,
    old_asset: MediaAsset,
    *,
    source_path: Path,
    original_filename: str,
    created_by: uuid.UUID,
    quota_bytes: int | None = None,
    video_processing: Literal["inline", "background"] = "inline",
) -> MediaAsset:
    """替換產生全新 asset（新 id），舊 asset 原樣保留、不變動——
    其他仍引用舊 id 的內容不受影響。要把內容改指到新素材，走
    `POST /admin/media/{id}/replace-references`（為每個內容項產生新草稿）。
    說明、圖說、來源、授權、標籤與裁切焦點沿用舊素材。"""
    new_asset = await create_media_asset(
        db,
        storage,
        source_path=source_path,
        declared_kind=old_asset.kind,
        original_filename=original_filename,
        campus_key=old_asset.campus_key,
        created_by=created_by,
        alt_text=old_asset.alt_text,
        source_attribution=old_asset.source_attribution,
        quota_bytes=quota_bytes,
        video_processing=video_processing,
    )
    new_asset.replaces_media_id = old_asset.id
    new_asset.caption = old_asset.caption
    new_asset.license_note = old_asset.license_note
    new_asset.tags = list(old_asset.tags or [])
    new_asset.crop_focus_x = old_asset.crop_focus_x
    new_asset.crop_focus_y = old_asset.crop_focus_y
    await db.flush()
    return new_asset


async def add_usage(
    db: AsyncSession,
    media_id: uuid.UUID,
    campus_key: str | None,
    content_item_id: str,
    field_name: str,
    *,
    content_kind: str | None = None,
    revision_id: uuid.UUID | None = None,
) -> None:
    db.add(
        MediaUsage(
            id=uuid.uuid4(),
            media_id=media_id,
            campus_key=campus_key,
            content_item_id=content_item_id,
            content_kind=content_kind,
            revision_id=revision_id,
            field_name=field_name,
            created_at=datetime.now(timezone.utc),
        )
    )
    await db.flush()


async def sync_content_item_usages(
    db: AsyncSession,
    content_item_id: str,
    content_kind: str,
    campus_key: str | None,
    revision_id: uuid.UUID,
    refs: list[MediaRef],
) -> None:
    """把某個 content item 的引用同步成最新一版（revision_id）的 refs——整批
    刪掉舊的、換成新的一批，每處引用一筆（含欄位路徑）。呼叫時機是每次
    儲存新版 revision（草稿也算「正在使用」，避免使用者能刪掉自己正在
    編輯中、還沒發布的圖片）。"""
    await db.execute(delete(MediaUsage).where(MediaUsage.content_item_id == content_item_id))
    now = datetime.now(timezone.utc)
    for ref in refs:
        db.add(
            MediaUsage(
                id=uuid.uuid4(),
                media_id=ref.media_id,
                campus_key=campus_key,
                content_item_id=content_item_id,
                content_kind=content_kind,
                revision_id=revision_id,
                field_name=ref.path[:128],
                created_at=now,
            )
        )
    await db.flush()
