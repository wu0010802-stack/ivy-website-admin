"""發布與審核流程（2026-09-25 補齊）：過期的待審版、送審與退回通知、排程不蓋回
較新的版本、全站排程清單、發布紀錄與整站還原、總覽的待發布與素材提示、
欄位規則版本、fixture 匯入指令不覆寫後台內容。"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError

from app.auth.models import Role, User
from app.content import service
from app.content.models import ContentItem, ContentRevision, PublishJob, SiteRelease
from app.content.publish_jobs import run_due_jobs
from app.media.models import MediaAsset, MediaKind, MediaStatus
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"
FAQ = f"{API}/admin/content-items/campus_faq"
Q = "?campus_key=yihua"
ABOUT = f"{API}/admin/content-items/home_about"
FIXTURE = Path(__file__).resolve().parents[2] / "content" / "site-fixture.json"


def _faq(q="參觀要預約嗎？"):
    return {"items": [{"q": q, "a": "請先來電。"}]}


def _about(title="關於常春藤"):
    return {"title": title, "since_label": "SINCE 1995", "body_text": "內文", "caption": "照片說明"}


@pytest.fixture
async def yihua_admin(app, db_session):
    await _create_user(db_session, "yihua-admin@ivy.example", "yihua-admin-password-123", Role.CAMPUS_ADMIN, ["yihua"])
    client = await _logged_in_client(app, "yihua-admin@ivy.example", "yihua-admin-password-123")
    yield client
    await client.aclose()


async def _draft(client, expected=0, q="參觀要預約嗎？"):
    resp = await client.post(f"{FAQ}/revisions{Q}", json={"expected_version": expected, "payload": _faq(q)})
    assert resp.status_code == 201, resp.text
    return resp.json()["latest_revision"]


async def _about_draft(client, expected, title):
    resp = await client.post(f"{ABOUT}/revisions", json={"expected_version": expected, "payload": _about(title)})
    assert resp.status_code == 201, resp.text
    return resp.json()["latest_revision"]


async def _make_due(db_session):
    await db_session.execute(
        update(PublishJob)
        .where(PublishJob.status == "scheduled")
        .values(publish_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    )
    await db_session.commit()


async def _schedule(client, revision_id, *, path=FAQ, query=Q):
    at = datetime.now(timezone.utc) + timedelta(hours=2)
    resp = await client.post(f"{path}/schedules{query}", json={"revision_id": revision_id, "publish_at": at.isoformat()})
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# 第 55 條：過期的待審版與送審、退回通知
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_new_draft_supersedes_pending_review(editor_client, yihua_admin):
    rev1 = await _draft(editor_client)
    assert (await editor_client.post(f"{FAQ}/submit{Q}", json={"revision_id": rev1["id"]})).status_code == 200
    assert len((await yihua_admin.get(f"{API}/admin/content-reviews")).json()) == 1

    # 送審後又改了一版：舊的待審版不會再被審，待審清單與總覽都歸零。
    await _draft(editor_client, expected=1, q="改過的問題")
    assert (await yihua_admin.get(f"{API}/admin/content-reviews")).json() == []
    assert (await yihua_admin.get(f"{API}/admin/dashboard")).json()["pending_review"] == 0
    history = (await yihua_admin.get(f"{FAQ}/revisions{Q}")).json()
    assert [(r["version"], r["review_status"]) for r in history] == [(2, "draft"), (1, "superseded")]
    # 已被取代的版本不能再拿來審。
    stale = await yihua_admin.post(f"{FAQ}/review{Q}", json={"revision_id": rev1["id"], "decision": "approve"})
    assert stale.status_code == 409


@pytest.mark.asyncio
async def test_direct_publish_and_restore_clear_pending_reviews(editor_client, yihua_admin):
    rev1 = await _draft(editor_client)
    await editor_client.post(f"{FAQ}/submit{Q}", json={"revision_id": rev1["id"]})
    # 管理者不經審核按鈕、直接發布待審的那一版：等於核准，不留在待審清單。
    published = await yihua_admin.post(f"{FAQ}/publish{Q}", json={"revision_id": rev1["id"]})
    assert published.status_code == 200, published.text
    assert published.json()["latest_revision"]["review_status"] == "approved"
    assert (await yihua_admin.get(f"{API}/admin/content-reviews")).json() == []

    rev2 = await _draft(editor_client, expected=1, q="第二版")
    await editor_client.post(f"{FAQ}/submit{Q}", json={"revision_id": rev2["id"]})
    restored = await yihua_admin.post(
        f"{FAQ}/revisions/{rev1['id']}/restore{Q}", json={"expected_version": 2, "publish": True}
    )
    assert restored.status_code == 201, restored.text
    assert (await yihua_admin.get(f"{API}/admin/content-reviews")).json() == []
    statuses = {r["version"]: r["review_status"] for r in (await yihua_admin.get(f"{FAQ}/revisions{Q}")).json()}
    assert statuses[2] == "superseded"


@pytest.mark.asyncio
async def test_submit_and_decisions_notify_the_other_side(editor_client, yihua_admin, minghua_client, admin_client):
    rev = await _draft(editor_client)
    await editor_client.post(f"{FAQ}/submit{Q}", json={"revision_id": rev["id"]})

    inbox = (await yihua_admin.get(f"{API}/admin/my-notifications")).json()
    assert [(n["kind"], n["content_kind"], n["campus_key"], n["revision_version"]) for n in inbox] == [
        ("content_review_submitted", "campus_faq", "yihua", 1)
    ]
    assert inbox[0]["actor_email"] == "editor-yihua@ivy.example"
    # 總管理者也能核准，一樣收到；別校管理者與送審的人自己都不會收到。
    assert [n["kind"] for n in (await admin_client.get(f"{API}/admin/my-notifications")).json()] == ["content_review_submitted"]
    assert (await minghua_client.get(f"{API}/admin/my-notifications")).json() == []
    assert (await editor_client.get(f"{API}/admin/my-notifications")).json() == []

    await yihua_admin.post(f"{FAQ}/review{Q}", json={"revision_id": rev["id"], "decision": "reject", "note": "請補電話"})
    mine = (await editor_client.get(f"{API}/admin/my-notifications")).json()
    assert [(n["kind"], n["note"], n["actor_email"]) for n in mine] == [
        ("content_review_rejected", "請補電話", "yihua-admin@ivy.example")
    ]
    assert mine[0]["read_at"] is None
    # 側欄「發布紀錄」旁的未讀數字從總覽 API 取；內容編輯沒有營運總覽也讀得到。
    assert (await editor_client.get(f"{API}/admin/dashboard")).json()["my_unread_notifications"] == 1
    assert (await yihua_admin.get(f"{API}/admin/dashboard")).json()["my_unread_notifications"] == 1

    # 已讀是個人的；別人的通知當作不存在。
    other = await yihua_admin.post(f"{API}/admin/my-notifications/{mine[0]['id']}/read")
    assert other.status_code == 404
    read = await editor_client.post(f"{API}/admin/my-notifications/{mine[0]['id']}/read")
    assert read.status_code == 200 and read.json()["read_at"]
    assert (await editor_client.get(f"{API}/admin/dashboard")).json()["my_unread_notifications"] == 0
    all_read = await yihua_admin.post(f"{API}/admin/my-notifications/read-all")
    assert all_read.json() == {"updated": 1}
    assert all(n["read_at"] for n in (await yihua_admin.get(f"{API}/admin/my-notifications")).json())

    rev2 = await _draft(editor_client, expected=1, q="補上電話")
    await editor_client.post(f"{FAQ}/submit{Q}", json={"revision_id": rev2["id"]})
    await yihua_admin.post(f"{FAQ}/review{Q}", json={"revision_id": rev2["id"], "decision": "approve"})
    assert (await editor_client.get(f"{API}/admin/my-notifications")).json()[0]["kind"] == "content_review_approved"


@pytest.mark.asyncio
async def test_review_status_check_constraint_and_schema_version(admin_client, db_session):
    rev = await _draft(admin_client)
    stored = await db_session.get(ContentRevision, uuid.UUID(rev["id"]))
    assert stored.schema_version == 1
    history = (await admin_client.get(f"{FAQ}/revisions{Q}")).json()
    assert history[0]["schema_version"] == 1
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text("UPDATE content_revisions SET review_status = 'waiting' WHERE id = :id"), {"id": rev["id"]}
        )
    await db_session.rollback()


# ---------------------------------------------------------------------------
# 第 54 條：排程到期不蓋回較新的版本、失敗通知與總覽、全站排程清單
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_schedule_skips_when_newer_version_published(admin_client, public_client, db_session):
    rev1 = await _draft(admin_client, q="排程的版本")
    job = await _schedule(admin_client, rev1["id"])
    rev2 = await _draft(admin_client, expected=1, q="後來直接發布的版本")
    assert (await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev2["id"]})).status_code == 200

    await _make_due(db_session)
    assert await run_due_jobs(db_session) == {"published": 0, "failed": 0, "skipped": 1}
    site = (await public_client.get(f"{API}/public/site")).json()
    assert site["content"]["campus_faq"]["yihua"]["items"][0]["q"] == "後來直接發布的版本"

    listed = (await admin_client.get(f"{FAQ}/schedules{Q}")).json()
    assert listed[0]["id"] == job["id"] and listed[0]["status"] == "skipped"
    assert "第 2 版" in listed[0]["error"]
    notes = (await admin_client.get(f"{API}/admin/my-notifications")).json()
    assert notes[0]["kind"] == "content_schedule_skipped" and notes[0]["revision_version"] == 1
    # 略過不是待辦：官網已經是較新的內容。
    assert (await admin_client.get(f"{API}/admin/dashboard")).json()["failed_publish_jobs"] == []
    actions = (await db_session.execute(select(AuditLogEntry.action))).scalars().all()
    assert "content.schedule_skipped" in actions


@pytest.mark.asyncio
async def test_schedule_skips_when_newer_version_was_published_then_rolled_back(admin_client, public_client, db_session):
    rev1 = await _draft(admin_client, q="第一版")
    await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev1["id"]})
    rev2 = await _draft(admin_client, expected=1, q="排程的第二版")
    await _schedule(admin_client, rev2["id"])
    rev3 = await _draft(admin_client, expected=2, q="第三版")
    await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev3["id"]})
    # 又把官網直接切回第一版：排程之後已經發布過更新的第 3 版，照排程發第 2 版
    # 就會蓋掉別人後來的決定，所以一樣不發。
    await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev1["id"]})

    await _make_due(db_session)
    assert await run_due_jobs(db_session) == {"published": 0, "failed": 0, "skipped": 1}
    site = (await public_client.get(f"{API}/public/site")).json()
    assert site["content"]["campus_faq"]["yihua"]["items"][0]["q"] == "第一版"


@pytest.mark.asyncio
async def test_failed_schedule_notifies_and_shows_on_dashboard_until_published(admin_client, db_session):
    rev = await _draft(admin_client)
    await _schedule(admin_client, rev["id"])
    await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": False})
    await _make_due(db_session)
    assert await run_due_jobs(db_session) == {"published": 0, "failed": 1, "skipped": 0}

    notes = (await admin_client.get(f"{API}/admin/my-notifications")).json()
    assert notes[0]["kind"] == "content_schedule_failed" and "停用" in notes[0]["error"]
    failed = (await admin_client.get(f"{API}/admin/dashboard")).json()["failed_publish_jobs"]
    assert [(j["kind"], j["campus_key"], j["revision_version"]) for j in failed] == [("campus_faq", "yihua", 1)]

    # 有人處理（分校重新啟用後發布）之後就不再列在總覽。
    await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": True})
    await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev["id"]})
    assert (await admin_client.get(f"{API}/admin/dashboard")).json()["failed_publish_jobs"] == []


@pytest.mark.asyncio
async def test_site_wide_schedule_list_respects_scope(admin_client, yihua_admin, minghua_client, editor_client):
    rev = await _draft(yihua_admin)
    job = await _schedule(yihua_admin, rev["id"])
    about = await _about_draft(admin_client, 0, "排程的關於")
    await _schedule(admin_client, about["id"], path=ABOUT, query="")

    everything = (await admin_client.get(f"{API}/admin/publish-jobs")).json()
    assert {(j["kind"], j["campus_key"]) for j in everything} == {("campus_faq", "yihua"), ("home_about", None)}
    assert all(j["can_cancel"] for j in everything)

    # 分校管理者看得到自己校與共用內容的排程，但共用內容沒有授權不能取消。
    own = {(j["kind"], j["campus_key"]): j for j in (await yihua_admin.get(f"{API}/admin/publish-jobs")).json()}
    assert own[("campus_faq", "yihua")]["can_cancel"] is True
    assert own[("home_about", None)]["can_cancel"] is False
    assert [j["kind"] for j in (await minghua_client.get(f"{API}/admin/publish-jobs")).json()] == ["home_about"]
    assert not any(j["can_cancel"] for j in (await editor_client.get(f"{API}/admin/publish-jobs")).json())

    # 從清單取消走原本的單一內容端點。
    assert (await yihua_admin.delete(f"{FAQ}/schedules/{job['id']}{Q}")).status_code == 204
    statuses = {j["id"]: j["status"] for j in (await admin_client.get(f"{API}/admin/publish-jobs")).json()}
    assert statuses[job["id"]] == "cancelled"


# ---------------------------------------------------------------------------
# 第 56 條：發布紀錄與整站還原
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_release_history_lists_changes_per_release(admin_client, yihua_admin, minghua_client):
    about1 = await _about_draft(admin_client, 0, "第一版關於")
    await admin_client.post(f"{ABOUT}/publish", json={"revision_id": about1["id"]})
    faq = await _draft(yihua_admin)
    await yihua_admin.post(f"{FAQ}/publish{Q}", json={"revision_id": faq["id"]})
    about2 = await _about_draft(admin_client, 1, "第二版關於")
    await admin_client.post(f"{ABOUT}/publish", json={"revision_id": about2["id"]})

    page = (await admin_client.get(f"{API}/admin/releases")).json()
    assert page["next_before"] is None
    rows = [
        [(c["kind"], c["campus_key"], c["revision_version"], c["previous_revision_version"]) for c in r["changes"]]
        for r in page["items"]
    ]
    assert rows == [
        [("home_about", None, 2, 1)],
        [("campus_faq", "yihua", 1, None)],
        [("home_about", None, 1, None)],
    ]
    assert [r["is_current"] for r in page["items"]] == [True, False, False]
    assert page["items"][0]["source"] == "publish"
    assert page["items"][0]["created_by_email"] == "admin@ivy.example"

    # 別校帳號看不到義華的發布；分頁用 before。
    assert len((await minghua_client.get(f"{API}/admin/releases")).json()["items"]) == 2
    first = (await admin_client.get(f"{API}/admin/releases?limit=1")).json()
    assert len(first["items"]) == 1 and first["next_before"]
    rest = (await admin_client.get(f"{API}/admin/releases", params={"limit": 5, "before": first["next_before"]})).json()
    assert [r["id"] for r in rest["items"]] == [r["id"] for r in page["items"][1:]]


@pytest.mark.asyncio
async def test_release_restore_rolls_back_whole_site(admin_client, yihua_admin, public_client, db_session):
    about1 = await _about_draft(admin_client, 0, "第一版關於")
    await admin_client.post(f"{ABOUT}/publish", json={"revision_id": about1["id"]})
    faq1 = await _draft(admin_client, q="第一版問題")
    await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": faq1["id"]})
    target = (await admin_client.get(f"{API}/admin/releases")).json()["items"][0]

    about2 = await _about_draft(admin_client, 1, "發錯的關於")
    await admin_client.post(f"{ABOUT}/publish", json={"revision_id": about2["id"]})
    faq2 = await _draft(admin_client, expected=1, q="發錯的問題")
    await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": faq2["id"]})
    hero = await admin_client.post(
        f"{API}/admin/content-items/home_hero/revisions",
        json={"expected_version": 0, "payload": {"eyebrow": "新區塊", "copy_lines": ["後來才上線"], "cta_label": "參觀"}},
    )
    await admin_client.post(f"{API}/admin/content-items/home_hero/publish", json={"revision_id": hero.json()["latest_revision"]["id"]})
    # 留一份沒發布的草稿，還原不能動它。
    await _about_draft(admin_client, 2, "還沒發布的草稿")

    denied = await yihua_admin.post(f"{API}/admin/releases/{target['id']}/restore", json={})
    assert denied.status_code == 403
    current = (await admin_client.get(f"{API}/admin/releases")).json()["items"][0]["id"]
    stale = await admin_client.post(
        f"{API}/admin/releases/{target['id']}/restore", json={"expected_current_release_id": str(uuid.uuid4())}
    )
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "RELEASE_CHANGED"

    restored = await admin_client.post(
        f"{API}/admin/releases/{target['id']}/restore", json={"expected_current_release_id": current}
    )
    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert body["changed_count"] == 2 and body["kept_count"] == 1
    assert body["release"]["source"] == "release_restore"
    assert body["release"]["restored_from_release_id"] == target["id"]
    assert body["release"]["is_current"] is True

    content = (await public_client.get(f"{API}/public/site")).json()["content"]
    assert content["home_about"]["title"] == "第一版關於"
    assert content["campus_faq"]["yihua"]["items"][0]["q"] == "第一版問題"
    assert content["home_hero"]["eyebrow"] == "新區塊"
    about = (await admin_client.get(ABOUT)).json()
    assert about["latest_revision"]["payload"]["title"] == "還沒發布的草稿"
    assert about["current_published_revision_id"] == about1["id"]
    # 歷史都還在：原本的發布紀錄沒有被刪。
    assert len((await admin_client.get(f"{API}/admin/releases")).json()["items"]) == 6
    audit = (await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "release.restore"))).scalar_one()
    assert audit.target_type == "site_release" and audit.metadata_json["kept_count"] == 1

    again = await admin_client.post(f"{API}/admin/releases/{body['release']['id']}/restore", json={})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "RELEASE_ALREADY_CURRENT"


@pytest.mark.asyncio
async def test_release_restore_refuses_outdated_revisions(admin_client, db_session):
    about1 = await _about_draft(admin_client, 0, "第一版關於")
    await admin_client.post(f"{ABOUT}/publish", json={"revision_id": about1["id"]})
    target = (await admin_client.get(f"{API}/admin/releases")).json()["items"][0]
    about2 = await _about_draft(admin_client, 1, "第二版關於")
    await admin_client.post(f"{ABOUT}/publish", json={"revision_id": about2["id"]})
    # 模擬欄位規則改了：舊版本少了必填欄位。
    await db_session.execute(
        update(ContentRevision).where(ContentRevision.id == uuid.UUID(about1["id"])).values(payload={"title": "舊格式"})
    )
    await db_session.commit()

    blocked = await admin_client.post(f"{API}/admin/releases/{target['id']}/restore", json={})
    assert blocked.status_code == 409
    detail = blocked.json()["detail"]
    assert detail["code"] == "RELEASE_NOT_RESTORABLE"
    assert [(i["kind"], i["campus_key"]) for i in detail["items"]] == [("home_about", None)]
    about = (await admin_client.get(ABOUT)).json()
    assert about["current_published_revision_id"] == about2["id"]


# ---------------------------------------------------------------------------
# 第 58 條：總覽的待發布與素材提示
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dashboard_counts_drafts_newer_than_live_and_media_issues(admin_client, db_session):
    about1 = await _about_draft(admin_client, 0, "上線中")
    await admin_client.post(f"{ABOUT}/publish", json={"revision_id": about1["id"]})
    dash = (await admin_client.get(f"{API}/admin/dashboard")).json()
    assert dash["pending_publish"] == 0 and dash["pending_publish_items"] == []

    await _about_draft(admin_client, 1, "改好還沒發布")
    await _draft(admin_client)
    dash = (await admin_client.get(f"{API}/admin/dashboard")).json()
    assert dash["pending_publish"] == 2
    items = {(i["kind"], i["campus_key"]): i for i in dash["pending_publish_items"]}
    assert items[("home_about", None)]["latest_version"] == 2
    assert items[("home_about", None)]["published_version"] == 1
    assert items[("campus_faq", "yihua")]["published_version"] is None
    assert dash["pending_publish_kinds"] == ["campus_faq", "home_about"]

    media = MediaAsset(
        id=uuid.uuid4(), kind=MediaKind.IMAGE, status=MediaStatus.PROCESSING, storage_key=f"t/{uuid.uuid4()}",
        original_filename="share.jpg", content_type="image/jpeg", size_bytes=10, created_at=datetime.now(timezone.utc),
    )
    db_session.add(media)
    await db_session.commit()
    meta = {
        "title": "常春藤", "description": "描述", "header_phone_number": "07-0000000",
        "header_phone_note": "義華", "share_image": str(media.id),
    }
    saved = await admin_client.post(f"{API}/admin/content-items/site_meta/revisions", json={"expected_version": 0, "payload": meta})
    assert saved.status_code == 201, saved.text
    issues = (await admin_client.get(f"{API}/admin/dashboard")).json()["content_media_issues"]
    assert issues == [{"kind": "site_meta", "campus_key": None, "missing": 0, "not_ready": 1, "live": False}]


# ---------------------------------------------------------------------------
# 第 66 條：fixture 匯入指令
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_seed_from_fixture_refuses_to_overwrite_and_validates(db_session):
    from app.content import service
    from app.content.initialize import SeedRefused, pending_initialization, seed_from_fixture

    data = json.loads(FIXTURE.read_text())
    plan = await seed_from_fixture(db_session, data, None, dry_run=True)
    assert plan.kinds == ["home_about", "home_hero", "site_footer"] and plan.existing == []
    await db_session.rollback()
    assert (await db_session.execute(select(ContentItem))).scalars().all() == []

    await seed_from_fixture(db_session, data, None)
    await db_session.commit()
    _, content = await service.get_public_content(db_session)
    # 頁尾四個欄位都有，不再只帶 tagline。
    assert content["site_footer"] == {
        "tagline": data["footer"]["tagline"],
        "copyright": data["footer"]["copyright"],
        "bottom_note": data["footer"]["bottomNote"],
        "campus_list_label": data["footer"]["campusListLabel"],
        # 原型的頁尾連結是 hash 網址，不帶入；None＝官網沿用內建連結。
        "links": None,
    }
    releases = (await db_session.execute(select(SiteRelease.source))).scalars().all()
    assert set(releases) == {"initialize"}

    # 後台改過之後重跑：預設拒絕，什麼都不寫。
    about = (await db_session.execute(select(ContentItem).where(ContentItem.kind == "home_about"))).scalar_one()
    edited = await service.create_revision(db_session, about, _about("園方改好的"), 1, None)
    await service.publish_revision(db_session, about, edited, None)
    await db_session.commit()
    with pytest.raises(SeedRefused) as refused:
        await seed_from_fixture(db_session, data, None)
    assert refused.value.existing == ["home_about", "home_hero", "site_footer"]
    await db_session.rollback()
    assert (await service.get_public_content(db_session))[1]["home_about"]["title"] == "園方改好的"

    # --force 才蓋回，舊版本留在版本紀錄。
    await seed_from_fixture(db_session, data, None, force=True)
    await db_session.commit()
    assert (await service.get_public_content(db_session))[1]["home_about"]["title"] == data["home"]["about"]["title"]
    count = (await db_session.execute(select(ContentRevision).where(ContentRevision.content_item_id == about.id))).scalars().all()
    assert len(count) == 3

    # initialize-content 的 dry-run 只列出還沒有版本的項目，不建立任何列。
    pending = await pending_initialization(db_session, data)
    assert ("home_about", None) not in pending and ("campus_profile", "yihua") in pending
    # 20 筆（含 2026-09-25 起的全站共用常見問題）扣掉已有版本的 3 筆。
    assert len(pending) == 18
    assert len((await db_session.execute(select(ContentItem))).scalars().all()) == 3


# ---------------------------------------------------------------------------
# B06 審查意見：排程與手動發布的交錯、略過原因、排程舊版、總覽的共用內容與
# 「知道了」
# ---------------------------------------------------------------------------


async def _faq_item(db_session) -> ContentItem:
    result = await db_session.execute(
        select(ContentItem).where(ContentItem.kind == "campus_faq", ContentItem.campus_key == "yihua")
    )
    return result.scalar_one()


@pytest.mark.asyncio
async def test_schedule_waits_for_concurrent_publish_before_comparing_versions(app, admin_client, public_client, db_session):
    """B06-1：排程先讀「官網現在是哪一版」、之後才鎖官網的話，中間有人手動發布
    較新的一版，排程拿到鎖以後還是會把舊版蓋回去。現在先鎖再讀。"""
    rev1 = await _draft(admin_client, q="第一版")
    await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev1["id"]})
    rev2 = await _draft(admin_client, expected=1, q="排程的第二版")
    await _schedule(admin_client, rev2["id"])
    rev3 = await _draft(admin_client, expected=2, q="同時手動發布的第三版")
    await _make_due(db_session)

    async with app.state.session_factory() as manual:
        item = await _faq_item(manual)
        revision = await manual.get(ContentRevision, uuid.UUID(rev3["id"]))
        # 手動發布拿到官網的鎖、還沒 commit 時，排程剛好到期。
        await service.publish_revision(manual, item, revision, None)
        task = asyncio.create_task(run_due_jobs(db_session))
        await asyncio.sleep(0.5)
        assert not task.done()
        await manual.commit()
    counts = await asyncio.wait_for(task, timeout=10)

    assert counts == {"published": 0, "failed": 0, "skipped": 1}
    site = (await public_client.get(f"{API}/public/site")).json()
    assert site["content"]["campus_faq"]["yihua"]["items"][0]["q"] == "同時手動發布的第三版"
    job = (await admin_client.get(f"{FAQ}/schedules{Q}")).json()[0]
    assert job["status"] == "skipped" and "第 3 版" in job["error"]


@pytest.mark.asyncio
async def test_skip_reason_tells_whether_site_still_has_that_version(admin_client, db_session):
    """B06-3：排好之後直接發布過這一版、又被整站還原換掉時，官網現在不是這一版，
    原因不能寫「官網已經是這一版」。"""
    rev1 = await _draft(admin_client, q="第一版")
    await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev1["id"]})
    target = (await admin_client.get(f"{API}/admin/releases")).json()["items"][0]
    rev2 = await _draft(admin_client, expected=1, q="排程的第二版")
    await _schedule(admin_client, rev2["id"])
    await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev2["id"]})
    restored = await admin_client.post(f"{API}/admin/releases/{target['id']}/restore", json={})
    assert restored.status_code == 200, restored.text

    # 另一項內容：排好之後直接發布了同一版，官網現在就是這一版。
    about1 = await _about_draft(admin_client, 0, "排程的關於")
    await _schedule(admin_client, about1["id"], path=ABOUT, query="")
    await admin_client.post(f"{ABOUT}/publish", json={"revision_id": about1["id"]})

    await _make_due(db_session)
    assert await run_due_jobs(db_session) == {"published": 0, "failed": 0, "skipped": 2}
    faq_job = (await admin_client.get(f"{FAQ}/schedules{Q}")).json()[0]
    assert faq_job["error"] == "排好之後官網發布過第 2 版，之後又換成第 1 版，不會自動蓋回去"
    about_job = (await admin_client.get(f"{ABOUT}/schedules")).json()[0]
    assert about_job["error"] == "官網已經是這一版，不需要再發布"
    notes = (await admin_client.get(f"{API}/admin/my-notifications")).json()
    assert {n["error"] for n in notes if n["kind"] == "content_schedule_skipped"} == {faq_job["error"], about_job["error"]}


@pytest.mark.asyncio
async def test_schedule_refuses_revision_not_newer_than_live(admin_client, db_session):
    """B06-4：排程官網上這一版或更舊的版本，到期一定會略過，建立時就擋下並說明。"""
    rev1 = await _draft(admin_client, q="第一版")
    rev2 = await _draft(admin_client, expected=1, q="第二版")
    await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev2["id"]})
    at = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

    older = await admin_client.post(f"{FAQ}/schedules{Q}", json={"revision_id": rev1["id"], "publish_at": at})
    assert older.status_code == 409
    assert older.json()["detail"]["code"] == "SCHEDULE_REVISION_NOT_NEWER"
    assert "比官網目前的第 2 版舊" in older.json()["detail"]["message"]
    assert "從版本紀錄還原" in older.json()["detail"]["message"]
    same = await admin_client.post(f"{FAQ}/schedules{Q}", json={"revision_id": rev2["id"], "publish_at": at})
    assert same.status_code == 409 and same.json()["detail"]["message"] == "官網已經是這一版，不需要排程"
    assert (await db_session.execute(select(PublishJob))).scalars().all() == []

    # 比官網新的草稿照常可以排。
    rev3 = await _draft(admin_client, expected=2, q="第三版")
    await _schedule(admin_client, rev3["id"])


async def _fail_due_job(db_session, job_id: str) -> None:
    await db_session.execute(
        update(PublishJob)
        .where(PublishJob.id == uuid.UUID(job_id))
        .values(status="failed", error="引用的素材還沒處理完成或已被刪除", finished_at=datetime.now(timezone.utc))
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_dashboard_shared_content_only_for_those_who_can_edit_it(admin_client, yihua_admin, db_session):
    """B06-2：沒有「全站共用內容」授權的分校管理者進不了共用內容頁、也不能發布，
    總覽不列共用內容的待發布、素材問題與排程失敗。"""
    about = await _about_draft(admin_client, 0, "總管理者的草稿")
    shared_job = await _schedule(admin_client, about["id"], path=ABOUT, query="")
    await _fail_due_job(db_session, shared_job["id"])
    media = MediaAsset(
        id=uuid.uuid4(), kind=MediaKind.IMAGE, status=MediaStatus.PROCESSING, storage_key=f"t/{uuid.uuid4()}",
        original_filename="share.jpg", content_type="image/jpeg", size_bytes=10, created_at=datetime.now(timezone.utc),
    )
    db_session.add(media)
    await db_session.commit()
    meta = {
        "title": "常春藤", "description": "描述", "header_phone_number": "07-0000000",
        "header_phone_note": "義華", "share_image": str(media.id),
    }
    saved = await admin_client.post(f"{API}/admin/content-items/site_meta/revisions", json={"expected_version": 0, "payload": meta})
    assert saved.status_code == 201, saved.text
    faq = await _draft(yihua_admin)
    own_job = await _schedule(yihua_admin, faq["id"])
    await _fail_due_job(db_session, own_job["id"])

    dash = (await yihua_admin.get(f"{API}/admin/dashboard")).json()
    assert [(i["kind"], i["campus_key"]) for i in dash["pending_publish_items"]] == [("campus_faq", "yihua")]
    assert dash["pending_publish"] == 1 and dash["pending_publish_kinds"] == ["campus_faq"]
    assert dash["content_media_issues"] == []
    assert [j["id"] for j in dash["failed_publish_jobs"]] == [own_job["id"]]

    # 授權之後共用內容也算進來（和進得去共用內容頁同一條規則）。
    user = (await db_session.execute(select(User).where(User.email == "yihua-admin@ivy.example"))).scalar_one()
    granted = await admin_client.patch(f"{API}/admin/users/{user.id}/capabilities", json={"capabilities": ["content.shared"]})
    assert granted.status_code == 200, granted.text
    dash = (await yihua_admin.get(f"{API}/admin/dashboard")).json()
    assert {(i["kind"], i["campus_key"]) for i in dash["pending_publish_items"]} == {
        ("campus_faq", "yihua"), ("home_about", None), ("site_meta", None),
    }
    assert [i["kind"] for i in dash["content_media_issues"]] == ["site_meta"]
    assert {j["id"] for j in dash["failed_publish_jobs"]} == {own_job["id"], shared_job["id"]}


@pytest.mark.asyncio
async def test_unpublished_schedule_can_be_acknowledged(admin_client, yihua_admin, editor_client, minghua_client, db_session):
    """B06-5、B06-6：分校停用、決定不發布那一版時，沒有「之後重新發布」可以讓
    失敗的排程消失，要能按「知道了」；手動發布過之後編輯頁也不再提示。"""
    rev = await _draft(yihua_admin)
    job = await _schedule(yihua_admin, rev["id"])
    await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": False})
    await _make_due(db_session)
    assert await run_due_jobs(db_session) == {"published": 0, "failed": 1, "skipped": 0}
    listed = (await yihua_admin.get(f"{FAQ}/schedules{Q}")).json()
    assert listed[0]["status"] == "failed" and listed[0]["resolved"] is False
    assert [j["id"] for j in (await yihua_admin.get(f"{API}/admin/dashboard")).json()["failed_publish_jobs"]] == [job["id"]]

    ack_url = f"{FAQ}/schedules/{job['id']}/acknowledge{Q}"
    # 和取消排程同一個權限：內容編輯只能送審，別校的人看不到這項內容。
    assert (await editor_client.post(ack_url)).status_code == 403
    assert (await minghua_client.post(ack_url)).status_code == 404
    acked = await yihua_admin.post(ack_url)
    assert acked.status_code == 200, acked.text
    assert acked.json()["resolved"] is True and acked.json()["status"] == "failed"
    assert (await yihua_admin.get(f"{API}/admin/dashboard")).json()["failed_publish_jobs"] == []
    assert (await yihua_admin.get(f"{FAQ}/schedules{Q}")).json()[0]["resolved"] is True
    # 再按一次不重複記錄。
    assert (await yihua_admin.post(ack_url)).status_code == 200
    entries = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "content.schedule_acknowledge"))
    ).scalars().all()
    assert len(entries) == 1 and entries[0].metadata_json["job_id"] == job["id"]
    stored = (await db_session.execute(select(PublishJob).where(PublishJob.id == uuid.UUID(job["id"])))).scalar_one()
    assert stored.acknowledged_by == (
        await db_session.execute(select(User.id).where(User.email == "yihua-admin@ivy.example"))
    ).scalar_one()

    # 還沒到期的排程不需要「知道了」。
    await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": True})
    rev2 = await _draft(yihua_admin, expected=1, q="第二版")
    pending = await _schedule(yihua_admin, rev2["id"])
    refused = await yihua_admin.post(f"{FAQ}/schedules/{pending['id']}/acknowledge{Q}")
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "INVALID_TRANSITION"


@pytest.mark.asyncio
async def test_failed_schedule_resolved_once_site_changes_version(admin_client, db_session):
    """B06-5：排程失敗之後有人直接發布，編輯頁拿到的 resolved 跟總覽一樣變成已處理。"""
    rev = await _draft(admin_client)
    await _schedule(admin_client, rev["id"])
    await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": False})
    await _make_due(db_session)
    await run_due_jobs(db_session)
    assert (await admin_client.get(f"{FAQ}/schedules{Q}")).json()[0]["resolved"] is False

    await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": True})
    rev2 = await _draft(admin_client, expected=1, q="改好再發布")
    assert (await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev2["id"]})).status_code == 200
    listed = (await admin_client.get(f"{FAQ}/schedules{Q}")).json()
    assert listed[0]["status"] == "failed" and listed[0]["resolved"] is True
    assert (await admin_client.get(f"{API}/admin/dashboard")).json()["failed_publish_jobs"] == []
