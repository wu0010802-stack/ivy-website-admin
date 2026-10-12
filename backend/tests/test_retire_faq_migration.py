"""2026-10-08 刪除 FAQ 內容類型的資料 migration（a9e11038c869）。

資料庫裡已經建立的 shared_faq／campus_faq 內容（版本、發布紀錄、排程、素材引用、
站內通知）要整批清掉，非 FAQ 的內容與 release 本身不受影響。"""
from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.auth.models import Role
from app.content import notices, service
from app.content.models import ContentItem, ContentRevision, PublishJob, SiteRelease, SiteReleaseEntry, SiteState
from app.content.registry import CONTENT_KIND_REGISTRY
from app.media.models import MediaAsset, MediaKind, MediaStatus, MediaUsage
from app.notifications.models import UserNotification
from tests.conftest import _create_user

_MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations" / "versions" / "a9e11038c869_delete_retired_faq_content.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("delete_retired_faq_migration", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


async def _run_delete(app) -> dict[str, int]:
    migration = _migration()
    async with app.state.engine.begin() as conn:
        return await conn.run_sync(migration._delete_retired_faq)


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _publish(db, kind: str, campus_key: str | None, payload: dict) -> tuple[ContentItem, ContentRevision]:
    """直接寫版本並發布（不經 API 的欄位驗證）：registry 已不認得 FAQ，模擬正式庫的既有資料。"""
    item = await service.get_or_create_content_item(db, kind, campus_key)
    revision = await service.create_revision(db, item, payload, item.latest_version, None)
    await service.publish_revision(db, item, revision, None)
    return item, revision


def test_registry_no_longer_knows_faq_kinds():
    assert "shared_faq" not in CONTENT_KIND_REGISTRY
    assert "campus_faq" not in CONTENT_KIND_REGISTRY


@pytest.mark.asyncio
async def test_deleting_retired_faq_removes_every_row_that_points_at_it(app, db_session):
    editor = await _create_user(db_session, "faq-editor@ivy.example", "editor-password-123", Role.SUPER_ADMIN)

    footer, footer_rev = await _publish(db_session, "site_footer", None, {"tagline": "保留"})
    shared, shared_rev = await _publish(db_session, "shared_faq", None, {"items": [{"id": "faq-1", "q": "Q", "a": "A"}]})
    yihua, yihua_rev = await _publish(db_session, "campus_faq", "yihua", {"items": [{"q": "Q1", "a": "A1"}]})
    # 明華另有一份還沒發布的新草稿：FAQ 的所有版本都要刪。
    minghua, minghua_rev = await _publish(db_session, "campus_faq", "minghua", {"items": []})
    await service.create_revision(db_session, minghua, {"items": [{"q": "草稿", "a": "草稿"}]}, minghua.latest_version, None)
    # 非 FAQ 內容另有一版草稿，應該原封不動。
    await service.create_revision(db_session, footer, {"tagline": "草稿"}, footer.latest_version, None)

    now = datetime.now(timezone.utc)
    asset = MediaAsset(
        id=uuid.uuid4(), campus_key=None, kind=MediaKind.IMAGE, status=MediaStatus.READY, storage_key="faq-migration.webp",
        original_filename="a.webp", content_type="image/webp", size_bytes=1, created_at=now,
    )
    db_session.add(asset)
    await db_session.flush()
    # FAQ 沒有素材欄位，正常沒有引用；這裡三種寫法（kind、revision、內容項 id）各放一筆，
    # 另放一筆非 FAQ 的引用。
    for content_item_id, kind, revision_id, field in (
        (str(shared.id), "shared_faq", shared_rev.id, "items[0].image"),
        (str(yihua.id), None, yihua_rev.id, "items[0].image"),
        (str(minghua.id), None, None, "items[1].image"),
        (str(footer.id), "site_footer", footer_rev.id, "logo"),
    ):
        db_session.add(
            MediaUsage(
                id=uuid.uuid4(), media_id=asset.id, campus_key=None, content_item_id=content_item_id,
                content_kind=kind, revision_id=revision_id, field_name=field, created_at=now,
            )
        )
    for item, revision in ((shared, shared_rev), (yihua, yihua_rev), (footer, footer_rev)):
        db_session.add(
            PublishJob(
                id=uuid.uuid4(), content_item_id=item.id, revision_id=revision.id, publish_at=now + timedelta(days=1),
                status="scheduled", created_by=editor.id, created_at=now,
            )
        )
        await notices.notify(db_session, [editor.id], notices.SCHEDULE_FAILED, item, reason="測試")
    await db_session.commit()
    footer_id, footer_rev_id = footer.id, footer_rev.id

    state = await db_session.get(SiteState, 1)
    release_id = state.current_release_id
    releases_before = await _count(db_session, SiteRelease)
    entries = (
        await db_session.execute(select(SiteReleaseEntry.content_item_id).where(SiteReleaseEntry.release_id == release_id))
    ).scalars().all()
    assert {shared.id, yihua.id, minghua.id, footer.id} == set(entries)

    counts = await _run_delete(app)

    assert counts["content_items"] == 3
    assert counts["content_revisions"] == 4  # shared 1、yihua 1、minghua 2
    # 每次發布都會寫一次完整 manifest：共用題目出現在 3 次、義華 2 次、明華 1 次。
    assert counts["site_release_entries"] == 6
    assert counts["publish_jobs"] == 2
    assert counts["media_usages"] == 3
    assert counts["user_notifications"] == 2

    db_session.expire_all()
    kinds = (await db_session.execute(select(ContentItem.kind))).scalars().all()
    assert kinds == ["site_footer"]
    # 非 FAQ 內容的版本（已發布版＋草稿）、排程、引用與通知都還在。
    footer_versions = (
        await db_session.execute(select(ContentRevision.version).where(ContentRevision.content_item_id == footer_id))
    ).scalars().all()
    assert sorted(footer_versions) == [1, 2]
    assert (await db_session.get(ContentItem, footer_id)).current_published_revision_id == footer_rev_id
    assert await _count(db_session, PublishJob) == 1
    assert (await db_session.execute(select(PublishJob.content_item_id))).scalar_one() == footer_id
    assert (await db_session.execute(select(MediaUsage.content_item_id))).scalars().all() == [str(footer_id)]
    assert (await db_session.execute(select(UserNotification.content_item_id))).scalars().all() == [footer_id]
    # release 本身保留（官網仍指向同一次發布），只少了 FAQ 那幾列，其他內容的列不變。
    assert await _count(db_session, SiteRelease) == releases_before
    assert (await db_session.get(SiteState, 1)).current_release_id == release_id
    left = (
        await db_session.execute(select(SiteReleaseEntry.content_item_id, SiteReleaseEntry.revision_id))
    ).all()
    assert {(entry.content_item_id, entry.revision_id) for entry in left} == {(footer_id, footer_rev_id)}


@pytest.mark.asyncio
async def test_deleting_retired_faq_is_a_noop_without_faq_and_safe_to_rerun(app, db_session):
    footer, footer_rev = await _publish(db_session, "site_footer", None, {"tagline": "保留"})
    await db_session.commit()
    footer_id, footer_rev_id = footer.id, footer_rev.id

    first = await _run_delete(app)
    second = await _run_delete(app)

    assert set(first.values()) == {0}
    assert set(second.values()) == {0}
    db_session.expire_all()
    assert (await db_session.get(ContentItem, footer_id)).current_published_revision_id == footer_rev_id
    assert await _count(db_session, SiteReleaseEntry) == 1
