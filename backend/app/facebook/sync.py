"""把各校粉專最近的貼文寫進收件匣（docs/specs/2026-10-28-facebook-news-sync-design.md §4）。

網路請求都在交易外做完，寫入是一校一個短交易。寫法是 upsert 且只更新內容欄位，
兩個程序同時同步也只是寫兩次一樣的值，所以不加 advisory lock。

WEBSITE_INSTAGRAM_ENABLED 開著時，每校 Facebook 那一段寫完、提交之後再用同一把 Page token 同步
粉專連結的 Instagram 貼文（docs/specs/2026-11-12-external-integrations-design.md §2）：
Instagram 自己一個交易、自己一組狀態欄位，失敗只記在 ig_ 欄位，不動 Facebook 的結果與狀態。"""

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

# 寫進 ig_last_error、顯示在後台的固定說法；其他錯誤只有 Graph 的步驟、HTTP 狀態與 Meta 錯誤代碼。
NO_INSTAGRAM_ACCOUNT = "粉專沒有連結 Instagram 專業帳號"
NO_INSTAGRAM_PERMISSION = "權杖沒有 Instagram 權限"
INSTAGRAM_UNEXPECTED = "Instagram 同步發生未預期的錯誤"


@dataclass
class PageSyncResult:
    campus_key: str
    count: int = 0
    error: str | None = None
    # Instagram 那一段（開關沒開、或沒拿到粉專權杖時兩個都是 None）：
    # 成功時 instagram_count 是這輪讀到的貼文數；沒成功時 instagram_error 是原因。
    instagram_count: int | None = None
    instagram_error: str | None = None


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


async def _record_instagram(
    db: AsyncSession, campus_key: str, page_id: str, now: datetime, *, count: int | None, error: str | None
) -> None:
    """只寫 ig_ 欄位。Facebook 那一段已先寫好這一列；萬一還沒有（理論上不會）就用 page_id 補一列。"""
    values: dict = {"ig_last_attempt_at": now, "ig_last_error": error}
    if error is None:
        values |= {"ig_last_success_at": now, "ig_last_count": count}
    await db.execute(
        insert(FacebookPageSync)
        .values(campus_key=campus_key, page_id=page_id, **values)
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
            .values(campus_key=campus_key, post_id=post.post_id, posted_at=post.posted_at, source=post.source, **content)
            # 同一則貼文換了粉專設定（理論上不會）也不搬校區、不改來源；處理狀態永遠不由同步改。
            .on_conflict_do_update(index_elements=[FacebookPagePost.post_id], set_=content)
        )


async def _sync_instagram(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    client: httpx.AsyncClient,
    result: PageSyncResult,
    page_id: str,
    token: str,
) -> None:
    """這一校的 Instagram 貼文。任何失敗都只記在 result 與 ig_ 欄位，不往外丟：
    Facebook 的結果與其他校不受影響。例外只記型別名稱（內容可能帶 token）。"""
    campus_key = result.campus_key
    posts: list[graph.GraphPost] = []
    count: int | None = None
    error: str | None = None
    try:
        account_id = await graph.instagram_account(client, settings, page_id, token)
        if account_id is None:
            error = NO_INSTAGRAM_ACCOUNT
        else:
            posts = await graph.instagram_media(client, settings, account_id, token)
            count = len(posts)
    except graph.GraphError as exc:
        error = NO_INSTAGRAM_PERMISSION if exc.code in graph.PERMISSION_ERROR_CODES else str(exc)[:200]
    except Exception as exc:  # noqa: BLE001 - 解析等意外不能拖垮 Facebook 與其他校
        error = INSTAGRAM_UNEXPECTED
        logger.error("Instagram 同步 %s 發生未預期的錯誤（%s）", campus_key, type(exc).__name__)
    now = datetime.now(timezone.utc)
    async with session_factory() as db:
        if error is None:
            await _write_posts(db, campus_key, posts, now)
        await _record_instagram(db, campus_key, page_id, now, count=count, error=error)
        await db.commit()
    result.instagram_count, result.instagram_error = count, error
    if error:
        logger.warning("Instagram 同步 %s 失敗：%s", campus_key, error)


async def sync_pages(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    *,
    campus_keys: list[str] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[PageSyncResult]:
    """同步設定裡的粉專（campus_keys 有給就只同步那幾校）。一校失敗不影響其他校；
    設定裡寫了不存在的校區代號就略過並記警告。WEBSITE_INSTAGRAM_ENABLED 開著時，
    每校 Facebook 寫完之後接著同步 Instagram（有拿到粉專權杖才做）。"""
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
            token: str | None = None
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
            # 粉專貼文讀不到（例如缺 pages_read_engagement）不代表 Instagram 讀不到；
            # 但連粉專權杖都沒拿到就沒有可用的 token，這一校略過。
            if settings.instagram_sync_enabled and token is not None:
                await _sync_instagram(session_factory, settings, client, result, page_id, token)
            results.append(result)
    return results
