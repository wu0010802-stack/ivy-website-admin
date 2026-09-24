"""規格 7：「全站內容編輯」是明確授權，只有總管理者能授予。"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from app.auth.models import Role
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"
HERO = f"{API}/admin/content-items/home_hero"
HERO_PAYLOAD = {"eyebrow": "常春藤", "copy_lines": ["一起長大"], "cta_label": "預約參觀"}


async def _grant(admin_client, user_id, caps):
    resp = await admin_client.patch(f"{API}/admin/users/{user_id}/capabilities", json={"capabilities": caps})
    return resp


@pytest.fixture
async def editor(app, db_session):
    user = await _create_user(db_session, "shared-editor@ivy.example", "shared-editor-pass-1", Role.EDITOR, ["yihua"])
    client = await _logged_in_client(app, "shared-editor@ivy.example", "shared-editor-pass-1")
    yield user, client
    await client.aclose()


@pytest.fixture
async def campus_admin(app, db_session):
    user = await _create_user(db_session, "shared-admin@ivy.example", "shared-admin-pass-12", Role.CAMPUS_ADMIN, ["yihua"])
    client = await _logged_in_client(app, "shared-admin@ivy.example", "shared-admin-pass-12")
    yield user, client
    await client.aclose()


@pytest.mark.asyncio
async def test_without_grant_editor_cannot_touch_shared_content(editor):
    _, client = editor
    denied = await client.post(f"{HERO}/revisions", json={"expected_version": 0, "payload": HERO_PAYLOAD})
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_granted_editor_drafts_and_submits_but_cannot_publish(admin_client, editor, campus_admin):
    user, client = editor
    granted = await _grant(admin_client, user.id, ["content.shared"])
    assert granted.status_code == 200, granted.text
    assert granted.json()["capabilities"] == ["content.shared"]

    draft = await client.post(f"{HERO}/revisions", json={"expected_version": 0, "payload": HERO_PAYLOAD})
    assert draft.status_code == 201, draft.text
    rev_id = draft.json()["latest_revision"]["id"]
    assert (await client.post(f"{HERO}/publish", json={"revision_id": rev_id})).status_code == 403
    assert (await client.post(f"{HERO}/submit", json={"revision_id": rev_id})).status_code == 200

    # 沒授權的分校管理者：看不到共用內容的送審、也不能審。
    _, admin2 = campus_admin
    assert (await admin2.get(f"{API}/admin/content-reviews")).json() == []
    assert (await admin2.post(f"{HERO}/review", json={"revision_id": rev_id, "decision": "approve"})).status_code == 403

    # 總管理者可以核准。
    approved = await admin_client.post(f"{HERO}/review", json={"revision_id": rev_id, "decision": "approve"})
    assert approved.status_code == 200, approved.text


@pytest.mark.asyncio
async def test_granted_campus_admin_can_publish_and_review_shared(admin_client, campus_admin):
    user, client = campus_admin
    await _grant(admin_client, user.id, ["content.shared"])
    draft = await client.post(f"{HERO}/revisions", json={"expected_version": 0, "payload": HERO_PAYLOAD})
    rev_id = draft.json()["latest_revision"]["id"]
    published = await client.post(f"{HERO}/publish", json={"revision_id": rev_id})
    assert published.status_code == 200, published.text
    dash = await client.get(f"{API}/admin/dashboard")
    assert dash.status_code == 200

    # 收回授權後立即失效。
    await _grant(admin_client, user.id, [])
    assert (await client.post(f"{HERO}/publish", json={"revision_id": rev_id})).status_code == 403


@pytest.mark.asyncio
async def test_granted_editor_can_upload_shared_media(admin_client, editor):
    user, client = editor
    buf = io.BytesIO()
    Image.new("RGB", (40, 30)).save(buf, "PNG")
    denied = await client.post(f"{API}/admin/media", data={"kind": "image"}, files={"file": ("a.png", buf.getvalue(), "image/png")})
    assert denied.status_code == 403
    await _grant(admin_client, user.id, ["content.shared"])
    ok = await client.post(f"{API}/admin/media", data={"kind": "image"}, files={"file": ("a.png", buf.getvalue(), "image/png")})
    assert ok.status_code == 201, ok.text


@pytest.mark.asyncio
async def test_grant_rules(admin_client, minghua_client, db_session):
    reception = await _create_user(db_session, "rc@ivy.example", "reception-pass-123", Role.RECEPTION, ["yihua"])
    assert (await _grant(admin_client, reception.id, ["content.shared"])).status_code == 400
    editor = await _create_user(db_session, "ed2@ivy.example", "editor-pass-12345", Role.EDITOR, ["yihua"])
    assert (await _grant(admin_client, editor.id, ["booking.export"])).status_code == 400
    # 只有總管理者能授予。
    assert (await _grant(minghua_client, editor.id, ["content.shared"])).status_code == 403

    created = await admin_client.post(
        f"{API}/admin/users",
        json={"email": "new-ed@ivy.example", "password": "a-long-enough-password", "role": "editor",
              "campus_keys": ["yihua"], "capabilities": ["content.shared"]},
    )
    assert created.status_code == 201, created.text
    assert created.json()["capabilities"] == ["content.shared"]

    # 改成櫃台時授權被清掉。
    changed = await admin_client.patch(
        f"{API}/admin/users/{created.json()['id']}/role", json={"role": "reception", "campus_keys": ["yihua"]}
    )
    assert changed.json()["capabilities"] == []
