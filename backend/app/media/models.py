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
    # 圖片：長邊 480 的縮圖（每張都有）與長邊 1600 的大圖（原圖更大時才有）。
    # 影片：抽一格做成的 poster（長邊 480，後台列表與沒設封面時的預設）。
    THUMBNAIL = "thumbnail"
    POSTER = "poster"
    LARGE = "large"


class MediaAsset(Base):
    """`campus_key` 為 null 代表跨校共用素材（如機構 logo）；
    非 null 代表僅該校可管理。刪除受引用保護：草稿、線上版、排程或任何
    可還原的舊版本仍引用時拒絕刪除（見 media/references.py）。

    封存（archived_at）只是從素材庫與選圖器收起來，檔案與引用都不動。
    刪除（deleted_at）先標記待清理，過 media_purge_delay_days 天才由定期
    工作刪掉檔案與記錄，期間可以復原。"""

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
    # 原檔內容的 SHA-256：匯入既有素材時用來去重（可重跑）。2026-09-25 以前的
    # 素材為 NULL。
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 影片時長（秒），由 ffprobe 取得；圖片、或主機沒有 ffprobe 時為 NULL。
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    alt_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_attribution: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 規格 4：圖說、授權註記與標籤搜尋。標籤是自由文字，存正規化後的清單。
    caption: Mapped[str | None] = mapped_column(String(500), nullable=True)
    license_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    crop_focus_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    crop_focus_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 說明、標籤、焦點等 metadata 的樂觀鎖（PATCH 帶 expected_version）。
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    processing_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    replaces_media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

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
    """各內容項**最新一版**（草稿）引用了哪些素材，每存一版就整批重建
    （content/routes._save_draft）。`field_name` 是欄位路徑（例如
    `articles[2].image`），`revision_id` 是那一版。線上版、排程與舊版本的
    引用不在這張表，由 media/references.py 直接掃 revision 內容。"""

    __tablename__ = "media_usages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    media_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    campus_key: Mapped[str | None] = mapped_column(
        ForeignKey("campuses.key", ondelete="CASCADE"), nullable=True
    )
    content_item_id: Mapped[str] = mapped_column(String(128), nullable=False)
    content_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    revision_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("content_revisions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    field_name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    asset: Mapped[MediaAsset] = relationship(back_populates="usages")
