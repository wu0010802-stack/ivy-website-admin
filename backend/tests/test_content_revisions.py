"""內容版本紀錄與還原：還原是「把舊版複製成新的一版」，不改寫歷史、
不帶上其他內容的草稿，權限與一般存檔相同。"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.operations.models import AuditLogEntry

BASE = "/api/website/v1/admin/content-items"


def _about(title: str) -> dict:
    return {"title": title, "since_label": "SINCE 1997", "body_text": "內文", "caption": "說明"}


async def _save(client, kind: str, version: int, payload: dict, campus_key: str | None = None):
    query = f"?campus_key={campus_key}" if campus_key else ""
    response = await client.post(
        f"{BASE}/{kind}/revisions{query}", json={"expected_version": version, "payload": payload}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _publish(client, kind: str, revision_id: str, campus_key: str | None = None):
    query = f"?campus_key={campus_key}" if campus_key else ""
    response = await client.post(f"{BASE}/{kind}/publish{query}", json={"revision_id": revision_id})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_history_lists_newest_first_with_author_and_published_flag(admin_client):
    first = await _save(admin_client, "home_about", 0, _about("第一版"))
    await _publish(admin_client, "home_about", first["latest_revision"]["id"])
    await _save(admin_client, "home_about", 1, _about("第二版草稿"))

    response = await admin_client.get(f"{BASE}/home_about/revisions")
    assert response.status_code == 200, response.text
    history = response.json()
    assert [r["version"] for r in history] == [2, 1]
    assert [r["is_published"] for r in history] == [False, True]
    assert history[0]["created_by_email"] == "admin@ivy.example"
    # 列表不帶 payload，要看內容走單筆端點。
    assert "payload" not in history[0]

    detail = await admin_client.get(f"{BASE}/home_about/revisions/{history[1]['id']}")
    assert detail.status_code == 200
    assert detail.json()["payload"]["title"] == "第一版"


@pytest.mark.asyncio
async def test_restore_as_draft_creates_new_version_without_touching_public_site(
    admin_client, public_client
):
    first = await _save(admin_client, "home_about", 0, _about("第一版"))
    await _publish(admin_client, "home_about", first["latest_revision"]["id"])
    second = await _save(admin_client, "home_about", 1, _about("第二版"))
    await _publish(admin_client, "home_about", second["latest_revision"]["id"])

    response = await admin_client.post(
        f"{BASE}/home_about/revisions/{first['latest_revision']['id']}/restore",
        json={"expected_version": 2, "publish": False},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["latest_version"] == 3
    assert body["latest_revision"]["payload"]["title"] == "第一版"
    # 只是草稿：官網仍是第二版。
    assert body["current_published_revision_id"] == second["latest_revision"]["id"]
    site = await public_client.get("/api/website/v1/public/site")
    assert site.json()["content"]["home_about"]["title"] == "第二版"


@pytest.mark.asyncio
async def test_restore_and_publish_only_switches_that_item(admin_client, public_client, db_session):
    about1 = await _save(admin_client, "home_about", 0, _about("關於第一版"))
    await _publish(admin_client, "home_about", about1["latest_revision"]["id"])
    about2 = await _save(admin_client, "home_about", 1, _about("關於第二版"))
    await _publish(admin_client, "home_about", about2["latest_revision"]["id"])

    footer = {"tagline": "已發布頁尾", "copyright": "c", "bottom_note": "n", "campus_list_label": "l"}
    footer_rev = await _save(admin_client, "site_footer", 0, footer)
    await _publish(admin_client, "site_footer", footer_rev["latest_revision"]["id"])
    # 別人存了頁尾草稿但還沒發布：還原「關於」不能把它帶上官網。
    await _save(admin_client, "site_footer", 1, {**footer, "tagline": "未發布的頁尾草稿"})

    response = await admin_client.post(
        f"{BASE}/home_about/revisions/{about1['latest_revision']['id']}/restore",
        json={"expected_version": 2, "publish": True},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["current_published_revision_id"] == body["latest_revision"]["id"]

    content = (await public_client.get("/api/website/v1/public/site")).json()["content"]
    assert content["home_about"]["title"] == "關於第一版"
    assert content["site_footer"]["tagline"] == "已發布頁尾"

    actions = (
        await db_session.execute(select(AuditLogEntry.action).order_by(AuditLogEntry.created_at))
    ).scalars().all()
    assert "content.restore" in actions


@pytest.mark.asyncio
async def test_restore_with_stale_version_is_rejected(admin_client):
    first = await _save(admin_client, "home_about", 0, _about("第一版"))
    await _save(admin_client, "home_about", 1, _about("第二版"))

    response = await admin_client.post(
        f"{BASE}/home_about/revisions/{first['latest_revision']['id']}/restore",
        json={"expected_version": 1},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "CONTENT_VERSION_CONFLICT"


@pytest.mark.asyncio
async def test_restore_rejects_revision_of_another_item(admin_client):
    about = await _save(admin_client, "home_about", 0, _about("關於"))
    footer = {"tagline": "t", "copyright": "c", "bottom_note": "n", "campus_list_label": "l"}
    await _save(admin_client, "site_footer", 0, footer)

    response = await admin_client.post(
        f"{BASE}/site_footer/revisions/{about['latest_revision']['id']}/restore",
        json={"expected_version": 1},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_campus_admin_cannot_read_or_restore_other_campus_history(admin_client, minghua_client):
    faq = {"items": [{"q": "義華的問題", "a": "答案"}]}
    yihua = await _save(admin_client, "campus_faq", 0, faq, campus_key="yihua")

    listed = await minghua_client.get(f"{BASE}/campus_faq/revisions?campus_key=yihua")
    assert listed.status_code == 404
    restored = await minghua_client.post(
        f"{BASE}/campus_faq/revisions/{yihua['latest_revision']['id']}/restore?campus_key=yihua",
        json={"expected_version": 1},
    )
    assert restored.status_code == 404

    # 自己的校區可以正常使用。
    own = await _save(minghua_client, "campus_faq", 0, {"items": [{"q": "明華", "a": "答"}]}, "minghua")
    await _save(minghua_client, "campus_faq", 1, {"items": [{"q": "明華改", "a": "答"}]}, "minghua")
    ok = await minghua_client.post(
        f"{BASE}/campus_faq/revisions/{own['latest_revision']['id']}/restore?campus_key=minghua",
        json={"expected_version": 2},
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["latest_revision"]["payload"]["items"][0]["q"] == "明華"


@pytest.mark.asyncio
async def test_campus_admin_cannot_restore_shared_content(admin_client, minghua_client):
    first = await _save(admin_client, "home_about", 0, _about("第一版"))
    await _save(admin_client, "home_about", 1, _about("第二版"))

    response = await minghua_client.post(
        f"{BASE}/home_about/revisions/{first['latest_revision']['id']}/restore",
        json={"expected_version": 2},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_restore_rejects_payload_that_no_longer_validates(admin_client, db_session):
    from app.content.models import ContentRevision

    first = await _save(admin_client, "home_about", 0, _about("第一版"))
    await _save(admin_client, "home_about", 1, _about("第二版"))
    # 模擬欄位規則變更後，舊版少了現在的必填欄位。
    revision = await db_session.get(ContentRevision, uuid.UUID(first["latest_revision"]["id"]))
    revision.payload = {"title": "舊格式"}
    await db_session.commit()

    response = await admin_client.post(
        f"{BASE}/home_about/revisions/{first['latest_revision']['id']}/restore",
        json={"expected_version": 2},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "CONTENT_REVISION_OUTDATED"
