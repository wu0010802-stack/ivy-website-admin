from __future__ import annotations

import asyncio
import os
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Cookie, Depends, File, Form, HTTPException, Request, UploadFile, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import SESSION_COOKIE_NAME, get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import (
    CapabilityDenied,
    ScopeDenied,
    campus_scope,
    can_edit_shared_content,
    covers_campus,
    has_capability,
    require_scope,
)
from app.auth.service import get_session_by_token
from app.config import Settings
from app.media import references as media_references
from app.media import service
from app.media.models import MediaAsset, MediaKind, MediaStatus, MediaVariant, VariantKind
from app.media.schemas import (
    MediaAssetOut,
    MediaHistoryReferenceOut,
    MediaReferenceOut,
    MediaUpdateRequest,
    MediaUploadLimitsOut,
    MediaUsagesOut,
    MediaUsedInOut,
)
from app.media.storage import MediaFileMissing, MediaStorage
from app.media.validation import MediaValidationError
from app.operations import audit_service

_UPLOAD_CHUNK_BYTES = 1024 * 1024


def _media_audit(asset: MediaAsset) -> dict:
    return {
        "kind": asset.kind.value,
        "content_type": asset.content_type,
        "size_bytes": asset.size_bytes,
        "status": asset.status.value,
    }


def _require_media_manage(user: User, campus_key: str | None) -> None:
    """共用素材（campus_key 為 NULL）五校共同使用，任何一校的管理者都能
    改寫或刪除等於跨校破壞——manage 一律限 super_admin，跟 content 模組的
    `_require_shared_or_scope` 同一套裁定。read 維持開放（大家都要看得到）。"""
    if campus_key is None:
        require_scope(user, "media.manage")
        # 有「全站共用內容」授權的人要能替首頁、消息換共用照片。
        if not can_edit_shared_content(user):
            raise CapabilityDenied()
        return
    require_scope(user, "media.manage", campus_keys=[campus_key])


def _too_large(max_bytes: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail={
            "code": "MEDIA_TOO_LARGE",
            "message": f"檔案超過大小限制（{max_bytes // (1024 * 1024)} MB）",
        },
    )


async def _receive_upload(file: UploadFile, max_bytes: int) -> tuple[Path, int]:
    """把上傳的檔案複製成有路徑的暫存檔（影片探測、解碼驗證、存進儲存體都
    要實體路徑），回傳 (暫存檔路徑, 大小)；呼叫端負責刪掉暫存檔。

    進到路由之前，Starlette 已經把整份 multipart 收完、檔案寫進它自己的
    SpooledTemporaryFile（超過 1 MB 落地），所以這裡擋不住「傳輸中」的大檔：
    傳輸中只有 BodySizeLimitMiddleware 依圖片、影片上限較大者擋整個本文，
    圖片的單檔上限要等收完才知道。這裡做的是：
    - UploadFile.size 已知就先比對這一類的上限，超過直接 413，不再複製；
    - 分塊複製，不整份讀進記憶體（影片最大 150 MB，幾個人同時上傳就會吃光
      API 記憶體）；
    - 複製完立刻關掉 Starlette 的暫存檔，之後的驗證與轉檔（影片可能很久）
      只佔一份磁碟空間；複製的那一下仍會短暫佔兩份。"""
    if file.size is not None and file.size > max_bytes:
        raise _too_large(max_bytes)
    fd, name = tempfile.mkstemp(prefix="media-upload-", suffix=".part")
    path = Path(name)
    total = 0
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await file.read(_UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise _too_large(max_bytes)
                await asyncio.to_thread(out.write, chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    await file.close()
    return path, total


def _max_bytes(request: Request, kind: MediaKind) -> int:
    settings: Settings = request.app.state.settings
    return settings.media_max_bytes(kind.value)


def _media_error(exc: MediaValidationError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": exc.code, "message": exc.message},
    )


def _quota_exceeded() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "MEDIA_QUOTA_EXCEEDED",
            "message": "此校區素材空間已滿，請先刪除不用的素材（刪除的素材過了保留天數才會釋出空間）",
        },
    )


