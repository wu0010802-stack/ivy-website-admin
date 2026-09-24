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
from app.media.models import MediaAsset
from app.content.registry import CONTENT_KIND_REGISTRY
from app.media import service as media_service
from app.operations import audit_service
from app.content.schemas import (
    ContentItemOut,
    ContentRevisionCreateRequest,
    ContentRevisionOut,
    ContentRevisionRestoreRequest,
    ContentRevisionSummaryOut,
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


def _require_read_scope(user: User, campus_key: str | None) -> None:
    """讀取閘門。共用內容（campus_key is None）所有登入角色都看得到；
    校區內容一定要有該校 scope，否則分校管理者可以讀別校的內容與尚未
    發布的草稿。不沿用 `_require_shared_or_scope`——那支要求 manage 權限，
    套在 GET 會誤擋 readonly／reception。"""
    require_scope(user, "content.read")
    if campus_key is not None:
        require_scope(user, "content.read", campus_keys=[campus_key])


def _require_shared_or_scope(user: User, item: ContentItem) -> None:
    """共用內容（campus_key is None）只有 super_admin 能編，
    分校不能改共用內容；校區自有內容才走一般 campus scope 檢查。"""
    if item.campus_key is None:
        if user.role != Role.SUPER_ADMIN:
            raise CapabilityDenied()
        return
    require_scope(user, "content.manage", campus_keys=[item.campus_key])


async def _validate_media_references(
    db: AsyncSession, media_ids: list[uuid.UUID], campus_key: str | None
) -> None:
    """引用的素材必須存在、而且屬於同一校或共用。不驗的話：引用不存在的
    UUID 會在寫 media_usages 時撞 FK 變成 500；引用別校的素材則會替對方
    建立一筆引用，讓那張圖再也刪不掉。"""
    if not media_ids:
        return
    result = await db.execute(
        select(MediaAsset.id, MediaAsset.campus_key).where(MediaAsset.id.in_(set(media_ids)))
    )
    found = {row.id: row.campus_key for row in result.all()}
    for media_id in media_ids:
        if media_id not in found:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "MEDIA_NOT_FOUND", "message": f"找不到素材 {media_id}"},
            )
        owner = found[media_id]
        if owner is not None and owner != campus_key:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "MEDIA_CROSS_CAMPUS", "message": "不能引用其他校區的素材"},
            )


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
    config = _get_kind_config(kind)
    if config.shared_only:
        campus_key = None
    _require_read_scope(current_user, campus_key)
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

    await _save_revision(db, item, config, typed_payload.model_dump(), payload.expected_version, current_user)

    await db.commit()
    item, latest = await _get_item_with_latest_revision(db, item.id)
    return _item_out(item, latest)


async def _save_revision(
    db: AsyncSession,
    item: ContentItem,
    config,
    dumped_payload: dict,
    expected_version: int,
    current_user: User,
) -> ContentRevision:
    """一般存檔與版本還原共用：驗素材引用、樂觀鎖寫入新版、同步素材引用。"""
    media_ids = config.extract_media_ids(dumped_payload)
    await _validate_media_references(db, media_ids, item.campus_key)
    try:
        revision = await service.create_revision(
            db, item, dumped_payload, expected_version, current_user.id
        )
    except service.VersionConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "CONTENT_VERSION_CONFLICT", "message": "內容已被其他人更新，請重新載入"},
        ) from exc

    await media_service.sync_content_item_usages(
        db, str(item.id), item.kind, item.campus_key, media_ids
    )
    return revision


async def _get_revision_of_item(
    db: AsyncSession, item: ContentItem, revision_id: uuid.UUID
) -> ContentRevision:
    result = await db.execute(
        select(ContentRevision).where(
            ContentRevision.id == revision_id, ContentRevision.content_item_id == item.id
        )
    )
    revision = result.scalar_one_or_none()
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個版本")
    return revision


