from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import Role, User
from app.auth.permissions import require_scope
from app.campuses.models import Campus
from app.operations import analytics_service, audit_service, dashboard_service, retention_service
from app.operations.models import SiteSettings

router = APIRouter(prefix="/api/website/v1", tags=["operations"])


class AnalyticsEventCreate(BaseModel):
    event_type: str
    campus_key: str | None = None


@router.post("/public/analytics-events", status_code=status.HTTP_204_NO_CONTENT)
async def create_analytics_event(
    payload: AnalyticsEventCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    if payload.campus_key:
        result = await db.execute(select(Campus).where(Campus.key == payload.campus_key))
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個校區")

    client_key = request.client.host if request.client else "unknown"
    try:
        await analytics_service.record_public_click(
            db, event_type=payload.event_type, campus_key=payload.campus_key, client_key=client_key
        )
    except analytics_service.EventTypeNotAllowed as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "EVENT_TYPE_NOT_ALLOWED", "message": "這個事件類型不能由公開端點回報"},
        ) from exc
    except analytics_service.RateLimited as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="請求太頻繁"
        ) from exc
    await db.commit()


@router.get("/admin/dashboard")
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    campus_keys = (
        None
        if current_user.role == Role.SUPER_ADMIN
        else [s.campus_key for s in current_user.campus_scopes]
    )
    return await dashboard_service.get_dashboard_summary(db, campus_keys)


@router.get("/admin/analytics/funnel")
async def get_analytics_funnel(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    require_scope(current_user, "booking.read", campus_keys=[campus_key])
    return await analytics_service.get_campus_funnel_counts(db, campus_key)


@router.get("/admin/audit-log")
async def get_audit_log(
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    if campus_key:
        require_scope(current_user, "booking.read", campus_keys=[campus_key])
    elif current_user.role != Role.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="沒有權限執行此操作")
    entries = await audit_service.list_recent(db, campus_key)
    return [
        {
            "id": str(e.id),
            "actor_user_id": str(e.actor_user_id) if e.actor_user_id else None,
            "action": e.action,
            "target_type": e.target_type,
            "target_id": e.target_id,
            "campus_key": e.campus_key,
            "metadata": e.metadata_json,
            "created_at": e.created_at.isoformat(),
        }
        for e in entries
    ]


class SiteSettingsUpdate(BaseModel):
    title: str
    description: str
    share_image: str | None = None
    noindex: bool
    privacy_policy_version: str


async def _get_or_create_settings(db: AsyncSession) -> SiteSettings:
    result = await db.execute(select(SiteSettings).where(SiteSettings.id == 1))
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = SiteSettings(id=1, updated_at=datetime.now(timezone.utc))
        db.add(settings)
        await db.flush()
    return settings


@router.get("/admin/site-settings")
async def get_site_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    require_scope(current_user, "content.read")
    settings = await _get_or_create_settings(db)
    await db.commit()
    return {
        "title": settings.title,
        "description": settings.description,
        "share_image": settings.share_image,
        "noindex": settings.noindex,
        "privacy_policy_version": settings.privacy_policy_version,
    }


@router.patch("/admin/site-settings")
async def update_site_settings(
    payload: SiteSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    if current_user.role != Role.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="沒有權限執行此操作")
    settings = await _get_or_create_settings(db)
    settings.title = payload.title
    settings.description = payload.description
    settings.share_image = payload.share_image
    settings.noindex = payload.noindex
    settings.privacy_policy_version = payload.privacy_policy_version
    settings.updated_at = datetime.now(timezone.utc)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="site_settings.update",
        target_type="site_settings",
        target_id="1",
        metadata={"noindex": payload.noindex, "privacy_policy_version": payload.privacy_policy_version},
    )
    await db.commit()
    return {
        "title": settings.title,
        "description": settings.description,
        "share_image": settings.share_image,
        "noindex": settings.noindex,
        "privacy_policy_version": settings.privacy_policy_version,
    }


@router.post("/admin/retention/dry-run")
async def retention_dry_run(
    older_than_days: int = 365,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    if current_user.role != Role.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="沒有權限執行此操作")
    return await retention_service.run_retention_sweep(db, older_than_days=older_than_days, dry_run=True)


@router.post("/admin/retention/run")
async def retention_run(
    request: Request,
    older_than_days: int = 365,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """預設環境不允許真的清理（WEBSITE_RETENTION_ALLOW_REAL_RUN 需明確
    設為 true），避免意外把個資清掉。"""
    if current_user.role != Role.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="沒有權限執行此操作")

    settings = request.app.state.settings
    if not settings.retention_allow_real_run:
        preview = await retention_service.run_retention_sweep(
            db, older_than_days=older_than_days, dry_run=True
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "RETENTION_REAL_RUN_DISABLED",
                "message": "預設不開放真正清理，需設定 WEBSITE_RETENTION_ALLOW_REAL_RUN=true",
                "dry_run_preview": preview,
            },
        )

    result = await retention_service.run_retention_sweep(
        db, older_than_days=older_than_days, dry_run=False
    )
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="retention.run",
        target_type="visit_requests",
        target_id="bulk",
        metadata={"older_than_days": older_than_days, "candidate_count": result["candidate_count"]},
    )
    await db.commit()
    return result
