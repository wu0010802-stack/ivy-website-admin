"""把各校粉專最近的貼文寫進收件匣（docs/specs/2026-10-28-facebook-news-sync-design.md §4）。

網路請求都在交易外做完，寫入是一校一個短交易。寫法是 upsert 且只更新內容欄位，
兩個程序同時同步也只是寫兩次一樣的值，所以不加 advisory lock。"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.campuses.models import Campus
from app.config import Settings
from app.facebook import graph
from app.facebook.models import FacebookPagePost, FacebookPageSync

logger = logging.getLogger("app.facebook.sync")


@dataclass
class PageSyncResult:
    campus_key: str
    count: int = 0
    error: str | None = None


async def _record(
    db: AsyncSession, campus_key: str, page_id: str, now: datetime, *, count: int | None, error: str | None
) -> None:
    values = {"page_id": page_id, "last_attempt_at": now, "last_error": error}
    if error is None:
        values |= {"last_success_at": now, "last_count": count}
    await db.execute(
        insert(FacebookPageSync)
        .values(campus_key=campus_key, **values)
        .on_conflict_do_update(index_elements=[FacebookPageSync.campus_key], set_=values)
    )


async def _write_posts(db: AsyncSession, campus_key: str, posts: list[graph.GraphPost], now: datetime) -> None:
    for post in posts:
        content = {
            "message": post.message,
            "permalink_url": post.permalink_url,
            "picture_url": post.picture_url,
            "video_url": post.video_url,
            "fetched_at": now,
        }
        await db.execute(
            insert(FacebookPagePost)
            .values(campus_key=campus_key, post_id=post.post_id, posted_at=post.posted_at, **content)
            # 同一則貼文換了粉專設定（理論上不會）也不搬校區；處理狀態永遠不由同步改。
            .on_conflict_do_update(index_elements=[FacebookPagePost.post_id], set_=content)
        )


async def sync_pages(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    *,
    campus_keys: list[str] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[PageSyncResult]:
    """同步設定裡的粉專（campus_keys 有給就只同步那幾校）。一校失敗不影響其他校；
    設定裡寫了不存在的校區代號就略過並記警告。"""
    pages = settings.facebook_page_ids
    if not settings.facebook_enabled:
        return []
    async with session_factory() as db:
        known = set(await db.scalars(select(Campus.key)))
    targets = [key for key in (campus_keys if campus_keys is not None else pages) if key in pages]
    results: list[PageSyncResult] = []
    async with graph.new_client(transport) as client:
        for campus_key in targets:
            if campus_key not in known:
                logger.warning("Facebook 同步：WEBSITE_FACEBOOK_PAGES 裡的 %s 不是已知校區，略過", campus_key)
                continue
            page_id = pages[campus_key]
            result = PageSyncResult(campus_key)
            try:
                token = await graph.page_token(client, settings, page_id)
                posts = await graph.page_posts(client, settings, page_id, token)
            except graph.GraphError as exc:
                result.error = str(exc)[:200]
                posts = []
            now = datetime.now(timezone.utc)
            async with session_factory() as db:
                if result.error is None:
                    await _write_posts(db, campus_key, posts, now)
                    result.count = len(posts)
                await _record(db, campus_key, page_id, now, count=result.count, error=result.error)
                await db.commit()
            if result.error:
                logger.warning("Facebook 同步 %s 失敗：%s", campus_key, result.error)
            results.append(result)
    return results
