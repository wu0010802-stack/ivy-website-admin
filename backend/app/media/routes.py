from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import Role, User
from app.auth.permissions import CapabilityDenied, ScopeDenied, require_scope
from app.media import service
from app.media.models import MediaAsset, MediaKind, MediaStatus
from app.media.schemas import MediaAssetOut, MediaUpdateRequest
from app.media.validation import MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MediaValidationError

_UPLOAD_CHUNK_BYTES = 1024 * 1024
_MAX_BYTES_BY_KIND = {MediaKind.IMAGE: MAX_IMAGE_BYTES, MediaKind.VIDEO: MAX_VIDEO_BYTES}


def _require_media_manage(user: User, campus_key: str | None) -> None:
    """共用素材（campus_key 為 NULL）五校共同使用，任何一校的管理者都能
    改寫或刪除等於跨校破壞——manage 一律限 super_admin，跟 content 模組的
    `_require_shared_or_scope` 同一套裁定。read 維持開放（大家都要看得到）。"""
    if campus_key is None:
        require_scope(user, "media.manage")
        if user.role != Role.SUPER_ADMIN:
            raise CapabilityDenied()
        return
    require_scope(user, "media.manage", campus_keys=[campus_key])


async def _read_upload_within_limit(file: UploadFile, kind: MediaKind) -> bytes:
    """分塊讀取並在超過上限時**立刻中止**。原本是先 `await file.read()` 把
    整個 multipart 收進記憶體、再比對 len()，等於上限完全沒有防護作用：
    任何人都能用一個超大檔把 API 的記憶體吃光。"""
    max_bytes = _MAX_BYTES_BY_KIND[kind]
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_UPLOAD_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail={
                    "code": "MEDIA_TOO_LARGE",
                    "message": f"檔案超過大小限制（{max_bytes // (1024 * 1024)} MB）",
                },
            )
        chunks.append(chunk)
    return b"".join(chunks)

router = APIRouter(prefix="/api/website/v1/admin/media", tags=["media"])

# 給公開官網用的唯讀路由：CMS 內容（目前是 campus_tour 的場景圖片）一旦
# 引用某個素材，訪客看頁面時要能直接載入圖片，不能要求先登入 admin。
# 依 UUID 直接讀取（不驗證是否真的被已發布內容引用）——這跟大多數 CMS
# 素材庫的作法一致（上傳後即可用穩定網址讀取，方便草稿預覽），UUID 不可
# 猜測，且只服務 status=ready 的素材，不外洩 processing/failed 的內部
# 狀態或任何其他欄位。
public_router = APIRouter(prefix="/api/website/v1/public/media", tags=["media-public"])


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
    _require_media_manage(current_user, campus_key)
    try:
        declared_kind = MediaKind(kind)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="kind 必須是 image 或 video") from exc

    data = await _read_upload_within_limit(file, declared_kind)
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
    _require_media_manage(current_user, asset.campus_key)
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
    _require_media_manage(current_user, asset.campus_key)
    storage = service.get_storage(request.app.state.settings)
    try:
        storage_keys = await service.delete_media_asset(db, storage, asset)
    except service.MediaInUse as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MEDIA_IN_USE", "message": "此素材仍被引用，無法刪除"},
        ) from exc
    await db.commit()
    # 交易提交成功之後才真的動磁碟；提交失敗時檔案還在，只會留下孤兒檔，
    # 不會出現「DB 說有、磁碟沒有」的破圖。
    for key in storage_keys:
        storage.delete(key)


@router.post("/{media_id}/replace", response_model=MediaAssetOut, status_code=status.HTTP_201_CREATED)
async def replace_media(
    media_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    old_asset = await _get_owned_asset(db, current_user, media_id)
    _require_media_manage(current_user, old_asset.campus_key)
    data = await _read_upload_within_limit(file, old_asset.kind)
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
    return Response(
        content=data,
        media_type=asset.content_type,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@public_router.get("/{media_id}/file")
async def get_public_media_file(
    media_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    result = await db.execute(select(MediaAsset).where(MediaAsset.id == media_id))
    asset = result.scalar_one_or_none()
    if asset is None or asset.status != MediaStatus.READY:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個素材")
    storage = service.get_storage(request.app.state.settings)
    data = storage.read_bytes(asset.storage_key)
    return Response(
        content=data,
        media_type=asset.content_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            # content_type 來自實際解碼結果（只可能是 jpeg/png/webp/gif/mp4），
            # 但仍明確關掉瀏覽器的 MIME 嗅探，避免任何殘留的誤判空間。
            "X-Content-Type-Options": "nosniff",
        },
    )
