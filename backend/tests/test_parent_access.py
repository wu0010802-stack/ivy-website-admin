from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

import httpx
import pytest

from tests.conftest import book_slot, freeze_rate_limit_clock


# 預約表單要有已發布的同意文字（啟用 slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")


async def _enable_slots_and_book(admin_client, public_client, campus_key="yihua"):
    # 家長自助管理的測試需要一筆「已確認」的案件（自選場次送單即 confirmed）。
    booked = await book_slot(
        admin_client, public_client, campus_key, idempotency_key="parent-access-setup-01",
        age=None, preferred_time=None, questions=None,
    )
    return booked["receipt_id"], booked["slot_id"], booked["slot_date"]


@pytest.mark.asyncio
async def test_parent_can_exchange_token_and_read_own_request(admin_client, public_client):
    receipt_id, _slot_id, _date = await _enable_slots_and_book(admin_client, public_client)

    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    assert link.status_code == 200
    fragment = link.json()["manage_url_fragment"]
    token = fragment.split("token=")[1]

    exchange = await public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": token}
    )
    assert exchange.status_code == 200
    assert exchange.json()["id"] == receipt_id
    assert exchange.headers["cache-control"] == "private, no-store"
    assert exchange.headers["referrer-policy"] == "no-referrer"
    assert exchange.headers["x-robots-tag"] == "noindex, nofollow"
    assert "reschedule_pending" not in exchange.json()

    me = await public_client.get("/api/website/v1/public/visit-manage/me")
    assert me.status_code == 200
    assert me.json()["id"] == receipt_id


@pytest.mark.asyncio
async def test_invalid_token_rejected(public_client):
    response = await public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": "not-a-real-token"}
    )
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "TOKEN_INVALID"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["referrer-policy"] == "no-referrer"


@pytest.mark.asyncio
async def test_invalid_new_link_clears_previous_browser_session(admin_client, public_client):
    receipt_id, _, _ = await _enable_slots_and_book(admin_client, public_client)
    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]
    await public_client.post("/api/website/v1/public/visit-manage/exchange", json={"token": token})
    invalid = await public_client.post("/api/website/v1/public/visit-manage/exchange", json={"token": "invalid"})
    assert invalid.status_code == 401
    assert (await public_client.get("/api/website/v1/public/visit-manage/me")).status_code == 401


@pytest.mark.asyncio
async def test_production_parent_cookie_is_secure(app, admin_client, public_client):
    receipt_id, _, _ = await _enable_slots_and_book(admin_client, public_client)
    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]
    app.state.settings.environment = "production"
    exchange = await public_client.post("/api/website/v1/public/visit-manage/exchange", json={"token": token})
    assert exchange.status_code == 200
    assert "Secure" in exchange.headers["set-cookie"]
    assert "HttpOnly" in exchange.headers["set-cookie"]


@pytest.mark.asyncio
async def test_parent_session_isolated_between_families(app, admin_client, public_client):
    """家長只能讀自己的案件：另一個家長的 session 讀不到這一筆。"""
    receipt_id, slot_id, slot_date = await _enable_slots_and_book(admin_client, public_client)

    # 建第二筆不同家長的案件（不同時段，避免撞名額）
    second_slot = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={"slot_date": slot_date, "start_time": "14:00:00", "end_time": "15:00:00", "capacity": 1},
    )
    me = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    other = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json={
            "campus_key": "yihua",
            "config_version": me.json()["version"],
            "parent_name": "林媽媽",
            "phone": "0922345678",
            "age": None,
            "preferred_time": None,
            "questions": None,
            "consent_given": True,
            "slot_id": second_slot.json()["id"],
        },
        headers={"Idempotency-Key": "parent-access-other-01"},
    )
    other_receipt_id = other.json()["receipt_id"]

    link_a = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    link_b = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{other_receipt_id}/access-link"
    )
    token_a = link_a.json()["manage_url_fragment"].split("token=")[1]
    token_b = link_b.json()["manage_url_fragment"].split("token=")[1]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", headers={"X-Ivy-Parent": "1"}) as client_a:
        await client_a.post("/api/website/v1/public/visit-manage/exchange", json={"token": token_a})
        me_a = await client_a.get("/api/website/v1/public/visit-manage/me")
        assert me_a.json()["id"] == receipt_id
        assert me_a.json()["id"] != other_receipt_id

    async with httpx.AsyncClient(transport=transport, base_url="http://test", headers={"X-Ivy-Parent": "1"}) as client_b:
        await client_b.post("/api/website/v1/public/visit-manage/exchange", json={"token": token_b})
        me_b = await client_b.get("/api/website/v1/public/visit-manage/me")
        assert me_b.json()["id"] == other_receipt_id