async def _file_response(
    storage: MediaStorage,
    request: Request,
    asset: MediaAsset | MediaVariant,
    headers: dict[str, str],
) -> Response:
    """串流送檔：不把整個原檔讀進 API 記憶體（影片可達 150 MB，並行下載
    會按檔案大小 × 請求數吃記憶體）。本機與 S3 都支援 Range。衍生檔
    （縮圖、大圖、poster）走同一條路。"""
    try:
        return await storage.file_response(
            asset.storage_key,
            request=request,
            media_type=asset.content_type,
            headers={"X-Content-Type-Options": "nosniff", **headers},
        )
    except MediaFileMissing as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個素材") from exc


VariantName = Literal["thumbnail", "poster", "large"]


def _variant(asset: MediaAsset, name: VariantName) -> MediaVariant:
    """素材的某種衍生檔；沒有（例如小圖沒有大圖、舊素材處理失敗）回 404，
    官網與後台都不會組出不存在的網址（見 variants 欄位）。"""
    wanted = VariantKind(name)
    for variant in asset.variants:
        if variant.kind == wanted:
            return variant
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="這個素材沒有這種縮圖")


router = APIRouter(prefix="/api/website/v1/admin/media", tags=["media"])

# 給公開官網用的唯讀路由：CMS 內容一旦發布引用某個素材，訪客看頁面時要
# 能直接載入圖片，不能要求先登入 admin。規格要求草稿素材授權才能取得，
# 所以匿名請求只服務「目前線上 release 有引用」的 ready 素材；帶有效後台
# session 的請求（/preview 草稿預覽）另依校區權限放行，且不給共用快取。
public_router = APIRouter(prefix="/api/website/v1/public/media", tags=["media-public"])


def _visible_campus_keys(user: User) -> list[str] | None:
    """None 代表不限（super_admin）；其餘角色只能看自己校 + 共用（campus_key IS NULL）。"""
    scope = campus_scope(user)
    return None if scope is None else sorted(scope)


async def _creator_emails(db: AsyncSession, assets: list[MediaAsset]) -> dict[uuid.UUID, str]:
    ids = {asset.created_by for asset in assets if asset.created_by is not None}
    if not ids:
        return {}
    result = await db.execute(select(User.id, User.email).where(User.id.in_(ids)))
    return dict(result.all())


def _used_in(asset: MediaAsset) -> list[MediaUsedInOut]:
    seen: list[tuple[str, str | None]] = []
    for usage in asset.usages:
        key = (usage.content_kind or usage.field_name, usage.campus_key)
        if usage.content_kind and key not in seen:
            seen.append(key)
    return [MediaUsedInOut(kind=kind, campus_key=campus_key) for kind, campus_key in seen]


def _out(asset: MediaAsset, settings: Settings, emails: dict[uuid.UUID, str] | None = None) -> MediaAssetOut:
    purge_after = (
        asset.deleted_at + timedelta(days=settings.media_purge_delay_days) if asset.deleted_at else None
    )
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
        duration_seconds=asset.duration_seconds,
        created_at=asset.created_at,
        created_by_email=(emails or {}).get(asset.created_by) if asset.created_by else None,
        archived_at=asset.archived_at,
        deleted_at=asset.deleted_at,
        purge_after=purge_after,
        replaces_media_id=asset.replaces_media_id,
        alt_text=asset.alt_text,
        source_attribution=asset.source_attribution,
        caption=asset.caption,
        license_note=asset.license_note,
        tags=list(asset.tags or []),
        crop_focus_x=asset.crop_focus_x,
        crop_focus_y=asset.crop_focus_y,
        processing_error=asset.processing_error,
        usage_count=len(asset.usages),
        used_in=_used_in(asset),
        variants=list(asset.variants),
        version=asset.version,
    )


async def _asset_out(db: AsyncSession, request: Request, asset: MediaAsset) -> MediaAssetOut:
    return _out(asset, request.app.state.settings, await _creator_emails(db, [asset]))


