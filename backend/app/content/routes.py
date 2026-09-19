from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import Role, User
from app.auth.permissions import CapabilityDenied, ScopeDenied, require_scope
from app.content import service
from app.content.models import ContentItem, ContentRevision
from app.content.registry import CONTENT_KIND_REGISTRY
from app.content.schemas import (
    ContentItemOut,
    ContentRevisionCreateRequest,
    ContentRevisionOut,
    PublicSiteOut,
    PublishRequest,
)

router = APIRouter(prefix="/api/website/v1", tags=["content"])

# 向下相容舊名稱（階段 B Task 5 第一版只有這個 kind）。
HOME_ABOUT_KIND = "home_about"

PUBLIC_SCHEMA_VERSION = "1.0.0-live"


def _get_kind_config(kind: str):
    config = CONTENT_KIND_REGISTRY.get(kind)
    if config is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"未知的內容種類：{kind}")
    return config


def _require_shared_or_scope(user: User, item: ContentItem) -> None:
    """共用內容（campus_key is None）只有 super_admin 能編，
    分校不能改共用內容；校區自有內容才走一般 campus scope 檢查。"""
    if item.campus_key is None:
        if user.role != Role.SUPER_ADMIN:
            raise CapabilityDenied()
        return
    require_scope(user, "content.manage", campus_keys=[item.campus_key])


async def _get_item_with_latest_revision(
    db: AsyncSession, item_id: uuid.UUID
) -> tuple[ContentItem, ContentRevision | None]:
    result = await db.execute(select(ContentItem).where(ContentItem.id == item_id))
    item = result.scalar_one_or_none()
    if item is None:
        raise ScopeDenied()
    latest = None
    if item.latest_version > 0:
        result = await db.execute(
            select(ContentRevision)
            .where(ContentRevision.content_item_id == item.id)
            .order_by(ContentRevision.version.desc())
            .limit(1)
        )
        latest = result.scalar_one_or_none()
    return item, latest


def _item_out(item: ContentItem, latest: ContentRevision | None) -> ContentItemOut:
    return ContentItemOut(
        id=item.id,
        kind=item.kind,
        campus_key=item.campus_key,
        latest_version=item.latest_version,
        current_published_revision_id=item.current_published_revision_id,
        latest_revision=ContentRevisionOut.model_validate(latest) if latest else None,
    )


@router.get("/admin/content-kinds", response_model=list[str])
async def list_content_kinds(current_user: User = Depends(get_current_user)) -> list[str]:
    require_scope(current_user, "content.read")
    return sorted(CONTENT_KIND_REGISTRY.keys())


@router.get("/admin/content-items/{kind}", response_model=ContentItemOut)
async def get_content_item(
    kind: str,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ContentItemOut:
    require_scope(current_user, "content.read")
    _get_kind_config(kind)
    item = await service.get_or_create_content_item(db, kind, campus_key)
    await db.commit()
    item, latest = await _get_item_with_latest_revision(db, item.id)
    return _item_out(item, latest)


@router.post(
    "/admin/content-items/{kind}/revisions",
    response_model=ContentItemOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_content_revision(
    kind: str,
    payload: ContentRevisionCreateRequest,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ContentItemOut:
    config = _get_kind_config(kind)
    if config.shared_only:
        campus_key = None

    try:
        typed_payload = config.payload_model.model_validate(payload.payload)
    except ValidationError as exc:
        errors = [
            {"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()
        ]
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors
        ) from exc

    item = await service.get_or_create_content_item(db, kind, campus_key)
    _require_shared_or_scope(current_user, item)

    try:
        await service.create_revision(
            db, item, typed_payload.model_dump(), payload.expected_version, current_user.id
        )
    except service.VersionConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "CONTENT_VERSION_CONFLICT", "message": "內容已被其他人更新，請重新載入"},
        ) from exc

    await db.commit()
    item, latest = await _get_item_with_latest_revision(db, item.id)
    return _item_out(item, latest)


@router.post("/admin/content-items/{kind}/publish", response_model=ContentItemOut)
async def publish_content_item(
    kind: str,
    payload: PublishRequest,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ContentItemOut:
    config = _get_kind_config(kind)
    if config.shared_only:
        campus_key = None

    item = await service.get_or_create_content_item(db, kind, campus_key)
    _require_shared_or_scope(current_user, item)

    result = await db.execute(
        select(ContentRevision).where(
            ContentRevision.id == payload.revision_id, ContentRevision.content_item_id == item.id
        )
    )
    revision = result.scalar_one_or_none()
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個版本")

    await service.publish_revision(db, item, revision, current_user.id)
    await db.commit()
    item, latest = await _get_item_with_latest_revision(db, item.id)
    return _item_out(item, latest)


@router.get("/public/site", response_model=PublicSiteOut)
async def get_public_site(
    response: Response,
    db: AsyncSession = Depends(get_db_session),
) -> PublicSiteOut:
    response.headers["Cache-Control"] = "no-cache, max-age=0"
    release_id, content = await service.get_public_content(db)
    if release_id is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="尚無可用內容")
    return PublicSiteOut(schema_version=PUBLIC_SCHEMA_VERSION, release_id=release_id, content=content)
