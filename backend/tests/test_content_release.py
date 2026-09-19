from __future__ import annotations

import pytest


def _payload(title="標題", since_label="SINCE 1997", body="內文", caption="說明"):
    return {"title": title, "since_label": since_label, "body_text": body, "caption": caption}


@pytest.mark.asyncio
async def test_public_site_returns_503_before_any_publish(public_client):
    response = await public_client.get("/api/website/v1/public/site")
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_draft_does_not_change_public_release(admin_client, public_client):
    before = await public_client.get("/api/website/v1/public/site")
    assert before.status_code == 503  # 尚無 release

    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="草稿標題")},
    )
    assert draft.status_code == 201, draft.text

    after_draft = await public_client.get("/api/website/v1/public/site")
    assert after_draft.status_code == 503  # 草稿不影響公開站，這裡仍未發布過


@pytest.mark.asyncio
async def test_publish_makes_content_public_and_stable_release(admin_client, public_client):
    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="發布前標題")},
    )
    revision_id = draft.json()["latest_revision"]["id"]

    publish = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/publish",
        json={"revision_id": revision_id},
    )
    assert publish.status_code == 200

    site = await public_client.get("/api/website/v1/public/site")
    assert site.status_code == 200
    body = site.json()
    assert body["content"]["home_about"]["title"] == "發布前標題"
    release_id = body["release_id"]

    # 再打一次，release_id 不變（沒有新發布動作）
    site_again = await public_client.get("/api/website/v1/public/site")
    assert site_again.json()["release_id"] == release_id


@pytest.mark.asyncio
async def test_editing_after_publish_does_not_change_public_release(admin_client, public_client):
    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="第一版")},
    )
    revision_id = draft.json()["latest_revision"]["id"]
    await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/publish", json={"revision_id": revision_id}
    )
    before = await public_client.get("/api/website/v1/public/site")

    # 儲存新草稿但不發布
    draft2 = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 1, "payload": _payload(title="第二版尚未發布")},
    )
    assert draft2.status_code == 201

    after = await public_client.get("/api/website/v1/public/site")
    assert after.json()["release_id"] == before.json()["release_id"]
    assert after.json()["content"]["home_about"]["title"] == "第一版"


@pytest.mark.asyncio
async def test_version_conflict_rejected(admin_client):
    await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="A")},
    )
    # 用過期的 expected_version 再送一次
    stale = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="B")},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "CONTENT_VERSION_CONFLICT"


@pytest.mark.asyncio
async def test_campus_admin_cannot_edit_shared_home_content(minghua_client):
    response = await minghua_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload()},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_javascript_url_scheme_rejected(admin_client):
    response = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={
            "expected_version": 0,
            "payload": _payload(body="javascript:alert(1)"),
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_unknown_content_kind_returns_404(admin_client):
    response = await admin_client.get("/api/website/v1/admin/content-items/not-a-real-kind")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_home_hero_kind_roundtrip(admin_client, public_client):
    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_hero/revisions",
        json={
            "expected_version": 0,
            "payload": {
                "eyebrow": "常春藤幼兒園 · 高雄五校",
                "copy_lines": ["第一行", "第二行"],
                "cta_label": "看看孩子的一天",
            },
        },
    )
    assert draft.status_code == 201, draft.text
    revision_id = draft.json()["latest_revision"]["id"]

    publish = await admin_client.post(
        "/api/website/v1/admin/content-items/home_hero/publish", json={"revision_id": revision_id}
    )
    assert publish.status_code == 200

    site = await public_client.get("/api/website/v1/public/site")
    assert site.json()["content"]["home_hero"]["cta_label"] == "看看孩子的一天"


@pytest.mark.asyncio
async def test_home_hero_rejects_too_many_copy_lines(admin_client):
    response = await admin_client.post(
        "/api/website/v1/admin/content-items/home_hero/revisions",
        json={
            "expected_version": 0,
            "payload": {
                "eyebrow": "x",
                "copy_lines": ["1", "2", "3", "4"],
                "cta_label": "x",
            },
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_site_footer_kind_roundtrip(admin_client, public_client):
    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/site_footer/revisions",
        json={"expected_version": 0, "payload": {"tagline": "測試標語"}},
    )
    assert draft.status_code == 201
    revision_id = draft.json()["latest_revision"]["id"]
    await admin_client.post(
        "/api/website/v1/admin/content-items/site_footer/publish", json={"revision_id": revision_id}
    )
    site = await public_client.get("/api/website/v1/public/site")
    assert site.json()["content"]["site_footer"]["tagline"] == "測試標語"


@pytest.mark.asyncio
async def test_public_site_read_requires_no_auth(public_client, admin_client):
    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={"expected_version": 0, "payload": _payload(title="公開內容")},
    )
    revision_id = draft.json()["latest_revision"]["id"]
    await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/publish", json={"revision_id": revision_id}
    )
    response = await public_client.get("/api/website/v1/public/site")
    assert response.status_code == 200
    assert "content" in response.json()
