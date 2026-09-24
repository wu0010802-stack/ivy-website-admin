"""排程發布的背景執行（規格 4）。由 `python -m app.cli process-notifications`
（生產以 cron 定期呼叫）每輪先跑一次。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import User
from app.auth.permissions import can_publish_shared_content, covers_campus, has_capability
from app.campuses.models import Campus
from app.content import service
from app.content.models import ContentItem, ContentRevision, PublishJob
from app.content.registry import CONTENT_KIND_REGISTRY
from app.media.models import MediaAsset, MediaStatus
from app.operations import audit_service


class NotPublishable(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def user_can_publish(user: User | None, item: ContentItem) -> bool:
    if user is None or not user.is_active:
        return False
    if item.campus_key is None:
        return can_publish_shared_content(user)
    if not has_capability(user, "content.publish"):
        return False
    return covers_campus(user, item.campus_key)


async def check_publishable(db: AsyncSession, item: ContentItem, revision: ContentRevision) -> None:
    """發布前（立即、核准、排程到期）共用的檢查：內容規則、分校仍啟用、
    引用的素材都已處理完成。"""
    config = CONTENT_KIND_REGISTRY.get(item.kind)
    if config is None:
        raise NotPublishable("未知的內容種類")
    blocker = config.publish_blocker(revision.payload)
    if blocker:
        raise NotPublishable(blocker)
    if item.campus_key is not None:
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
    done = failed = 0
    for job_id in job_ids:
        ok = await _run_one(db, job_id)
        if ok is None:
            continue
        done += int(ok)
        failed += int(not ok)
    return {"published": done, "failed": failed}


async def _run_one(db: AsyncSession, job_id: uuid.UUID) -> bool | None:
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
    try:
        if item is None or revision is None:
            raise NotPublishable("內容或版本已不存在")
        if not user_can_publish(creator, item):
            raise NotPublishable("排程的人已沒有發布權限")
        await check_publishable(db, item, revision)
        await service.publish_revision(db, item, revision, job.created_by)
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
        return True
    except NotPublishable as exc:
        job.status = "failed"
        job.error = exc.message[:500]
        job.finished_at = now
        await db.commit()
        return False
