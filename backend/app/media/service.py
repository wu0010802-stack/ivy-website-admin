from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.content.models import ContentItem, ContentRevision, SiteReleaseEntry, SiteState
from app.content.registry import CONTENT_KIND_REGISTRY
from app.media.models import MediaAsset, MediaKind, MediaStatus, MediaVariant, MediaUsage, VariantKind
from app.media.processing import ProcessingError, extract_video_poster_webp, make_image_thumbnail_webp
from app.media.storage import LocalMediaStorage
from app.media.validation import MediaValidationError, sniff_and_validate

_EXTENSION_BY_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
}


class MediaInUse(Exception):
    pass


class MediaQuotaExceeded(Exception):
    pass


async def _ensure_quota(
    db: AsyncSession, campus_key: str | None, incoming_bytes: int, quota_bytes: int
) -> None:
    """同一校區的上傳用 advisory lock 排隊，才不會兩個並行請求都看到
    「還有空間」而一起超過。處理失敗的素材原檔會被刪掉，不計入。"""
    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": f"media-quota:{campus_key or '__shared__'}"},
        )
    scope = MediaAsset.campus_key.is_(None) if campus_key is None else MediaAsset.campus_key == campus_key
    used = await db.execute(
        select(func.coalesce(func.sum(MediaAsset.size_bytes), 0)).where(
            scope, MediaAsset.status != MediaStatus.FAILED
        )
    )
    if used.scalar_one() + incoming_bytes > quota_bytes:
        raise MediaQuotaExceeded()


def get_storage(settings: Settings) -> LocalMediaStorage:
    return LocalMediaStorage(settings.media_root)


async def create_media_asset(
    db: AsyncSession,
    storage: LocalMediaStorage,
    *,
    data: bytes,
    declared_kind: MediaKind,
    original_filename: str,
    campus_key: str | None,
    created_by: uuid.UUID,
    alt_text: str | None = None,
    source_attribution: str | None = None,
    quota_bytes: int | None = None,
) -> MediaAsset:
    """驗證 → 存檔 → 產生縮圖／poster → 寫入 metadata。仍在請求內完成
    （非同步 worker 佇列屬 Task 9，尚未建立），但解碼、寫檔與 ffmpeg 都
    丟到 thread 執行：API 只有一個 event loop，同步做會讓一次影片上傳
    卡住所有校區與公開訪客的請求（ffmpeg 最長 30 秒）。"""
    content_type, width, height = await asyncio.to_thread(sniff_and_validate, data, declared_kind)
    if quota_bytes is not None:
        await _ensure_quota(db, campus_key, len(data), quota_bytes)

    extension = _EXTENSION_BY_CONTENT_TYPE[content_type]
    storage_key = storage.generate_key(extension)
    await asyncio.to_thread(storage.write_bytes, storage_key, data)
    # 從這裡開始磁碟上已經有檔案了；後面任何一步失敗都必須把它刪掉，
    # 否則 media_root 會累積永遠沒有 DB 記錄指向的孤兒檔。
    asset = MediaAsset(
        id=uuid.uuid4(),
        campus_key=campus_key,
        kind=declared_kind,
        status=MediaStatus.PROCESSING,
        storage_key=storage_key,
        original_filename=original_filename,
        content_type=content_type,
        size_bytes=len(data),
        width=width,
        height=height,
        alt_text=alt_text,
        source_attribution=source_attribution,
        created_by=created_by,
        created_at=datetime.now(timezone.utc),
    )
    db.add(asset)
    try:
        await db.flush()
    except Exception:
        storage.delete(storage_key)
        raise

    try:
        if declared_kind == MediaKind.IMAGE:
            thumb_bytes = await asyncio.to_thread(make_image_thumbnail_webp, data)
            thumb_key = storage.generate_key(".webp")
            await asyncio.to_thread(storage.write_bytes, thumb_key, thumb_bytes)
            db.add(
                MediaVariant(
                    id=uuid.uuid4(),
                    media_id=asset.id,
                    kind=VariantKind.THUMBNAIL,
                    storage_key=thumb_key,
                    content_type="image/webp",
                    width=None,
                    height=None,
                )
            )
        else:
            poster_bytes = await asyncio.to_thread(extract_video_poster_webp, data)
            poster_key = storage.generate_key(".webp")
            await asyncio.to_thread(storage.write_bytes, poster_key, poster_bytes)
            db.add(
                MediaVariant(
                    id=uuid.uuid4(),
                    media_id=asset.id,
                    kind=VariantKind.POSTER,
                    storage_key=poster_key,
                    content_type="image/webp",
                    width=None,
                    height=None,
                )
            )
        asset.status = MediaStatus.READY
    except ProcessingError as exc:
        asset.status = MediaStatus.FAILED
        asset.processing_error = str(exc)[:500]
        # 處理失敗的原檔永遠不會被公開，留著只會佔共用 volume；保留
        # 紀錄讓使用者看到失敗原因，但刪掉檔案（配額也不計 FAILED）。
        storage.delete(storage_key)

    await db.flush()
    return asset


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


