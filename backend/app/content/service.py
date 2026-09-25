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
from app.campuses.models import CAMPUS_NAMES, Campus
from app.common.timezones import today_local
from app.content.registry import CONTENT_KIND_REGISTRY, drop_unshared_faq_markers, schema_version_of


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


async def lock_site_state(db: AsyncSession) -> SiteState:
    """鎖住「官網目前是哪一次發布」直到交易結束。立即發布、核准、還原、整站
    還原都在 publish_revision／restore_release 裡拿同一把鎖；要先看官網現在
    是哪一版、再決定發不發布的呼叫端（排程到期）要先拿鎖再讀，否則讀完到
    發布之間別人插進來的較新版本會被蓋回去。"""
    return await _get_or_create_site_state(db)


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


def _drop_inactive_scope(entries: list, inactive: set[str]) -> list:
    """全站消息、活動與共用常見問題裡只適用停用校區的項目不輸出；適用多校的
    只拿掉停用的那幾校。舊版本手打的 campus 文字（「仁武校」）照校名比對。"""
    inactive_names = {CAMPUS_NAMES[key] for key in inactive if key in CAMPUS_NAMES}
    kept = []
    for entry in entries:
        if not isinstance(entry, dict):
            kept.append(entry)
            continue
        if entry.get("scope") == "campus":
            keys = [key for key in entry.get("campus_keys") or [] if key not in inactive]
            if not keys:
                continue
            entry = {**entry, "campus_keys": keys}
        elif "scope" not in entry and (entry.get("campus") or "").strip() in inactive_names:
            continue
        kept.append(entry)
    return kept


def _without_inactive_campuses(kind: str, payload: dict, inactive: set[str]) -> dict:
    if kind == "home_news":
        return {
            **payload,
            "articles": _drop_inactive_scope(payload.get("articles", []), inactive),
            "events": _drop_inactive_scope(payload.get("events", []), inactive),
        }
    if kind == "shared_faq":
        return {**payload, "items": _drop_inactive_scope(payload.get("items", []), inactive)}
    return payload


async def inactive_campus_keys(db: AsyncSession) -> set[str]:
    result = await db.execute(select(Campus.key).where(Campus.active.is_(False)))
    return set(result.scalars())


async def published_payload(db: AsyncSession, kind: str, campus_key: str | None) -> dict | None:
    """這項內容目前發布中的 payload；沒發布過回 None。「目前發布中」看
    current_published_revision_id（與站台 release 在同一個交易切換，見
    booking/consent.py）。不管分校是否停用：停用的分校只是 get_public_content
    不輸出，家長管理頁仍要顯示那一校的校名與電話。"""
    campus_filter = ContentItem.campus_key.is_(None) if campus_key is None else ContentItem.campus_key == campus_key
    result = await db.execute(
        select(ContentRevision.payload)
        .join(ContentItem, ContentItem.current_published_revision_id == ContentRevision.id)
        .where(ContentItem.kind == kind, campus_filter)
    )
    payload = result.scalar_one_or_none()
    return payload if isinstance(payload, dict) else None


async def get_public_content(db: AsyncSession) -> tuple[str | None, dict]:
    """回傳 (release_id, content dict)。尚無任何 release 時 release_id 為 None，
    呼叫端（public route）應視為「尚無可用內容」回 503，不得回假資料。

    停用的分校（規格 3.2、9.2）不出現在公開內容裡：那一校的介紹、常見問題、
    探索與消息都不輸出，官網因此不列這一校（首頁五校、頁尾、sitemap），分校頁
    回 404；只適用那一校的全站消息與共用題目也一起拿掉。發布紀錄不動，重新
    啟用後原本已發布的內容直接恢復。草稿預覽走後台 API，不受影響。"""
    result = await db.execute(select(SiteState).where(SiteState.id == 1))
    state = result.scalar_one_or_none()
    if state is None or state.current_release_id is None:
        return None, {}
    inactive = await inactive_campus_keys(db)

    result = await db.execute(
        select(SiteReleaseEntry, ContentRevision, ContentItem)
        .join(ContentRevision, SiteReleaseEntry.revision_id == ContentRevision.id)
        .join(ContentItem, SiteReleaseEntry.content_item_id == ContentItem.id)
        .where(SiteReleaseEntry.release_id == state.current_release_id)
    )
    content: dict = {}
    today = today_local().isoformat()
    for _entry, revision, item in result.all():
        if item.campus_key is not None and item.campus_key in inactive:
            continue
        config = CONTENT_KIND_REGISTRY.get(item.kind)
        payload = config.public_view(revision.payload, today) if config is not None else revision.payload
        if inactive:
            payload = _without_inactive_campuses(item.kind, payload, inactive)
        # 非共用（campus_key 導向）的 kind 一個 kind 會有多校各一列，用
        # campus_key 當第二層 key，不能直接覆蓋成同一個扁平欄位，否則只
        # 會留下其中一校的資料。
        if config is not None and not config.shared_only and item.campus_key is not None:
            content.setdefault(item.kind, {})[item.campus_key] = payload
        else:
            content[item.kind] = payload
    if "campus_faq" in content:
        # 停用的本校題目只在藏住同一題共用題目時才需要輸出問題文字，要等共用
        # 題目也讀進來才能比對（見 registry.drop_unshared_faq_markers）。
        content["campus_faq"] = {
            campus_key: drop_unshared_faq_markers(campus_key, payload, content.get("shared_faq"))
            for campus_key, payload in content["campus_faq"].items()
        }
    return str(state.current_release_id), content


def public_media_ids(content: dict) -> set[uuid.UUID]:
    """公開內容（get_public_content 的輸出）引用到的素材：官網要這些素材的
    尺寸、衍生檔與預設焦點才能組 srcset 與 object-position。"""
    ids: set[uuid.UUID] = set()
    for kind, value in content.items():
        config = CONTENT_KIND_REGISTRY.get(kind)
        if config is None or not isinstance(value, dict):
            continue
        payloads = value.values() if not config.shared_only else [value]
        for payload in payloads:
            if isinstance(payload, dict):
                ids.update(config.extract_media_ids(payload))
    return ids

