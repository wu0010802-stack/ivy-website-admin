"""內容版本歷史、還原成草稿、直接發布舊版。"""
from __future__ import annotations

import pytest

from tests.test_content_release import _payload

API = "/api/website/v1/admin/content-items/home_about"


async def _save(client, expected, title):
    resp = await client.post(f"{API}/revisions", json={"expected_version": expected, "payload": _payload(title=title)})
    assert resp.status_code == 201, resp.text
    return resp.json()["latest_revision"]


@pytest.mark.asyncio
async def test_history_marks_published_versions(admin_client):
    v1 = await _save(admin_client, 0, "第一版")
    await admin_client.post(f"{API}/publish", json={"revision_id": v1["id"]})
    v2 = await _save(admin_client, 1, "第二版")
    await admin_client.post(f"{API}/publish", json={"revision_id": v2["id"]})
    await _save(admin_client, 2, "第三版草稿")

    history = await admin_client.get(f"{API}/revisions")
    assert history.status_code == 200, history.text
    rows = history.json()
    assert [r["version"] for r in rows] == [3, 2, 1]
    assert [r["is_published"] for r in rows] == [False, True, False]
    assert [r["ever_published"] for r in rows] == [False, True, True]
    assert rows[0]["created_by_email"] == "admin@ivy.example"

    one = await admin_client.get(f"{API}/revisions/{v1['id']}")
    assert one.json()["payload"]["title"] == "第一版"


@pytest.mark.asyncio
async def test_restore_creates_new_draft_without_publishing(admin_client, public_client):
    v1 = await _save(admin_client, 0, "第一版")
    await admin_client.post(f"{API}/publish", json={"revision_id": v1["id"]})
    v2 = await _save(admin_client, 1, "改壞的版本")
    await admin_client.post(f"{API}/publish", json={"revision_id": v2["id"]})

    restored = await admin_client.post(f"{API}/restore", json={"revision_id": v1["id"], "expected_version": 2})
    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert body["latest_version"] == 3
    assert body["latest_revision"]["payload"]["title"] == "第一版"
    # 還原只是草稿，線上還是改壞的那版。
    site = await public_client.get("/api/website/v1/public/site")
    assert site.json()["content"]["home_about"]["title"] == "改壞的版本"

    stale = await admin_client.post(f"{API}/restore", json={"revision_id": v1["id"], "expected_version": 2})
    assert stale.status_code == 409


@pytest.mark.asyncio
async def test_publish_old_revision_rolls_back_public_site(admin_client, public_client):
    v1 = await _save(admin_client, 0, "第一版")
    await admin_client.post(f"{API}/publish", json={"revision_id": v1["id"]})
    v2 = await _save(admin_client, 1, "第二版")
    await admin_client.post(f"{API}/publish", json={"revision_id": v2["id"]})

    rollback = await admin_client.post(f"{API}/publish", json={"revision_id": v1["id"]})
    assert rollback.status_code == 200
    site = await public_client.get("/api/website/v1/public/site")
    assert site.json()["content"]["home_about"]["title"] == "第一版"


@pytest.mark.asyncio
async def test_campus_admin_cannot_restore_shared_content(admin_client, minghua_client):
    v1 = await _save(admin_client, 0, "第一版")
    denied = await minghua_client.post(f"{API}/restore", json={"revision_id": v1["id"], "expected_version": 1})
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_campus_history_is_scoped(admin_client, minghua_client):
    assert (await minghua_client.get("/api/website/v1/admin/content-items/campus_faq/revisions?campus_key=yihua")).status_code == 404
    assert (await minghua_client.get("/api/website/v1/admin/content-items/campus_faq/revisions?campus_key=minghua")).status_code == 200