async def _access_token(admin_client, receipt_id: str) -> str:
    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    return link.json()["manage_url_fragment"].split("token=")[1]


@pytest.mark.asyncio
async def test_parent_mutation_refuses_request_switched_in_another_tab(admin_client, public_client):
    """同一個瀏覽器的分頁共用一個 session cookie：A 的管理頁開著，另一個分頁開了 B 的
    連結，回 A 分頁按取消或改期，不能改到 B（2026-09-30 E2E：A 仍是原狀、B 被取消）。
    異動帶畫面上的案件 id，和 session 的案件對不上就 409，兩筆都不動。"""
    receipt_a, _slot_a, slot_date = await _enable_slots_and_book(admin_client, public_client)
    second_slot = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={"slot_date": slot_date, "start_time": "14:00:00", "end_time": "15:00:00", "capacity": 1},
    )
    target_slot = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={"slot_date": slot_date, "start_time": "16:00:00", "end_time": "17:00:00", "capacity": 1},
    )
    version = (await admin_client.get("/api/website/v1/admin/booking-config/yihua")).json()["version"]
    second = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json={
            "campus_key": "yihua",
            "config_version": version,
            "parent_name": "陳媽媽",
            "phone": "0912345678",
            "age": None,
            "preferred_time": None,
            "questions": None,
            "consent_given": True,
            "slot_id": second_slot.json()["id"],
        },
        headers={"Idempotency-Key": "parent-access-second-child-01"},
    )
    receipt_b = second.json()["receipt_id"]

    for receipt in (receipt_a, receipt_b):
        exchanged = await public_client.post(
            "/api/website/v1/public/visit-manage/exchange", json={"token": await _access_token(admin_client, receipt)}
        )
        assert exchanged.status_code == 200

    cancel = await public_client.post("/api/website/v1/public/visit-manage/cancel", json={"visit_request_id": receipt_a})
    assert cancel.status_code == 409
    assert cancel.json()["detail"]["code"] == "PARENT_SESSION_CHANGED"
    moved = await public_client.post(
        "/api/website/v1/public/visit-manage/reschedule",
        json={"slot_id": target_slot.json()["id"], "visit_request_id": receipt_a},
    )
    assert moved.status_code == 409
    assert moved.json()["detail"]["code"] == "PARENT_SESSION_CHANGED"

    # 兩筆都沒動：仍是已確認、場次也沒換。
    for receipt, expected_slot in ((receipt_a, _slot_a), (receipt_b, second_slot.json()["id"])):
        detail = await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt}")
        assert detail.json()["status"] == "confirmed"
        assert detail.json()["slot_id"] == expected_slot

    # 顯示 B 的分頁照常可以操作。
    cancel_b = await public_client.post("/api/website/v1/public/visit-manage/cancel", json={"visit_request_id": receipt_b})
    assert cancel_b.status_code == 200
    assert cancel_b.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_parent_mutations_without_visit_request_id_still_work_for_old_pages(admin_client, public_client):
    """CD 先部署 API 再部署 web：部署前就開著的家長頁、web 上線前的空窗都是舊版官網，
    取消不帶 body，照舊依 session 處理（發布版本需前後相容）。"""
    receipt, _slot_id, _slot_date = await _enable_slots_and_book(admin_client, public_client)
    await public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": await _access_token(admin_client, receipt)}
    )
    cancelled = await public_client.post("/api/website/v1/public/visit-manage/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_parent_can_cancel_own_request(app, admin_client, public_client):
    receipt_id, _slot_id, _date = await _enable_slots_and_book(admin_client, public_client)
    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", headers={"X-Ivy-Parent": "1"}) as client:
        await client.post("/api/website/v1/public/visit-manage/exchange", json={"token": token})
        cancel = await client.post("/api/website/v1/public/visit-manage/cancel", json={"visit_request_id": receipt_id})
        assert cancel.status_code == 200
        assert cancel.json()["status"] == "cancelled"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    [("POST", "exchange"), ("POST", "cancel"), ("POST", "reschedule"), ("PATCH", "me")],
)
async def test_parent_mutations_require_non_simple_request_header(public_client, method, path):
    public_client.headers.pop('X-Ivy-Parent')
    response = await public_client.request(method, f'/api/website/v1/public/visit-manage/{path}', json={
        'token': 'invalid-test-token', 'visit_request_id': str(uuid.uuid4()), 'slot_id': str(uuid.uuid4()),
        'expected_version': 1,
    })
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_parent_exchange_rejects_cross_site_and_wrong_configured_origin(app, public_client):
    path = '/api/website/v1/public/visit-manage/exchange'
    response = await public_client.post(path, json={'token': 'invalid'}, headers={'Sec-Fetch-Site': 'cross-site'})
    assert response.status_code == 403
    app.state.settings.admin_origin = 'https://website.example'
    response = await public_client.post(path, json={'token': 'invalid'}, headers={'Origin': 'https://other.example'})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_parent_change_deadline_is_enforced_by_api(admin_client, public_client, db_session):
    from app.booking.models import VisitSlot
    from app.common.timezones import OPERATING_TZ
    receipt, slot_id, _ = await _enable_slots_and_book(admin_client, public_client)
    link = await admin_client.post(f'/api/website/v1/admin/visit-requests/{receipt}/access-link')
    token = link.json()['manage_url_fragment'].split('token=')[1]
    exchange = await public_client.post('/api/website/v1/public/visit-manage/exchange', json={'token': token})
    assert exchange.json().get('can_cancel') is True
    assert exchange.json().get('can_reschedule') is True
    slot = await db_session.get(VisitSlot, uuid.UUID(slot_id))
    starts = (datetime.now(timezone.utc) + timedelta(hours=12)).astimezone(OPERATING_TZ)
    slot.slot_date = starts.date()
    slot.start_time = starts.time().replace(tzinfo=None)
    await db_session.commit()
    me = await public_client.get('/api/website/v1/public/visit-manage/me')
    assert me.json()['can_cancel'] is False
    assert me.json()['can_reschedule'] is False
    for method, path, body in [
        ('POST', 'cancel', {'visit_request_id': receipt}),
        ('POST', 'reschedule', {'visit_request_id': receipt, 'slot_id': str(uuid.uuid4())}),
        ('PATCH', 'me', {'visit_request_id': receipt, 'expected_version': 1, 'parent_name': '陳爸爸'}),
    ]:
        result = await public_client.request(method, f'/api/website/v1/public/visit-manage/{path}', json=body)
        assert result.status_code == 409, (path, result.text)
        assert result.json()['detail']['code'] == 'CHANGE_DEADLINE_PASSED'


