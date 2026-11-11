"""後台手機推播的訂閱管理 API（notifications/push_routes.py，2026-11-05）。

推播服務一律用 httpx.MockTransport（app.state.push_transport）；不連真的服務、不發真的通知。"""

from __future__ import annotations

import uuid
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import func, select

from app.common.timezones import now_utc
from app.notifications.models import PushSubscription
from app.notifications.push_routes import MAX_DEVICES_PER_USER, device_label
from tests.conftest import freeze_rate_limit_clock
from tests.push_fixtures import (  # noqa: F401  （pytest fixture）
    admin, campus_admin, clients, editor, push_app, readonly, reception,
)
from tests.push_helpers import APPLE, FCM, PRIVATE_KEY, PUBLIC_KEY, FakePushService, new_device

BASE = "/api/website/v1/admin/push"
CONFIG = f"{BASE}/config"
SUBSCRIPTIONS = f"{BASE}/subscriptions"
REMOVE = f"{SUBSCRIPTIONS}/remove"
TEST = f"{BASE}/test"
IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
CHROME_MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"


def _body(device) -> dict:
    return {"endpoint": device.endpoint, "keys": device.keys}


async def _count(application, **where) -> int:
    async with application.state.session_factory() as db:
        query = select(func.count()).select_from(PushSubscription)
        for column, value in where.items():
            query = query.where(getattr(PushSubscription, column) == value)
        return (await db.execute(query)).scalar_one()


async def _rows(application) -> list[PushSubscription]:
    async with application.state.session_factory() as db:
        return list((await db.execute(select(PushSubscription).order_by(PushSubscription.created_at))).scalars())


# ----------------------------------------------------------------------------- 設定


async def test_config_requires_login_and_hands_out_only_the_public_key(push_app, admin):
    anonymous = httpx.AsyncClient(transport=httpx.ASGITransport(app=push_app), base_url="http://test")
    try:
        assert (await anonymous.get(CONFIG)).status_code == 401
    finally:
        await anonymous.aclose()
    response = await admin.get(CONFIG)
    assert response.status_code == 200
    assert response.json() == {"enabled": True, "public_key": PUBLIC_KEY}
    assert PRIVATE_KEY not in response.text


async def test_config_reports_disabled_without_keys(admin_client):
    # 預設的測試 app 沒有設 VAPID 金鑰。
    response = await admin_client.get(CONFIG)
    assert response.json() == {"enabled": False, "public_key": None}


async def test_subscribing_without_keys_configured_is_409(admin_client):
    response = await admin_client.post(SUBSCRIPTIONS, json=_body(new_device()))
    assert response.status_code == 409 and response.json()["detail"]["code"] == "PUSH_NOT_CONFIGURED"
    assert (await admin_client.post(TEST)).status_code == 409


# ----------------------------------------------------------------------------- 權限


@pytest.mark.parametrize("who", ["admin", "campus_admin", "reception"])
async def test_people_who_receive_pushes_can_subscribe(clients, push_app, who):
    client = clients[who]
    response = await client.post(SUBSCRIPTIONS, json=_body(new_device()), headers={"user-agent": IPHONE_UA})
    assert response.status_code == 201, response.text
    assert response.json()["device_label"] == "iPhone（主畫面）"
    assert await _count(push_app) == 1


@pytest.mark.parametrize("who", ["editor", "readonly"])
async def test_roles_without_booking_handle_get_403(clients, push_app, who):
    client = clients[who]
    assert (await client.post(SUBSCRIPTIONS, json=_body(new_device()))).status_code == 403
    assert (await client.post(TEST)).status_code == 403
    assert (await client.get(CONFIG)).status_code == 200  # 設定本身誰都能讀
    assert (await client.get(SUBSCRIPTIONS)).json() == []
    assert await _count(push_app) == 0