# 版本紀錄只列最近這幾版；更舊的仍保留在資料庫（發布紀錄引用著），
# 只是介面上不再提供還原，免得列表無限變長。
REVISION_HISTORY_LIMIT = 50


@router.get(
    "/admin/content-items/{kind}/revisions",
    response_model=list[ContentRevisionSummaryOut],
)
async def list_content_revisions(
    kind: str,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[ContentRevisionSummaryOut]:
    config = _get_kind_config(kind)
    if config.shared_only:
        campus_key = None
    _require_read_scope(current_user, campus_key)
    item = await service.get_or_create_content_item(db, kind, campus_key)
    await db.commit()
    result = await db.execute(
        select(ContentRevision, User.email)
        .outerjoin(User, ContentRevision.created_by == User.id)
        .where(ContentRevision.content_item_id == item.id)
        .order_by(ContentRevision.version.desc())
        .limit(REVISION_HISTORY_LIMIT)
    )
    return [
        ContentRevisionSummaryOut(
            id=revision.id,
            version=revision.version,
            created_at=revision.created_at,
            created_by_email=email,
            is_published=revision.id == item.current_published_revision_id,
        )
        for revision, email in result.all()
    ]


@router.get(
    "/admin/content-items/{kind}/revisions/{revision_id}",
    response_model=ContentRevisionOut,
)
async def get_content_revision(
    kind: str,
    revision_id: uuid.UUID,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ContentRevisionOut:
    config = _get_kind_config(kind)
    if config.shared_only:
        campus_key = None
    _require_read_scope(current_user, campus_key)
    item = await service.get_or_create_content_item(db, kind, campus_key)
    await db.commit()
    revision = await _get_revision_of_item(db, item, revision_id)
    return ContentRevisionOut.model_validate(revision)


@router.post(
    "/admin/content-items/{kind}/revisions/{revision_id}/restore",
    response_model=ContentItemOut,
    status_code=status.HTTP_201_CREATED,
)
async def restore_content_revision(
    kind: str,
    revision_id: uuid.UUID,
    payload: ContentRevisionRestoreRequest,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ContentItemOut:
    """把舊版內容複製成一個新版本（版本號繼續往上），不改寫歷史，也不動
    其他內容項目。選 publish 時在同一個交易裡發布，官網只會切到這一項的
    還原內容，別人尚未發布的草稿不會被帶上去。"""
    config = _get_kind_config(kind)
    if config.shared_only:
        campus_key = None

    item = await service.get_or_create_content_item(db, kind, campus_key)
    _require_shared_or_scope(current_user, item)
    source = await _get_revision_of_item(db, item, revision_id)

    # 舊版是用當時的欄位規則存的；欄位規則之後可能變嚴或多了必填欄位，
    # 還原前用目前的規則再驗一次，不讓不合格的內容繞過存檔驗證上官網。
    try:
        typed_payload = config.payload_model.model_validate(source.payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "CONTENT_REVISION_OUTDATED",
                "message": "這一版的欄位格式已經過時，無法直接還原，請手動修改後再儲存",
            },
        ) from exc

    revision = await _save_revision(
        db, item, config, typed_payload.model_dump(), payload.expected_version, current_user
    )
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="content.restore",
        target_type="content_item",
        target_id=str(item.id),
        campus_key=item.campus_key,
        metadata={
            "kind": kind,
            "restored_from_version": source.version,
            "revision_version": revision.version,
            "published": payload.publish,
        },
    )
    if payload.publish:
        await service.publish_revision(db, item, revision, current_user.id)
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="content.publish",
            target_type="content_item",
            target_id=str(item.id),
            campus_key=item.campus_key,
            metadata={"kind": kind, "revision_version": revision.version},
        )

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
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="content.publish",
        target_type="content_item",
        target_id=str(item.id),
        campus_key=item.campus_key,
        metadata={"kind": kind, "revision_version": revision.version},
    )
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
