"""改密碼與帳號復原的交錯（2026-10-13 深度掃描第 2 項；第 3 項的 Google／LINE 版在各自的 OAuth 測試檔）。

本人改密碼先驗舊密碼、再算新雜湊（約 250 ms），這段空檔裡重設密碼可能已經提交並撤銷所有 session。
請求要在鎖住帳號列之後重驗 session 與「驗證時的密碼雜湊」，不能把剛重設好的密碼蓋回去。測試用真的並發，
不 mock 資料庫：把新密碼的雜湊運算停住，讓重設在中間完成。"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select

from app.auth import service
from app.auth.models import Role, User
from tests.conftest import _create_user, _logged_in_client

ROOT = "/api/website/v1"
OLD = "old-password-123456"
ATTACKER = "attacker-new-password-1"
RESET = "reset-new-password-456"


@pytest.fixture
def pause_hashing(monkeypatch):
    """讓雜湊指定明文的請求停在「已驗完舊密碼、正在算新雜湊」，其他明文照常算。"""
    reached, go = asyncio.Event(), asyncio.Event()
    original = service.hash_password_async
    watched: list[str] = []

    async def paused(password: str):
        if password in watched:
            reached.set()
            await go.wait()
        return await original(password)

    monkeypatch.setattr(service, "hash_password_async", paused)
    return reached, go, watched


async def _login(app, email: str, password: str):
    return await _logged_in_client(app, email, password)


def _verify(password: str, password_hash: str) -> bool:
    return service._pwd_context.verify(password, password_hash)


@pytest.mark.asyncio
async def test_change_password_started_before_an_admin_reset_cannot_overwrite_it(
    app, admin_client, db_session, pause_hashing
):
    reached, go, watched = pause_hashing
    user = await _create_user(db_session, "staff@example.org", OLD, Role.CAMPUS_ADMIN, ["minghua"])
    staff = await _login(app, "staff@example.org", OLD)
    watched.append(ATTACKER)

    change = asyncio.create_task(
        staff.post(f"{ROOT}/auth/change-password", json={"current_password": OLD, "new_password": ATTACKER})
    )
    await asyncio.wait_for(reached.wait(), 10)
    reset = await admin_client.post(f"{ROOT}/admin/users/{user.id}/password", json={"password": RESET})
    assert reset.status_code == 204, reset.text
    go.set()
    response = await asyncio.wait_for(change, 20)

    assert response.status_code == 401, response.text  # 重設已撤銷這個 session
    async with app.state.session_factory() as db:
        fresh = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        assert _verify(RESET, fresh.password_hash), "重設好的密碼要留著"
        assert not _verify(ATTACKER, fresh.password_hash)
    await staff.aclose()


@pytest.mark.asyncio
async def test_two_concurrent_password_changes_from_one_session_do_not_overwrite_each_other(
    app, db_session, pause_hashing
):
    reached, go, watched = pause_hashing
    user = await _create_user(db_session, "staff@example.org", OLD, Role.CAMPUS_ADMIN, ["minghua"])
    staff = await _login(app, "staff@example.org", OLD)
    watched.append(ATTACKER)

    first = asyncio.create_task(
        staff.post(f"{ROOT}/auth/change-password", json={"current_password": OLD, "new_password": ATTACKER})
    )
    await asyncio.wait_for(reached.wait(), 10)
    second = await staff.post(f"{ROOT}/auth/change-password", json={"current_password": OLD, "new_password": RESET})
    assert second.status_code == 204, second.text
    go.set()
    response = await asyncio.wait_for(first, 20)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "CREDENTIALS_CHANGED"
    async with app.state.session_factory() as db:
        fresh = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        assert _verify(RESET, fresh.password_hash)
    await staff.aclose()


@pytest.mark.asyncio
async def test_normal_password_change_still_works_and_keeps_this_session(app, db_session):
    await _create_user(db_session, "staff@example.org", OLD, Role.CAMPUS_ADMIN, ["minghua"])
    staff = await _login(app, "staff@example.org", OLD)
    other_device = await _login(app, "staff@example.org", OLD)

    response = await staff.post(f"{ROOT}/auth/change-password", json={"current_password": OLD, "new_password": RESET})

    assert response.status_code == 204, response.text
    assert (await staff.get(f"{ROOT}/auth/me")).status_code == 200
    assert (await other_device.get(f"{ROOT}/auth/me")).status_code == 401
    await staff.aclose()
    await other_device.aclose()