async def test_everything_requires_login(push_app):
    anonymous = httpx.AsyncClient(transport=httpx.ASGITransport(app=push_app), base_url="http://test")
    try:
        device = new_device()
        calls = [
            anonymous.get(SUBSCRIPTIONS),
            anonymous.post(SUBSCRIPTIONS, json=_body(device)),
            anonymous.post(REMOVE, json={"endpoint": device.endpoint}),
            anonymous.delete(f"{SUBSCRIPTIONS}/{uuid.uuid4()}"),
            anonymous.post(TEST),
        ]
        assert [(await call).status_code for call in calls] == [401] * 5
    finally:
        await anonymous.aclose()


async def test_writes_need_the_csrf_token(push_app, admin):
    device = new_device()
    del admin.headers["x-csrf-token"]
    for call in (
        admin.post(SUBSCRIPTIONS, json=_body(device)),
        admin.post(REMOVE, json={"endpoint": device.endpoint}),
        admin.delete(f"{SUBSCRIPTIONS}/{uuid.uuid4()}"),
        admin.post(TEST),
    ):
        assert (await call).status_code == 403
    assert await _count(push_app) == 0


async def test_origin_must_match_for_writes(push_app, admin):
    response = await admin.post(SUBSCRIPTIONS, json=_body(new_device()), headers={"origin": "https://evil.example"})
    assert response.status_code == 403 and await _count(push_app) == 0


# ----------------------------------------------------------------------------- 訂閱驗證


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/x",
        "https://127.0.0.1/x",
        "https://169.254.169.254/latest/meta-data/",
        "https://localhost:8000/x",
        "https://evil.example/fcm.googleapis.com",
        "https://fcm.googleapis.com.evil.example/x",
        "https://fcm.googleapis.com@evil.example/x",
        "https://fcm.googleapis.com:8443/x",
    ],
)
async def test_non_whitelisted_endpoints_are_refused(push_app, admin, endpoint):
    device = new_device()
    response = await admin.post(SUBSCRIPTIONS, json={"endpoint": endpoint, "keys": device.keys})
    assert response.status_code == 422 and response.json()["detail"]["code"] == "PUSH_ENDPOINT_NOT_ALLOWED"
    assert await _count(push_app) == 0


async def test_bad_keys_and_oversized_fields_are_refused(push_app, admin):
    device = new_device()
    other = new_device()
    cases = [
        {"endpoint": device.endpoint, "keys": {"p256dh": "AAAA", "auth": device.keys["auth"]}},  # 不是曲線上的點
        {"endpoint": device.endpoint, "keys": {"p256dh": device.keys["p256dh"], "auth": "AAAA"}},  # auth 長度不對
        {"endpoint": device.endpoint, "keys": {"p256dh": "!!!", "auth": device.keys["auth"]}},
        {"endpoint": device.endpoint, "keys": {"p256dh": "A" * 201, "auth": device.keys["auth"]}},
        {"endpoint": device.endpoint, "keys": {"p256dh": device.keys["p256dh"], "auth": "A" * 101}},
        {"endpoint": FCM + "a" * 2001, "keys": other.keys},
        {"endpoint": "", "keys": other.keys},
        {"endpoint": device.endpoint},
        {"keys": device.keys},
        {"endpoint": device.endpoint, "keys": {"p256dh": device.keys["p256dh"]}},
        {"endpoint": 5, "keys": device.keys},
    ]
    for body in cases:
        response = await admin.post(SUBSCRIPTIONS, json=body)
        assert response.status_code == 422, (body, response.text)
    assert await _count(push_app) == 0


async def test_browser_subscription_json_with_expiration_time_is_accepted(push_app, admin):
    device = new_device()
    response = await admin.post(SUBSCRIPTIONS, json={**_body(device), "expirationTime": None})
    assert response.status_code == 201


async def test_padded_base64_keys_are_normalised(push_app, admin):
    device = new_device()
    body = {"endpoint": device.endpoint, "keys": {"p256dh": device.keys["p256dh"] + "=", "auth": device.keys["auth"] + "=="}}
    assert (await admin.post(SUBSCRIPTIONS, json=body)).status_code == 201
    [row] = await _rows(push_app)
    assert row.p256dh == device.keys["p256dh"] and row.auth == device.keys["auth"]


# ----------------------------------------------------------------------------- 清單與回應內容