async def delete_media_asset(
    db: AsyncSession, storage: LocalMediaStorage, asset: MediaAsset
) -> list[str]:
    """刪除 DB 記錄並回傳需要刪除的 storage key；**檔案由呼叫端在 commit
    成功之後才刪**。先 unlink 再刪 DB 的順序會在交易回滾時留下「DB 有記錄、
    磁碟沒檔案」的破圖狀態，比留下孤兒檔更難修。"""
    # 重新以 FOR UPDATE 鎖住這一列，並用即時查詢算引用數，不用 eager load
    # 的快照——否則「A 正在刪、B 同時把這張圖加進內容」會兩邊都成功，
    # 接著 cascade 把 B 剛建立的引用一起刪掉。
    locked = await db.execute(
        select(MediaAsset.id).where(MediaAsset.id == asset.id).with_for_update()
    )
    if locked.scalar_one_or_none() is None:
        raise MediaInUse()

    usage_count = await db.execute(
        select(func.count()).select_from(MediaUsage).where(MediaUsage.media_id == asset.id)
    )
    if usage_count.scalar_one() > 0:
        raise MediaInUse()
    if await is_referenced_by_current_release(db, asset.id):
        raise MediaInUse()

    storage_keys = [variant.storage_key for variant in asset.variants]
    storage_keys.append(asset.storage_key)
    await db.delete(asset)
    await db.flush()
    return storage_keys


async def replace_media_asset(
    db: AsyncSession,
    storage: LocalMediaStorage,
    old_asset: MediaAsset,
    *,
    data: bytes,
    original_filename: str,
    created_by: uuid.UUID,
    quota_bytes: int | None = None,
) -> MediaAsset:
    """替換產生全新 asset（新 id），舊 asset 原樣保留、不變動——
    其他仍引用舊 id 的內容不受影響。呼叫端（內容編輯器）負責把自己的
    引用指到新 id；這裡只負責「生出新版本」。"""
    new_asset = await create_media_asset(
        db,
        storage,
        data=data,
        declared_kind=old_asset.kind,
        original_filename=original_filename,
        campus_key=old_asset.campus_key,
        created_by=created_by,
        alt_text=old_asset.alt_text,
        source_attribution=old_asset.source_attribution,
        quota_bytes=quota_bytes,
    )
    new_asset.replaces_media_id = old_asset.id
    await db.flush()
    return new_asset


async def add_usage(
    db: AsyncSession, media_id: uuid.UUID, campus_key: str | None, content_item_id: str, field_name: str
) -> None:
    db.add(
        MediaUsage(
            id=uuid.uuid4(),
            media_id=media_id,
            campus_key=campus_key,
            content_item_id=content_item_id,
            field_name=field_name,
            created_at=datetime.now(timezone.utc),
        )
    )
    await db.flush()


async def sync_content_item_usages(
    db: AsyncSession,
    content_item_id: str,
    field_name: str,
    campus_key: str | None,
    media_ids: list[uuid.UUID],
) -> None:
    """把某個 content item 目前這個欄位引用的媒體，同步成 media_ids 這份
    清單——整批刪掉舊的、換成新的一批，不逐一比對差異。呼叫時機是每次
    儲存新版 revision（草稿也算「正在使用」，避免使用者能刪掉自己正在
    編輯中、還沒發布的圖片）。"""
    await db.execute(
        delete(MediaUsage).where(
            MediaUsage.content_item_id == content_item_id, MediaUsage.field_name == field_name
        )
    )
    for media_id in media_ids:
        db.add(
            MediaUsage(
                id=uuid.uuid4(),
                media_id=media_id,
                campus_key=campus_key,
                content_item_id=content_item_id,
                field_name=field_name,
                created_at=datetime.now(timezone.utc),
            )
        )
    await db.flush()
