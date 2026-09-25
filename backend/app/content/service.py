from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.models import (
    ContentItem,
    ContentRevision,
    ReleaseSource,
    SiteRelease,
    SiteReleaseEntry,
    SiteState,
)
from app.common.timezones import today_local
from app.content.registry import CONTENT_KIND_REGISTRY, schema_version_of


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
    # 樂觀鎖要有效，版本比對與寫入必須在同一把列鎖內。只比 Python 物件上
    # 的 latest_version 的話，兩個管理者同時存檔會各自通過檢查、產生同一個
    # version 的兩筆 revision，後送出的那筆靜默覆蓋前一筆。
    locked = await db.execute(
        select(ContentItem).where(ContentItem.id == content_item.id).with_for_update()
    )
    locked_item = locked.scalar_one_or_none()
    if locked_item is None:
        raise VersionConflict()
    await db.refresh(content_item, attribute_names=["latest_version"])

    if content_item.latest_version != expected_version:
        raise VersionConflict()
    new_version = content_item.latest_version + 1
    revision = ContentRevision(
        id=uuid.uuid4(),
        content_item_id=content_item.id,
        version=new_version,
        payload=payload,
        schema_version=schema_version_of(content_item.kind),
        created_by=created_by,
        created_at=datetime.now(timezone.utc),
    )
    db.add(revision)
    content_item.latest_version = new_version
    await db.flush()
    # 送審後又存了新版：舊的待審版已經不是要審的內容（送審只收最新一版），
    # 不能一直掛在待審清單與總覽。
    await supersede_pending_reviews(db, content_item.id, below_version=new_version)
    return revision


async def supersede_pending_reviews(db: AsyncSession, content_item_id: uuid.UUID, *, below_version: int) -> None:
    """把這個內容項版本號小於 below_version 的待審版標成已被取代。"""
    await db.execute(
        update(ContentRevision)
        .where(
            ContentRevision.content_item_id == content_item_id,
            ContentRevision.review_status == "pending_review",
            ContentRevision.version < below_version,
        )
        .values(review_status="superseded")
        .execution_options(synchronize_session="fetch")
    )


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


async def _release_entries(db: AsyncSession, release_id: uuid.UUID | None) -> dict[uuid.UUID, uuid.UUID]:
    if release_id is None:
        return {}
    result = await db.execute(select(SiteReleaseEntry).where(SiteReleaseEntry.release_id == release_id))
    return {entry.content_item_id: entry.revision_id for entry in result.scalars()}


async def _write_release(
    db: AsyncSession,
    state: SiteState,
    entries: dict[uuid.UUID, uuid.UUID],
    created_by: uuid.UUID | None,
    *,
    source: str,
    restored_from: uuid.UUID | None = None,
) -> SiteRelease:
    new_release = SiteRelease(
        id=uuid.uuid4(),
        created_by=created_by,
        created_at=datetime.now(timezone.utc),
        source=source,
        restored_from_release_id=restored_from,
    )
    db.add(new_release)
    await db.flush()
    for item_id, rev_id in entries.items():
        db.add(SiteReleaseEntry(release_id=new_release.id, content_item_id=item_id, revision_id=rev_id))
    state.current_release_id = new_release.id
    await db.flush()
    return new_release


async def _mark_live(
    db: AsyncSession, content_item: ContentItem, revision: ContentRevision, published_by: uuid.UUID | None
) -> None:
    """官網換成這一版之後的共同收尾：記上線時間，較舊的待審版標成已被取代；
    直接發布了正在待審的那一版，就等於核准了它，不會留在待審清單裡。"""
    now = datetime.now(timezone.utc)
    if content_item.current_published_revision_id != revision.id:
        content_item.published_at = now
    content_item.current_published_revision_id = revision.id
    await supersede_pending_reviews(db, content_item.id, below_version=revision.version)
    if revision.review_status == "pending_review":
        revision.review_status = "approved"
        revision.reviewed_by = published_by
        revision.reviewed_at = now