async def test_responses_never_include_endpoint_or_keys(push_app, admin):
    device = new_device()
    created = await admin.post(SUBSCRIPTIONS, json=_body(device))
    listed = await admin.get(SUBSCRIPTIONS)
    for response in (created, listed):
        for secret in (device.endpoint, device.keys["p256dh"], device.keys["auth"], PRIVATE_KEY):
            assert secret not in response.text
    assert set(created.json()) == {"id", "device_label", "created_at", "last_success_at"}
    assert listed.json() == [created.json()]
    assert created.json()["last_success_at"] is None


async def test_each_person_only_sees_their_own_devices(push_app, admin, reception):
    mine, theirs = new_device(), new_device(APPLE)
    await admin.post(SUBSCRIPTIONS, json=_body(mine))
    await reception.post(SUBSCRIPTIONS, json=_body(theirs))
    assert len((await admin.get(SUBSCRIPTIONS)).json()) == 1
    assert len((await reception.get(SUBSCRIPTIONS)).json()) == 1
    assert (await admin.get(SUBSCRIPTIONS)).json()[0]["id"] != (await reception.get(SUBSCRIPTIONS)).json()[0]["id"]


# ----------------------------------------------------------------------------- upsert、改綁、上限


async def test_resubscribing_the_same_endpoint_updates_in_place(push_app, admin):
    device = new_device()
    first = (await admin.post(SUBSCRIPTIONS, json=_body(device), headers={"user-agent": CHROME_MAC_UA})).json()
    async with push_app.state.session_factory() as db:
        row = (await db.execute(select(PushSubscription))).scalar_one()
        row.failure_count = 7
        row.created_at = now_utc() - timedelta(days=30)
        await db.commit()
    renewed = device.__class__(endpoint=device.endpoint)  # 同一個 endpoint、新的金鑰（瀏覽器重新訂閱）
    again = await admin.post(SUBSCRIPTIONS, json=_body(renewed), headers={"user-agent": IPHONE_UA})
    assert again.status_code == 201
    [row] = await _rows(push_app)
    assert str(row.id) == first["id"] == again.json()["id"]
    assert row.p256dh == renewed.keys["p256dh"] and row.auth == renewed.keys["auth"]
    assert row.device_label == "iPhone（主畫面）" and row.failure_count == 0
    assert now_utc() - row.created_at > timedelta(days=29)  # 同一個人，開啟日期不變


async def test_an_endpoint_that_belonged_to_someone_else_is_rebound_to_the_caller(push_app, admin, reception):
    device = new_device()
    await reception.post(SUBSCRIPTIONS, json=_body(device))
    response = await admin.post(SUBSCRIPTIONS, json=_body(device))
    assert response.status_code == 201
    assert len(await _rows(push_app)) == 1
    assert len((await admin.get(SUBSCRIPTIONS)).json()) == 1
    assert (await reception.get(SUBSCRIPTIONS)).json() == []  # 原本那個人不會再收到


async def test_knowing_someone_elses_endpoint_is_not_enough_to_take_it_over(push_app, admin, reception):
    """2026-11-11 資安稽核：改綁要帶同一組金鑰（同一台裝置才有）。只知道 endpoint 的人搶不走，對方照常收得到。"""
    device = new_device()
    await reception.post(SUBSCRIPTIONS, json=_body(device))
    [before] = await _rows(push_app)
    response = await admin.post(SUBSCRIPTIONS, json={"endpoint": device.endpoint, "keys": new_device().keys})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "PUSH_ENDPOINT_IN_USE"
    [after] = await _rows(push_app)
    assert (after.user_id, after.p256dh, after.auth) == (before.user_id, before.p256dh, before.auth)
    assert (await admin.get(SUBSCRIPTIONS)).json() == []
    assert len((await reception.get(SUBSCRIPTIONS)).json()) == 1


