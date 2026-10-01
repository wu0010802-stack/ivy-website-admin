from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.booking.models import VisitRequest
from app.operations import retention_service
from tests.conftest import book_slot, create_slot, freeze_rate_limit_clock, legacy_request


# 預約表單要有已發布的同意文字（切 slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")


async def _book_visit(admin_client, public_client, campus_key="yihua") -> str:
    booked = await book_slot(admin_client, public_client, campus_key)
    return booked["receipt_id"]


@pytest.mark.asyncio
async def test_click_event_recorded(public_client):
    response = await public_client.post(
        "/api/website/v1/public/analytics-events",
        json={"event_type": "cta_click_line", "campus_key": "yihua", "event_id": str(uuid4())},
    )
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_forged_conversion_event_rejected(public_client):
    """惡意提交 request_created/visit_confirmed 不得改變成效統計——
    公開端點只接受點擊類事件。"""
    response = await public_client.post(
        "/api/website/v1/public/analytics-events",
        json={"event_type": "visit_confirmed", "campus_key": "yihua", "event_id": str(uuid4())},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "EVENT_TYPE_NOT_ALLOWED"


@pytest.mark.asyncio
async def test_click_events_do_not_change_request_created_count(
    public_client, admin_client
):
    for _ in range(5):
        await public_client.post(
            "/api/website/v1/public/analytics-events",
            json={"event_type": "cta_click_phone", "campus_key": "yihua", "event_id": str(uuid4())},
        )
    funnel = await admin_client.get("/api/website/v1/admin/analytics/funnel?campus_key=yihua")
    assert funnel.json()["counts"]["cta_click_phone"] == 5
    assert funnel.json()["counts"]["request_created"] == 0


@pytest.mark.asyncio
async def test_click_event_rate_limited(app, public_client):
    freeze_rate_limit_clock(app)
    last_status = None
    for _ in range(25):
        resp = await public_client.post(
            "/api/website/v1/public/analytics-events",
            json={"event_type": "cta_click_line", "campus_key": "yihua", "event_id": str(uuid4())},
        )
        last_status = resp.status_code
    assert last_status == 429


@pytest.mark.asyncio
async def test_request_created_event_recorded_internally(admin_client, public_client):
    await _book_visit(admin_client, public_client)
    funnel = await admin_client.get("/api/website/v1/admin/analytics/funnel?campus_key=yihua")
    assert funnel.json()["counts"]["request_created"] == 1


@pytest.mark.asyncio
async def test_dashboard_scoped_by_campus_no_cross_campus_leak(
    admin_client, minghua_client, public_client
):
    await _book_visit(admin_client, public_client, campus_key="yihua")

    minghua_dashboard = await minghua_client.get("/api/website/v1/admin/dashboard")
    assert minghua_dashboard.status_code == 200
    # minghua 只看自己校，不因為 yihua 有案件而看到不屬於自己的資料
    assert minghua_dashboard.json()["campuses_without_active_booking"] == ["minghua"]


@pytest.mark.asyncio
async def test_export_visit_requests_does_not_leak_other_campus(
    admin_client, minghua_client, public_client
):
    await _book_visit(admin_client, public_client, campus_key="yihua")
    # 個資匯出是總管理者逐人授予的（2026-09-25 起），先授權再測校區範圍。
    minghua_me = (await minghua_client.get("/api/website/v1/auth/me")).json()["user"]
    granted = await admin_client.patch(
        f"/api/website/v1/admin/users/{minghua_me['id']}/capabilities", json={"capabilities": ["booking.export"]}
    )
    assert granted.status_code == 200, granted.text

    minghua_export = await minghua_client.get(
        "/api/website/v1/admin/visit-requests/export?campus_key=minghua"
    )
    assert minghua_export.status_code == 200
    assert "陳媽媽" not in minghua_export.text

    # minghua 不能匯出 yihua 的資料
    forbidden = await minghua_client.get(
        "/api/website/v1/admin/visit-requests/export?campus_key=yihua"
    )
    assert forbidden.status_code == 404


@pytest.mark.asyncio
async def test_audit_log_records_booking_config_before_and_after(admin_client):
    """規格 L181：預約設定要有修改前後紀錄。這些都是分校公開在官網上的設定
    （學校電話、LINE、外部網址、說明），沒有家長個資，完整記下來事後才查得出
    改之前是什麼（2026-09-25 缺口 10；原本刻意不記電話）。"""
    await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": 0, "mode": "phone", "phone": "07-392-8366", "message": "請於上班時間來電"},
    )
    log = await admin_client.get("/api/website/v1/admin/audit-log?campus_key=yihua")
    assert log.status_code == 200
    entries = log.json()
    assert len(entries) == 1
    assert entries[0]["action"] == "booking_config.update"
    metadata = entries[0]["metadata"]
    assert metadata["mode"] == "phone" and metadata["version"] == 1
    assert metadata["before"] == {
        "mode": "paused", "line_url": None, "phone": None, "external_url": None, "message": None,
        "parent_change_deadline_hours": 24,
    }
    assert metadata["after"]["phone"] == "07-392-8366"
    assert metadata["after"]["message"] == "請於上班時間來電"
    assert metadata["changed"] == ["mode", "phone", "message"]