async def publish_revision(
    db: AsyncSession,
    content_item: ContentItem,
    revision: ContentRevision,
    created_by: uuid.UUID | None,
    *,
    source: str = ReleaseSource.PUBLISH,
) -> SiteRelease:
    """鎖定 SiteState → 讀目前 release manifest → 只替換這個 content item 的
    entry → 建新 release → 原子切換指標。其他 content item 的已發布版本
    完全不受影響（不論是否有共同 kind）。"""
    state = await _get_or_create_site_state(db)
    current_entries = await _release_entries(db, state.current_release_id)
    current_entries[content_item.id] = revision.id
    new_release = await _write_release(db, state, current_entries, created_by, source=source)
    await _mark_live(db, content_item, revision, created_by)
    await db.flush()
    return new_release


class ReleaseNotRestorable(Exception):
    """整站還原的目標裡有內容現在不能發布（欄位規則改了、素材已刪除…）。"""

    def __init__(self, problems: list[dict]) -> None:
        self.problems = problems
        super().__init__("release not restorable")


class ReleaseAlreadyCurrent(Exception):
    pass


class ReleaseChanged(Exception):
    """呼叫端看到的「目前版本」已經不是現在的版本（有人剛發布過）。"""


async def restore_release(
    db: AsyncSession,
    target_release_id: uuid.UUID,
    created_by: uuid.UUID | None,
    *,
    expected_current_release_id: uuid.UUID | None = None,
    check=None,
) -> tuple[SiteRelease, list[tuple[ContentItem, ContentRevision]], int]:
    """整站還原（規格 L155）：把官網上每一項內容換回目標那次發布時的版本，
    寫成一筆新的 release，不刪任何歷史，之後也能再還原回來。

    目標之後才第一次上線的內容項（例如後來新增的區塊）維持現狀，不會把它
    從官網拿掉。`check(item, revision)` 是發布前檢查，丟 NotPublishable 的
    內容項會一起列出、整批不動。回傳（新 release、實際換掉的內容項、維持
    不動的件數）。"""
    state = await _get_or_create_site_state(db)
    if expected_current_release_id is not None and state.current_release_id != expected_current_release_id:
        raise ReleaseChanged()
    if state.current_release_id == target_release_id:
        raise ReleaseAlreadyCurrent()
    target = await _release_entries(db, target_release_id)
    current = await _release_entries(db, state.current_release_id)
    changed_ids = {item_id: rev_id for item_id, rev_id in target.items() if current.get(item_id) != rev_id}
    kept = sum(1 for item_id in current if item_id not in target)
    if not changed_ids:
        # 內容和目前一模一樣（例如那次之後只是重新發布同一版）。
        raise ReleaseAlreadyCurrent()

    changed: list[tuple[ContentItem, ContentRevision]] = []
    problems: list[dict] = []
    for item_id, rev_id in changed_ids.items():
        item = await db.get(ContentItem, item_id, populate_existing=True)
        revision = await db.get(ContentRevision, rev_id, populate_existing=True)
        if item is None or revision is None:
            continue
        if check is not None:
            try:
                await check(item, revision)
            except Exception as exc:  # noqa: BLE001 - check 丟的是 NotPublishable，這裡只收集原因
                problems.append({"kind": item.kind, "campus_key": item.campus_key, "message": getattr(exc, "message", str(exc))})
                continue
        changed.append((item, revision))
    if problems:
        raise ReleaseNotRestorable(problems)

    entries = dict(current)
    for item, revision in changed:
        entries[item.id] = revision.id
    new_release = await _write_release(
        db, state, entries, created_by, source=ReleaseSource.RELEASE_RESTORE, restored_from=target_release_id
    )
    for item, revision in changed:
        await _mark_live(db, item, revision, created_by)
    await db.flush()
    return new_release, changed, kept


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
    today = today_local().isoformat()
    for _entry, revision, item in result.all():
        config = CONTENT_KIND_REGISTRY.get(item.kind)
        payload = config.public_view(revision.payload, today) if config is not None else revision.payload
        # 非共用（campus_key 導向）的 kind 一個 kind 會有多校各一列，用
        # campus_key 當第二層 key，不能直接覆蓋成同一個扁平欄位，否則只
        # 會留下其中一校的資料。
        if config is not None and not config.shared_only and item.campus_key is not None:
            content.setdefault(item.kind, {})[item.campus_key] = payload
        else:
            content[item.kind] = payload
    return str(state.current_release_id), content
