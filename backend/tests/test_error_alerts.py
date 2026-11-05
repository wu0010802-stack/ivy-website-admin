"""網站出現新的錯誤時推到總管理者手機（notifications/error_alerts.py，接 operations/error_reports.py，2026-11-05）。

觸發條件：一組錯誤第一次出現，或已標為處理後又發生。全站 15 分鐘節流、只給啟用中的總管理者、
推播沒啟用時什麼都不做、失敗不影響錯誤回報與 API 回應。推播服務全部用 httpx.MockTransport。"""

from __future__ import annotations

import logging
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, update

from app.auth.models import Role, User
from app.common.timezones import now_utc
from app.notifications import error_alerts
from app.operations import error_reports
from app.operations.models import ErrorGroup
from tests.conftest import parent_client
from tests.push_fixtures import (  # noqa: F401  （pytest fixture）
    admin, campus_admin, clients, editor, login, push_app, readonly, reception,
)
from tests.push_helpers import APPLE, FakePushService, new_device

API = "/api/website/v1"
URL = f"{API}/public/client-errors"
SUBSCRIPTIONS = f"{API}/admin/push/subscriptions"


@pytest.fixture(autouse=True)
def _fresh_state():
    error_reports.reset_state()
    yield
    error_reports.reset_state()


def _report(**overrides) -> dict:
    return {
        "source": "web",
        "kind": "TypeError",
        "message": "x is not a function",
        "stack": "TypeError: x is not a function\n    at go (/_nuxt/entry.abc123.js:10:20)",
        "path": "/campuses/yihua",
        "release": "build-1",
        **overrides,
    }


async def _subscribe(client, host: str | None = None):
    device = new_device(host) if host else new_device()
    assert (await client.post(SUBSCRIPTIONS, json={"endpoint": device.endpoint, "keys": device.keys})).status_code == 201
    return device


async def _report_error(push_app, **overrides) -> httpx.Response:
    async with parent_client(push_app) as public:
        response = await public.post(URL, json=_report(**overrides))
    await error_alerts.wait_idle()
    return response


async def _groups(push_app) -> list[ErrorGroup]:
    async with push_app.state.session_factory() as db:
        return list((await db.execute(select(ErrorGroup).order_by(ErrorGroup.id))).scalars())


async def _age_alerts(push_app, minutes: int) -> None:
    """把所有組的 alerted_at 往前推，模擬節流窗口已過。"""
    async with push_app.state.session_factory() as db:
        await db.execute(update(ErrorGroup).where(ErrorGroup.alerted_at.is_not(None)).values(alerted_at=now_utc() - timedelta(minutes=minutes)))
        await db.commit()


# ----------------------------------------------------------------------------- 觸發與內容


async def test_a_first_time_error_alerts_the_super_admin(push_app, admin):
    device = await _subscribe(admin)
    response = await _report_error(push_app)
    assert response.status_code == 204
    [payload] = push_app.state.fake_push.bodies_for(device)
    assert payload == {
        "title": "網站出現新的錯誤",
        "body": "官網：TypeError x is not a function",
        "url": "/admin/system-status#errors",
        "tag": "site-error",
    }
    [group] = await _groups(push_app)
    assert group.alerted_at is not None


@pytest.mark.parametrize(("source", "label"), [("web", "官網"), ("admin", "後台")])
async def test_body_names_the_source(push_app, admin, source, label):
    device = await _subscribe(admin)
    await _report_error(push_app, source=source, kind="RangeError", message="boom")
    [payload] = push_app.state.fake_push.bodies_for(device)
    assert payload["body"] == f"{label}：RangeError boom"


async def test_api_errors_alert_too(push_app, admin):
    device = await _subscribe(admin)

    @push_app.get(f"{API}/_alert_boom")
    async def _boom() -> dict:
        raise ValueError("kaboom")

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=push_app, raise_app_exceptions=False), base_url="http://test") as client:
        assert (await client.get(f"{API}/_alert_boom")).status_code == 500
    await error_alerts.wait_idle()
    [payload] = push_app.state.fake_push.bodies_for(device)
    assert payload["body"] == "API：ValueError kaboom" and payload["tag"] == "site-error"