@pytest.mark.asyncio
async def test_audit_log_requires_permission(minghua_client):
    response = await minghua_client.get("/api/website/v1/admin/audit-log?campus_key=yihua")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_retention_dry_run_does_not_modify_data(admin_client, public_client, db_session):
    from uuid import UUID

    receipt_id = await _book_visit(admin_client, public_client)
    await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/cancel")

    request = await db_session.get(VisitRequest, UUID(receipt_id))
    request.created_at = datetime.now(timezone.utc) - timedelta(days=400)
    request.cancelled_at = datetime.now(timezone.utc) - timedelta(days=400)
    await db_session.commit()

    dry_run = await admin_client.post("/api/website/v1/admin/retention/dry-run")
    assert dry_run.status_code == 200
    assert dry_run.json()["counts"]["cancelled"] == 1
    assert dry_run.json()["total"] == 1
    # 試算不留紀錄。
    assert (await admin_client.get("/api/website/v1/admin/retention-runs")).json() == []

    await db_session.refresh(request)
    assert request.parent_name == "陳媽媽"  # dry-run 不改資料
    assert request.anonymized_at is None


@pytest.mark.asyncio
async def test_retention_real_run_disabled_by_default(admin_client, public_client):
    await _book_visit(admin_client, public_client)
    response = await admin_client.post("/api/website/v1/admin/retention/run")
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "RETENTION_REAL_RUN_DISABLED"
    assert response.json()["detail"]["dry_run_preview"]["dry_run"] is True


@pytest.mark.asyncio
async def test_retention_does_not_touch_active_requests(admin_client, public_client, db_session):
    """未結案（new/confirmed）的案件即使很舊也不會被匿名化，不破壞還在
    進行中的接待工作；只算進「超過天數未結案」的提醒。"""
    from uuid import UUID

    booked_id = await _book_visit(admin_client, public_client)
    legacy_id = await legacy_request(db_session, status="new")
    for receipt_id in (booked_id, legacy_id):
        request = await db_session.get(VisitRequest, UUID(receipt_id))
        request.created_at = datetime.now(timezone.utc) - timedelta(days=400)
    await db_session.commit()

    days = {"cancelled_days": 365, "completed_days": 365, "open_overdue_days": 365}
    candidates = await retention_service.find_candidates(db_session, days)
    assert all(found == [] for found in candidates.values())
    assert await retention_service.count_open_overdue(db_session, days) == 2


@pytest.mark.asyncio
async def test_site_settings_roundtrip(admin_client):
    update = await admin_client.patch(
        "/api/website/v1/admin/site-settings",
        json={
            "expected_version": 1,
            "title": "常春藤幼兒園",
            "description": "測試描述",
            "share_image": None,
            "noindex": True,
            "privacy_policy_version": "v1",
        },
    )
    assert update.status_code == 200
    read = await admin_client.get("/api/website/v1/admin/site-settings")
    assert read.json()["title"] == "常春藤幼兒園"
    assert read.json()["noindex"] is True
    assert read.json()["version"] == 2

    # 拿舊版本存檔：不蓋掉別人剛改的設定。
    stale = await admin_client.patch(
        "/api/website/v1/admin/site-settings",
        json={
            "expected_version": 1,
            "title": "舊畫面",
            "description": "x",
            "share_image": None,
            "noindex": False,
            "privacy_policy_version": "v1",
        },
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "SITE_SETTINGS_VERSION_CONFLICT"
    assert stale.json()["detail"]["current_version"] == 2
    assert (await admin_client.get("/api/website/v1/admin/site-settings")).json()["title"] == "常春藤幼兒園"


@pytest.mark.asyncio
async def test_site_settings_requires_super_admin(minghua_client):
    response = await minghua_client.patch(
        "/api/website/v1/admin/site-settings",
        json={
            "expected_version": 1,
            "title": "x",
            "description": "x",
            "share_image": None,
            "noindex": True,
            "privacy_policy_version": "v1",
        },
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_dashboard_lists_today_visits_and_draft_kinds(admin_client, public_client, db_session):
    """總覽要回答「今天誰要來」和「哪幾項內容還沒發布」，不是只給兩個數字。
    數字沒辦法讓櫃台直接打電話，也沒辦法讓編輯知道要點進哪一頁。"""
    slot_id = await create_slot(admin_client, "yihua", days_ahead=0)
    # 今天 10:00 的場次過了 10 點就不能再用確認端點排入（已開始的時段會回
    # 409），這裡直接寫成已確認的案件，測試才不會因為執行時間而失敗。
    receipt_id = await legacy_request(
        db_session, status="confirmed", slot_id=slot_id, parent_name="陳媽媽"
    )

    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_about/revisions",
        json={
            "expected_version": 0,
            "payload": {
                "title": "標題",
                "since_label": "SINCE 1997",
                "body_text": "內文",
                "caption": "說明",
            },
        },
    )
    assert draft.status_code == 201, draft.text

    dashboard = await admin_client.get("/api/website/v1/admin/dashboard")
    assert dashboard.status_code == 200, dashboard.text
    body = dashboard.json()

    assert body["today_visits"] == 1
    today_rows = body["today_visit_list"]
    assert [r["id"] for r in today_rows] == [receipt_id]
    assert today_rows[0]["parent_name"]
    assert today_rows[0]["campus_key"] == "yihua"
    assert today_rows[0]["start_time"] == "10:00:00"
    assert today_rows[0]["end_time"] == "11:00:00"

    # 草稿要指名是哪一項內容，前端才能直接連過去。
    assert body["pending_publish"] >= 1
    assert "home_about" in body["pending_publish_kinds"]
