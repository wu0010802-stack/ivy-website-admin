from __future__ import annotations

import asyncio
import copy
import hashlib
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import ValidationError
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import Role, User
from app.auth.permissions import (
    CapabilityDenied,
    ScopeDenied,
    can_edit_shared_content,
    can_publish_shared_content,
    require_scope,
)
from app.content import notices, service
from app.content import publish_jobs
from app.campuses.models import Campus
from app.common.timezones import today_local
from app.content.models import (
    ContentItem,
    ContentRevision,
    PublishJob,
    ReleaseSource,
    SiteRelease,
    SiteReleaseEntry,
    SiteState,
)
from app.media.models import MediaAsset, MediaStatus
from app.media.schemas import (
    MediaReplaceReferencesOut,
    MediaReplaceReferencesRequest,
    MediaReplacedItemOut,
)
from app.content.registry import CONTENT_KIND_REGISTRY, MediaRef, managed_as_shared, set_at_path
from app.media import service as media_service
from app.operations import audit_service
from app.content.schemas import (
    ContentItemOut,
    ContentRevisionCreateRequest,
    ContentRevisionOut,
    ContentRevisionRestoreRequest,
    ContentRevisionSummaryOut,
    PendingReviewOut,
    PublicSiteOut,
    PublishJobOut,
    PublishRequest,
    ReviewDecisionRequest,
    ScheduleRequest,
    SubmitReviewRequest,
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


def _campus_key_for(config, campus_key: str | None) -> str | None:
    """共用內容一律不看 campus_key；分校內容（五校介紹、探索、各校消息）
    一定要指定校區——沒帶的話會被當成一份「共用」的同名內容，發布後官網
    讀到的形狀就錯了。"""
    if config.shared_only:
        return None
    if not campus_key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "CAMPUS_KEY_REQUIRED", "message": "這項內容是各校各一份，請指定校區"},
        )
    return campus_key


def _require_read_scope(user: User, kind: str, campus_key: str | None) -> None:
    """讀取閘門。共用內容（campus_key is None）與總部管理的各校內容
    （hq_managed）所有登入角色都看得到；其餘校區內容一定要有該校 scope，
    否則分校管理者可以讀別校的內容與尚未發布的草稿。不沿用
    `_require_shared_or_scope`——那支要求 manage 權限，套在 GET 會誤擋
    readonly／reception。"""
    require_scope(user, "content.read")
    if campus_key is not None and not managed_as_shared(kind, campus_key):
        require_scope(user, "content.read", campus_keys=[campus_key])


def _require_shared_or_scope(user: User, item: ContentItem) -> None:
    """共用內容（campus_key is None）與總部管理的各校內容（hq_managed）只有
    super_admin 或有「全站共用內容」授權的人能編，分校不能改；校區自有
    內容才走一般 campus scope 檢查。"""
    if managed_as_shared(item.kind, item.campus_key):
        if not can_edit_shared_content(user):
            raise CapabilityDenied()
        return
    require_scope(user, "content.manage", campus_keys=[item.campus_key])


def _require_publish(user: User, item: ContentItem) -> None:
    """發布（立即、核准送審、排程）要 content.publish：內容編輯只能送審。"""
    _require_shared_or_scope(user, item)
    if managed_as_shared(item.kind, item.campus_key):
        if not can_publish_shared_content(user):
            raise CapabilityDenied()
    else:
        require_scope(user, "content.publish", campus_keys=[item.campus_key])


async def _revision_of(
    db: AsyncSession, item: ContentItem, revision_id: uuid.UUID, *, for_update: bool = False
) -> ContentRevision:
    stmt = select(ContentRevision).where(
        ContentRevision.id == revision_id, ContentRevision.content_item_id == item.id
    )
    if for_update:
        # FOR NO KEY UPDATE：擋住同時審核，但不擋別的發布寫 release entries 時的外鍵檢查。
        stmt = stmt.with_for_update(key_share=True).execution_options(populate_existing=True)
    result = await db.execute(stmt)
    revision = result.scalar_one_or_none()
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個版本")
    return revision


def _rejected_revision() -> HTTPException:
    """已退回的版本不能發布，也不能排程（排程到期時 publish_jobs 也會再擋一次）。"""
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "CONTENT_REVISION_REJECTED", "message": "這一版已被退回，請修改後重新儲存再發布"},
    )