async def test_at_most_ten_devices_per_person_oldest_dropped(push_app, admin):
    devices = [new_device() for _ in range(MAX_DEVICES_PER_USER + 2)]
    ids = []
    for index, device in enumerate(devices):
        response = await admin.post(SUBSCRIPTIONS, json=_body(device))
        assert response.status_code == 201
        ids.append(response.json()["id"])
        # 讓建立時間確實遞增（同一毫秒內建立時 created_at 可能相同）。
        async with push_app.state.session_factory() as db:
            row = await db.get(PushSubscription, uuid.UUID(response.json()["id"]))
            row.created_at = now_utc() - timedelta(hours=len(devices) - index)
            await db.commit()
    kept = {item["id"] for item in (await admin.get(SUBSCRIPTIONS)).json()}
    assert len(kept) == MAX_DEVICES_PER_USER
    assert ids[0] not in kept and ids[1] not in kept and ids[-1] in kept  # 最舊的兩台被刪


async def test_the_limit_is_per_person(push_app, admin, reception):
    for _ in range(MAX_DEVICES_PER_USER):
        await admin.post(SUBSCRIPTIONS, json=_body(new_device()))
    await reception.post(SUBSCRIPTIONS, json=_body(new_device(APPLE)))
    await admin.post(SUBSCRIPTIONS, json=_body(new_device()))
    assert await _count(push_app) == MAX_DEVICES_PER_USER + 1
    assert len((await reception.get(SUBSCRIPTIONS)).json()) == 1


# ----------------------------------------------------------------------------- 移除


async def test_remove_by_endpoint_deletes_only_my_own_row(push_app, admin, reception):
    mine, theirs = new_device(), new_device(APPLE)
    await admin.post(SUBSCRIPTIONS, json=_body(mine))
    await reception.post(SUBSCRIPTIONS, json=_body(theirs))
    assert (await admin.post(REMOVE, json={"endpoint": theirs.endpoint})).status_code == 204
    assert await _count(push_app) == 2  # 別人的 endpoint 刪不到
    assert (await admin.post(REMOVE, json={"endpoint": mine.endpoint})).status_code == 204
    assert await _count(push_app, endpoint=mine.endpoint) == 0 and await _count(push_app) == 1
    assert (await admin.post(REMOVE, json={"endpoint": mine.endpoint})).status_code == 204  # 重複移除不報錯


async def test_remove_requires_an_endpoint(push_app, admin):
    assert (await admin.post(REMOVE, json={})).status_code == 422
    assert (await admin.post(REMOVE, json={"endpoint": "x", "extra": 1})).status_code == 422


async def test_delete_by_id_only_removes_my_own_device(push_app, admin, reception):
    mine, theirs = new_device(), new_device(APPLE)
    mine_id = (await admin.post(SUBSCRIPTIONS, json=_body(mine))).json()["id"]
    their_id = (await reception.post(SUBSCRIPTIONS, json=_body(theirs))).json()["id"]
    assert (await admin.delete(f"{SUBSCRIPTIONS}/{their_id}")).status_code == 404
    assert await _count(push_app) == 2
    assert (await admin.delete(f"{SUBSCRIPTIONS}/{uuid.uuid4()}")).status_code == 404
    assert (await admin.delete(f"{SUBSCRIPTIONS}/not-a-uuid")).status_code == 422
    assert (await admin.delete(f"{SUBSCRIPTIONS}/{mine_id}")).status_code == 204
    assert await _count(push_app) == 1 and await _count(push_app, endpoint=theirs.endpoint) == 1


# ----------------------------------------------------------------------------- 測試通知


async def test_test_push_reaches_every_device_of_mine_and_nobody_else(push_app, admin, reception):
    phone, laptop, other = new_device(APPLE), new_device(), new_device()
    await admin.post(SUBSCRIPTIONS, json=_body(phone))
    await admin.post(SUBSCRIPTIONS, json=_body(laptop))
    await reception.post(SUBSCRIPTIONS, json=_body(other))
    response = await admin.post(TEST)
    assert response.status_code == 200 and response.json() == {"sent": 2, "failed": 0}
    service: FakePushService = push_app.state.fake_push
    [message] = service.bodies_for(phone)
    assert message["title"] == "測試通知" and message["url"] == "/admin/account"
    assert len(service.bodies_for(laptop)) == 1 and service.bodies_for(other) == []
    async with push_app.state.session_factory() as db:
        rows = list((await db.execute(select(PushSubscription).where(PushSubscription.endpoint.in_([phone.endpoint, laptop.endpoint])))).scalars())
    assert all(row.last_success_at is not None for row in rows)


