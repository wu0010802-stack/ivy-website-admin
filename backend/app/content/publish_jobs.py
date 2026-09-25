"""排程發布的背景執行（規格 4）。由 API 內建的定期工作每輪先跑一次
（app/workers/maintenance.py；手動補跑用 `python -m app.cli process-notifications`）。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import User
from app.campuses.models import Campus
from app.content import notices, service
from app.content.models import ContentItem, ContentRevision, PublishJob, ReleaseSource, SiteRelease, SiteReleaseEntry
from app.content.notices import user_can_publish  # noqa: F401 - 路由與舊呼叫端從這裡取用
from app.content.registry import CONTENT_KIND_REGISTRY
from app.media.models import MediaAsset, MediaStatus
from app.operations import audit_service


class NotPublishable(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


async def check_publishable(
    db: AsyncSession,
    item: ContentItem,
    revision: ContentRevision,
    *,
    require_active_campus: bool = True,
    validate_schema: bool = False,
) -> None:
    """發布前（立即、核准、排程到期、整站還原）共用的檢查：內容規則、分校仍
    啟用、引用的素材都已處理完成。整站還原另外用目前的欄位規則重驗舊版本，
    分校停用中的內容照樣換回舊版（官網本來就不顯示停用的分校）。"""
    config = CONTENT_KIND_REGISTRY.get(item.kind)
    if config is None:
        raise NotPublishable("未知的內容種類")
    if validate_schema:
        try:
            config.payload_model.model_validate(revision.payload)
        except ValidationError as exc:
            raise NotPublishable("這一版的欄位格式已經過時，請到編輯頁手動修改後再發布") from exc
    blocker = config.publish_blocker(revision.payload)
    if blocker:
        raise NotPublishable(blocker)
    if require_active_campus and item.campus_key is not None:
        campus = await db.get(Campus, item.campus_key, populate_existing=True)
        if campus is None or not campus.active:
            raise NotPublishable("分校已停用，內容不會發布")
    media_ids = config.extract_media_ids(revision.payload)
    if media_ids:
        result = await db.execute(select(MediaAsset.id, MediaAsset.status).where(MediaAsset.id.in_(media_ids)))
        found = dict(result.all())
        for media_id in media_ids:
            if found.get(media_id) != MediaStatus.READY:
                raise NotPublishable("引用的素材還沒處理完成或已被刪除")


async def run_due_jobs(db: AsyncSession, *, limit: int = 20) -> dict:
    """到期的排程逐筆處理，每筆自己一個交易：一筆失敗不影響其他筆。"""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(PublishJob.id)
        .where(PublishJob.status == "scheduled", PublishJob.publish_at <= now)
        .order_by(PublishJob.publish_at)
        .limit(limit)
    )
    job_ids = [row[0] for row in result.all()]
    counts = {"published": 0, "failed": 0, "skipped": 0}
    for job_id in job_ids:
        outcome = await _run_one(db, job_id)
        if outcome is not None:
            counts[outcome] += 1
    return counts


async def newer_version_since(db: AsyncSession, item: ContentItem, job: PublishJob) -> int | None:
    """排好之後官網已經是、或曾經換成比排程版本新的版本時，回傳那個版本號。

    排程綁的是明確的一版（規格 L156）。到期時如果有人另外發布過更新的內容
    （包含還原舊內容，還原會存成新的一版），照排程發布就會把官網退回舊內容，
    所以不發布。官網現在的版本本身就比排程版本新也一樣。"""
    candidates = []
    if item.current_published_revision_id is not None:
        live = await db.get(ContentRevision, item.current_published_revision_id)
        if live is not None:
            candidates.append(live.version)
    since = await db.execute(
        select(func.max(ContentRevision.version))
        .select_from(SiteReleaseEntry)
        .join(SiteRelease, SiteRelease.id == SiteReleaseEntry.release_id)
        .join(ContentRevision, ContentRevision.id == SiteReleaseEntry.revision_id)
        .where(SiteReleaseEntry.content_item_id == item.id, SiteRelease.created_at > job.created_at)
    )
    newest_since = since.scalar_one_or_none()
    if newest_since is not None:
        candidates.append(newest_since)
    return max(candidates) if candidates else None


async def _finish_unpublished(
    db: AsyncSession, job: PublishJob, item: ContentItem | None, revision: ContentRevision | None,
    *, status: str, message: str, now: datetime,
) -> None:
    job.status = status
    job.error = message[:500]
    job.finished_at = now
    if item is not None:
        # 排程的人要知道這次沒有發布；總覽另外列出還沒處理的失敗。
        await notices.notify(
            db,
            [job.created_by],
            notices.SCHEDULE_SKIPPED if status == "skipped" else notices.SCHEDULE_FAILED,
            item,
            revision_version=revision.version if revision else None,
            publish_at=job.publish_at.isoformat(),
            job_id=str(job.id),
            error=job.error,
        )
        await audit_service.log_action(
            db,
            actor_user_id=None,
            action="content.schedule_skipped" if status == "skipped" else "content.schedule_failed",
            target_type="content_item",
            target_id=str(item.id),
            campus_key=item.campus_key,
            metadata={
                "kind": item.kind,
                "revision_version": revision.version if revision else None,
                "job_id": str(job.id),
                "error": job.error,
            },
        )
    await db.commit()


async def _run_one(db: AsyncSession, job_id: uuid.UUID) -> str | None:
    locked = await db.execute(
        select(PublishJob).where(PublishJob.id == job_id).with_for_update(skip_locked=True)
    )
    job = locked.scalar_one_or_none()
    if job is None or job.status != "scheduled":
        await db.rollback()
        return None
    item = await db.get(ContentItem, job.content_item_id, populate_existing=True)
    revision = await db.get(ContentRevision, job.revision_id, populate_existing=True)
    creator = None
    if job.created_by is not None:
        # populate_existing：同一個 session 之前載入過這個人時，不能沿用舊的
        # is_active／校區範圍——這裡就是要確認「現在」還有沒有權限。
        res = await db.execute(
            select(User)
            .options(selectinload(User.campus_scopes))
            .where(User.id == job.created_by)
            .execution_options(populate_existing=True)
        )
        creator = res.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if item is not None and revision is not None:
        newer = await newer_version_since(db, item, job)
        if newer is not None and newer >= revision.version:
            message = (
                "官網已經是這一版，不需要再發布"
                if newer == revision.version
                else f"排好之後官網已經發布過較新的第 {newer} 版，不會把第 {revision.version} 版蓋回去"
            )
            await _finish_unpublished(db, job, item, revision, status="skipped", message=message, now=now)
            return "skipped"
    try:
        if item is None or revision is None:
            raise NotPublishable("內容或版本已不存在")
        if not user_can_publish(creator, item):
            raise NotPublishable("排程的人已沒有發布權限")
        await check_publishable(db, item, revision)
        await service.publish_revision(db, item, revision, job.created_by, source=ReleaseSource.SCHEDULED)
        job.status = "done"
        job.finished_at = now
        await audit_service.log_action(
            db,
            actor_user_id=job.created_by,
            action="content.publish_scheduled",
            target_type="content_item",
            target_id=str(item.id),
            campus_key=item.campus_key,
            metadata={"kind": item.kind, "revision_version": revision.version, "job_id": str(job.id)},
        )
        await db.commit()
        return "published"
    except NotPublishable as exc:
        await _finish_unpublished(db, job, item, revision, status="failed", message=exc.message, now=now)
        return "failed"
