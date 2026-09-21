from __future__ import annotations

import asyncio
from datetime import date, timedelta

import pytest


def _payload(config_version: int):
    return {
        "campus_key": "yihua",
        "config_version": config_version,
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "age": "3-4",
        "preferred_time": "平日上午",
        "questions": None,
        "consent_given": True,
    }


@pytest.mark.asyncio
async def test_concurrent_identical_submissions_create_only_one_request(
    admin_client, public_client, second_public_client
):
    """真實併發：兩個獨立連線同時用同一個 idempotency key 送出同樣內容，
    只能有一筆案件被建立，另一個必須安全地拿到同一個 receipt（不是各建一筆）。"""
    current = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    resp = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": current.json()["version"], "mode": "inquiry"},
    )
    version = resp.json()["version"]

    payload = _payload(version)
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

    current = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    resp = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": current.json()["version"], "mode": "inquiry"},
    )
    version = resp.json()["version"]
    payload = _payload(version)
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
    current = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": current.json()["version"], "mode": "slots"},
    )
    me = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    version = me.json()["version"]

    slot_date = (date.today() + timedelta(days=5)).isoformat()
    slot_resp = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={
            "slot_date": slot_date,
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "capacity": 1,
        },
    )
    slot_id = slot_resp.json()["id"]

    def _payload(name: str) -> dict:
        return {
            "campus_key": "yihua",
            "config_version": version,
            "parent_name": name,
            "phone": "0912345678",
            "age": "3-4",
            "preferred_time": None,
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