async def test_long_messages_are_cut_to_60_characters_and_whitespace_collapsed(push_app, admin):
    device = await _subscribe(admin)
    await _report_error(push_app, message="很長的訊息\n\n   " + "字" * 200)
    [payload] = push_app.state.fake_push.bodies_for(device)
    assert "\n" not in payload["body"] and "  " not in payload["body"]
    shown = payload["body"].removeprefix("官網：TypeError ")
    assert shown.startswith("很長的訊息 字") and len(shown) == 60


async def test_message_is_the_redacted_stored_text_not_the_raw_report(push_app, admin):
    device = await _subscribe(admin)
    await _report_error(push_app, message="failed for mom@example.com phone 0912345678")
    [payload] = push_app.state.fake_push.bodies_for(device)
    assert "mom@example.com" not in payload["body"] and "0912345678" not in payload["body"]
    assert "[email]" in payload["body"]


# ----------------------------------------------------------------------------- 只有新的一組或重新開啟才通知


async def test_the_same_error_again_does_not_alert_again(push_app, admin):
    device = await _subscribe(admin)
    await _report_error(push_app)
    await _age_alerts(push_app, 60)  # 就算節流窗口過了
    await _report_error(push_app)
    await _report_error(push_app)
    assert len(push_app.state.fake_push.bodies_for(device)) == 1
    assert (await _groups(push_app))[0].count == 3


async def test_an_error_that_comes_back_after_being_resolved_alerts_again(push_app, admin):
    device = await _subscribe(admin)
    await _report_error(push_app)
    [group] = await _groups(push_app)
    assert (await admin.post(f"{API}/admin/error-groups/{group.id}/resolve")).status_code in (200, 204)
    await _age_alerts(push_app, 20)
    await _report_error(push_app)
    assert len(push_app.state.fake_push.bodies_for(device)) == 2
    [group] = await _groups(push_app)
    assert group.resolved_at is None and group.count == 2


# ----------------------------------------------------------------------------- 全站 15 分鐘節流


async def test_alerts_are_throttled_site_wide_for_15_minutes(push_app, admin):
    device = await _subscribe(admin)
    await _report_error(push_app, kind="ErrorA")
    await _report_error(push_app, kind="ErrorB")  # 另一組新錯誤，但全站 15 分鐘內才推過
    await _report_error(push_app, kind="ErrorC")
    assert [p["body"] for p in push_app.state.fake_push.bodies_for(device)] == ["官網：ErrorA x is not a function"]
    groups = await _groups(push_app)
    assert [g.alerted_at is not None for g in groups] == [True, False, False]  # 被擋掉的不補推，也沒有標記
    await _age_alerts(push_app, 14)
    await _report_error(push_app, kind="ErrorD")
    assert len(push_app.state.fake_push.bodies_for(device)) == 1  # 14 分鐘還在窗口內
    await _age_alerts(push_app, 16)
    await _report_error(push_app, kind="ErrorE")
    assert [p["body"] for p in push_app.state.fake_push.bodies_for(device)][-1] == "官網：ErrorE x is not a function"
    assert len(push_app.state.fake_push.bodies_for(device)) == 2


async def test_concurrent_new_errors_send_only_one_alert(push_app, admin):
    device = await _subscribe(admin)
    import asyncio

    async with parent_client(push_app) as public:
        await asyncio.gather(*(public.post(URL, json=_report(kind=f"Err{i}")) for i in range(8)))
    await error_alerts.wait_idle()
    assert len(push_app.state.fake_push.bodies_for(device)) == 1
    assert sum(g.alerted_at is not None for g in await _groups(push_app)) == 1


async def test_the_group_is_marked_before_sending_even_when_the_push_fails(push_app, admin):
    device = await _subscribe(admin)
    push_app.state.fake_push.default_status = 503
    await _report_error(push_app, kind="ErrorA")
    assert len(push_app.state.fake_push.bodies_for(device)) == 1
    [group] = await _groups(push_app)
    assert group.alerted_at is not None
    await _report_error(push_app, kind="ErrorB")  # 剛剛那次失敗也算推過：窗口內不再嘗試
    assert len(push_app.state.fake_push.bodies_for(device)) == 1


