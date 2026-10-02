from __future__ import annotations

import asyncio
from datetime import date, timedelta

import pytest

from tests.conftest import create_slot, set_booking_mode


# 預約表單要有已發布的同意文字（啟用 slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")


def _payload(config_version: int, slot_id: str):
    return {
        "campus_key": "yihua",
        "config_version": config_version,
        "slot_id": slot_id,
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "email": "parent@example.com",
        "age": "3-4",
        "questions": None,
        "consent_given": True,
    }


async def _open_slot(admin_client, *, capacity: int = 2, days_ahead: int = 3) -> tuple[int, str]:
    """建一個場次再切到 slots；回傳（設定版本, slot_id）。"""
    slot_id = await create_slot(admin_client, "yihua", days_ahead=days_ahead, capacity=capacity)
    response = await set_booking_mode(admin_client, "yihua", mode="slots")
    assert response.status_code == 200, response.text
    return response.json()["version"], slot_id


@pytest.mark.asyncio
async def test_concurrent_identical_submissions_create_only_one_request(
    admin_client, public_client, second_public_client
):
    """真實併發：兩個獨立連線同時用同一個 idempotency key 送出同樣內容，
    只能有一筆案件被建立，另一個必須安全地拿到同一個 receipt（不是各建一筆）。"""
    version, slot_id = await _open_slot(admin_client)

    payload = _payload(version, slot_id)
    headers = {"Idempotency-Key": "race-test-01"}

    results = await asyncio.gather(
        public_client.post("/api/website/v1/public/visit-requests", json=payload, headers=headers),
        second_public_client.post(
            "/api/website/v1/public/visit-requests", json=payload, headers=headers
        ),
    )
    statuses = sorted(r.status_code for r in results)
    # 兩者都應成功（一個 201 一個 200，或極端 race 下兩個都 201 但
    # receipt 相同——因為唯一鍵約束會擋掉第二個 INSERT），但不可能有
    # 失敗或建出兩筆不同案件。
    assert set(statuses).issubset({200, 201})
    receipt_ids = {r.json()["receipt_id"] for r in results}
    assert len(receipt_ids) == 1, f"應該只有一個 receipt_id，實際：{receipt_ids}"


@pytest.mark.asyncio
async def test_many_concurrent_identical_submissions_still_one_request(app, admin_client, public_client):
    """加大併發數（10 個獨立連線同時打同一個 idempotency key），
    提高真的撞上 INSERT 競爭窗口的機率，驗證 IntegrityError 安全網。"""
    import httpx

    version, slot_id = await _open_slot(admin_client)
    # 這裡用一般 httpx client（不經測試用的家長 client），官網會帶的人數自己補上，
    # 十個請求才會同時打到建單。
    payload = {**_payload(version, slot_id), "party_size": 2}
    headers = {"Idempotency-Key": "race-test-many-01"}

    transport = httpx.ASGITransport(app=app)
    clients = [httpx.AsyncClient(transport=transport, base_url="http://test") for _ in range(10)]
    try:
        results = await asyncio.gather(
            *[
                c.post("/api/website/v1/public/visit-requests", json=payload, headers=headers)
                for c in clients
            ]
        )
    finally:
        for c in clients:
            await c.aclose()

    for r in results:
        assert r.status_code in (200, 201), r.text
    receipt_ids = {r.json()["receipt_id"] for r in results}
    assert len(receipt_ids) == 1, f"應該只有一個 receipt_id，實際：{receipt_ids}"
    assert sum(1 for r in results if r.status_code == 201) == 1, "只能有一個請求真的建立新案件"


@pytest.mark.asyncio
async def test_one_slot_cannot_accept_two_families(
    public_client, second_public_client, admin_client
):
    """計畫 Task 7 明確要求的真實 PostgreSQL 併發驗證：同一個時段的
    最後一個名額，兩個不同 idempotency key 的並發請求只能一個成功。"""
    version, slot_id = await _open_slot(admin_client, capacity=1, days_ahead=5)
    slot_date = (date.today() + timedelta(days=5)).isoformat()

    def _payload(name: str) -> dict:
        return {
            "campus_key": "yihua",
            "config_version": version,
            "parent_name": name,
            "phone": "0912345678",
            "email": "parent@example.com",
            "age": "3-4",
            "questions": None,
            "consent_given": True,
            "slot_id": slot_id,
        }

    path = "/api/website/v1/public/visit-requests"
    a, b = await asyncio.gather(
        public_client.post(path, json=_payload("陳媽媽"), headers={"Idempotency-Key": "capacity-a"}),
        second_public_client.post(
            path, json=_payload("林媽媽"), headers={"Idempotency-Key": "capacity-b"}
        ),
    )
    assert sorted([a.status_code, b.status_code]) == [201, 409]
    rejected = a if a.status_code == 409 else b
    assert rejected.json()["detail"]["code"] == "SLOT_FULL"

    # 資料庫層確認只有一筆真的佔用這個時段。
    check = await admin_client.get(
        f"/api/website/v1/admin/slots?campus_key=yihua&date_from={slot_date}&date_to={slot_date}"
    )
    assert check.json()[0]["booked_count"] == 1



