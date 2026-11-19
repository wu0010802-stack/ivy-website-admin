from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

POST_STATUSES = ("new", "imported", "dismissed")
POST_SOURCES = ("facebook", "instagram")


class FacebookPagePost(Base):
    """各校粉專的貼文收件匣（docs/specs/2026-10-28-facebook-news-sync-design.md）。同步只寫
    內文、照片與影片網址、連結與抓取時間；status 以後的欄位只由後台的轉成消息／略過改。
    picture_url、video_url 是 Meta CDN 帶簽章的網址，幾天就失效，每次同步換新，不能直接給官網用。
    2026-11-12 起同一個收件匣也收該校粉專連結的 Instagram 貼文（source='instagram'，
    post_id 是 ig_<media id>，docs/specs/2026-11-12-external-integrations-design.md §2）。"""

    __tablename__ = "facebook_page_posts"
    __table_args__ = (
        CheckConstraint("status IN ('new', 'imported', 'dismissed')", name="ck_facebook_page_posts_status"),
        CheckConstraint("source IN ('facebook', 'instagram')", name="ck_facebook_page_posts_source"),
        Index("ix_facebook_page_posts_campus_posted", "campus_key", "posted_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="CASCADE"), nullable=False)
    # Graph API 的貼文 ID，「粉專ID_貼文ID」；Instagram 的是「ig_<media id>」，兩邊不會撞。
    post_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # 貼文從哪裡來；同步只在第一次寫入時設定，之後不改。
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="facebook", server_default="facebook")
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    permalink_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    picture_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 影片貼文（含 Reel）的 mp4 網址；這種貼文的 picture_url 是影片的某一格。
    video_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="new", server_default="new")
    # 轉成的 campus_news 消息 id；之後在消息編輯器被刪掉也不回頭清，只當紀錄。
    article_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True
    )
    # 轉成消息時一起放進素材庫的影片；沒有影片或影片沒帶進來就是空的。
    video_media_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True
    )
    handled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FacebookPageSync(Base):
    """每校一列：最近一次同步的時間與結果。last_error 只有 HTTP 狀態與 Meta 錯誤代碼，不含 token 與回應內容。
    ig_ 開頭的四欄是同一次同步之後 Instagram 那一段的結果，互不影響：Instagram 失敗不會動
    last_*，Instagram 沒開（WEBSITE_INSTAGRAM_ENABLED）時永遠是 NULL。"""

    __tablename__ = "facebook_page_sync"

    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="CASCADE"), primary_key=True)
    page_id: Mapped[str] = mapped_column(String(32), nullable=False)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ig_last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ig_last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ig_last_error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ig_last_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
