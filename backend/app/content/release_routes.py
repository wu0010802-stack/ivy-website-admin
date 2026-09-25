"""全站發布紀錄、整站還原與全站排程清單（規格 L85、L155、L156、L323）。

單一內容的版本紀錄與還原在 content/routes.py；這裡看的是「官網」這一層：
哪一天誰發布了什麼、一次把整站換回某次發布的樣子、所有還沒到期的排程。"""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import campus_scope, require_scope
from app.content import notices, publish_jobs, service
from app.content.models import ContentItem, ContentRevision, PublishJob, SiteRelease, SiteReleaseEntry, SiteState
from app.content.schemas import (
    PublishJobListOut,
    ReleaseChangeOut,
    ReleaseOut,
    ReleasePageOut,
    ReleaseRestoreOut,
    ReleaseRestoreRequest,
)
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["content"])

# 已結束（發布、失敗、略過、取消）的排程只列最近這麼多筆；還沒到期的全部列。
FINISHED_JOBS_LIMIT = 50


def _visible_condition(user: User):
    """共用內容所有能讀內容的人都看得到；分校內容只看自己校區範圍內的。"""
    scope = campus_scope(user)
    if scope is None:
        return None
    return ContentItem.campus_key.is_(None) | ContentItem.campus_key.in_(scope)


def _visible(user: User, campus_key: str | None) -> bool:
    scope = campus_scope(user)
    return scope is None or campus_key is None or campus_key in scope


@router.get("/admin/publish-jobs", response_model=list[PublishJobListOut])
async def list_publish_jobs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[PublishJobListOut]:
    """全站排程：還沒到期的依時間先後全部列出，已結束的列最近 50 筆（新的在前）。"""
    require_scope(current_user, "content.read")
    base = (
        select(PublishJob, ContentItem, ContentRevision.version, User.email)
        .join(ContentItem, ContentItem.id == PublishJob.content_item_id)
        .join(ContentRevision, ContentRevision.id == PublishJob.revision_id)
        .outerjoin(User, User.id == PublishJob.created_by)
    )
    condition = _visible_condition(current_user)
    if condition is not None:
        base = base.where(condition)
    upcoming = await db.execute(
        base.where(PublishJob.status == "scheduled").order_by(PublishJob.publish_at, PublishJob.created_at)
    )
    finished = await db.execute(
        base.where(PublishJob.status != "scheduled")
        .order_by(func.coalesce(PublishJob.finished_at, PublishJob.publish_at).desc())
        .limit(FINISHED_JOBS_LIMIT)
    )
    return [
        PublishJobListOut(
            id=job.id,
            kind=item.kind,
            campus_key=item.campus_key,
            revision_id=job.revision_id,
            revision_version=version,
            publish_at=job.publish_at,
            status=job.status,
            error=job.error,
            created_by_email=email,
            created_at=job.created_at,
            finished_at=job.finished_at,
            can_cancel=job.status == "scheduled" and notices.user_can_publish(current_user, item),
        )
        for job, item, version, email in [*upcoming.all(), *finished.all()]
    ]