def _can_edit_content(user: User, campus_key: str | None) -> bool:
    if campus_key is None:
        return can_edit_shared_content(user)
    return has_capability(user, "content.manage") and covers_campus(user, campus_key)


def usages_out(
    media_id: uuid.UUID, found: media_references.MediaReferences, user: User
) -> MediaUsagesOut:
    """引用清單。看不到那一校內容的人（共用素材被別校用到）只給內容種類與
    欄位位置，不給標題——那可能是別校還沒發布的消息。"""
    history: dict[uuid.UUID, MediaHistoryReferenceOut] = {}
    for ref in found.history:
        row = history.setdefault(
            ref.content_item_id,
            MediaHistoryReferenceOut(
                content_item_id=ref.content_item_id, kind=ref.kind, campus_key=ref.campus_key, versions=[]
            ),
        )
        if ref.version not in row.versions:
            row.versions.append(ref.version)
    return MediaUsagesOut(
        media_id=media_id,
        references=[
            MediaReferenceOut(
                content_item_id=ref.content_item_id,
                kind=ref.kind,
                campus_key=ref.campus_key,
                revision_id=ref.revision_id,
                version=ref.version,
                field_path=ref.path,
                label=ref.label if ref.campus_key is None or covers_campus(user, ref.campus_key) else None,
                states=ref.states,
                publish_at=ref.publish_at,
                can_edit=_can_edit_content(user, ref.campus_key),
            )
            for ref in found.active
        ],
        history=list(history.values()),
        untracked_usages=found.untracked_usages,
        can_archive=not found.in_use,
        can_delete=not found.referenced,
    )


def _in_use(exc: service.MediaInUse, media_id: uuid.UUID, user: User, *, archiving: bool = False) -> HTTPException:
    found = exc.references
    if found is None:
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MEDIA_IN_USE", "message": "此素材仍被引用，無法刪除"},
        )
    usages = usages_out(media_id, found, user).model_dump(mode="json")
    if found.in_use:
        message = (
            "草稿、官網或已排程的內容還在用這個素材，先在內容頁換掉才能封存"
            if archiving
            else "草稿、官網或已排程的內容還在用這個素材，先在內容頁換掉才能刪除"
        )
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MEDIA_IN_USE", "message": message, "usages": usages},
        )
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "MEDIA_IN_HISTORY",
            "message": "舊版本還用到這個素材，刪掉之後那些版本就無法還原；不想再看到它可以改用封存",
            "usages": usages,
        },
    )