@pytest.mark.asyncio
@pytest.mark.parametrize("for_update", [False, True])
async def test_concurrent_first_reads_create_booking_config_once(app, for_update):
    """還沒有設定列的校區同時被讀第一次（後台時段頁同時讀預約方式與每週規則、
    官網同一頁兩處都讀）：慢的那個不可以撞主鍵回 500，要等對方交易結束後讀回同一列。

    固定順序重現競爭：A 建好列但還沒 commit；B 此時第一次讀，看不到 A 的列而去
    INSERT，會卡在 A 的鎖上；A commit 後 B 必須正常拿到這一列。"""
    from sqlalchemy import func, select

    from app.booking import service
    from app.booking.models import BookingConfig, BookingMode

    async with app.state.session_factory() as first, app.state.session_factory() as second:
        await service.get_or_create_config(first, "chongde", for_update=for_update)
        racing = asyncio.create_task(service.get_or_create_config(second, "chongde", for_update=for_update))
        await asyncio.sleep(0.3)
        assert not racing.done(), "第二個交易應該等第一個交易結束，不能先回來"
        await first.commit()
        config = await asyncio.wait_for(racing, timeout=10)
        assert config.mode == BookingMode.PAUSED
        await second.commit()

    async with app.state.session_factory() as session:
        count = await session.scalar(
            select(func.count()).select_from(BookingConfig).where(BookingConfig.campus_key == "chongde")
        )
    assert count == 1


def _hold_until_both_return(monkeypatch, module, name: str) -> None:
    """兩個請求第一次呼叫 module.name 都回來後才一起往下走：兩邊拿到同樣的結果（例如都
    還查不到對方的案件），交錯順序因此固定，不靠運氣撞上競爭窗口。之後的呼叫不攔。"""
    original = getattr(module, name)
    barrier = asyncio.Barrier(2)
    calls = 0

    async def held(*args, **kwargs):
        nonlocal calls
        calls += 1
        first_two = calls <= 2
        result = await original(*args, **kwargs)
        if first_two:
            await asyncio.wait_for(barrier.wait(), timeout=10)
        return result

    monkeypatch.setattr(module, name, held)


async def _last_slot_payload(admin_client) -> tuple[dict, str, str]:
    """slots 模式，開一個只剩一個名額的時段。回傳 (送單內容, 時段 id, 日期)。"""
    version, slot_id = await _open_slot(admin_client, capacity=1, days_ahead=6)
    slot_date = (date.today() + timedelta(days=6)).isoformat()
    return _payload(version, slot_id), slot_id, slot_date


async def _assert_one_booking_same_receipt(admin_client, results, slot_date: str) -> None:
    assert sorted(r.status_code for r in results) == [200, 201], [r.text for r in results]
    assert len({r.json()["receipt_id"] for r in results}) == 1
    assert {r.json()["status"] for r in results} == {"confirmed"}
    check = await admin_client.get(
        f"/api/website/v1/admin/slots?campus_key=yihua&date_from={slot_date}&date_to={slot_date}"
    )
    assert check.json()[0]["booked_count"] == 1


@pytest.mark.asyncio
async def test_concurrent_replay_waiting_on_lock_gets_receipt_not_slot_full(
    monkeypatch, admin_client, public_client, second_public_client
):
    """最後一個名額、同一把 Idempotency-Key 的重送同時抵達（2026-09-30 E2E 回 201＋409
    SLOT_FULL，家長畫面顯示額滿，其實已建立）。兩個請求都查不到既有案件、都通過預檢，
    慢的那個在校區設定列鎖上等到快的建好案件：拿到鎖後要先認出是重播，回同一張收據。"""
    from app.booking import service

    payload, _slot_id, slot_date = await _last_slot_payload(admin_client)
    _hold_until_both_return(monkeypatch, service, "find_replay")
    _hold_until_both_return(monkeypatch, service, "precheck_submission")

    headers = {"Idempotency-Key": "last-slot-replay-lock-01"}
    path = "/api/website/v1/public/visit-requests"
    results = await asyncio.wait_for(
        asyncio.gather(
            public_client.post(path, json=payload, headers=headers),
            second_public_client.post(path, json=payload, headers=headers),
        ),
        timeout=30,
    )
    await _assert_one_booking_same_receipt(admin_client, results, slot_date)


@pytest.mark.asyncio
async def test_concurrent_replay_prechecked_after_first_commit_gets_receipt(
    monkeypatch, admin_client, public_client, second_public_client
):
    """同上，但慢的那個在不上鎖的預檢時，快的已經建好並提交：預檢看到名額已滿，擋下前
    要再查一次同一把 key，已經建立就回原收據。"""
    from app.booking import service

    payload, _slot_id, slot_date = await _last_slot_payload(admin_client)
    _hold_until_both_return(monkeypatch, service, "find_replay")
    original_precheck = service.precheck_submission
    first_done = asyncio.Event()
    prechecks = 0

    async def precheck_after_first_request(*args, **kwargs):
        nonlocal prechecks
        prechecks += 1
        if prechecks == 2:
            await asyncio.wait_for(first_done.wait(), timeout=10)
        return await original_precheck(*args, **kwargs)

    monkeypatch.setattr(service, "precheck_submission", precheck_after_first_request)

    headers = {"Idempotency-Key": "last-slot-replay-precheck-01"}
    path = "/api/website/v1/public/visit-requests"
    tasks = [
        asyncio.create_task(client.post(path, json=payload, headers=headers))
        for client in (public_client, second_public_client)
    ]
    for task in tasks:
        task.add_done_callback(lambda _task: first_done.set())
    results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=30)
    await _assert_one_booking_same_receipt(admin_client, results, slot_date)