# ----------------------------------------------------------------------------- 收件人


async def test_only_active_super_admins_receive_error_alerts(push_app, admin, campus_admin, reception):
    admin_device = await _subscribe(admin)
    campus_device = await _subscribe(campus_admin, APPLE)
    desk_device = await _subscribe(reception)
    second = await login(push_app, "push-admin-2@ivy.example", Role.SUPER_ADMIN)
    inactive = await login(push_app, "push-admin-3@ivy.example", Role.SUPER_ADMIN)
    try:
        second_device = await _subscribe(second)
        inactive_device = await _subscribe(inactive)
        async with push_app.state.session_factory() as db:
            await db.execute(update(User).where(User.email == "push-admin-3@ivy.example").values(is_active=False))
            await db.commit()
        await _report_error(push_app)
    finally:
        await second.aclose()
        await inactive.aclose()
    service: FakePushService = push_app.state.fake_push
    assert len(service.bodies_for(admin_device)) == 1 and len(service.bodies_for(second_device)) == 1
    assert service.bodies_for(campus_device) == [] and service.bodies_for(desk_device) == []  # 分校管理者、接待不收
    assert service.bodies_for(inactive_device) == []  # 停用的帳號不收


async def test_no_subscribers_means_no_requests_but_the_group_is_still_marked(push_app, admin):
    await _report_error(push_app)
    assert push_app.state.fake_push.requests == []


# ----------------------------------------------------------------------------- 推播關閉、失敗不外溢


async def test_nothing_is_scheduled_or_sent_when_push_is_not_configured(app, public_client, db_session):
    requests: list[httpx.Request] = []
    app.state.push_transport = httpx.MockTransport(lambda request: requests.append(request) or httpx.Response(201))
    assert (await public_client.post(URL, json=_report())).status_code == 204
    assert error_alerts._tasks == set()
    await error_alerts.wait_idle()
    assert requests == []
    db_session.expire_all()
    [group] = (await db_session.execute(select(ErrorGroup))).scalars().all()
    assert group.alerted_at is None  # 沒啟用就不標記


async def test_alert_failures_never_affect_the_report_endpoint(push_app, admin, monkeypatch, caplog):
    await _subscribe(admin)

    async def broken(*args, **kwargs):
        raise RuntimeError("push backend exploded https://fcm.googleapis.com/x")

    monkeypatch.setattr(error_alerts, "alert", broken)
    caplog.set_level(logging.WARNING)
    response = await _report_error(push_app)
    assert response.status_code == 204
    assert len(await _groups(push_app)) == 1  # 錯誤回報照常寫入
    warning = next(r for r in caplog.records if "手機推播失敗" in r.getMessage())
    assert "RuntimeError" in warning.getMessage() and "fcm.googleapis.com" not in warning.getMessage()


async def test_scheduling_failures_are_swallowed(push_app, monkeypatch):
    def broken_loop():
        raise RuntimeError("no loop")

    monkeypatch.setattr(error_alerts.asyncio, "get_running_loop", broken_loop)
    error_alerts.schedule(push_app, 1)  # 不丟例外
    assert error_alerts._tasks == set()


async def test_the_background_task_keeps_a_reference_until_it_finishes(push_app, admin):
    import asyncio

    await _subscribe(admin)
    release = asyncio.Event()
    original = error_alerts.alert

    async def slow(*args, **kwargs):
        await release.wait()
        return await original(*args, **kwargs)

    error_alerts.alert = slow  # type: ignore[assignment]
    try:
        async with parent_client(push_app) as public:
            assert (await public.post(URL, json=_report())).status_code == 204  # 回應不等通知
        assert len(error_alerts._tasks) == 1
        release.set()
        await error_alerts.wait_idle()
    finally:
        error_alerts.alert = original  # type: ignore[assignment]
    assert error_alerts._tasks == set()
    assert len(push_app.state.fake_push.requests) == 1