async def test_test_push_counts_failures_and_drops_dead_devices(push_app, admin):
    alive, dead, broken = new_device(), new_device(), new_device(APPLE)
    for device in (alive, dead, broken):
        await admin.post(SUBSCRIPTIONS, json=_body(device))
    service: FakePushService = push_app.state.fake_push
    service.statuses[dead.endpoint] = 410
    service.statuses[broken.endpoint] = 503
    assert (await admin.post(TEST)).json() == {"sent": 1, "failed": 2}
    assert await _count(push_app, endpoint=dead.endpoint) == 0  # 410 的裝置已刪除
    [row] = [r for r in await _rows(push_app) if r.endpoint == broken.endpoint]
    assert row.failure_count == 1 and row.last_failure_at is not None  # 503 的留著、記一次失敗


async def test_test_push_without_devices_sends_nothing(push_app, admin):
    assert (await admin.post(TEST)).json() == {"sent": 0, "failed": 0}
    assert push_app.state.fake_push.requests == []


async def test_test_push_is_limited_to_three_per_minute_per_person(push_app, admin, reception):
    freeze_rate_limit_clock(push_app)
    await admin.post(SUBSCRIPTIONS, json=_body(new_device()))
    await reception.post(SUBSCRIPTIONS, json=_body(new_device(APPLE)))
    assert [(await admin.post(TEST)).status_code for _ in range(3)] == [200, 200, 200]
    blocked = await admin.post(TEST)
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) >= 1
    assert (await reception.post(TEST)).status_code == 200  # 限流是每個人各自算
    assert len(push_app.state.fake_push.requests) == 4  # 被擋的那一次沒有送出


# ----------------------------------------------------------------------------- 系統狀態、UA 名稱


async def test_system_status_shows_push_row_with_device_count_and_no_secrets(push_app, admin, reception):
    await admin.post(SUBSCRIPTIONS, json=_body(new_device()))
    await reception.post(SUBSCRIPTIONS, json=_body(new_device(APPLE)))
    response = await admin.get("/api/website/v1/admin/system-status")
    assert response.status_code == 200
    row = next(item for item in response.json()["services"] if item["key"] == "web_push")
    assert row == {"key": "web_push", "level": "ok", "detail": {"configured": True, "devices": 2}}
    assert PRIVATE_KEY not in response.text and PUBLIC_KEY not in response.text


async def test_system_status_row_when_keys_are_missing(admin_client):
    response = await admin_client.get("/api/website/v1/admin/system-status")
    row = next(item for item in response.json()["services"] if item["key"] == "web_push")
    assert row == {"key": "web_push", "level": "info", "detail": {"configured": False}}


@pytest.mark.parametrize(
    ("user_agent", "label"),
    [
        (IPHONE_UA, "iPhone（主畫面）"),
        ("Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1", "iPad（主畫面）"),
        ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", "Android Chrome"),
        ("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36", "Android Samsung 瀏覽器"),
        ("Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0", "Android Firefox"),
        (CHROME_MAC_UA, "Mac Chrome"),
        ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", "Mac Safari"),
        ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "Windows Edge"),
        ("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Linux Firefox"),
        ("curl/8.0", "其他裝置"),
        ("", "其他裝置"),
        (None, "其他裝置"),
    ],
)
async def test_device_label_comes_from_the_user_agent(user_agent, label):
    assert device_label(user_agent) == label
    assert len(label) <= 80


async def test_logs_never_contain_endpoints_or_keys(push_app, admin, caplog):
    device = new_device()
    caplog.set_level("DEBUG")
    await admin.post(SUBSCRIPTIONS, json=_body(device))
    await admin.post(TEST)
    assert device.endpoint not in caplog.text and device.keys["auth"] not in caplog.text and PRIVATE_KEY not in caplog.text
