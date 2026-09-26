"""還原並發布與一般發布同時進行不能死結（真 Postgres、兩個獨立 API 請求）。

舊的取鎖順序：還原先存草稿鎖住內容項、再拿站台鎖；一般發布先拿站台鎖、寫
site_release_entries 時的外鍵檢查要等內容項 → 互等，其中一筆 500。同步點
只用來安排這個交錯：還原建完版本後，等一般發布拿到站台鎖才繼續。修正後
還原在存草稿前就先拿站台鎖，一般發布只會排在它後面。"""

import asyncio

import pytest

from app.content import service

BASE = "/api/website/v1/admin/content-items/home_about"


@pytest.mark.asyncio
async def test_restore_and_publish_concurrently_does_not_deadlock(admin_client, monkeypatch, caplog):
    async def save(version, title):
        response = await admin_client.post(
            f"{BASE}/revisions",
            json={"expected_version": version, "payload": {
                "title": title, "since_label": "SINCE 1997", "body_text": "內文", "caption": "說明",
            }},
        )
        assert response.status_code == 201, response.text
        return response.json()["latest_revision"]["id"]

    first = await save(0, "第一版")
    seeded = await admin_client.post(f"{BASE}/publish", json={"revision_id": first})
    assert seeded.status_code == 200, seeded.text
    second = await save(1, "第二版")

    restore_has_item = asyncio.Event()
    publisher_has_state = asyncio.Event()
    original_create = service.create_revision
    original_state = service._get_or_create_site_state

    async def create_with_barrier(*args, **kwargs):
        revision = await original_create(*args, **kwargs)
        restore_has_item.set()
        await asyncio.wait_for(publisher_has_state.wait(), 5)
        return revision

    async def state_with_barrier(*args, **kwargs):
        state = await original_state(*args, **kwargs)
        publisher_has_state.set()
        return state

    monkeypatch.setattr(service, "create_revision", create_with_barrier)
    monkeypatch.setattr(service, "_get_or_create_site_state", state_with_barrier)
    restore = asyncio.create_task(admin_client.post(
        f"{BASE}/revisions/{first}/restore", json={"expected_version": 2, "publish": True},
    ))
    await asyncio.wait_for(restore_has_item.wait(), 5)
    publish = asyncio.create_task(admin_client.post(f"{BASE}/publish", json={"revision_id": second}))
    try:
        responses = await asyncio.wait_for(asyncio.gather(restore, publish), 15)
    finally:
        for task in (restore, publish):
            if not task.done():
                task.cancel()
        await asyncio.gather(restore, publish, return_exceptions=True)
    assert "deadlock detected" not in caplog.text.lower()
    assert [response.status_code for response in responses] == [201, 200], [
        (response.status_code, response.text) for response in responses
    ]
