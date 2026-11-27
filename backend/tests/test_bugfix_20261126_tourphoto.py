"""2026-11-26 修復 tourphoto：校園探索可以發布沒有照片的場景。

後台「新增場景」帶的 image 是空字串，忘了選照片照樣能發布；官網環境頁的
responsiveImage('') 會接成 `/assets/.webp`，正式站破圖。現在比照五校介紹
（registry 的 publish_blocker）：草稿照存（先取名再選照片），發布、排程（建立
與到期執行）、核准、還原並發布都擋下，並講出是哪個場景沒照片。"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.auth.models import Role, User
from app.content import publish_jobs
from app.content.models import PublishJob
from app.content.registry import CONTENT_KIND_REGISTRY
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"
TOUR = f"{API}/admin/content-items/campus_tour"
Q = "?campus_key=yihua"


def _scene(key: str, name: str, image: str) -> dict:
    return {"key": key, "name": name, "image": image, "intro": ""}


def _tour_missing_photo() -> dict:
    # 第二個場景是按「新增場景」後只改了名稱、忘了選照片的樣子。
    return {"scenes": [_scene("hall", "大廳", "campus"), _scene("scene-1764140000000", "戶外遊戲場", "")]}


async def _draft(client, payload: dict, expected: int = 0) -> dict:
    resp = await client.post(f"{TOUR}/revisions{Q}", json={"expected_version": expected, "payload": payload})
    assert resp.status_code == 201, resp.text
    return resp.json()["latest_revision"]


def _assert_names_missing_scene(message: str) -> None:
    assert "第 2 個場景「戶外遊戲場」" in message
    assert "照片" in message
    assert "大廳" not in message


def test_blocker_names_every_scene_without_photo():
    blocker = CONTENT_KIND_REGISTRY["campus_tour"].publish_blocker
    assert blocker({"scenes": [_scene("a", "大廳", "campus")]}) is None
    message = blocker({"scenes": [_scene("a", "", ""), _scene("b", "大廳", "campus"), _scene("c", "菜園", "")]})
    assert message is not None
    assert "第 1 個場景" in message and "第 3 個場景「菜園」" in message
    assert "大廳" not in message


@pytest.mark.asyncio
async def test_draft_saves_but_publish_is_blocked(admin_client, public_client):
    rev = await _draft(admin_client, _tour_missing_photo())
    blocked = await admin_client.post(f"{TOUR}/publish{Q}", json={"revision_id": rev["id"]})
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"]["code"] == "CONTENT_NOT_READY"
    _assert_names_missing_scene(blocked.json()["detail"]["message"])
    # 沒有任何內容上線，官網不會拿到空的 image。
    site = await public_client.get(f"{API}/public/site")
    assert site.status_code == 503 or "campus_tour" not in site.json()["content"]


@pytest.mark.asyncio
async def test_schedule_is_blocked_when_created(admin_client):
    rev = await _draft(admin_client, _tour_missing_photo())
    at = datetime.now(timezone.utc) + timedelta(hours=2)
    blocked = await admin_client.post(f"{TOUR}/schedules{Q}", json={"revision_id": rev["id"], "publish_at": at.isoformat()})
    assert blocked.status_code == 409, blocked.text
    _assert_names_missing_scene(blocked.json()["detail"]["message"])


@pytest.mark.asyncio
async def test_due_schedule_fails_instead_of_publishing(admin_client, public_client, db_session):
    """規則上線前就排好的排程（或用其他方式建的）：到期時一樣擋下，記 failed 與原因。"""
    rev = await _draft(admin_client, _tour_missing_photo())
    admin = (await db_session.execute(select(User).where(User.email == "admin@ivy.example"))).scalar_one()
    now = datetime.now(timezone.utc)
    job = PublishJob(
        id=uuid.uuid4(),
        content_item_id=uuid.UUID((await admin_client.get(f"{TOUR}{Q}")).json()["id"]),
        revision_id=uuid.UUID(rev["id"]),
        publish_at=now - timedelta(seconds=1),
        created_at=now - timedelta(minutes=5),
        created_by=admin.id,
    )
    db_session.add(job)
    job_id = job.id
    await db_session.commit()

    assert await publish_jobs.run_due_jobs(db_session) == {"published": 0, "failed": 1, "skipped": 0}
    db_session.expire_all()
    job = await db_session.get(PublishJob, job_id)
    assert job.status == "failed"
    _assert_names_missing_scene(job.error)
    site = await public_client.get(f"{API}/public/site")
    assert site.status_code == 503 or "campus_tour" not in site.json()["content"]


@pytest.mark.asyncio
async def test_approving_submission_is_blocked(app, db_session, admin_client):
    """送審本身不擋（後台送審前會先提醒）；核准＝立即發布，要擋下並留在待審核。"""
    editor = await _create_user(db_session, "tour-editor@ivy.example", "tour-editor-pass-12", Role.EDITOR, ["yihua"])
    grant = await admin_client.patch(f"{API}/admin/users/{editor.id}/capabilities", json={"capabilities": ["content.shared"]})
    assert grant.status_code == 200, grant.text
    editor_client = await _logged_in_client(app, "tour-editor@ivy.example", "tour-editor-pass-12")
    try:
        rev = await _draft(editor_client, _tour_missing_photo())
        submitted = await editor_client.post(f"{TOUR}/submit{Q}", json={"revision_id": rev["id"]})
        assert submitted.status_code == 200, submitted.text
    finally:
        await editor_client.aclose()

    blocked = await admin_client.post(f"{TOUR}/review{Q}", json={"revision_id": rev["id"], "decision": "approve"})
    assert blocked.status_code == 409, blocked.text
    _assert_names_missing_scene(blocked.json()["detail"]["message"])
    latest = (await admin_client.get(f"{TOUR}{Q}")).json()["latest_revision"]
    assert latest["review_status"] == "pending_review"


@pytest.mark.asyncio
async def test_restore_and_publish_is_blocked(admin_client):
    old = await _draft(admin_client, _tour_missing_photo())
    fixed = await _draft(admin_client, {"scenes": [_scene("hall", "大廳", "campus")]}, expected=1)
    published = await admin_client.post(f"{TOUR}/publish{Q}", json={"revision_id": fixed["id"]})
    assert published.status_code == 200, published.text

    restored = await admin_client.post(
        f"{TOUR}/revisions/{old['id']}/restore{Q}", json={"expected_version": 2, "publish": True}
    )
    assert restored.status_code == 409, restored.text
    _assert_names_missing_scene(restored.json()["detail"]["message"])
    # 還原成草稿照舊可以（之後補照片再發布）。
    draft_only = await admin_client.post(
        f"{TOUR}/revisions/{old['id']}/restore{Q}", json={"expected_version": 2, "publish": False}
    )
    assert draft_only.status_code == 201, draft_only.text
