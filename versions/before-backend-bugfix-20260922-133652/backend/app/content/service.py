from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.models import (
    ContentItem,
    ContentRevision,
    SiteRelease,
    SiteReleaseEntry,
    SiteState,
)
from app.content.registry import CONTENT_KIND_REGISTRY


class VersionConflict(Exception):
    """對應 API 錯誤碼 CONTENT_VERSION_CONFLICT：expected_version 與目前
    latest_version 不符，代表有人先一步儲存過，前端應保留使用者輸入並提示。"""


async def get_or_create_content_item(
    db: AsyncSession, kind: str, campus_key: str | None
) -> ContentItem:
    result = await db.execute(
        select(ContentItem).where(ContentItem.kind == kind, ContentItem.campus_key == campus_key)
    )
    item = result.scalar_one_or_none()
    if item is None:
        item = ContentItem(id=uuid.uuid4(), kind=kind, campus_key=campus_key, latest_version=0)
        db.add(item)
        await db.flush()
    return item


async def create_revision(
    db: AsyncSession,
    content_item: ContentItem,
    payload: dict,
    expected_version: int,
    created_by: uuid.UUID,
) -> ContentRevision:
    if content_item.latest_version != expected_version:
        raise VersionConflict()
    new_version = content_item.latest_version + 1
    revision = ContentRevision(
        id=uuid.uuid4(),
        content_item_id=content_item.id,
        version=new_version,
        payload=payload,
        created_by=created_by,
        created_at=datetime.now(timezone.utc),
    )
    db.add(revision)
    content_item.latest_version = new_version
    await db.flush()
    return revision


async def _get_or_create_site_state(db: AsyncSession) -> SiteState:
    result = await db.execute(select(SiteState).where(SiteState.id == 1).with_for_update())
    state = result.scalar_one_or_none()
    if state is None:
        state = SiteState(id=1, current_release_id=None)
        db.add(state)
        await db.flush()
        # 重新以 FOR UPDATE 鎖住剛建立的列，確保與其他併發發布交易序列化。
        result = await db.execute(select(SiteState).where(SiteState.id == 1).with_for_update())
        state = result.scalar_one()
    return state


async def publish_revision(
    db: AsyncSession, content_item: ContentItem, revision: ContentRevision, created_by: uuid.UUID
) -> SiteRelease:
    """鎖定 SiteState → 讀目前 release manifest → 只替換這個 content item 的
    entry → 建新 release → 原子切換指標。其他 content item 的已發布版本
    完全不受影響（不論是否有共同 kind）。"""
    state = await _get_or_create_site_state(db)

    current_entries: dict[uuid.UUID, uuid.UUID] = {}
    if state.current_release_id is not None:
        result = await db.execute(
            select(SiteReleaseEntry).where(SiteReleaseEntry.release_id == state.current_release_id)
        )
        for entry in result.scalars():
            current_entries[entry.content_item_id] = entry.revision_id

    current_entries[content_item.id] = revision.id

    new_release = SiteRelease(
        id=uuid.uuid4(), created_by=created_by, created_at=datetime.now(timezone.utc)
    )
    db.add(new_release)
    await db.flush()

    for item_id, rev_id in current_entries.items():
        db.add(
            SiteReleaseEntry(release_id=new_release.id, content_item_id=item_id, revision_id=rev_id)
        )

    content_item.current_published_revision_id = revision.id
    state.current_release_id = new_release.id
    await db.flush()
    return new_release


async def get_public_content(db: AsyncSession) -> tuple[str | None, dict]:
    """回傳 (release_id, content dict)。尚無任何 release 時 release_id 為 None，
    呼叫端（public route）應視為「尚無可用內容」回 503，不得回假資料。"""
    result = await db.execute(select(SiteState).where(SiteState.id == 1))
    state = result.scalar_one_or_none()
    if state is None or state.current_release_id is None:
        return None, {}

    result = await db.execute(
        select(SiteReleaseEntry, ContentRevision, ContentItem)
        .join(ContentRevision, SiteReleaseEntry.revision_id == ContentRevision.id)
        .join(ContentItem, SiteReleaseEntry.content_item_id == ContentItem.id)
        .where(SiteReleaseEntry.release_id == state.current_release_id)
    )
    content: dict = {}
    for _entry, revision, item in result.all():
        config = CONTENT_KIND_REGISTRY.get(item.kind)
        # 非共用（campus_key 導向）的 kind 一個 kind 會有多校各一列，用
        # campus_key 當第二層 key，不能直接覆蓋成同一個扁平欄位，否則只
        # 會留下其中一校的資料。
        if config is not None and not config.shared_only and item.campus_key is not None:
            content.setdefault(item.kind, {})[item.campus_key] = revision.payload
        else:
            content[item.kind] = revision.payload
    return str(state.current_release_id), content
