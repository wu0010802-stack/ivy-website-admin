from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class ContentItem(Base):
    """`kind` 是固定的內容代號（如 `home_about`）；`campus_key` 為 null 代表
    跨校共用內容（首頁），非 null 代表僅該校可編輯——分校不能改共用內容。"""

    __tablename__ = "content_items"
    # Postgres 的 UNIQUE 把每個 NULL 視為互異值，所以 (kind, NULL) 這種
    # 共用內容其實完全不受原本那個唯一約束保護，併發下會產生重複列。
    # 拆成兩個 partial unique index：共用內容只比 kind，校區內容比兩欄。
    __table_args__ = (
        Index(
            "uq_content_item_kind_shared",
            "kind",
            unique=True,
            postgresql_where=text("campus_key IS NULL"),
        ),
        Index(
            "uq_content_item_kind_campus",
            "kind",
            "campus_key",
            unique=True,
            postgresql_where=text("campus_key IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    campus_key: Mapped[str | None] = mapped_column(
        ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=True
    )
    latest_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_published_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("content_revisions.id", ondelete="SET NULL", use_alter=True), nullable=True
    )

    revisions: Mapped[list["ContentRevision"]] = relationship(
        back_populates="content_item",
        cascade="all, delete-orphan",
        foreign_keys="ContentRevision.content_item_id",
    )


class ContentRevision(Base):
    __tablename__ = "content_revisions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    content_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # 規格 4 審核流程：draft → pending_review →（approved 並發布｜rejected 附原因）。
    # 能直接發布的角色（總管理者、分校管理者）不需要送審，照舊存草稿就發布。
    review_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="draft", server_default="draft", index=True
    )
    review_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    content_item: Mapped[ContentItem] = relationship(
        back_populates="revisions", foreign_keys=[content_item_id]
    )


class SiteRelease(Base):
    """一次發布產生一筆 release；`entries` 記錄該次 release 涵蓋的
    每個 content item 對應哪個 revision，形成完整 manifest 快照。"""

    __tablename__ = "site_releases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    entries: Mapped[list["SiteReleaseEntry"]] = relationship(
        back_populates="release", cascade="all, delete-orphan"
    )


class SiteReleaseEntry(Base):
    __tablename__ = "site_release_entries"

    release_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("site_releases.id", ondelete="CASCADE"), primary_key=True
    )
    content_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_items.id", ondelete="CASCADE"), primary_key=True
    )
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_revisions.id", ondelete="RESTRICT"), nullable=False
    )

    release: Mapped[SiteRelease] = relationship(back_populates="entries")


class SiteState(Base):
    """單一列（id=1）記錄目前生效的 release；發布交易鎖這一列，
    確保「同一頁面所有內容用同一份 release」與原子切換。"""

    __tablename__ = "site_state"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    current_release_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("site_releases.id", ondelete="SET NULL"), nullable=True
    )


class PublishJob(Base):
    """排程發布（規格 4）：綁定明確的 revision 與時間（UTC 儲存）。到時由
    背景工作重新檢查排程人仍有權限、分校仍啟用、內容可發布，才真正發布；
    檢查不過就記 failed 與原因，不會默默換成別的版本。"""

    __tablename__ = "publish_jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    content_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_revisions.id", ondelete="CASCADE"), nullable=False
    )
    publish_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    # scheduled | done | failed | cancelled
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="scheduled", server_default="scheduled")
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
