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
    # metadata 的樂觀鎖版本（PATCH 帶 expected_version）。
    version: int

    model_config = {"from_attributes": True}


class MediaUpdateRequest(BaseModel):
    # 畫面載入時素材的 version；不符回 409 MEDIA_VERSION_CONFLICT。
    expected_version: int = Field(ge=1)
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

    # 素材本身的裁切焦點（0–1，左上為 0）：內容版位沒有另外設定焦點時，官網
    # 用它當 object-position（見 content/schemas.MediaSlotPayload）。
    crop_focus_x: float | None = Field(default=None, ge=0, le=1)
    crop_focus_y: float | None = Field(default=None, ge=0, le=1)


class PublicMediaVariantOut(BaseModel):
    kind: VariantKind
    width: int | None
    height: int | None


class PublicMediaOut(BaseModel):
    """公開內容引用到的素材資訊（GET /public/site 的 media）：官網用來組
    srcset、套用素材預設焦點與補替代文字。檔案網址由官網依 id 組成
    （/public/media/{id}/file 與 /variants/{kind}），權限跟原檔同一套。"""

    id: uuid.UUID
    kind: MediaKind
    content_type: str
    width: int | None
    height: int | None
    alt_text: str | None
    # 素材的裁切焦點換成 0–100（跟內容版位的焦點同一個單位），沒設為 null。
    focus_x: float | None
    focus_y: float | None
    variants: list[PublicMediaVariantOut]


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
    # 只換這些位置（usages 回傳的 field_path，例如只換封面、不換內文；規格
    # L142「替換預設只改目前版位」）。省略＝最新版裡用到舊素材的位置全換。
    field_paths: list[str] | None = Field(default=None, min_length=1, max_length=100)


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
