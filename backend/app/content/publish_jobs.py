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
    """發布前檢查不通過。code 是 API 的錯誤碼：素材未就緒、分校停用、欄位
    格式過時各有自己的代碼，內容規則（例如示範同意文字）才是
    CONTENT_NOT_READY。"""

    def __init__(self, message: str, code: str = "CONTENT_NOT_READY") -> None:
        self.message = message
        self.code = code
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
        raise NotPublishable("未知的內容種類", "CONTENT_KIND_UNKNOWN")
    if validate_schema:
        try:
            config.payload_model.model_validate(revision.payload)
        except ValidationError as exc:
            raise NotPublishable(
                "這一版的欄位格式已經過時，請到編輯頁手動修改後再發布", "CONTENT_SCHEMA_OUTDATED"
            ) from exc
    blocker = config.publish_blocker(revision.payload)
    if blocker:
        raise NotPublishable(blocker)
    if require_active_campus and item.campus_key is not None:
        campus = await db.get(Campus, item.campus_key, populate_existing=True)
        if campus is None or not campus.active:
            raise NotPublishable("分校已停用，內容不會發布", "CAMPUS_INACTIVE")
    media_ids = config.extract_media_ids(revision.payload)
    if media_ids:
        result = await db.execute(
            select(MediaAsset.id, MediaAsset.status, MediaAsset.deleted_at).where(MediaAsset.id.in_(media_ids))
        )
        found = {row.id: row for row in result.all()}
        for media_id in media_ids:
            row = found.get(media_id)
            if row is None or row.status != MediaStatus.READY:
                raise NotPublishable("引用的素材還沒處理完成或已被刪除", "MEDIA_NOT_READY")
            # 待清理的素材公開路由一律 404：發布出去官網就破圖，到期還會被刪檔。
            if row.deleted_at is not None:
                raise NotPublishable("引用的素材已刪除（待清理），請到素材庫復原或換一個素材", "MEDIA_NOT_READY")


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


# 到期了但沒有發布：failed＝檢查不過，skipped＝官網已經是同一版或較新的版本。
UNPUBLISHED_STATUSES = ("failed", "skipped")


async def live_version(db: AsyncSession, item: ContentItem) -> int | None:
    """官網上這項內容目前是第幾版；從來沒發布過是 None。"""
    if item.current_published_revision_id is None:
        return None
    live = await db.get(ContentRevision, item.current_published_revision_id)
    return live.version if live is not None else None


async def skip_reason(db: AsyncSession, item: ContentItem, revision: ContentRevision, job: PublishJob) -> str | None:
    """到期時不照排程發布的原因；None 代表可以發布。呼叫端要先拿 lock_site_state，
    讀到的才是別人發布完成之後的官網。

    排程綁的是明確的一版（規格 L156）。到期時如果有人另外發布過同一版或更新
    的內容（包含還原舊內容，還原會存成新的一版），照排程發布就會蓋掉別人
    後來的決定，所以不發布。官網現在的版本本身就比排程版本新也一樣。"""
    live = await live_version(db, item)
    since = await db.execute(
        select(func.max(ContentRevision.version))
        .select_from(SiteReleaseEntry)
        .join(SiteRelease, SiteRelease.id == SiteReleaseEntry.release_id)
        .join(ContentRevision, ContentRevision.id == SiteReleaseEntry.revision_id)
        .where(SiteReleaseEntry.content_item_id == item.id, SiteRelease.created_at > job.created_at)
    )
    newest = max((v for v in (live, since.scalar_one_or_none()) if v is not None), default=None)
    if newest is None or newest < revision.version:
        return None
    if live == revision.version:
        return "官網已經是這一版，不需要再發布"
    if newest == revision.version:
        # 排好之後有人直接發布過這一版，之後又換掉（例如整站還原）：官網現在
        # 不是這一版，原因不能寫成「已經是這一版」。
        now_live = f"第 {live} 版" if live is not None else "其他內容"
        return f"排好之後官網發布過第 {revision.version} 版，之後又換成{now_live}，不會自動蓋回去"
    return f"排好之後官網已經發布過較新的第 {newest} 版，不會把第 {revision.version} 版蓋回去"


def is_resolved(job: PublishJob, item: ContentItem) -> bool:
    """沒有發布的排程（failed／skipped）已經有人處理：按了「知道了」，或官網
    上這項內容在排程結束之後換過版本。編輯頁的提示與總覽的待辦用同一個
    定義（總覽用 unresolved_condition）。"""
    if job.status not in UNPUBLISHED_STATUSES:
        return False
    if job.acknowledged_at is not None:
        return True
    return item.published_at is not None and job.finished_at is not None and item.published_at >= job.finished_at


def unresolved_condition():
    """is_resolved 的反面，給 SQL 用（要和 ContentItem join）。"""
    return (
        PublishJob.status.in_(UNPUBLISHED_STATUSES)
        & PublishJob.acknowledged_at.is_(None)
        & (
            ContentItem.published_at.is_(None)
            | PublishJob.finished_at.is_(None)
            | (ContentItem.published_at < PublishJob.finished_at)
        )
    )


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
    # 先鎖官網再讀這項內容現在是哪一版：手動發布、核准、整站還原都拿同一把
    # 鎖，這樣它們要嘛在這之前 commit（下面讀得到），要嘛等排程做完。先讀後
    # 鎖的話，讀完到 publish_revision 拿到鎖之間有人發布較新的一版，排程還是
    # 會把舊版蓋回官網。
    await service.lock_site_state(db)
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
        reason = await skip_reason(db, item, revision, job)
        if reason is not None:
            await _finish_unpublished(db, job, item, revision, status="skipped", message=reason, now=now)
            return "skipped"
    try:
        if item is None or revision is None:
            raise NotPublishable("內容或版本已不存在", "CONTENT_NOT_FOUND")
        if not user_can_publish(creator, item):
            raise NotPublishable("排程的人已沒有發布權限", "PUBLISHER_NOT_ALLOWED")
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
