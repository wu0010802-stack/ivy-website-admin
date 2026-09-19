from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, require_scope
from app.media import service
from app.media.models import MediaAsset, MediaKind
from app.media.schemas import MediaAssetOut, MediaUpdateRequest
from app.media.validation import MediaValidationError

router = APIRouter(prefix="/api/website/v1/admin/media", tags=["media"])


def _visible_campus_keys(user: User) -> list[str] | None:
    """None 代表不限（super_admin）；其餘角色只能看自己校 + 共用（campus_key IS NULL）。"""
    if user.role.value == "super_admin":
        return None
    return [s.campus_key for s in user.campus_scopes]


def _out(asset: MediaAsset) -> MediaAssetOut:
    return MediaAssetOut(
        id=asset.id,
        campus_key=asset.campus_key,
        kind=asset.kind,
        status=asset.status,
        original_filename=asset.original_filename,
        content_type=asset.content_type,
        size_bytes=asset.size_bytes,
        width=asset.width,
        height=asset.height,
        alt_text=asset.alt_text,
        source_attribution=asset.source_attribution,
        crop_focus_x=asset.crop_focus_x,
        crop_focus_y=asset.crop_focus_y,
        processing_error=asset.processing_error,
        usage_count=len(asset.usages),
        variants=list(asset.variants),
    )


async def _get_owned_asset(db: AsyncSession, user: User, media_id: uuid.UUID) -> MediaAsset:
    result = await db.execute(
        select(MediaAsset)
        .options(selectinload(MediaAsset.variants), selectinload(MediaAsset.usages))
        .where(MediaAsset.id == media_id)
    )
    asset = result.scalar_one_or_none()
    if asset is None:
        raise ScopeDenied()
    if asset.campus_key is not None:
        require_scope(user, "media.read", campus_keys=[asset.campus_key])
    return asset


@router.get("", response_model=list[MediaAssetOut])
async def list_media(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[MediaAssetOut]:
    require_scope(current_user, "media.read")
    result = await db.execute(
        select(MediaAsset).options(
            selectinload(MediaAsset.variants), selectinload(MediaAsset.usages)
        )
    )
    assets = list(result.scalars())
    visible = _visible_campus_keys(current_user)
    if visible is not None:
        assets = [a for a in assets if a.campus_key is None or a.campus_key in visible]
    return [_out(a) for a in assets]


@router.post("", response_model=MediaAssetOut, status_code=status.HTTP_201_CREATED)
async def upload_media(
    request: Request,
    file: UploadFile = File(...),
    kind: str = Form(...),
    campus_key: str | None = Form(default=None),
    alt_text: str | None = Form(default=None),
    source_attribution: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    require_scope(current_user, "media.manage", campus_keys=[campus_key] if campus_key else None)
    try:
        declared_kind = MediaKind(kind)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="kind 必須是 image 或 video") from exc

    data = await file.read()
    storage = service.get_storage(request.app.state.settings)
    try:
        asset = await service.create_media_asset(
            db,
            storage,
            data=data,
            declared_kind=declared_kind,
            original_filename=file.filename or "unnamed",
            campus_key=campus_key,
            created_by=current_user.id,
            alt_text=alt_text,
            source_attribution=source_attribution,
        )
    except MediaValidationError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": exc.code, "message": exc.message},
        ) from exc

    await db.commit()
    await db.refresh(asset, attribute_names=["variants", "usages"])
    return _out(asset)


@router.get("/{media_id}", response_model=MediaAssetOut)
async def get_media(
    media_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    asset = await _get_owned_asset(db, current_user, media_id)
    return _out(asset)


@router.patch("/{media_id}", response_model=MediaAssetOut)
async def update_media(
    media_id: uuid.UUID,
    payload: MediaUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    asset = await _get_owned_asset(db, current_user, media_id)
    require_scope(
        current_user, "media.manage", campus_keys=[asset.campus_key] if asset.campus_key else None
    )
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)
    await db.commit()
    await db.refresh(asset, attribute_names=["variants", "usages"])
    return _out(asset)


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media(
    media_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    asset = await _get_owned_asset(db, current_user, media_id)
    require_scope(
        current_user, "media.manage", campus_keys=[asset.campus_key] if asset.campus_key else None
    )
    storage = service.get_storage(request.app.state.settings)
    try:
        await service.delete_media_asset(db, storage, asset)
    except service.MediaInUse as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MEDIA_IN_USE", "message": "此素材仍被引用，無法刪除"},
        ) from exc
    await db.commit()


@router.post("/{media_id}/replace", response_model=MediaAssetOut, status_code=status.HTTP_201_CREATED)
async def replace_media(
    media_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    old_asset = await _get_owned_asset(db, current_user, media_id)
    require_scope(
        current_user, "media.manage", campus_keys=[old_asset.campus_key] if old_asset.campus_key else None
    )
    data = await file.read()
    storage = service.get_storage(request.app.state.settings)
    try:
        new_asset = await service.replace_media_asset(
            db,
            storage,
            old_asset,
            data=data,
            original_filename=file.filename or "unnamed",
            created_by=current_user.id,
        )
    except MediaValidationError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    await db.commit()
    await db.refresh(new_asset, attribute_names=["variants", "usages"])
    return _out(new_asset)


@router.get("/{media_id}/file")
async def get_media_file(
    media_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    asset = await _get_owned_asset(db, current_user, media_id)
    storage = service.get_storage(request.app.state.settings)
    data = storage.read_bytes(asset.storage_key)
    return Response(content=data, media_type=asset.content_type)