def _not_ready(exc: publish_jobs.NotPublishable) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": exc.code, "message": exc.message},
    )


async def _validate_media_references(
    db: AsyncSession, refs: list[MediaRef], campus_key: str | None
) -> None:
    """引用的素材必須存在、而且屬於同一校或共用。不驗的話：引用不存在的
    UUID 會在寫 media_usages 時撞 FK 變成 500；引用別校的素材則會替對方
    建立一筆引用，讓那張圖再也刪不掉。影片版位只能放影片、照片版位只能放
    圖片（MediaRef.kind）。

    素材列用 FOR SHARE 讀：刪除素材（media.service.mark_deleted）先 FOR UPDATE
    鎖列、確認沒有引用才標記待清理。一般 SELECT 讀到的是對方 commit 前的
    deleted_at，兩邊會同時成功，草稿就引用了待清理的素材（發布後官網破圖）。
    FOR SHARE 跟 FOR UPDATE 互斥：對方先鎖就等它 commit、讀到新的 deleted_at；
    這裡先鎖，刪除要等這份草稿 commit，之後查引用就會看到它。

    影片只播一段（MediaRef.clip）時，開始秒數要小於影片長度、結束秒數不能
    超過影片長度：結束秒數永遠播不到的話，官網循環會從 0 秒重播整支。影片
    長度不明（主機沒有 ffprobe）時不檢查。"""
    if not refs:
        return
    result = await db.execute(
        select(
            MediaAsset.id, MediaAsset.campus_key, MediaAsset.deleted_at, MediaAsset.kind, MediaAsset.duration_seconds
        )
        .where(MediaAsset.id.in_({ref.media_id for ref in refs}))
        .order_by(MediaAsset.id)
        .with_for_update(read=True)
    )
    found = {row.id: row for row in result.all()}
    for ref in refs:
        media_id = ref.media_id
        # 待清理的素材過幾天就會真的刪掉，不能再被新的版本引用。
        if media_id not in found or found[media_id].deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "MEDIA_NOT_FOUND", "message": f"找不到素材 {media_id}"},
            )
        owner = found[media_id].campus_key
        if owner is not None and owner != campus_key:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "MEDIA_CROSS_CAMPUS", "message": "不能引用其他校區的素材"},
            )
        if ref.kind is not None and found[media_id].kind.value != ref.kind:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "MEDIA_KIND_MISMATCH",
                    "message": "影片欄位只能選影片" if ref.kind == "video" else "照片欄位只能選圖片",
                    "field_path": ref.path,
                },
            )
        duration = found[media_id].duration_seconds
        if ref.clip is not None and duration:
            start, end = ref.clip
            if start >= duration or (end is not None and end > duration):
                name = f"「{ref.label}」" if ref.label else "影片片段"
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={
                        "code": "MEDIA_CLIP_OUT_OF_RANGE",
                        "message": f"{name}的影片只有 {duration:g} 秒：開始秒數要小於影片長度，結束秒數不能超過影片長度",
                        "field_path": ref.path,
                    },
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


@router.get("/admin/content-items/{kind}", response_model=ContentItemOut)
async def get_content_item(
    kind: str,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ContentItemOut:
    config = _get_kind_config(kind)
    campus_key = _campus_key_for(config, campus_key)
    _require_read_scope(current_user, kind, campus_key)
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
    campus_key = _campus_key_for(config, campus_key)

    item = await service.get_or_create_content_item(db, kind, campus_key)
    _require_shared_or_scope(current_user, item)
    await _save_draft(db, config, kind, item, payload.payload, payload.expected_version, current_user)
    await db.commit()
    item, latest = await _get_item_with_latest_revision(db, item.id)
    return _item_out(item, latest)


async def _save_draft(
    db: AsyncSession,
    config,
    kind: str,
    item: ContentItem,
    raw_payload: dict,
    expected_version: int,
    current_user: User,
) -> ContentRevision:
    """新存草稿與「還原舊版成草稿」共用同一條路：一樣過目前的 schema 驗證、
    素材引用驗證、樂觀鎖與素材引用同步，還原不能繞過任何一道檢查。"""
    try:
        typed_payload = config.payload_model.model_validate(raw_payload)
    except ValidationError as exc:
        errors = [
            {"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()
        ]
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors
        ) from exc

    dumped_payload = typed_payload.model_dump()
    _, previous = await _get_item_with_latest_revision(db, item.id)
    dumped_payload = config.before_save(dumped_payload, previous.payload if previous else None)
    media_refs = config.extract_media_refs(dumped_payload)
    await _validate_media_references(db, media_refs, item.campus_key)
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
        db, str(item.id), kind, item.campus_key, revision.id, media_refs
    )
    return revision


