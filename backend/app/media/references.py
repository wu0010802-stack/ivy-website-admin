"""素材被哪些內容引用（規格 L142-143）：哪個內容項、哪一版、哪個欄位，以及
那一版是最新草稿、官網上的版本、已排程的版本，還是只剩可還原的舊版本。

MediaUsage 只記各內容項最新一版，這裡另外直接掃 revision 內容：線上版、
排程版與舊版本的引用都要算，刪掉它們用到的素材，官網會破圖、排程到點
會失敗、還原會回 MEDIA_NOT_FOUND。素材量與版本數都是幾百筆等級，先用
payload 文字包含素材 id 篩一輪，再逐筆用 registry 解析出精確的欄位路徑。"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import Text, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.models import ContentItem, ContentRevision, PublishJob, SiteReleaseEntry, SiteState
from app.content.registry import CONTENT_KIND_REGISTRY
from app.media.models import MediaUsage

DRAFT = "draft"  # 內容項最新的一版（編輯頁打開看到的）
LIVE = "live"  # 目前官網 release 裡的那一版
SCHEDULED = "scheduled"  # 已排程、還沒執行的那一版
ACTIVE_STATES = (DRAFT, LIVE, SCHEDULED)


@dataclass
class MediaReference:
    content_item_id: uuid.UUID
    kind: str
    campus_key: str | None
    revision_id: uuid.UUID
    version: int
    path: str
    label: str | None
    # 空清單＝只在可還原的舊版本裡。
    states: list[str] = field(default_factory=list)
    publish_at: datetime | None = None


@dataclass
class MediaReferences:
    references: list[MediaReference]
    # MediaUsage 裡找不到對應內容版本的引用（舊資料或其他模組寫入的）。
    # 一樣當作使用中，不能刪也不能封存。
    untracked_usages: int = 0

    @property
    def active(self) -> list[MediaReference]:
        return [ref for ref in self.references if ref.states]

    @property
    def history(self) -> list[MediaReference]:
        return [ref for ref in self.references if not ref.states]

    @property
    def in_use(self) -> bool:
        """草稿、官網或排程在用：不能封存、不能刪除。"""
        return bool(self.active) or self.untracked_usages > 0

    @property
    def referenced(self) -> bool:
        """任何一版（含可還原的舊版本）在用：不能刪除。"""
        return self.in_use or bool(self.references)


async def find_references(db: AsyncSession, media_id: uuid.UUID) -> MediaReferences:
    needle = str(media_id)
    release_id = (
        await db.execute(select(SiteState.current_release_id).where(SiteState.id == 1))
    ).scalar_one_or_none()
    live: set[uuid.UUID] = set()
    if release_id is not None:
        live = set(
            (
                await db.execute(
                    select(SiteReleaseEntry.revision_id).where(SiteReleaseEntry.release_id == release_id)
                )
            ).scalars()
        )
    scheduled = {
        revision_id: publish_at
        for revision_id, publish_at in (
            await db.execute(
                select(PublishJob.revision_id, func.min(PublishJob.publish_at))
                .where(PublishJob.status == "scheduled")
                .group_by(PublishJob.revision_id)
            )
        ).all()
    }

    rows = await db.execute(
        select(ContentRevision, ContentItem)
        .join(ContentItem, ContentItem.id == ContentRevision.content_item_id)
        # 舊資料的 UUID 可能是大寫；解析時 uuid.UUID 會統一，篩選也不分大小寫。
        .where(func.lower(cast(ContentRevision.payload, Text)).contains(needle))
        .order_by(ContentItem.kind, ContentItem.campus_key, ContentRevision.version.desc())
    )
    references: list[MediaReference] = []
    tracked_items: set[str] = set()
    for revision, item in rows.all():
        config = CONTENT_KIND_REGISTRY.get(item.kind)
        if config is None or not isinstance(revision.payload, dict):
            continue
        states = []
        if revision.version == item.latest_version:
            states.append(DRAFT)
        if revision.id in live:
            states.append(LIVE)
        if revision.id in scheduled:
            states.append(SCHEDULED)
        for ref in config.extract_media_refs(revision.payload):
            if ref.media_id != media_id:
                continue
            tracked_items.add(str(item.id))
            references.append(
                MediaReference(
                    content_item_id=item.id,
                    kind=item.kind,
                    campus_key=item.campus_key,
                    revision_id=revision.id,
                    version=revision.version,
                    path=ref.path,
                    label=ref.label,
                    states=states,
                    publish_at=scheduled.get(revision.id),
                )
            )

    usage_items = (
        await db.execute(select(MediaUsage.content_item_id).where(MediaUsage.media_id == media_id))
    ).scalars().all()
    untracked = sum(1 for content_item_id in usage_items if content_item_id not in tracked_items)
    return MediaReferences(references=references, untracked_usages=untracked)
