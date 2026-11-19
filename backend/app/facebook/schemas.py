from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

PostStatus = Literal["new", "imported", "dismissed"]
# 貼文從哪裡同步來的：粉專貼文，或粉專連結的 Instagram 專業帳號貼文（同一個收件匣）。
PostSource = Literal["facebook", "instagram"]


class FacebookPostOut(BaseModel):
    id: uuid.UUID
    campus_key: str
    source: PostSource
    message: str | None
    posted_at: datetime
    permalink_url: str | None
    has_picture: bool
    # 影片貼文（含 Reel）：轉成消息時影片會一起放進素材庫與消息內文。
    has_video: bool
    status: PostStatus
    article_id: str | None
    handled_at: datetime | None


class InstagramSyncStatusOut(BaseModel):
    """同一次同步裡 Instagram 那一段的結果；失敗不影響 Facebook 那一段。"""

    last_attempt_at: datetime | None
    last_success_at: datetime | None
    last_error: str | None
    last_count: int | None


class FacebookSyncStatusOut(BaseModel):
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    last_error: str | None
    last_count: int | None
    # 沒有同步狀態列時整個 sync 是 null；Instagram 沒開（instagram_enabled=false）時這裡是 null。
    instagram: InstagramSyncStatusOut | None


class FacebookPostCounts(BaseModel):
    new: int = 0
    imported: int = 0
    dismissed: int = 0


class FacebookPostListOut(BaseModel):
    # 這校有沒有設定粉專（WEBSITE_FACEBOOK_PAGES）；沒有時其他欄位都是空的。
    configured: bool
    # WEBSITE_INSTAGRAM_ENABLED 開著而且這校有設定粉專：收件匣才顯示來源與篩選、Instagram 同步狀態。
    instagram_enabled: bool
    sync_seconds: int
    sync: FacebookSyncStatusOut | None
    counts: FacebookPostCounts
    posts: list[FacebookPostOut]


class FacebookSyncIn(BaseModel):
    campus_key: str


class FacebookImportOut(BaseModel):
    post: FacebookPostOut
    article_id: str
    # 實際存進消息草稿的標題（去掉 emoji、【】、hashtag 後），後台提示用這個而不是原文第一行。
    article_title: str
    content_version: int
    # 影片有沒有一起放進消息內文；沒帶進來時 video_skipped_reason 寫原因（太大、太長、格式不合）。
    video_included: bool = False
    video_skipped_reason: str | None = None
