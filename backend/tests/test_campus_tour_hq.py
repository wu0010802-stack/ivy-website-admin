"""2026-10-05 校園探索（官網環境頁「五所校園」）改由總部帳號直接控制：各校各一份，
但編輯、發布、送審與總覽提醒都比照共用內容（registry 的 hq_managed）。"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from app.auth.models import Role
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"
TOUR = f"{API}/admin/content-items/campus_tour"
PROFILE = f"{API}/admin/content-items/campus_profile"


def _tour(name: str = "大廳") -> dict:
    return {"scenes": [{"key": "hall", "name": name, "image": "campus", "intro": "介紹"}]}


async def _grant(admin_client, user_id, caps):
    resp = await admin_client.patch(f"{API}/admin/users/{user_id}/capabilities", json={"capabilities": caps})
    assert resp.status_code == 200, resp.text


async def _draft(client, campus_key: str, name: str = "大廳"):
    return await client.post(
        f"{TOUR}/revisions?campus_key={campus_key}", json={"expected_version": 0, "payload": _tour(name)}
    )


@pytest.fixture
async def yihua_admin(app, db_session):
    user = await _create_user(db_session, "tour-admin@ivy.example", "tour-admin-pass-123", Role.CAMPUS_ADMIN, ["yihua"])
    client = await _logged_in_client(app, "tour-admin@ivy.example", "tour-admin-pass-123")
    yield user, client
    await client.aclose()


@pytest.fixture
async def yihua_editor(app, db_session):
    user = await _create_user(db_session, "tour-editor@ivy.example", "tour-editor-pass-12", Role.EDITOR, ["yihua"])
    client = await _logged_in_client(app, "tour-editor@ivy.example", "tour-editor-pass-12")
    yield user, client
    await client.aclose()


@pytest.mark.asyncio
async def test_campus_accounts_cannot_edit_own_campus_tour(yihua_admin, yihua_editor):
    _, admin = yihua_admin
    _, editor = yihua_editor
    assert (await _draft(admin, "yihua")).status_code == 403
    assert (await _draft(editor, "yihua")).status_code == 403
    # 其他各校內容照舊由分校編輯。
    profile = await admin.get(f"{PROFILE}?campus_key=yihua")
    assert profile.status_code == 200
    # 讀取比照共用內容：看得到，只是不能改。
    read = await admin.get(f"{TOUR}?campus_key=minghua")
    assert read.status_code == 200, read.text


@pytest.mark.asyncio
async def test_super_admin_publishes_every_campus(admin_client, yihua_admin):
    for key in ("yihua", "minghua"):
        draft = await _draft(admin_client, key)
        assert draft.status_code == 201, draft.text
        published = await admin_client.post(
            f"{TOUR}/publish?campus_key={key}", json={"revision_id": draft.json()["latest_revision"]["id"]}
        )
        assert published.status_code == 200, published.text
    _, admin = yihua_admin
    latest = (await admin_client.get(f"{TOUR}?campus_key=yihua")).json()["latest_revision"]
    denied = await admin.post(f"{TOUR}/publish?campus_key=yihua", json={"revision_id": latest["id"]})
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_shared_grant_covers_tours_of_other_campuses(admin_client, yihua_admin):
    user, admin = yihua_admin
    await _grant(admin_client, user.id, ["content.shared"])
    # 授權的分校管理者五校都能改、能發布（不限自己的校區）。
    draft = await _draft(admin, "minghua")
    assert draft.status_code == 201, draft.text
    published = await admin.post(
        f"{TOUR}/publish?campus_key=minghua", json={"revision_id": draft.json()["latest_revision"]["id"]}
    )
    assert published.status_code == 200, published.text
    # 發布紀錄看得到別校的校園探索。
    releases = (await admin.get(f"{API}/admin/releases")).json()["items"]
    changes = [change for release in releases for change in release["changes"]]
    assert any(c["kind"] == "campus_tour" and c["campus_key"] == "minghua" for c in changes)


@pytest.mark.asyncio
async def test_granted_editor_submits_and_only_shared_publishers_review(admin_client, yihua_editor, yihua_admin):
    editor_user, editor = yihua_editor
    await _grant(admin_client, editor_user.id, ["content.shared"])
    draft = await _draft(editor, "chongde")
    assert draft.status_code == 201, draft.text
    rev_id = draft.json()["latest_revision"]["id"]
    assert (await editor.post(f"{TOUR}/publish?campus_key=chongde", json={"revision_id": rev_id})).status_code == 403
    assert (await editor.post(f"{TOUR}/submit?campus_key=chongde", json={"revision_id": rev_id})).status_code == 200

    # 沒授權的分校管理者不列、不能審；總管理者列得到。
    _, admin = yihua_admin
    assert (await admin.get(f"{API}/admin/content-reviews")).json() == []
    reviews = (await admin_client.get(f"{API}/admin/content-reviews")).json()
    assert [(r["kind"], r["campus_key"]) for r in reviews] == [("campus_tour", "chongde")]


@pytest.mark.asyncio
async def test_dashboard_reminders_follow_hq_rule(admin_client, yihua_admin):
    # 義華的校園探索有未發布的草稿：義華分校管理者的總覽不提醒，有授權後才算。
    assert (await _draft(admin_client, "yihua")).status_code == 201
    user, admin = yihua_admin

    def tour_items(dash: dict) -> list[tuple[str, str | None]]:
        return [(row["kind"], row["campus_key"]) for row in dash["pending_publish_items"] if row["kind"] == "campus_tour"]

    assert tour_items((await admin.get(f"{API}/admin/dashboard")).json()) == []
    assert tour_items((await admin_client.get(f"{API}/admin/dashboard")).json()) == [("campus_tour", "yihua")]
    await _grant(admin_client, user.id, ["content.shared"])
    assert tour_items((await admin.get(f"{API}/admin/dashboard")).json()) == [("campus_tour", "yihua")]


@pytest.mark.asyncio
async def test_media_usages_treat_tour_as_shared(admin_client, yihua_admin):
    # 素材「用在哪裡」：校園探索比照共用內容，各校都看得到場景名稱，但只有總部能前往編輯。
    buf = io.BytesIO()
    Image.new("RGB", (40, 30)).save(buf, "PNG")
    uploaded = await admin_client.post(
        f"{API}/admin/media", data={"kind": "image"}, files={"file": ("a.png", buf.getvalue(), "image/png")}
    )
    assert uploaded.status_code == 201, uploaded.text
    media_id = uploaded.json()["id"]
    saved = await admin_client.post(
        f"{TOUR}/revisions?campus_key=minghua",
        json={"expected_version": 0, "payload": {"scenes": [{"key": "hall", "name": "大廳", "image": media_id, "intro": "介紹"}]}},
    )
    assert saved.status_code == 201, saved.text
    user, admin = yihua_admin
    [ref] = (await admin.get(f"{API}/admin/media/{media_id}/usages")).json()["references"]
    assert ref["kind"] == "campus_tour" and ref["label"] is not None and ref["can_edit"] is False
    await _grant(admin_client, user.id, ["content.shared"])
    [ref] = (await admin.get(f"{API}/admin/media/{media_id}/usages")).json()["references"]
    assert ref["can_edit"] is True