@router.get(
    "/admin/content-items/{kind}/revisions",
    response_model=list[ContentRevisionSummaryOut],
)
async def list_content_revisions(
    kind: str,
    campus_key: str | None = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[ContentRevisionSummaryOut]:
    """版本歷史：每次存檔都是一版，標出目前線上的是哪一版、哪些曾經上線。"""
    config = _get_kind_config(kind)
    campus_key = _campus_key_for(config, campus_key)
    _require_read_scope(current_user, kind, campus_key)
    item = await service.get_or_create_content_item(db, kind, campus_key)
    await db.commit()
    limit = max(1, min(limit, 200))

    published = await db.execute(
        select(SiteReleaseEntry.revision_id, func.max(SiteRelease.created_at))
        .join(SiteRelease, SiteRelease.id == SiteReleaseEntry.release_id)
        .where(SiteReleaseEntry.content_item_id == item.id)
        .group_by(SiteReleaseEntry.revision_id)
    )
    last_published = {rid: at for rid, at in published.all()}

    rows = await db.execute(
        select(ContentRevision, User.email, User.display_name)
        .outerjoin(User, User.id == ContentRevision.created_by)
        .where(ContentRevision.content_item_id == item.id)
        .order_by(ContentRevision.version.desc())
        .limit(limit)
    )
    return [
        ContentRevisionSummaryOut(
            id=rev.id,
            version=rev.version,
            created_at=rev.created_at,
            created_by_email=email,
            created_by_display_name=display_name,
            is_published=rev.id == item.current_published_revision_id,
            ever_published=rev.id in last_published,
            last_published_at=last_published.get(rev.id),
            review_status=rev.review_status,
            review_note=rev.review_note,
            reviewed_at=rev.reviewed_at,
            schema_version=rev.schema_version,
        )
        for rev, email, display_name in rows.all()
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
    campus_key = _campus_key_for(config, campus_key)
    _require_read_scope(current_user, kind, campus_key)
    item = await service.get_or_create_content_item(db, kind, campus_key)
    await db.commit()
    result = await db.execute(
        select(ContentRevision).where(
            ContentRevision.id == revision_id, ContentRevision.content_item_id == item.id
        )
    )
    revision = result.scalar_one_or_none()
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個版本")
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
    還原內容，別人尚未發布的草稿不會被帶上去。規格：內容還原不回復預約
    設定、時段、案件或通知，這裡只動內容。

    直接發布與一般發布同一套規則：要有發布權限（內容編輯只能還原成草稿
    再送審），也要通過發布前檢查（例如預約文案的隱私說明還是示意文字）。"""
    config = _get_kind_config(kind)
    campus_key = _campus_key_for(config, campus_key)

    item = await service.get_or_create_content_item(db, kind, campus_key)
    _require_shared_or_scope(current_user, item)
    if payload.publish:
        _require_publish(current_user, item)
    source = await _revision_of(db, item, revision_id)

    # 舊版是用當時的欄位規則存的；欄位規則之後可能變嚴或多了必填欄位，
    # 還原前用目前的規則再驗一次，不讓不合格的內容繞過存檔驗證上官網。
    try:
        config.payload_model.model_validate(source.payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "CONTENT_REVISION_OUTDATED",
                "message": "這一版的欄位格式已經過時，無法直接還原，請手動修改後再儲存",
            },
        ) from exc

    if payload.publish:
        # 取鎖順序要跟一般發布一樣先站台、後內容項：存草稿會鎖內容項，一般
        # 發布拿著站台鎖寫 site_release_entries 時要等這把鎖，反過來就死結。
        await service.lock_site_state(db)
    revision = await _save_draft(
        db, config, kind, item, dict(source.payload), payload.expected_version, current_user
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
        try:
            await publish_jobs.check_publishable(db, item, revision)
        except publish_jobs.NotPublishable as exc:
            await db.rollback()
            raise _not_ready(exc) from exc
        await service.publish_revision(db, item, revision, current_user.id, source=ReleaseSource.RESTORE)
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
    campus_key = _campus_key_for(config, campus_key)

    item = await service.get_or_create_content_item(db, kind, campus_key)
    _require_publish(current_user, item)
    revision = await _revision_of(db, item, payload.revision_id)
    if "expected_published_revision_id" in payload.model_fields_set:
        # 鎖住內容項再比對，兩個同時按發布的人只有一個會通過。先拿站台鎖（與
        # publish_revision 的其他呼叫端同順序）：先鎖內容項的話，另一個已拿到站台鎖、
        # 正在寫 release entries（外鍵要 FOR KEY SHARE 這個內容項）的發布會和這裡互等成死結。
        await service.lock_site_state(db)
        await db.refresh(item, with_for_update=True)
        if item.current_published_revision_id != payload.expected_published_revision_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "CONTENT_VERSION_CONFLICT",
                    "message": "官網上的版本已被其他人更新，請重新載入後再發布",
                },
            )
    if revision.review_status == "rejected":
        raise _rejected_revision()
    try:
        await publish_jobs.check_publishable(db, item, revision)
    except publish_jobs.NotPublishable as exc:
        raise _not_ready(exc) from exc

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


def _etag_matches(header: str | None, etag: str) -> bool:
    """If-None-Match 可能是 *、多個以逗號分隔的值，或帶 W/ 的弱比對值。"""
    if not header:
        return False
    for candidate in header.split(","):
        candidate = candidate.strip()
        if candidate == "*" or candidate.removeprefix("W/") == etag:
            return True
    return False


class _PublicSiteCache:
    """/public/site 的程序內快取：序列化後的本文與 ETag。分兩層——
    content：鍵是 (release id, 停用分校, 台北日期)，這三個決定公開內容（release 的
      entries 與 revision.payload 建立後不再修改；活動過期靠日期、分校停用靠
      campuses.active），連同內容引用的素材 id；
    body：content 鍵加上素材指紋（media.service.public_media_fingerprint，涵蓋輸出
      用到的所有素材欄位與衍生檔）。
    命中時一次請求只付「release／停用分校」與「素材指紋」兩個輕量查詢；任何發布、
    還原、排程生效（換 release）、分校啟停、素材改動、跨日，鍵或指紋就不同，下一
    次請求立刻重算，不靠寫入端失效，所以多個 worker 之間也一致。只留最新一份。"""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.content_key: tuple | None = None
        self.content: dict = {}
        self.media_ids: frozenset[uuid.UUID] = frozenset()
        self.body_key: tuple | None = None
        self.body: bytes = b""
        self.etag: str = ""
        # single-flight：同時多個請求都沒命中時只有一個去重算，其他等它做完再看快取。
        self.lock: asyncio.Lock | None = None


_public_site_cache = _PublicSiteCache()


def _public_site_hit(key: tuple, fingerprint: str) -> tuple[bytes, str] | None:
    cache = _public_site_cache
    if cache.body_key == (key, fingerprint):
        return cache.body, cache.etag
    return None


async def _public_site_body(db: AsyncSession) -> tuple[bytes, str] | None:
    """(本文, ETag)；官網還沒發布過回 None。輸出與逐次重算完全相同。"""
    cache = _public_site_cache
    row = (
        await db.execute(
            select(
                SiteState.current_release_id,
                select(func.array_agg(Campus.key)).where(Campus.active.is_(False)).scalar_subquery(),
            ).select_from(SiteState).where(SiteState.id == 1)
        )
    ).first()
    if row is None or row[0] is None:
        return None
    release_id = row[0]
    key = (release_id, frozenset(row[1] or ()), today_local().isoformat())
    if cache.content_key == key:
        fingerprint = await media_service.public_media_fingerprint(db, cache.media_ids)
        hit = _public_site_hit(key, fingerprint)
        if hit is not None:
            return hit
    if cache.lock is None:
        cache.lock = asyncio.Lock()
    async with cache.lock:
        if cache.content_key != key:
            content = await service.build_public_content(db, release_id, key[1], key[2])
            cache.media_ids = frozenset(service.public_media_ids(content))
            cache.content = content
            cache.content_key = key
            cache.body_key = None
        fingerprint = await media_service.public_media_fingerprint(db, cache.media_ids)
        hit = _public_site_hit(key, fingerprint)
        if hit is not None:
            return hit
        media = await media_service.public_media(db, set(cache.media_ids))
        body = PublicSiteOut(
            schema_version=PUBLIC_SCHEMA_VERSION, release_id=str(release_id), content=cache.content, media=media
        ).model_dump_json().encode()
        etag = f'"{hashlib.sha256(body).hexdigest()[:32]}"'
        # 讀素材的期間若又被改了就不存：存了會把較新的本文掛在舊指紋底下，
        # 之後素材改回原樣時就會誤命中。
        if await media_service.public_media_fingerprint(db, cache.media_ids) == fingerprint:
            cache.body_key = (key, fingerprint)
            cache.body = body
            cache.etag = etag
        return body, etag


@router.get(
    "/public/site",
    response_model=PublicSiteOut,
    responses={
        304: {"description": "內容跟 If-None-Match 帶來的版本相同"},
        503: {"description": "官網還沒發布過任何內容（detail.code = NO_PUBLISHED_CONTENT）"},
    },
)
async def get_public_site(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """規格 L311：帶 ETag。內容除了發布紀錄，還會隨日期（活動過期）、分校
    停用與素材狀態改變，所以 ETag 直接取輸出本文的雜湊，不另外推算版本。
    官網與瀏覽器帶 If-None-Match 重新驗證時，沒變就回 304、不再傳整份內容。"""
    # 本文與 ETag 有程序內快取（見 _PublicSiteCache），內容或素材一變就重算。
    cached = await _public_site_body(db)
    if cached is None:
        # 帶代碼讓後台分得出「還沒發布過」與服務暫時無法使用（兩者都是 503）。
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "NO_PUBLISHED_CONTENT", "message": "尚無可用內容"},
        )
    body, etag = cached
    headers = {"Cache-Control": "no-cache, max-age=0", "ETag": etag}
    if _etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


# ---------------------------------------------------------------------------
# 送審與審核（規格 4、7：內容編輯只能送審，分校管理者審核發布）
# ---------------------------------------------------------------------------


async def _item_for(db: AsyncSession, kind: str, campus_key: str | None):
    config = _get_kind_config(kind)
    campus_key = _campus_key_for(config, campus_key)
    item = await service.get_or_create_content_item(db, kind, campus_key)
    return config, item


@router.post("/admin/content-items/{kind}/submit", response_model=ContentItemOut)
async def submit_for_review(
    kind: str,
    payload: SubmitReviewRequest,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ContentItemOut:
    _, item = await _item_for(db, kind, campus_key)
    _require_shared_or_scope(current_user, item)
    revision = await _revision_of(db, item, payload.revision_id)
    if revision.version != item.latest_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "CONTENT_VERSION_CONFLICT", "message": "只能送審最新的草稿，請重新載入"},
        )
    if revision.review_status not in ("draft", "rejected"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": "這一版已經送審過了"},
        )
    revision.review_status = "pending_review"
    revision.review_note = None
    revision.submitted_by = current_user.id
    revision.submitted_at = datetime.now(timezone.utc)
    # 通知能核准的人（規格 L151）；沒人能核准時送審照樣成立，總覽會列出。
    reviewers = await notices.reviewers_for(db, item)
    await notices.notify(
        db,
        [user.id for user in reviewers],
        notices.REVIEW_SUBMITTED,
        item,
        exclude=current_user.id,
        revision_version=revision.version,
        actor_email=current_user.email,
    )
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="content.submit_review",
        target_type="content_item",
        target_id=str(item.id),
        campus_key=item.campus_key,
        metadata={"kind": kind, "revision_version": revision.version},
    )
    await db.commit()
    item, latest = await _get_item_with_latest_revision(db, item.id)
    return _item_out(item, latest)


@router.post("/admin/content-items/{kind}/review", response_model=ContentItemOut)
async def review_submission(
    kind: str,
    payload: ReviewDecisionRequest,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ContentItemOut:
    """核准＝立即發布這一版；退回要附原因。"""
    _, item = await _item_for(db, kind, campus_key)
    _require_publish(current_user, item)
    # 兩位審核者同時按核准／退回：鎖住這一版再看狀態，後到的會看到前一位的決定（409）。
    # 先拿站台鎖再鎖版本，與直接發布（站台 → 內容項 → _mark_live 改這一版）同順序。
    await service.lock_site_state(db)
    revision = await _revision_of(db, item, payload.revision_id, for_update=True)
    if revision.review_status != "pending_review":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": "這一版不在待審核狀態"},
        )
    now = datetime.now(timezone.utc)
    if payload.decision == "approve":
        try:
            await publish_jobs.check_publishable(db, item, revision)
        except publish_jobs.NotPublishable as exc:
            raise _not_ready(exc) from exc
        revision.review_status = "approved"
        revision.review_note = (payload.note or "").strip() or None
        await service.publish_revision(db, item, revision, current_user.id, source=ReleaseSource.REVIEW)
    else:
        revision.review_status = "rejected"
        revision.review_note = (payload.note or "").strip()
        # 已排好的這一版跟著取消：退回的內容不能在排程到期時上線。
        await db.execute(
            update(PublishJob)
            .where(PublishJob.revision_id == revision.id, PublishJob.status == "scheduled")
            .values(status="cancelled", finished_at=now)
        )
    revision.reviewed_by = current_user.id
    revision.reviewed_at = now
    # 送審的人要知道結果；退回原因一起帶過去（規格 L152）。
    await notices.notify(
        db,
        [revision.submitted_by],
        notices.REVIEW_APPROVED if payload.decision == "approve" else notices.REVIEW_REJECTED,
        item,
        exclude=current_user.id,
        revision_version=revision.version,
        note=revision.review_note,
        actor_email=current_user.email,
    )
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="content.approve" if payload.decision == "approve" else "content.reject",
        target_type="content_item",
        target_id=str(item.id),
        campus_key=item.campus_key,
        metadata={"kind": kind, "revision_version": revision.version, "note": revision.review_note},
    )
    await db.commit()
    item, latest = await _get_item_with_latest_revision(db, item.id)
    return _item_out(item, latest)


@router.get("/admin/content-reviews", response_model=list[PendingReviewOut])
async def list_pending_reviews(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[PendingReviewOut]:
    """待審核清單：只列目前使用者有權發布的內容。"""
    require_scope(current_user, "content.read")
    rows = await db.execute(
        select(ContentRevision, ContentItem, User.email, User.display_name)
        .join(ContentItem, ContentItem.id == ContentRevision.content_item_id)
        .outerjoin(User, User.id == ContentRevision.submitted_by)
        .where(ContentRevision.review_status == "pending_review")
        .order_by(ContentRevision.submitted_at)
    )
    out = []
    for rev, item, email, display_name in rows.all():
        if not publish_jobs.user_can_publish(current_user, item):
            continue
        out.append(
            PendingReviewOut(
                kind=item.kind,
                campus_key=item.campus_key,
                revision_id=rev.id,
                version=rev.version,
                submitted_at=rev.submitted_at,
                submitted_by_email=email,
                submitted_by_display_name=display_name,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 排程發布
# ---------------------------------------------------------------------------


async def _job_out(db: AsyncSession, job: PublishJob, item: ContentItem) -> PublishJobOut:
    rev = await db.get(ContentRevision, job.revision_id)
    creator = await db.get(User, job.created_by) if job.created_by else None
    return PublishJobOut(
        id=job.id,
        revision_id=job.revision_id,
        revision_version=rev.version if rev else 0,
        publish_at=job.publish_at,
        status=job.status,
        error=job.error,
        created_by_email=creator.email if creator else None,
        created_by_display_name=creator.display_name if creator else None,
        finished_at=job.finished_at,
        resolved=publish_jobs.is_resolved(job, item),
    )


@router.get("/admin/content-items/{kind}/schedules", response_model=list[PublishJobOut])
async def list_schedules(
    kind: str,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[PublishJobOut]:
    config = _get_kind_config(kind)
    campus_key = _campus_key_for(config, campus_key)
    _require_read_scope(current_user, kind, campus_key)
    item = await service.get_or_create_content_item(db, kind, campus_key)
    await db.commit()
    result = await db.execute(
        select(PublishJob)
        .where(PublishJob.content_item_id == item.id)
        .order_by(PublishJob.publish_at.desc())
        .limit(20)
    )
    return [await _job_out(db, job, item) for job in result.scalars()]


@router.post(
    "/admin/content-items/{kind}/schedules",
    response_model=PublishJobOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_schedule(
    kind: str,
    payload: ScheduleRequest,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> PublishJobOut:
    _, item = await _item_for(db, kind, campus_key)
    _require_publish(current_user, item)
    revision = await _revision_of(db, item, payload.revision_id)
    if revision.review_status == "rejected":
        raise _rejected_revision()
    now = datetime.now(timezone.utc)
    if payload.publish_at <= now:
        raise HTTPException(status_code=422, detail="排程時間要在未來；要馬上上線請直接發布")
    # 到期時官網已經是同一版或較新的版本就會略過（不蓋回舊內容），排了也不會
    # 發布，當下就講清楚，不要等時間到了才發現。
    live = await publish_jobs.live_version(db, item)
    if live is not None and revision.version <= live:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "SCHEDULE_REVISION_NOT_NEWER",
                "message": (
                    "官網已經是這一版，不需要排程"
                    if revision.version == live
                    else f"第 {revision.version} 版比官網目前的第 {live} 版舊，到時候不會發布；"
                    "要回到舊內容請從版本紀錄還原（會存成新的一版），再排程或發布"
                ),
            },
        )
    try:
        # 先檢查一次，明顯不能發布的就不要排；到時候還會再檢查一次。
        await publish_jobs.check_publishable(db, item, revision)
    except publish_jobs.NotPublishable as exc:
        raise _not_ready(exc) from exc
    job = PublishJob(
        id=uuid.uuid4(),
        content_item_id=item.id,
        revision_id=revision.id,
        publish_at=payload.publish_at.astimezone(timezone.utc),
        status="scheduled",
        created_by=current_user.id,
        created_at=now,
    )
    db.add(job)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="content.schedule",
        target_type="content_item",
        target_id=str(item.id),
        campus_key=item.campus_key,
        metadata={"kind": kind, "revision_version": revision.version, "publish_at": job.publish_at.isoformat()},
    )
    await db.commit()
    return await _job_out(db, job, item)


@router.delete("/admin/content-items/{kind}/schedules/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_schedule(
    kind: str,
    job_id: uuid.UUID,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    _, item = await _item_for(db, kind, campus_key)
    _require_publish(current_user, item)
    result = await db.execute(
        select(PublishJob)
        .where(PublishJob.id == job_id, PublishJob.content_item_id == item.id)
        .with_for_update()
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個排程")
    if job.status != "scheduled":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="這個排程已經執行或取消了")
    job.status = "cancelled"
    job.finished_at = datetime.now(timezone.utc)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="content.schedule_cancel",
        target_type="content_item",
        target_id=str(item.id),
        campus_key=item.campus_key,
        metadata={"kind": kind, "job_id": str(job_id)},
    )
    await db.commit()


@router.post("/admin/content-items/{kind}/schedules/{job_id}/acknowledge", response_model=PublishJobOut)
async def acknowledge_schedule(
    kind: str,
    job_id: uuid.UUID,
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> PublishJobOut:
    """沒有發布的排程（檢查不過或已略過）按「知道了」：總覽不再列成待辦、編輯
    頁不再提示。分校停用、決定不發布那一版時，沒有「之後重新發布」可以讓它
    消失。和取消排程同一個權限（能發布這項內容的人）。按過再按不重複記錄。"""
    _, item = await _item_for(db, kind, campus_key)
    _require_publish(current_user, item)
    result = await db.execute(
        select(PublishJob)
        .where(PublishJob.id == job_id, PublishJob.content_item_id == item.id)
        .with_for_update()
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個排程")
    if job.status not in publish_jobs.UNPUBLISHED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": "只有沒有發布的排程需要標成已處理"},
        )
    if job.acknowledged_at is None:
        job.acknowledged_at = datetime.now(timezone.utc)
        job.acknowledged_by = current_user.id
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="content.schedule_acknowledge",
            target_type="content_item",
            target_id=str(item.id),
            campus_key=item.campus_key,
            metadata={"kind": kind, "job_id": str(job_id), "status": job.status},
        )
    await db.commit()
    return await _job_out(db, job, item)



# ---------------------------------------------------------------------------
# 批次替換素材（規格 L142：先列影響範圍，再為每個內容項產生草稿）
# ---------------------------------------------------------------------------


def _replace_invalid(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "MEDIA_REPLACEMENT_INVALID", "message": message},
    )


async def _visible_media(db: AsyncSession, user: User, media_id: uuid.UUID) -> MediaAsset:
    asset = await db.get(MediaAsset, media_id)
    if asset is None:
        raise ScopeDenied()
    require_scope(user, "media.read", campus_keys=[asset.campus_key] if asset.campus_key else None)
    return asset


@router.post("/admin/media/{media_id}/replace-references", response_model=MediaReplaceReferencesOut)
async def replace_media_references(
    media_id: uuid.UUID,
    payload: MediaReplaceReferencesRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaReplaceReferencesOut:
    """把選定內容項最新一版裡用到舊素材的欄位（有帶 field_paths 就只換那些
    位置）改成新素材，各存成一個新草稿（不發布，官網要等各自發布或送審）。影響範圍由
    GET /admin/media/{id}/usages 列出；每項帶當時看到的版本號，之後有人另外
    存過就整批停下（409），請使用者重看，不會蓋掉別人的修改。

    一律全部成功或全部不動：任何一項沒權限、版本對不上或存檔驗證不過都回
    錯誤，已處理的項目一起回滾。"""
    old = await _visible_media(db, current_user, media_id)
    replacement = await _visible_media(db, current_user, payload.replacement_id)
    if replacement.id == old.id:
        raise _replace_invalid("請選另一個素材來替換")
    if replacement.kind != old.kind:
        raise _replace_invalid("圖片只能換成圖片、影片只能換成影片")
    # 處理中的影片可以先換進草稿（發布時 check_publishable 會擋到轉好為止）。
    if replacement.status == MediaStatus.FAILED or replacement.deleted_at is not None:
        raise _replace_invalid("替換用的素材處理失敗或已刪除")

    results: list[MediaReplacedItemOut] = []
    seen: set[uuid.UUID] = set()
    for entry in payload.items:
        if entry.content_item_id in seen:
            continue
        seen.add(entry.content_item_id)
        item, latest = await _get_item_with_latest_revision(db, entry.content_item_id)
        _require_shared_or_scope(current_user, item)
        config = _get_kind_config(item.kind)
        if latest is None or item.latest_version != entry.expected_version:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "CONTENT_VERSION_CONFLICT",
                    "message": "查看影響範圍之後，有內容被別人存了新版本，請重新查看後再替換",
                },
            )
        paths = [ref.path for ref in config.extract_media_refs(latest.payload) if ref.media_id == old.id]
        if entry.field_paths is not None:
            # 只換勾選的位置。勾選的位置有任何一個不是舊素材（路徑送錯）一樣
            # 整批停下，不會只換一半。
            wanted = list(dict.fromkeys(entry.field_paths))
            paths = wanted if set(wanted) <= set(paths) else []
        if not paths:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "MEDIA_NOT_REFERENCED", "message": "有內容的最新版本已經沒有用到這個素材，請重新查看"},
            )
        new_payload = copy.deepcopy(latest.payload)
        for path in paths:
            set_at_path(new_payload, path, str(replacement.id))
        revision = await _save_draft(
            db, config, item.kind, item, new_payload, entry.expected_version, current_user
        )
        results.append(
            MediaReplacedItemOut(
                content_item_id=item.id,
                kind=item.kind,
                campus_key=item.campus_key,
                version=revision.version,
                field_paths=paths,
            )
        )

    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="media.replace_references",
        target_type="media_asset",
        target_id=str(old.id),
        campus_key=old.campus_key,
        metadata={
            "replacement_id": str(replacement.id),
            "items": [
                {
                    "content_item_id": str(r.content_item_id),
                    "kind": r.kind,
                    "campus_key": r.campus_key,
                    "version": r.version,
                    "field_paths": r.field_paths,
                }
                for r in results
            ],
        },
    )
    await db.commit()
    return MediaReplaceReferencesOut(replacement_id=replacement.id, items=results)
