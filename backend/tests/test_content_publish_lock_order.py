"""內容發布相關的並行操作不能死結（真 Postgres、獨立的 API 請求與排程工作）。

還原並發布與一般發布——舊的取鎖順序：還原先存草稿鎖住內容項、再拿站台鎖；一般發布先拿站台鎖、寫
site_release_entries 時的外鍵檢查要等內容項 → 互等，其中一筆 500。同步點
只用來安排這個交錯：還原建完版本後，等一般發布拿到站台鎖才繼續。修正後
還原在存草稿前就先拿站台鎖，一般發布只會排在它後面。"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text, update

from app.content import service
from app.content.models import PublishJob
from app.content.publish_jobs import run_due_jobs

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


@pytest.mark.asyncio
async def test_reject_and_due_schedule_concurrently_does_not_deadlock(
    app, admin_client, editor_client, db_session, monkeypatch, caplog
):
    """退回審核與同一版的排程到期同時進行不能死結（2026-10-14）。

    舊的取鎖順序：排程先鎖排程列、再等站台鎖；退回先拿站台鎖、鎖這一版，再取消
    這一版的排程（要等排程列）→ 互等，其中一邊被 Postgres 中止：審核者拿到 500
    而退回的內容照樣上線，或這一輪其餘到期的排程整批延後。同步點讓退回拿到站台
    鎖後先停，等排程在資料庫裡卡在鎖上才繼續。修正後排程也先拿站台鎖，只會排在
    退回後面，讀到已取消就不發布。"""
    news = "/api/website/v1/admin/content-items/campus_news"
    q = "?campus_key=yihua"
    drafted = await editor_client.post(
        f"{news}/revisions{q}",
        json={"expected_version": 0, "payload": {
            "events": [{"id": "event-1", "date": "2026-11-01", "title": "參觀要預約嗎？", "description": "請先來電。"}],
        }},
    )
    assert drafted.status_code == 201, drafted.text
    revision_id = drafted.json()["latest_revision"]["id"]
    submitted = await editor_client.post(f"{news}/submit{q}", json={"revision_id": revision_id})
    assert submitted.status_code == 200, submitted.text
    at = datetime.now(timezone.utc) + timedelta(hours=1)
    scheduled = await admin_client.post(f"{news}/schedules{q}", json={"revision_id": revision_id, "publish_at": at.isoformat()})
    assert scheduled.status_code == 201, scheduled.text
    await db_session.execute(update(PublishJob).values(publish_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
    await db_session.commit()

    reviewer_has_state = asyncio.Event()
    worker_waiting = asyncio.Event()
    original_state = service._get_or_create_site_state
    calls = 0

    async def state_with_barrier(*args, **kwargs):
        nonlocal calls
        calls += 1
        first = calls == 1
        state = await original_state(*args, **kwargs)
        if first:
            reviewer_has_state.set()
            await asyncio.wait_for(worker_waiting.wait(), 5)
        return state

    async def run_worker():
        async with app.state.session_factory() as worker_db:
            return await run_due_jobs(worker_db)

    monkeypatch.setattr(service, "_get_or_create_site_state", state_with_barrier)
    review = asyncio.create_task(admin_client.post(
        f"{news}/review{q}", json={"revision_id": revision_id, "decision": "reject", "note": "電話未確認"},
    ))
    worker = None
    try:
        await asyncio.wait_for(reviewer_has_state.wait(), 5)
        worker = asyncio.create_task(run_worker())
        for _ in range(100):
            waiting = await db_session.scalar(text(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
            ))
            await db_session.rollback()
            if waiting:
                break
            await asyncio.sleep(0.05)
        assert waiting, "排程沒有卡在鎖上，測不到取鎖順序"
        worker_waiting.set()
        reviewed, counts = await asyncio.wait_for(asyncio.gather(review, worker), 15)
    finally:
        for task in (review, worker):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(*(t for t in (review, worker) if t is not None), return_exceptions=True)
    assert "deadlock detected" not in caplog.text.lower()
    assert reviewed.status_code == 200, reviewed.text
    assert counts == {"published": 0, "failed": 0, "skipped": 0}
    job_status = await db_session.scalar(select(PublishJob.status))
    assert job_status == "cancelled"
