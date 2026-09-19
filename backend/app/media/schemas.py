from __future__ import annotations

import uuid

from pydantic import BaseModel

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
    crop_focus_x: float | None
    crop_focus_y: float | None
    processing_error: str | None
    usage_count: int
    variants: list[MediaVariantOut]

    model_config = {"from_attributes": True}


class MediaUpdateRequest(BaseModel):
    alt_text: str | None = None
    source_attribution: str | None = None
    crop_focus_x: float | None = None
    crop_focus_y: float | None = None