async def _release_page(
    db: AsyncSession, user: User, *, limit: int, before: datetime | None
) -> ReleasePageOut:
    stmt = (
        select(SiteRelease, User.email)
        .outerjoin(User, User.id == SiteRelease.created_by)
        .order_by(SiteRelease.created_at.desc(), SiteRelease.id.desc())
        .limit(limit + 1)
    )
    if before is not None:
        stmt = stmt.where(SiteRelease.created_at < before)
    rows = (await db.execute(stmt)).all()
    page, predecessor = rows[:limit], rows[limit:]
    release_ids = [release.id for release, _ in rows]

    entries: dict[uuid.UUID, dict[uuid.UUID, tuple]] = {rid: {} for rid in release_ids}
    if release_ids:
        result = await db.execute(
            select(
                SiteReleaseEntry.release_id,
                SiteReleaseEntry.content_item_id,
                SiteReleaseEntry.revision_id,
                ContentRevision.version,
                ContentItem.kind,
                ContentItem.campus_key,
            )
            .join(ContentRevision, ContentRevision.id == SiteReleaseEntry.revision_id)
            .join(ContentItem, ContentItem.id == SiteReleaseEntry.content_item_id)
            .where(SiteReleaseEntry.release_id.in_(release_ids))
        )
        for release_id, item_id, revision_id, version, kind, campus_key in result.all():
            entries[release_id][item_id] = (revision_id, version, kind, campus_key)

    state = await db.get(SiteState, 1)
    current_id = state.current_release_id if state else None
    scoped = campus_scope(user) is not None
    items: list[ReleaseOut] = []
    for index, (release, email) in enumerate(page):
        previous_id = rows[index + 1][0].id if index + 1 < len(rows) else None
        previous = entries.get(previous_id, {}) if previous_id else {}
        changes = [
            ReleaseChangeOut(
                content_item_id=item_id,
                kind=kind,
                campus_key=campus_key,
                revision_id=revision_id,
                revision_version=version,
                previous_revision_version=previous[item_id][1] if item_id in previous else None,
            )
            for item_id, (revision_id, version, kind, campus_key) in entries[release.id].items()
            if (previous.get(item_id) or (None,))[0] != revision_id and _visible(user, campus_key)
        ]
        # 分校帳號只看得到跟自己有關的發布；別校的發布整筆不列。
        if scoped and not changes:
            continue
        changes.sort(key=lambda c: (c.campus_key or "", c.kind))
        items.append(
            ReleaseOut(
                id=release.id,
                created_at=release.created_at,
                created_by_email=email,
                source=release.source,
                restored_from_release_id=release.restored_from_release_id,
                is_current=release.id == current_id,
                changes=changes,
            )
        )
    next_before = page[-1][0].created_at if predecessor else None
    return ReleasePageOut(items=items, next_before=next_before)


@router.get("/admin/releases", response_model=ReleasePageOut)
async def list_releases(
    limit: int = 30,
    before: datetime | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ReleasePageOut:
    """發布紀錄：每次官網內容切換一筆，新的在前，列出和前一次相比換掉了哪些內容。"""
    require_scope(current_user, "content.read")
    return await _release_page(db, current_user, limit=max(1, min(limit, 100)), before=before)


@router.post("/admin/releases/{release_id}/restore", response_model=ReleaseRestoreOut)
async def restore_release(
    release_id: uuid.UUID,
    payload: ReleaseRestoreRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ReleaseRestoreOut:
    """整站還原（限總管理者）：把官網每一項內容換回那次發布時的版本，存成一筆
    新的發布紀錄，原本的紀錄都保留。只動內容，不回復預約設定、時段、案件或
    通知；各內容的草稿也不動。"""
    require_scope(current_user, "content.release_restore")
    target = await db.get(SiteRelease, release_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這次發布")

    async def check(item: ContentItem, revision: ContentRevision) -> None:
        await publish_jobs.check_publishable(db, item, revision, require_active_campus=False, validate_schema=True)

    try:
        release, changed, kept = await service.restore_release(
            db,
            release_id,
            current_user.id,
            expected_current_release_id=payload.expected_current_release_id,
            check=check,
        )
    except service.ReleaseAlreadyCurrent as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "RELEASE_ALREADY_CURRENT", "message": "官網現在就是這次發布的內容"},
        ) from exc
    except service.ReleaseChanged as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "RELEASE_CHANGED", "message": "剛剛有人發布了新內容，請重新整理發布紀錄後再決定"},
        ) from exc
    except service.ReleaseNotRestorable as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "RELEASE_NOT_RESTORABLE",
                "message": "有些內容的舊版本現在不能發布，整站沒有變動",
                "items": exc.problems,
            },
        ) from exc

    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="release.restore",
        target_type="site_release",
        target_id=str(release.id),
        metadata={
            "restored_from_release_id": str(release_id),
            "changed": [
                {"kind": item.kind, "campus_key": item.campus_key, "revision_version": revision.version}
                for item, revision in changed
            ],
            "kept_count": kept,
        },
    )
    await db.commit()
    page = await _release_page(db, current_user, limit=1, before=None)
    return ReleaseRestoreOut(release=page.items[0], changed_count=len(changed), kept_count=kept)
