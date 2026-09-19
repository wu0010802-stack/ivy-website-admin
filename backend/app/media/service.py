from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
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
) -> MediaAsset:
    """驗證 → 存檔 → 產生縮圖／poster → 寫入 metadata。整段目前是同步執行
    （非同步 worker 佇列屬 Task 9，尚未建立），檔案較大時會拉長請求時間，
    屬階段 B 的已知限制。"""
    try:
        content_type, width, height = sniff_and_validate(data, declared_kind)
    except MediaValidationError:
        raise

    extension = _EXTENSION_BY_CONTENT_TYPE[content_type]
    storage_key = storage.generate_key(extension)
    storage.write_bytes(storage_key, data)

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
    await db.flush()

    try:
        if declared_kind == MediaKind.IMAGE:
            thumb_bytes = make_image_thumbnail_webp(data)
            thumb_key = storage.generate_key(".webp")
            storage.write_bytes(thumb_key, thumb_bytes)
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
            poster_bytes = extract_video_poster_webp(data)
            poster_key = storage.generate_key(".webp")
            storage.write_bytes(poster_key, poster_bytes)
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

    await db.flush()
    return asset


async def delete_media_asset(db: AsyncSession, storage: LocalMediaStorage, asset: MediaAsset) -> None:
    if len(asset.usages) > 0:
        raise MediaInUse()
    for variant in asset.variants:
        storage.delete(variant.storage_key)
    storage.delete(asset.storage_key)
    await db.delete(asset)
    await db.flush()


async def replace_media_asset(
    db: AsyncSession,
    storage: LocalMediaStorage,
    old_asset: MediaAsset,
    *,
    data: bytes,
    original_filename: str,
    created_by: uuid.UUID,
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