async def _get_owned_asset(db: AsyncSession, user: User, media_id: uuid.UUID) -> MediaAsset:
    """含待清理的素材（要能復原）；呼叫端自己決定待清理時能不能做。"""
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
    request: Request,
    tag: str | None = Query(default=None, max_length=30, description="只列有這個標籤的素材"),
    q: str | None = Query(default=None, max_length=100, description="檔名、圖片說明、圖說或標籤片段"),
    state: Literal["active", "archived", "deleted"] = Query(
        default="active", description="active＝一般素材（選圖器用這個）；archived＝已封存；deleted＝待清理"
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[MediaAssetOut]:
    require_scope(current_user, "media.read")
    stmt = select(MediaAsset).options(selectinload(MediaAsset.variants), selectinload(MediaAsset.usages))
    if state == "deleted":
        stmt = stmt.where(MediaAsset.deleted_at.is_not(None))
    else:
        stmt = stmt.where(MediaAsset.deleted_at.is_(None))
        stmt = stmt.where(
            MediaAsset.archived_at.is_not(None) if state == "archived" else MediaAsset.archived_at.is_(None)
        )
    result = await db.execute(stmt.order_by(MediaAsset.created_at.desc()))
    assets = list(result.scalars())
    visible = _visible_campus_keys(current_user)
    if visible is not None:
        assets = [a for a in assets if a.campus_key is None or a.campus_key in visible]
    # 素材量是幾百張等級，在應用層篩就好；JSON 欄位跨資料庫的包含查詢
    # 寫法不一，不值得為此綁死 PostgreSQL 的 jsonb 運算子。
    if tag and tag.strip():
        wanted = tag.strip()
        assets = [a for a in assets if wanted in (a.tags or [])]
    if q and q.strip():
        needle = q.strip().lower()
        assets = [
            a for a in assets
            if needle in a.original_filename.lower()
            or needle in (a.alt_text or "").lower()
            or needle in (a.caption or "").lower()
            or any(needle in t.lower() for t in (a.tags or []))
        ]
    emails = await _creator_emails(db, assets)
    settings = request.app.state.settings
    return [_out(a, settings, emails) for a in assets]


@router.get("/upload-limits", response_model=MediaUploadLimitsOut)
async def get_upload_limits(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> MediaUploadLimitsOut:
    """後台提示與送出前檢查用：單檔上限來自部署設定。"""
    require_scope(current_user, "media.read")
    settings: Settings = request.app.state.settings
    return MediaUploadLimitsOut(
        max_image_bytes=settings.media_max_bytes("image"),
        max_video_bytes=settings.media_max_bytes("video"),
        image_types=["image/jpeg", "image/png", "image/webp"],
        video_types=["video/mp4"],
        purge_delay_days=settings.media_purge_delay_days,
    )


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

    source_path, size = await _receive_upload(file, _max_bytes(request, declared_kind))
    storage = service.get_storage(request.app.state.settings)
    try:
        asset = await service.create_media_asset(
            db,
            storage,
            source_path=source_path,
            size_bytes=size,
            declared_kind=declared_kind,
            original_filename=file.filename or "unnamed",
            campus_key=campus_key,
            created_by=current_user.id,
            alt_text=alt_text,
            source_attribution=source_attribution,
            quota_bytes=request.app.state.settings.media_quota_bytes_per_campus,
        )
    except service.MediaQuotaExceeded as exc:
        await db.rollback()
        raise _quota_exceeded() from exc
    except MediaValidationError as exc:
        await db.rollback()
        raise _media_error(exc) from exc
    finally:
        source_path.unlink(missing_ok=True)

    # 不記原始檔名：家長或孩子的名字常常直接寫在檔名裡。
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="media.upload",
        target_type="media_asset",
        target_id=str(asset.id),
        campus_key=asset.campus_key,
        metadata=_media_audit(asset),
    )
    await db.commit()
    await db.refresh(asset, attribute_names=["variants", "usages"])
    return await _asset_out(db, request, asset)


@router.get("/{media_id}", response_model=MediaAssetOut)
async def get_media(
    media_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    asset = await _get_owned_asset(db, current_user, media_id)
    return await _asset_out(db, request, asset)


@router.get("/{media_id}/usages", response_model=MediaUsagesOut)
async def get_media_usages(
    media_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaUsagesOut:
    """用在哪裡（規格 L327）：草稿、官網、排程各是哪個內容項的哪一版、哪個
    欄位；只剩舊版本在用的另列。批次替換前的影響範圍也看這裡。"""
    await _get_owned_asset(db, current_user, media_id)
    found = await media_references.find_references(db, media_id)
    return usages_out(media_id, found, current_user)


@router.patch("/{media_id}", response_model=MediaAssetOut)
async def update_media(
    media_id: uuid.UUID,
    payload: MediaUpdateRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    """圖片與影片都能補說明、圖說、來源、授權與標籤（規格 L138）。"""
    asset = await _get_owned_asset(db, current_user, media_id)
    _require_media_manage(current_user, asset.campus_key)
    # 鎖列後重讀 version：兩個人同時存檔時後到的一方會等前一方提交，
    # 再看到新的 version 而被擋下，不會悄悄蓋掉前一個人改的說明。
    await db.refresh(asset, attribute_names=["version"], with_for_update=True)
    if asset.version != payload.expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "MEDIA_VERSION_CONFLICT",
                "message": "這個素材的說明剛被其他人修改，請重新載入後再編輯",
                "current_version": asset.version,
            },
        )
    changed = []
    for field, value in payload.model_dump(exclude_unset=True, exclude={"expected_version"}).items():
        if getattr(asset, field) != value:
            changed.append(field)
        setattr(asset, field, value)
    if changed:
        asset.version += 1
        # 只記改了哪些欄位；說明與圖說是自由文字，不抄進稽核。
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="media.update",
            target_type="media_asset",
            target_id=str(asset.id),
            campus_key=asset.campus_key,
            metadata={"fields": sorted(changed)},
        )
    await db.commit()
    await db.refresh(asset, attribute_names=["variants", "usages"])
    return await _asset_out(db, request, asset)


async def _archive(
    media_id: uuid.UUID, request: Request, user: User, db: AsyncSession, archived: bool
) -> MediaAssetOut:
    asset = await _get_owned_asset(db, user, media_id)
    _require_media_manage(user, asset.campus_key)
    if asset.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MEDIA_DELETED", "message": "這個素材已刪除（待清理），先復原才能封存"},
        )
    try:
        await service.set_archived(db, asset, archived, actor_id=user.id)
    except service.MediaInUse as exc:
        # 先組好錯誤再回滾：回滾會讓 user 過期，之後再讀校區範圍會觸發 lazy load。
        error = _in_use(exc, media_id, user, archiving=True)
        await db.rollback()
        raise error from exc
    await db.commit()
    await db.refresh(asset, attribute_names=["variants", "usages"])
    return await _asset_out(db, request, asset)


