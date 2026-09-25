from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
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
    # 官網上的版本最近一次換掉的時間（發布、核准、排程、還原都算）。排程到期時
    # 用它判斷「排好之後有沒有人另外發布過」，總覽用它判斷排程失敗後是否已處理。
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    revisions: Mapped[list["ContentRevision"]] = relationship(
        back_populates="content_item",
        cascade="all, delete-orphan",
        foreign_keys="ContentRevision.content_item_id",
    )


# 審核狀態：draft → pending_review →（approved 並發布｜rejected 附原因）；
# 送審之後又存了新版、或另外發布／還原了較新的版本，舊的待審版改成
# superseded（已被取代），不再出現在待審清單與總覽。
REVIEW_STATUSES = ("draft", "pending_review", "approved", "rejected", "superseded")


class ContentRevision(Base):
    __tablename__ = "content_revisions"
    __table_args__ = (
        CheckConstraint(
            "review_status IN ('draft', 'pending_review', 'approved', 'rejected', 'superseded')",
            name="ck_content_revisions_review_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    content_item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    # 存檔當下這種內容的欄位規則版本（registry 的 schema_version）。欄位規則
    # 有不相容的改動時調高，還原或發布舊版就知道要不要先轉換或重新驗證。
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
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


class ReleaseSource:
    """這次 release 是怎麼來的（發布紀錄頁顯示用）。舊資料沒有記錄，為 NULL。"""

    PUBLISH = "publish"
    REVIEW = "review"
    SCHEDULED = "scheduled"
    RESTORE = "restore"
    RELEASE_RESTORE = "release_restore"
    INITIALIZE = "initialize"


class SiteRelease(Base):
    """一次發布產生一筆 release；`entries` 記錄該次 release 涵蓋的
    每個 content item 對應哪個 revision，形成完整 manifest 快照。"""

    __tablename__ = "site_releases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    source: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # 整站還原產生的 release 記下還原的是哪一次；不刪任何歷史。
    restored_from_release_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("site_releases.id", ondelete="SET NULL"), nullable=True
    )

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
    # scheduled | done | failed | skipped | cancelled。skipped＝到期時官網已經是
    # 較新的版本（排好之後有人另外發布），不蓋回舊內容。
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="scheduled", server_default="scheduled")
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 沒有發布（failed／skipped）的排程有人按了「知道了」：例如分校停用、決定不
    # 發布那一版，總覽不再列成待辦、編輯頁不再提示。
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
