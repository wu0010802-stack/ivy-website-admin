from __future__ import annotations

import uuid

from pydantic import BaseModel, Field, field_validator

from app.media.models import MediaKind, MediaStatus, VariantKind


class MediaVariantOut(BaseModel):
    id: uuid.UUID
    kind: VariantKind
    content_type: str
    width: int | None
    height: int | None

    model_config = {"from_attributes": True}


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
    alt_text: str | None
    source_attribution: str | None
    caption: str | None = None
    license_note: str | None = None
    tags: list[str] = Field(default_factory=list)
    crop_focus_x: float | None
    crop_focus_y: float | None
    processing_error: str | None
    usage_count: int
    variants: list[MediaVariantOut]

    model_config = {"from_attributes": True}


class MediaUpdateRequest(BaseModel):
    alt_text: str | None = None
    source_attribution: str | None = None
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
