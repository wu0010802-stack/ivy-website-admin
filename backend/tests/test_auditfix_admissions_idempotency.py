"""手動新增招生訪視帶 Idempotency-Key（2026-10-20 稽核 #10）。

後端已 commit、回應卻在路上遺失（代理 502、手機逾時）時，接待會按第二次儲存；同一把 key 要回原本那筆，
不能多建一筆。key 相同、內容不同是另一次送出被誤用同一把 key，回 409。沒帶 key 的舊畫面照舊建立。"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import func, select

from app.admissions.models import RecruitmentVisit
from tests.admissions_helpers import ADMISSIONS, manual_fields

URL = f"{ADMISSIONS}/records?campus_key=yihua"


async def _count(db_session) -> int:
    return await db_session.scalar(select(func.count()).select_from(RecruitmentVisit))


async def _post(client, key: str | None, **overrides):
    headers = {"Idempotency-Key": key} if key else {}
    return await client.post(URL, json=manual_fields(**overrides), headers=headers)


@pytest.mark.asyncio
async def test_resending_with_same_key_returns_the_first_visit(admin_client, db_session):
    first = await _post(admin_client, "key-1")
    assert first.status_code == 201, first.text

    again = await _post(admin_client, "key-1")

    assert again.status_code == 200, again.text
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["seq_no"] == first.json()["seq_no"]
    assert await _count(db_session) == 1
    events = (await admin_client.get(f"{ADMISSIONS}/records/{first.json()['id']}/events")).json()
    assert [e["event_type"] for e in events] == ["created"]


@pytest.mark.asyncio
async def test_same_key_with_different_content_is_409(admin_client, db_session):
    assert (await _post(admin_client, "key-2")).status_code == 201

    changed = await _post(admin_client, "key-2", child_name="陳小華")

    assert changed.status_code == 409, changed.text
    assert changed.json()["detail"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert await _count(db_session) == 1


@pytest.mark.asyncio
async def test_key_is_scoped_to_campus_and_missing_key_still_creates(admin_client, db_session):
    assert (await _post(admin_client, "key-3")).status_code == 201
    other = await admin_client.post(
        f"{ADMISSIONS}/records?campus_key=minghua", json=manual_fields(), headers={"Idempotency-Key": "key-3"}
    )
    assert other.status_code == 201, other.text
    assert (await _post(admin_client, None)).status_code == 201
    assert (await _post(admin_client, None)).status_code == 201
    assert await _count(db_session) == 4


@pytest.mark.asyncio
async def test_concurrent_resends_with_same_key_create_one_visit(admin_client, db_session):
    responses = await asyncio.gather(*(_post(admin_client, "key-4") for _ in range(3)))

    assert sorted(r.status_code for r in responses) == [200, 200, 201], [r.text for r in responses]
    assert len({r.json()["id"] for r in responses}) == 1
    assert await _count(db_session) == 1
