from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class MediaKind(str, enum.Enum):
    IMAGE = "image"
    VIDEO = "video"


class MediaStatus(str, enum.Enum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class VariantKind(str, enum.Enum):
    THUMBNAIL = "thumbnail"
    POSTER = "poster"


class MediaAsset(Base):
    """`campus_key` 為 null 代表跨校共用素材（如機構 logo）；
    非 null 代表僅該校可管理。刪除受 usage 保護：仍被引用時拒絕刪除。"""

    __tablename__ = "media_assets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str | None] = mapped_column(
        ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=True
    )
    kind: Mapped[MediaKind] = mapped_column(Enum(MediaKind, name="media_kind"), nullable=False)
    status: Mapped[MediaStatus] = mapped_column(
        Enum(MediaStatus, name="media_status"), nullable=False, default=MediaStatus.PROCESSING
    )
    storage_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    alt_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_attribution: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 規格 4：圖說、授權註記與標籤搜尋。標籤是自由文字，存正規化後的清單。
    caption: Mapped[str | None] = mapped_column(String(500), nullable=True)
    license_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    crop_focus_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    crop_focus_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    processing_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    replaces_media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True
    )

    variants: Mapped[list["MediaVariant"]] = relationship(
        back_populates="asset", cascade="all, delete-orphan"
    )
    usages: Mapped[list["MediaUsage"]] = relationship(
        back_populates="asset", cascade="all, delete-orphan"
    )


class MediaVariant(Base):
    __tablename__ = "media_variants"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    media_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[VariantKind] = mapped_column(Enum(VariantKind, name="media_variant_kind"), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)

    asset: Mapped[MediaAsset] = relationship(back_populates="variants")


class MediaUsage(Base):
    """誰在用這個素材；階段 B 的 content 模組寫入這張表建立引用關係。
    `content_item_id`／`field_name` 先用字串泛用欄位，Task 5 content 模型
    定案後可再收斂為外鍵，不影響刪除保護邏輯。"""

    __tablename__ = "media_usages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    media_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    campus_key: Mapped[str | None] = mapped_column(
        ForeignKey("campuses.key", ondelete="CASCADE"), nullable=True
    )
    content_item_id: Mapped[str] = mapped_column(String(128), nullable=False)
    field_name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    asset: Mapped[MediaAsset] = relationship(back_populates="usages")