@pytest.mark.asyncio
async def test_parent_token_exchange_has_rate_limit(app, public_client):
    freeze_rate_limit_clock(app)
    results = [await public_client.post('/api/website/v1/public/visit-manage/exchange', json={'token': 'invalid'}) for _ in range(31)]
    assert results[-1].status_code == 429
    assert 'retry-after' in results[-1].headers


@pytest.mark.asyncio
async def test_parent_change_deadline_follows_campus_setting(admin_client, public_client, db_session):
    """規格 L238：期限依各校設定，預設參觀前 24 小時。家長頁顯示的截止時間、
    能不能取消／改期與 API 實際擋下的時間點都要跟著設定走。"""
    from sqlalchemy import select

    from app.booking.models import VisitSlot
    from app.common.timezones import slot_start_utc
    from app.operations.models import AuditLogEntry

    receipt, slot_id, _ = await _enable_slots_and_book(admin_client, public_client)
    config = (await admin_client.get("/api/website/v1/admin/booking-config/yihua")).json()
    assert config["parent_change_deadline_hours"] == 24
    slot = await db_session.get(VisitSlot, uuid.UUID(slot_id))
    starts = slot_start_utc(slot.slot_date, slot.start_time)

    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]
    exchanged = (await public_client.post("/api/website/v1/public/visit-manage/exchange", json={"token": token})).json()
    assert exchanged["change_deadline_hours"] == 24
    assert datetime.fromisoformat(exchanged["change_deadline"]) == starts - timedelta(hours=24)
    assert exchanged["can_cancel"] is True

    # 參觀在三天後；改成參觀前 5 天截止，線上就不能再取消或改期。
    updated = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": config["version"], "mode": "slots", "parent_change_deadline_hours": 120},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["parent_change_deadline_hours"] == 120
    me = (await public_client.get("/api/website/v1/public/visit-manage/me")).json()
    assert me["change_deadline_hours"] == 120
    assert datetime.fromisoformat(me["change_deadline"]) == starts - timedelta(hours=120)
    assert me["can_cancel"] is False and me["can_reschedule"] is False
    blocked = await public_client.post("/api/website/v1/public/visit-manage/cancel", json={"visit_request_id": receipt})
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "CHANGE_DEADLINE_PASSED"
    detail = await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt}")
    assert detail.json()["parent_change_deadline_hours"] == 120

    # 範圍 1–336 小時；沒帶這個欄位的存檔（舊版後台）維持原設定。
    version = updated.json()["version"]
    for bad in (0, 337):
        rejected = await admin_client.patch(
            "/api/website/v1/admin/booking-config/yihua",
            json={"expected_version": version, "mode": "slots", "parent_change_deadline_hours": bad},
        )
        assert rejected.status_code == 422
    kept = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": version, "mode": "slots"},
    )
    assert kept.json()["parent_change_deadline_hours"] == 120

    # 改回 24 小時後又能取消，取消回應也帶該校的期限。
    back = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": kept.json()["version"], "mode": "slots", "parent_change_deadline_hours": 24},
    )
    assert back.status_code == 200
    cancelled = await public_client.post("/api/website/v1/public/visit-manage/cancel", json={"visit_request_id": receipt})
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["change_deadline_hours"] == 24

    audits = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "booking_config.update"))
    ).scalars().all()
    assert {a.metadata_json["parent_change_deadline_hours"] for a in audits} >= {24, 120}


