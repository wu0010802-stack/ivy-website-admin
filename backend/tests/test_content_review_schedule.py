"""內容編輯送審、分校管理者審核；排程發布與到期執行。"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from app.auth.models import Role
from app.content.models import PublishJob
from app.content.publish_jobs import run_due_jobs
from tests.conftest import _create_user, _logged_in_client

FAQ = "/api/website/v1/admin/content-items/campus_faq"
Q = "?campus_key=yihua"


def _faq(q="參觀要預約嗎？"):
    return {"items": [{"q": q, "a": "請先來電。"}]}


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


@pytest.mark.asyncio
async def test_editor_can_draft_but_not_publish(editor_client):
    rev = await _draft(editor_client)
    denied = await editor_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev["id"]})
    assert denied.status_code == 403
    schedule = await editor_client.post(
        f"{FAQ}/schedules{Q}",
        json={"revision_id": rev["id"], "publish_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()},
    )
    assert schedule.status_code == 403


@pytest.mark.asyncio
async def test_submit_reject_resubmit_approve(editor_client, yihua_admin, public_client):
    rev = await _draft(editor_client)
    submitted = await editor_client.post(f"{FAQ}/submit{Q}", json={"revision_id": rev["id"]})
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["latest_revision"]["review_status"] == "pending_review"
    again = await editor_client.post(f"{FAQ}/submit{Q}", json={"revision_id": rev["id"]})
    assert again.status_code == 409

    queue = await yihua_admin.get("/api/website/v1/admin/content-reviews")
    assert [(r["kind"], r["campus_key"]) for r in queue.json()] == [("campus_faq", "yihua")]
    assert queue.json()[0]["submitted_by_email"] == "editor-yihua@ivy.example"
    dash = await yihua_admin.get("/api/website/v1/admin/dashboard")
    assert dash.json()["pending_review"] == 1

    no_note = await yihua_admin.post(f"{FAQ}/review{Q}", json={"revision_id": rev["id"], "decision": "reject"})
    assert no_note.status_code == 422
    rejected = await yihua_admin.post(
        f"{FAQ}/review{Q}", json={"revision_id": rev["id"], "decision": "reject", "note": "答案請寫電話號碼"}
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["latest_revision"]["review_status"] == "rejected"
    assert rejected.json()["latest_revision"]["review_note"] == "答案請寫電話號碼"

    rev2 = await _draft(editor_client, expected=1, q="參觀要預約嗎？（修正）")
    await editor_client.post(f"{FAQ}/submit{Q}", json={"revision_id": rev2["id"]})
    approved = await yihua_admin.post(f"{FAQ}/review{Q}", json={"revision_id": rev2["id"], "decision": "approve"})
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["latest_revision"]["review_status"] == "approved"
    assert body["current_published_revision_id"] == rev2["id"]
    site = await public_client.get("/api/website/v1/public/site")
    assert site.json()["content"]["campus_faq"]["yihua"]["items"][0]["q"] == "參觀要預約嗎？（修正）"
    assert (await yihua_admin.get("/api/website/v1/admin/content-reviews")).json() == []


@pytest.mark.asyncio
async def test_other_campus_admin_cannot_review(editor_client, minghua_client):
    rev = await _draft(editor_client)
    await editor_client.post(f"{FAQ}/submit{Q}", json={"revision_id": rev["id"]})
    denied = await minghua_client.post(f"{FAQ}/review{Q}", json={"revision_id": rev["id"], "decision": "approve"})
    assert denied.status_code == 404
    assert (await minghua_client.get("/api/website/v1/admin/content-reviews")).json() == []


@pytest.mark.asyncio
async def test_schedule_runs_when_due_and_can_be_cancelled(admin_client, public_client, db_session):
    rev = await _draft(admin_client)
    past = await admin_client.post(
        f"{FAQ}/schedules{Q}",
        json={"revision_id": rev["id"], "publish_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()},
    )
    assert past.status_code == 422
    naive = await admin_client.post(
        f"{FAQ}/schedules{Q}", json={"revision_id": rev["id"], "publish_at": "2099-01-01T10:00:00"}
    )
    assert naive.status_code == 422

    at = datetime.now(timezone.utc) + timedelta(hours=2)
    job = await admin_client.post(f"{FAQ}/schedules{Q}", json={"revision_id": rev["id"], "publish_at": at.isoformat()})
    assert job.status_code == 201, job.text
    assert job.json()["status"] == "scheduled"

    # 還沒到期：不發布。
    assert await run_due_jobs(db_session) == {"published": 0, "failed": 0, "skipped": 0}
    assert (await public_client.get("/api/website/v1/public/site")).status_code == 503

    # 把時間撥到過去，模擬到期。
    await db_session.execute(update(PublishJob).values(publish_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
    await db_session.commit()
    assert await run_due_jobs(db_session) == {"published": 1, "failed": 0, "skipped": 0}
    site = await public_client.get("/api/website/v1/public/site")
    assert site.json()["content"]["campus_faq"]["yihua"]["items"][0]["q"] == "參觀要預約嗎？"

    listed = await admin_client.get(f"{FAQ}/schedules{Q}")
    assert listed.json()[0]["status"] == "done"

    rev2 = await _draft(admin_client, expected=1, q="新問題")
    job2 = await admin_client.post(
        f"{FAQ}/schedules{Q}", json={"revision_id": rev2["id"], "publish_at": at.isoformat()}
    )
    cancelled = await admin_client.delete(f"{FAQ}/schedules/{job2.json()['id']}{Q}")
    assert cancelled.status_code == 204
    assert (await admin_client.delete(f"{FAQ}/schedules/{job2.json()['id']}{Q}")).status_code == 409


@pytest.mark.asyncio
async def test_schedule_fails_if_scheduler_lost_permission(app, admin_client, db_session, public_client):
    creator = await _create_user(db_session, "leaving@ivy.example", "leaving-password-123", Role.CAMPUS_ADMIN, ["yihua"])
    client = await _logged_in_client(app, "leaving@ivy.example", "leaving-password-123")
    try:
        rev = await _draft(client)
        at = datetime.now(timezone.utc) + timedelta(hours=1)
        job = await client.post(f"{FAQ}/schedules{Q}", json={"revision_id": rev["id"], "publish_at": at.isoformat()})
        assert job.status_code == 201, job.text
    finally:
        await client.aclose()

    await admin_client.patch(f"/api/website/v1/admin/users/{creator.id}/active", json={"is_active": False})
    await db_session.execute(update(PublishJob).values(publish_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
    await db_session.commit()
    assert await run_due_jobs(db_session) == {"published": 0, "failed": 1, "skipped": 0}
    listed = await admin_client.get(f"{FAQ}/schedules{Q}")
    assert listed.json()[0]["status"] == "failed"
    assert "權限" in listed.json()[0]["error"]
    assert (await public_client.get("/api/website/v1/public/site")).status_code == 503


@pytest.mark.asyncio
async def test_inactive_campus_content_cannot_publish(admin_client):
    rev = await _draft(admin_client)
    await admin_client.patch("/api/website/v1/admin/campuses/yihua/status", json={"active": False})
    blocked = await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": rev["id"]})
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "CONTENT_NOT_READY"
    await admin_client.patch("/api/website/v1/admin/campuses/yihua/status", json={"active": True})
