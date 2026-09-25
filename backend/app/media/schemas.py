from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.media.models import MediaKind, MediaStatus, VariantKind


class MediaVariantOut(BaseModel):
    id: uuid.UUID
    kind: VariantKind
    content_type: str
    width: int | None
    height: int | None

    model_config = {"from_attributes": True}


class MediaUsedInOut(BaseModel):
    """最新一版用到這個素材的內容項（依 MediaUsage，去重）。"""

    kind: str
    campus_key: str | None


class MediaAssetOut(BaseModel):
    id: uuid.UUID
    campus_key: str | None
    kind: MediaKind
    status: MediaStatus
    original_filename: str
    content_type: str
    size_bytes: int
    width: int | None
    height: int | None
    duration_seconds: float | None = None
    created_at: datetime
    created_by_email: str | None = None
    archived_at: datetime | None = None
    deleted_at: datetime | None = None
    # 待清理的素材會在這個時間之後由定期工作刪除。
    purge_after: datetime | None = None
    replaces_media_id: uuid.UUID | None = None
    alt_text: str | None
    source_attribution: str | None
    caption: str | None = None
    license_note: str | None = None
    tags: list[str] = Field(default_factory=list)
    crop_focus_x: float | None
    crop_focus_y: float | None
    processing_error: str | None
    usage_count: int
    used_in: list[MediaUsedInOut] = Field(default_factory=list)
    variants: list[MediaVariantOut]

    model_config = {"from_attributes": True}


class MediaUpdateRequest(BaseModel):
    alt_text: str | None = Field(default=None, max_length=500)
    source_attribution: str | None = Field(default=None, max_length=255)
    caption: str | None = Field(default=None, max_length=500)
    license_note: str | None = Field(default=None, max_length=255)
    tags: list[str] | None = Field(default=None, max_length=20)

    @field_validator("tags")
    @classmethod
    def _normalize_tags(cls, value: list[str] | None) -> list[str] | None:
        """去頭尾空白、去空字串、去重（保留第一次出現的順序），每個最多 30 字。"""
        if value is None:
            return None
        out: list[str] = []
        for tag in value:
            cleaned = tag.strip()
            if not cleaned:
                continue
            if len(cleaned) > 30:
                raise ValueError("每個標籤最多 30 字")
            if cleaned not in out:
                out.append(cleaned)
        return out
    crop_focus_x: float | None = None
    crop_focus_y: float | None = None


MediaReferenceState = Literal["draft", "live", "scheduled"]


class MediaReferenceOut(BaseModel):
    """一處引用：哪個內容項的哪一版、哪個欄位。"""

    content_item_id: uuid.UUID
    kind: str
    campus_key: str | None
    revision_id: uuid.UUID
    version: int
    field_path: str
    # 那一項的標題（消息標題、場景名稱）；看不到那一校內容的人不給。
    label: str | None
    states: list[MediaReferenceState]
    publish_at: datetime | None = None
    # 目前登入的人能不能改這個內容項（批次替換只會動這些）。
    can_edit: bool


class MediaHistoryReferenceOut(BaseModel):
    """只剩可還原的舊版本在用：同一內容項合併成一筆。"""

    content_item_id: uuid.UUID
    kind: str
    campus_key: str | None
    versions: list[int]


class MediaUsagesOut(BaseModel):
    media_id: uuid.UUID
    references: list[MediaReferenceOut]
    history: list[MediaHistoryReferenceOut]
    # 其他來源記錄的引用（找不到對應的內容版本），一樣算使用中。
    untracked_usages: int = 0
    can_archive: bool
    can_delete: bool


class MediaUploadLimitsOut(BaseModel):
    max_image_bytes: int
    max_video_bytes: int
    image_types: list[str]
    video_types: list[str]
    purge_delay_days: int


class MediaReplaceItem(BaseModel):
    content_item_id: uuid.UUID
    # 看影響範圍當下的最新版本號；之後有人另外存過就停下來，請使用者重看。
    expected_version: int = Field(ge=1)


class MediaReplaceReferencesRequest(BaseModel):
    replacement_id: uuid.UUID
    items: list[MediaReplaceItem] = Field(min_length=1, max_length=50)


class MediaReplacedItemOut(BaseModel):
    content_item_id: uuid.UUID
    kind: str
    campus_key: str | None
    version: int
    field_paths: list[str]


class MediaReplaceReferencesOut(BaseModel):
    replacement_id: uuid.UUID
    items: list[MediaReplacedItemOut]
