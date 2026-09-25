"""重新產生圖片素材的縮圖與大圖（`python -m app.cli regenerate-media-variants`）。

2026-09-25 的 B10 起官網 srcset 會用到縮圖與大圖，但以下衍生檔不能直接用：

- 2026-09-25 以前上傳的圖片（sha256 為 NULL）：縮圖沒有依 EXIF 拍攝方向轉正
  （手機直拍的照片是躺著的），也沒有大圖。
- 去背 PNG／WebP（以及舊的 GIF）：縮圖與大圖一律轉成 RGB，透明處變成黑底。

migration de61f57ec77d 把這些衍生檔的寬高清成 NULL（官網就不把它們放進
srcset、後台點焦點改用原檔），這裡重讀原檔重新產生，寬高補回來之後才重新
進 srcset。新的衍生檔是新的一筆記錄（新 id），官網與後台的網址帶這個 id
當版本，瀏覽器快取過的舊縮圖不會繼續被用。
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import uuid
from dataclasses import dataclass, field

from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.media.models import MediaAsset, MediaKind, MediaStatus, MediaVariant, VariantKind
from app.media.processing import needs_large_rendition, oriented_size
from app.media.service import image_renditions
from app.media.storage import MediaFileMissing, MediaStorage
from app.media.validation import MAX_IMAGE_PIXELS

_IMAGE_VARIANTS = (VariantKind.THUMBNAIL, VariantKind.LARGE)

REASON_LEGACY = "2026-09-25 以前上傳（縮圖沒有依拍攝方向轉正、沒有大圖）"
REASON_STALE = "衍生檔待重新產生（去背圖的透明處可能變黑）"
REASON_NO_THUMBNAIL = "沒有縮圖"
REASON_NO_LARGE = "缺大圖"
REASON_ALL = "指定全部重新產生"


class RegenerationFailed(Exception):
    pass


@dataclass
class Candidate:
    asset_id: uuid.UUID
    filename: str
    campus_key: str | None
    reasons: list[str] = field(default_factory=list)


def _reasons(asset: MediaAsset, *, include_all: bool) -> list[str]:
    variants = [v for v in asset.variants if v.kind in _IMAGE_VARIANTS]
    kinds = {v.kind for v in variants}
    reasons: list[str] = []
    if asset.sha256 is None:
        reasons.append(REASON_LEGACY)
    if VariantKind.THUMBNAIL not in kinds:
        reasons.append(REASON_NO_THUMBNAIL)
    if any(v.width is None or v.height is None for v in variants):
        reasons.append(REASON_STALE)
    if VariantKind.LARGE not in kinds and needs_large_rendition(asset.width, asset.height):
        reasons.append(REASON_NO_LARGE)
    if include_all and not reasons:
        reasons.append(REASON_ALL)
    return reasons


async def find_candidates(db: AsyncSession, *, include_all: bool = False) -> list[Candidate]:
    """處理完成的圖片裡需要重新產生衍生檔的（含封存與待清理：它們還可能
    被復原或還原舊版本時用到）。"""
    result = await db.execute(
        select(MediaAsset)
        .options(selectinload(MediaAsset.variants))
        .where(MediaAsset.kind == MediaKind.IMAGE, MediaAsset.status == MediaStatus.READY)
        .order_by(MediaAsset.created_at, MediaAsset.id)
    )
    out: list[Candidate] = []
    for asset in result.scalars():
        reasons = _reasons(asset, include_all=include_all)
        if reasons:
            out.append(Candidate(asset.id, asset.original_filename, asset.campus_key, reasons))
    return out


def _inspect(data: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(data)) as img:
        width, height = img.size
        if width * height > MAX_IMAGE_PIXELS:
            raise RegenerationFailed(f"圖片像素過多（{width}x{height}）")
        return oriented_size(img)


@dataclass
class Regenerated:
    old_keys: list[str]
    new_keys: list[str]


async def regenerate_image_variants(db: AsyncSession, storage: MediaStorage, asset_id: uuid.UUID) -> Regenerated:
    """重讀原檔，重新產生縮圖（與原圖夠大時的大圖），換掉舊的衍生檔記錄；
    素材寬高改成轉正後的尺寸，順便補上 sha256。

    只改 DB 與寫新檔；舊衍生檔的檔案**由呼叫端在 commit 成功後才刪**（回傳
    old_keys），commit 失敗則刪掉 new_keys，不留孤兒檔也不讓官網破圖。
    讀不到原檔或解碼失敗丟 RegenerationFailed，舊衍生檔原封不動。"""
    result = await db.execute(
        select(MediaAsset)
        .options(selectinload(MediaAsset.variants))
        .where(MediaAsset.id == asset_id)
        .with_for_update(of=MediaAsset)
    )
    asset = result.scalar_one_or_none()
    if asset is None or asset.kind != MediaKind.IMAGE or asset.status != MediaStatus.READY:
        raise RegenerationFailed("素材不存在、不是圖片或還沒處理完成")
    try:
        data = await asyncio.to_thread(storage.read_bytes, asset.storage_key)
    except (MediaFileMissing, FileNotFoundError) as exc:
        raise RegenerationFailed("儲存空間裡找不到原檔") from exc
    try:
        width, height = await asyncio.to_thread(_inspect, data)
        renditions = await asyncio.to_thread(image_renditions, data, width, height)
    except RegenerationFailed:
        raise
    except Exception as exc:  # noqa: BLE001 - Pillow 對壞檔可能丟各種例外
        raise RegenerationFailed(f"原檔無法解碼：{type(exc).__name__}") from exc

    new_keys: list[str] = []
    try:
        new_variants: list[MediaVariant] = []
        for kind, rendition in renditions:
            key = storage.generate_key(".webp")
            await asyncio.to_thread(storage.write_bytes, key, rendition.data)
            new_keys.append(key)
            new_variants.append(
                MediaVariant(
                    id=uuid.uuid4(),
                    media_id=asset.id,
                    kind=kind,
                    storage_key=key,
                    content_type="image/webp",
                    width=rendition.width,
                    height=rendition.height,
                )
            )
        old = [v for v in asset.variants if v.kind in _IMAGE_VARIANTS]
        for variant in old:
            asset.variants.remove(variant)
        await db.flush()
        asset.variants.extend(new_variants)
        asset.width, asset.height = width, height
        if asset.sha256 is None:
            asset.sha256 = hashlib.sha256(data).hexdigest()
        await db.flush()
    except Exception:
        for key in new_keys:
            await asyncio.to_thread(storage.delete, key)
        raise
    return Regenerated(old_keys=[v.storage_key for v in old], new_keys=new_keys)
