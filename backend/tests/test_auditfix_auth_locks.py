"""總管理者清除綁定／停權要先鎖帳號列（2026-10-20 稽核 #05）。

綁定 callback 在帳號列鎖內寫入 line_sub 再 commit。清除綁定或停權若只用一般 SELECT 讀帳號，讀到的是綁定
前的 None；把 None 設成 None 不算修改，UPDATE 不會帶這個欄位，剛綁上的 sub 就留在資料庫裡。測試用另一條
連線模擬「綁定交易已鎖列、寫入 sub 但還沒 commit」，等請求卡在帳號列鎖上才放行。"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select, text

from app.auth.models import Role, User
from tests.conftest import _create_user

API = "/api/website/v1"
ATTACKER_SUB = "U" + "c" * 32


async def _wait_until_blocked(app, task: asyncio.Task, *, seconds: float = 8.0) -> None:
    # 每次輪詢開新連線：同一交易裡 pg_stat_activity 沿用第一次的快照。
    for _ in range(int(seconds / 0.05)):
        if task.done():
            outcome = task.exception() or task.result()
            raise AssertionError(f"請求沒有等帳號列鎖就結束了：{outcome!r} {getattr(outcome, 'text', '')[:300]}")
        async with app.state.engine.connect() as conn:
            waiting = await conn.scalar(
                text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")
            )
        if waiting:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("請求沒有卡在帳號列鎖上，交錯沒有發生")


async def _link_while_request_waits(app, user_id, request):
    """另一個交易鎖住帳號列、寫入 line_sub 但還沒 commit；請求卡在鎖上之後才 commit。"""
    async with app.state.session_factory() as other:
        user = (await other.execute(select(User).where(User.id == user_id).with_for_update())).scalar_one()
        user.line_sub = ATTACKER_SUB
        await other.flush()
        task = asyncio.create_task(request)
        await _wait_until_blocked(app, task)
        await other.commit()
    return await asyncio.wait_for(task, 20)


async def _stored_line_sub(app, user_id):
    async with app.state.session_factory() as db:
        return (await db.execute(select(User.line_sub).where(User.id == user_id))).scalar_one()


@pytest.mark.asyncio
async def test_clear_external_logins_waits_for_a_concurrent_link_and_clears_it(app, admin_client, db_session):
    user = await _create_user(db_session, "staff@example.org", "staff-password-123", Role.CAMPUS_ADMIN, ["yihua"])
    user_id = user.id
    await db_session.commit()

    response = await _link_while_request_waits(
        app, user_id, admin_client.post(f"{API}/admin/users/{user_id}/clear-external-logins")
    )

    assert response.status_code == 200, response.text
    assert response.json()["line_linked"] is False
    assert await _stored_line_sub(app, user_id) is None, "併發綁上的 LINE 要一起被清掉"


@pytest.mark.asyncio
async def test_deactivate_waits_for_a_concurrent_link_and_clears_it(app, admin_client, db_session):
    user = await _create_user(db_session, "staff@example.org", "staff-password-123", Role.CAMPUS_ADMIN, ["yihua"])
    user_id = user.id
    await db_session.commit()

    response = await _link_while_request_waits(
        app, user_id, admin_client.patch(f"{API}/admin/users/{user_id}/active", json={"is_active": False})
    )

    assert response.status_code == 200, response.text
    assert response.json()["line_linked"] is False and response.json()["is_active"] is False
    assert await _stored_line_sub(app, user_id) is None, "停權時併發綁上的 LINE 不能留到復權"