@router.post("/{media_id}/archive", response_model=MediaAssetOut)
async def archive_media(
    media_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    """封存（規格 L143）：沒被草稿、官網或排程用到的素材從素材庫與選圖器收起來，
    檔案保留，舊版本照樣能還原。"""
    return await _archive(media_id, request, current_user, db, True)


@router.post("/{media_id}/unarchive", response_model=MediaAssetOut)
async def unarchive_media(
    media_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    return await _archive(media_id, request, current_user, db, False)


@router.post("/{media_id}/restore", response_model=MediaAssetOut)
async def restore_media(
    media_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    """把待清理的素材救回來（清理工作執行之前都可以）。"""
    asset = await _get_owned_asset(db, current_user, media_id)
    _require_media_manage(current_user, asset.campus_key)
    if asset.deleted_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MEDIA_NOT_DELETED", "message": "這個素材沒有被刪除"},
        )
    await service.restore_deleted(db, asset, actor_id=current_user.id)
    await db.commit()
    await db.refresh(asset, attribute_names=["variants", "usages"])
    return await _asset_out(db, request, asset)


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media(
    media_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """刪除＝標記待清理（規格 L322-327）。檔案過 media_purge_delay_days 天才由
    定期工作刪掉，期間可以 POST .../restore 復原。任何一版內容（含可還原的
    舊版本與排程）還在用就回 409 並列出引用處。"""
    asset = await _get_owned_asset(db, current_user, media_id)
    _require_media_manage(current_user, asset.campus_key)
    if asset.deleted_at is not None:
        return
    try:
        await service.mark_deleted(db, asset, actor_id=current_user.id)
    except service.MediaInUse as exc:
        error = _in_use(exc, media_id, current_user)
        await db.rollback()
        raise error from exc
    await db.commit()


@router.post("/{media_id}/replace", response_model=MediaAssetOut, status_code=status.HTTP_201_CREATED)
async def replace_media(
    media_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    """上傳新檔案成為新素材（新 id，沿用舊素材的說明與標籤），舊素材不動。
    要讓內容改用新素材，接著呼叫 .../replace-references。"""
    old_asset = await _get_owned_asset(db, current_user, media_id)
    _require_media_manage(current_user, old_asset.campus_key)
    if old_asset.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MEDIA_DELETED", "message": "這個素材已刪除（待清理），先復原才能替換"},
        )
    source_path, size = await _receive_upload(file, _max_bytes(request, old_asset.kind))
    storage = service.get_storage(request.app.state.settings)
    try:
        new_asset = await service.replace_media_asset(
            db,
            storage,
            old_asset,
            source_path=source_path,
            size_bytes=size,
            original_filename=file.filename or "unnamed",
            created_by=current_user.id,
            quota_bytes=request.app.state.settings.media_quota_bytes_per_campus,
        )
    except service.MediaQuotaExceeded as exc:
        await db.rollback()
        raise _quota_exceeded() from exc
    except MediaValidationError as exc:
        await db.rollback()
        raise _media_error(exc) from exc
    finally:
        source_path.unlink(missing_ok=True)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="media.replace",
        target_type="media_asset",
        target_id=str(new_asset.id),
        campus_key=new_asset.campus_key,
        metadata={"replaces_media_id": str(old_asset.id), **_media_audit(new_asset)},
    )
    await db.commit()
    await db.refresh(new_asset, attribute_names=["variants", "usages"])
    return await _asset_out(db, request, new_asset)


@router.get("/{media_id}/file")
async def get_media_file(
    media_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    asset = await _get_owned_asset(db, current_user, media_id)
    storage = service.get_storage(request.app.state.settings)
    return await _file_response(storage, request, asset, {"Cache-Control": "private, no-store"})


@router.get("/{media_id}/variants/{variant}")
async def get_media_variant(
    media_id: uuid.UUID,
    variant: VariantName,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """素材庫列表、選圖器用的縮圖與影片 poster（規格 L139）。權限同原檔。
    衍生檔一旦產生就不會變（替換素材是新的 id），可以讓瀏覽器私有快取。"""
    asset = await _get_owned_asset(db, current_user, media_id)
    storage = service.get_storage(request.app.state.settings)
    return await _file_response(
        storage, request, _variant(asset, variant), {"Cache-Control": "private, max-age=86400"}
    )


async def _admin_can_preview(db: AsyncSession, session_token: str | None, asset: MediaAsset) -> bool:
    if session_token is None:
        return False
    session = await get_session_by_token(db, session_token)
    if session is None:
        return False
    result = await db.execute(
        select(User).options(selectinload(User.campus_scopes)).where(User.id == session.user_id)
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return False
    try:
        require_scope(
            user, "media.read", campus_keys=[asset.campus_key] if asset.campus_key else None
        )
    except (CapabilityDenied, ScopeDenied):
        return False
    return True


async def _public_asset(
    db: AsyncSession, media_id: uuid.UUID, session_token: str | None
) -> tuple[MediaAsset, dict[str, str]]:
    """公開讀檔的權限（原檔與衍生檔共用）：目前線上 release 有引用的 ready
    素材給所有人並允許長快取；其餘只給有權限的後台 session（草稿預覽），
    不給共用快取。回傳 (素材, 快取標頭)，都不符合時 404。"""
    result = await db.execute(
        select(MediaAsset).options(selectinload(MediaAsset.variants)).where(MediaAsset.id == media_id)
    )
    asset = result.scalar_one_or_none()
    if asset is None or asset.status != MediaStatus.READY or asset.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個素材")
    if media_id in await service.current_release_media_ids(db):
        return asset, {"Cache-Control": "public, max-age=31536000, immutable"}
    if await _admin_can_preview(db, session_token, asset):
        return asset, {"Cache-Control": "private, no-store"}
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個素材")


@public_router.get("/{media_id}/file")
async def get_public_media_file(
    media_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> Response:
    asset, headers = await _public_asset(db, media_id, session_token)
    storage = service.get_storage(request.app.state.settings)
    # content_type 來自實際解碼結果（jpeg/png/webp/mp4，另有舊的 gif），
    # _file_response 仍明確關掉瀏覽器的 MIME 嗅探。
    return await _file_response(storage, request, asset, headers)


@public_router.get("/{media_id}/variants/{variant}")
async def get_public_media_variant(
    media_id: uuid.UUID,
    variant: VariantName,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> Response:
    """官網的縮圖、大圖（srcset）與影片 poster；誰拿得到跟原檔完全相同。"""
    asset, headers = await _public_asset(db, media_id, session_token)
    storage = service.get_storage(request.app.state.settings)
    return await _file_response(storage, request, _variant(asset, variant), headers)
