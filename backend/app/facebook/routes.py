"""後台「Facebook 貼文」收件匣（docs/specs/2026-10-28-facebook-news-sync-design.md §5）。"""

from __future__ import annotations

import copy
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, require_scope
from app.content import service as content_service
from app.content.models import ContentRevision
from app.content.registry import CONTENT_KIND_REGISTRY
# 存草稿要過跟後台編輯器一樣的驗證、素材引用檢查與樂觀鎖，不另寫一份。
from app.content.routes import _save_draft
from app.content.schemas import CAMPUS_NEWS_MAX_ARTICLES
from app.facebook import graph
from app.facebook.models import FacebookPagePost, FacebookPageSync
from app.facebook.schemas import (
    FacebookImportOut,
    FacebookPostCounts,
    FacebookPostListOut,
    FacebookPostOut,
    FacebookSyncIn,
    FacebookSyncStatusOut,
    PostStatus,
)
from app.facebook.service import build_article
from app.facebook.sync import sync_pages
from app.media import service as media_service
from app.media.models import MediaKind, MediaVariant
from app.media.validation import MediaValidationError
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["facebook-posts"])

KIND = "campus_news"
LIST_LIMIT = 100


def _error(code: int, error_code: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": error_code, "message": message})


def _post_out(post: FacebookPagePost) -> FacebookPostOut:
    return FacebookPostOut(
        id=post.id,
        campus_key=post.campus_key,
        message=post.message,
        posted_at=post.posted_at,
        permalink_url=post.permalink_url,
        has_picture=bool(post.picture_url),
        has_video=bool(post.video_url),
        status=post.status,  # type: ignore[arg-type]
        article_id=post.article_id,
        handled_at=post.handled_at,
    )


async def _owned_post(
    db: AsyncSession, user: User, post_id: uuid.UUID, capability: str, *, lock: bool = False
) -> FacebookPagePost:
    query = select(FacebookPagePost).where(FacebookPagePost.id == post_id)
    if lock:
        query = query.with_for_update()
    post = await db.scalar(query)
    if post is None:
        raise ScopeDenied()
    require_scope(user, capability, campus_keys=[post.campus_key])
    return post


def _transport(request: Request):
    # 測試注入 httpx.MockTransport；正式站是 None（真的連 Meta）。
    return getattr(request.app.state, "facebook_transport", None)


async def _list_out(db: AsyncSession, request: Request, campus_key: str, status_filter: PostStatus) -> FacebookPostListOut:
    settings = request.app.state.settings
    configured = settings.facebook_enabled and campus_key in settings.facebook_page_ids
    sync_row = await db.get(FacebookPageSync, campus_key)
    counts = dict(
        (await db.execute(
            select(FacebookPagePost.status, func.count())
            .where(FacebookPagePost.campus_key == campus_key)
            .group_by(FacebookPagePost.status)
        )).all()
    )
    posts = await db.scalars(
        select(FacebookPagePost)
        .where(FacebookPagePost.campus_key == campus_key, FacebookPagePost.status == status_filter)
        .order_by(FacebookPagePost.posted_at.desc())
        .limit(LIST_LIMIT)
    )
    return FacebookPostListOut(
        configured=configured,
        sync_seconds=settings.facebook_sync_seconds,
        sync=FacebookSyncStatusOut(
            last_attempt_at=sync_row.last_attempt_at,
            last_success_at=sync_row.last_success_at,
            last_error=sync_row.last_error,
            last_count=sync_row.last_count,
        ) if sync_row else None,
        counts=FacebookPostCounts(**counts),
        posts=[_post_out(post) for post in posts],
    )


@router.get("/admin/facebook-posts", response_model=FacebookPostListOut)
async def list_facebook_posts(
    request: Request,
    campus_key: str = Query(min_length=1, max_length=32),
    status_filter: PostStatus = Query(default="new", alias="status"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> FacebookPostListOut:
    """這校粉專同步進來的貼文（新到舊，最多 100 則）與同步狀態。"""
    require_scope(current_user, "content.read", campus_keys=[campus_key])
    return await _list_out(db, request, campus_key, status_filter)


@router.post("/admin/facebook-posts/sync", response_model=FacebookPostListOut)
async def sync_facebook_posts(
    payload: FacebookSyncIn,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> FacebookPostListOut:
    """立即同步這一校（不等每小時的自動同步）。失敗寫在回應的 sync.last_error，不回錯誤碼。"""
    require_scope(current_user, "content.manage", campus_keys=[payload.campus_key])
    settings = request.app.state.settings
    if not (settings.facebook_enabled and payload.campus_key in settings.facebook_page_ids):
        raise _error(status.HTTP_409_CONFLICT, "FACEBOOK_NOT_CONFIGURED", "這校還沒接上 Facebook 粉專")
    results = await sync_pages(
        request.app.state.session_factory, settings, campus_keys=[payload.campus_key], transport=_transport(request)
    )
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="facebook_posts.sync",
        target_type="facebook_page",
        target_id=payload.campus_key,
        campus_key=payload.campus_key,
        metadata={
            "synced_posts": results[0].count if results else 0,
            "sync_failed": not results or results[0].error is not None,
        },
    )
    await db.commit()
    return await _list_out(db, request, payload.campus_key, "new")


@router.get("/admin/facebook-posts/{post_id}/picture")
async def facebook_post_picture(
    post_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """貼文照片經 API 轉給後台：員工瀏覽器不直接連 Meta，後台 CSP 也不用開 fbcdn。"""
    post = await _owned_post(db, current_user, post_id, "content.read")
    if not post.picture_url:
        raise _error(status.HTTP_404_NOT_FOUND, "FACEBOOK_POST_NO_PICTURE", "這則貼文沒有照片")
    url = post.picture_url
    async with graph.new_client(_transport(request)) as client:
        try:
            content, content_type = await graph.download_picture(
                client, url, request.app.state.settings.media_max_bytes("image")
            )
        except graph.DownloadError as exc:
            raise _error(status.HTTP_404_NOT_FOUND, exc.code, exc.message) from None
    return Response(
        content,
        media_type=content_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
        },
    )


async def _set_status(db: AsyncSession, post: FacebookPagePost, new_status: str, action: str, user: User) -> None:
    post.status = new_status
    post.handled_by = user.id
    post.handled_at = datetime.now(timezone.utc)
    await audit_service.log_action(
        db,
        actor_user_id=user.id,
        action=action,
        target_type="facebook_post",
        target_id=str(post.id),
        campus_key=post.campus_key,
    )
    await db.commit()


@router.post("/admin/facebook-posts/{post_id}/dismiss", response_model=FacebookPostOut)
async def dismiss_facebook_post(
    post_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> FacebookPostOut:
    """不轉成消息，收到「略過」；隨時可以放回。"""
    post = await _owned_post(db, current_user, post_id, "content.manage", lock=True)
    if post.status != "new":
        raise _error(status.HTTP_409_CONFLICT, "FACEBOOK_POST_STATUS", "這則貼文已經處理過了，請重新整理")
    await _set_status(db, post, "dismissed", "facebook_post.dismiss", current_user)
    return _post_out(post)


@router.post("/admin/facebook-posts/{post_id}/restore", response_model=FacebookPostOut)
async def restore_facebook_post(
    post_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> FacebookPostOut:
    post = await _owned_post(db, current_user, post_id, "content.manage", lock=True)
    if post.status != "dismissed":
        raise _error(status.HTTP_409_CONFLICT, "FACEBOOK_POST_STATUS", "這則貼文不在略過清單裡，請重新整理")
    await _set_status(db, post, "new", "facebook_post.restore", current_user)
    return _post_out(post)


async def _store_picture(db: AsyncSession, request: Request, user: User, campus_key: str, content: bytes, content_type: str):
    """照片進該校素材庫；回 (素材, 這次新寫的檔案 key)。素材庫已有同一張就沿用，不新寫檔。"""
    settings = request.app.state.settings
    storage = media_service.get_storage(settings)
    suffix = {"image/png": ".png", "image/webp": ".webp"}.get(content_type, ".jpg")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        handle.write(content)
        path = Path(handle.name)
    try:
        existing = await media_service.find_by_sha256(
            db, await media_service.stored_sha256(path, MediaKind.IMAGE), campus_key
        )
        if existing is not None:
            return existing, []
        try:
            asset = await media_service.create_media_asset(
                db,
                storage,
                source_path=path,
                declared_kind=MediaKind.IMAGE,
                original_filename=f"facebook{suffix}",
                campus_key=campus_key,
                created_by=user.id,
                source_attribution="Facebook 粉專貼文",
                quota_bytes=settings.media_quota_bytes_per_campus,
            )
        except media_service.MediaQuotaExceeded:
            await db.rollback()
            raise _error(status.HTTP_409_CONFLICT, "MEDIA_QUOTA_EXCEEDED", "這校的素材空間已滿") from None
        except media_service.MediaBusy:
            await db.rollback()
            raise _error(status.HTTP_409_CONFLICT, "MEDIA_BUSY", "素材庫正忙，請稍後再試") from None
        except MediaValidationError as exc:
            await db.rollback()
            raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, exc.code, exc.message) from None
    finally:
        path.unlink(missing_ok=True)
    keys = [
        asset.storage_key,
        *(await db.scalars(select(MediaVariant.storage_key).where(MediaVariant.media_id == asset.id))),
    ]
    if asset.status.value != "ready":
        await db.rollback()
        await media_service.delete_stored_files(storage, keys)
        raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "MEDIA_PROCESSING_FAILED", asset.processing_error or "照片處理失敗")
    return asset, keys


# 這幾種影片下載失敗重試也不會好：不擋轉換，只是不帶影片（原因告訴使用者）。
_VIDEO_SKIPPED = ("FACEBOOK_VIDEO_TOO_LARGE", "FACEBOOK_VIDEO_UNSUPPORTED", "FACEBOOK_VIDEO_UNTRUSTED")


async def _fetch_video(client, url: str, max_bytes: int) -> tuple[Path | None, str | None]:
    """影片下載到暫存檔，回 (路徑, 沒帶影片的原因)；呼叫端負責刪暫存檔。
    檔案太大、格式不收、不在 FB CDN 上不擋轉換；連結過期與下載失敗才回錯誤請使用者再試。"""
    fd, name = tempfile.mkstemp(prefix="facebook-video-", suffix=".mp4")
    os.close(fd)
    path = Path(name)
    try:
        await graph.download_video(client, url, max_bytes, path)
    except graph.DownloadError as exc:
        path.unlink(missing_ok=True)
        if exc.code == "FACEBOOK_VIDEO_TOO_LARGE":
            return None, f"影片超過 {max_bytes // (1024 * 1024)} MB"
        if exc.code in _VIDEO_SKIPPED:
            return None, exc.message
        code = status.HTTP_409_CONFLICT if exc.code == "FACEBOOK_VIDEO_EXPIRED" else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise _error(code, exc.code, exc.message) from None
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path, None


async def _store_video(db: AsyncSession, request: Request, user: User, campus_key: str, path: Path):
    """影片進該校素材庫；回 (素材, 這次新寫的檔案 key, 沒帶影片的原因)。影片本身不合素材庫的
    規定（太長、不是標準 MP4）一樣不擋轉換。轉檔照一般上傳排背景工作，素材回來時可能還在處理中；
    發布前的檢查會等它處理完（content.publish_jobs 的 MEDIA_NOT_READY）。"""
    settings = request.app.state.settings
    try:
        # savepoint：影片這一步失敗只退掉影片，前面已經建好的封面照片素材留著。
        async with db.begin_nested():
            asset = await media_service.create_media_asset(
                db,
                media_service.get_storage(settings),
                source_path=path,
                declared_kind=MediaKind.VIDEO,
                original_filename="facebook.mp4",
                campus_key=campus_key,
                created_by=user.id,
                source_attribution="Facebook 粉專貼文",
                quota_bytes=settings.media_quota_bytes_per_campus,
                video_processing=settings.media_video_processing_mode,
            )
    except media_service.MediaQuotaExceeded:
        raise _error(status.HTTP_409_CONFLICT, "MEDIA_QUOTA_EXCEEDED", "這校的素材空間已滿") from None
    except media_service.MediaBusy:
        raise _error(status.HTTP_409_CONFLICT, "MEDIA_BUSY", "素材庫正忙，請稍後再試") from None
    except MediaValidationError as exc:
        return None, [], exc.message
    keys = [
        asset.storage_key,
        *(await db.scalars(select(MediaVariant.storage_key).where(MediaVariant.media_id == asset.id))),
    ]
    return asset, keys, None


@router.post("/admin/facebook-posts/{post_id}/import", response_model=FacebookImportOut)
async def import_facebook_post(
    post_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> FacebookImportOut:
    """照片（影片貼文再加影片）進該校素材庫，在該校消息草稿最上面加一則；之後照原本的送審與發布。"""
    post = await _owned_post(db, current_user, post_id, "content.manage")
    require_scope(current_user, "media.manage", campus_keys=[post.campus_key])
    if post.status == "imported":
        raise _error(status.HTTP_409_CONFLICT, "FACEBOOK_POST_STATUS", "這則貼文已經轉成消息了")
    if not post.picture_url:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "FACEBOOK_POST_NO_PICTURE", "這則貼文沒有照片，消息一定要有一張照片"
        )
    picture_url, video_url = post.picture_url, post.video_url
    settings = request.app.state.settings
    video_path: Path | None = None
    video_skipped: str | None = None
    # 先下載（這時還沒鎖任何列）再鎖貼文、寫入：Meta 慢的時候不卡住別人。
    async with graph.new_client(_transport(request)) as client:
        try:
            content, content_type = await graph.download_picture(client, picture_url, settings.media_max_bytes("image"))
        except graph.DownloadError as exc:
            code = status.HTTP_409_CONFLICT if exc.code == "FACEBOOK_PICTURE_EXPIRED" else status.HTTP_422_UNPROCESSABLE_ENTITY
            raise _error(code, exc.code, exc.message) from None
        if video_url:
            video_path, video_skipped = await _fetch_video(client, video_url, settings.media_max_bytes("video"))

    storage = media_service.get_storage(settings)
    new_keys: list[str] = []
    try:
        post = await _owned_post(db, current_user, post_id, "content.manage", lock=True)
        if post.status == "imported":
            raise _error(status.HTTP_409_CONFLICT, "FACEBOOK_POST_STATUS", "這則貼文已經轉成消息了")
        campus_key = post.campus_key
        asset, new_keys = await _store_picture(db, request, current_user, campus_key, content, content_type)
        video_asset = None
        if video_path is not None:
            video_asset, video_keys, video_skipped = await _store_video(db, request, current_user, campus_key, video_path)
            new_keys = [*new_keys, *video_keys]
        article = build_article(post, str(asset.id), str(video_asset.id) if video_asset else None)
        item = await content_service.get_or_create_content_item(db, KIND, campus_key)
        latest = None
        if item.latest_version > 0:
            latest = await db.scalar(
                select(ContentRevision).where(
                    ContentRevision.content_item_id == item.id, ContentRevision.version == item.latest_version
                )
            )
        payload = copy.deepcopy(latest.payload) if latest else {"articles": [], "events": []}
        articles = payload.setdefault("articles", [])
        if any(entry.get("id") == article["id"] for entry in articles):
            raise _error(status.HTTP_409_CONFLICT, "FACEBOOK_POST_STATUS", "這則貼文已經在消息草稿裡了")
        if len(articles) >= CAMPUS_NEWS_MAX_ARTICLES:
            raise _error(
                status.HTTP_409_CONFLICT,
                "FACEBOOK_NEWS_FULL",
                f"這校的消息已經有 {CAMPUS_NEWS_MAX_ARTICLES} 則，請先到「各校消息與活動」移除舊的",
            )
        articles.insert(0, article)
        revision = await _save_draft(
            db, CONTENT_KIND_REGISTRY[KIND], KIND, item, payload, item.latest_version, current_user
        )
        post.status = "imported"
        post.article_id = article["id"]
        post.media_id = asset.id
        post.video_media_id = video_asset.id if video_asset else None
        post.handled_by = current_user.id
        post.handled_at = datetime.now(timezone.utc)
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="facebook_post.import",
            target_type="facebook_post",
            target_id=str(post.id),
            campus_key=campus_key,
            metadata={
                "article_id": article["id"],
                "media_id": str(asset.id),
                "video_media_id": str(video_asset.id) if video_asset else None,
                "content_version": revision.version,
            },
        )
        await db.commit()
    except BaseException:
        # 素材檔已寫進儲存空間：沒提交成功就刪掉，不留孤兒檔（沿用的舊素材不刪）。
        await db.rollback()
        await media_service.delete_stored_files(storage, new_keys)
        raise
    finally:
        if video_path is not None:
            video_path.unlink(missing_ok=True)
    return FacebookImportOut(
        post=_post_out(post),
        article_id=article["id"],
        article_title=article["title"],
        content_version=revision.version,
        video_included=video_asset is not None,
        video_skipped_reason=video_skipped,
    )
