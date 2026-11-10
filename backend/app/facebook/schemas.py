from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

PostStatus = Literal["new", "imported", "dismissed"]


class FacebookPostOut(BaseModel):
    id: uuid.UUID
    campus_key: str
    message: str | None
    posted_at: datetime
    permalink_url: str | None
    has_picture: bool
    status: PostStatus
    article_id: str | None
    handled_at: datetime | None


class FacebookSyncStatusOut(BaseModel):
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    last_error: str | None
    last_count: int | None


class FacebookPostCounts(BaseModel):
    new: int = 0
    imported: int = 0
    dismissed: int = 0


class FacebookPostListOut(BaseModel):
    # 這校有沒有設定粉專（WEBSITE_FACEBOOK_PAGES）；沒有時其他欄位都是空的。
    configured: bool
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