@pytest.mark.asyncio
async def test_parent_page_keeps_inactive_campus_name_and_phone(admin_client, public_client, db_session):
    """B08 審查：停用的分校不在公開內容裡，家長管理頁改用預約回應帶的校名與電話，
    不改列其他校區；停用後不給改期（公開時段也不列），取消照常。"""
    from app.content import service as content_service

    receipt, _slot_id, slot_date = await _enable_slots_and_book(admin_client, public_client)
    other_slot = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={"slot_date": slot_date, "start_time": "15:00:00", "end_time": "16:00:00", "capacity": 2},
    )
    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]

    # 還沒發布分校介紹：校名用分校資料表的名稱，沒有電話。
    exchanged = (await public_client.post("/api/website/v1/public/visit-manage/exchange", json={"token": token})).json()
    assert (exchanged["campus_name"], exchanged["campus_active"], exchanged["campus_phone"]) == ("義華校", True, None)
    assert exchanged["can_reschedule"] is True

    item = await content_service.get_or_create_content_item(db_session, "campus_profile", "yihua")
    profile = {
        "name": "常春藤義華校", "district": "三民區", "address": "高雄市三民區義華路68號", "phone": " 07-3800000 ",
        "facebook": "", "line": "",
    }
    revision = await content_service.create_revision(db_session, item, profile, item.latest_version, None)
    await content_service.publish_revision(db_session, item, revision, None)
    await db_session.commit()

    off = await admin_client.patch("/api/website/v1/admin/campuses/yihua/status", json={"active": False, "reason": "整修"})
    assert off.status_code == 200, off.text
    site = (await public_client.get("/api/website/v1/public/site")).json()["content"]
    assert "yihua" not in site.get("campus_profile", {})

    me = (await public_client.get("/api/website/v1/public/visit-manage/me")).json()
    assert (me["campus_name"], me["campus_active"], me["campus_phone"]) == ("常春藤義華校", False, "07-3800000")
    assert me["can_cancel"] is True
    assert me["can_reschedule"] is False
    blocked = await public_client.post(
        "/api/website/v1/public/visit-manage/reschedule",
        json={"visit_request_id": receipt, "slot_id": other_slot.json()["id"]},
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "BOOKING_UNAVAILABLE"

    cancelled = await public_client.post("/api/website/v1/public/visit-manage/cancel", json={"visit_request_id": receipt})
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["campus_name"] == "常春藤義華校"
