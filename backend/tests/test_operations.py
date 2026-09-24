from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.booking.models import VisitRequest, VisitRequestStatus
from app.operations import retention_service


async def _submit_inquiry(admin_client, public_client, campus_key="yihua", idempotency_key="ops-01"):
    current = await admin_client.get(f"/api/website/v1/admin/booking-config/{campus_key}")
    await admin_client.patch(
        f"/api/website/v1/admin/booking-config/{campus_key}",
        json={"expected_version": current.json()["version"], "mode": "inquiry"},
    )
    me = await admin_client.get(f"/api/website/v1/admin/booking-config/{campus_key}")
    response = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json={
            "campus_key": campus_key,
            "config_version": me.json()["version"],
            "parent_name": "陳媽媽",
            "phone": "0912345678",
            "age": None,
            "preferred_time": None,
            "questions": None,
            "consent_given": True,
        },
        headers={"Idempotency-Key": idempotency_key},
    )
    assert response.status_code == 201, response.text
    return response.json()["receipt_id"]


@pytest.mark.asyncio
async def test_click_event_recorded(public_client):
    response = await public_client.post(
        "/api/website/v1/public/analytics-events",
        json={"event_type": "cta_click_line", "campus_key": "yihua"},
    )
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_forged_conversion_event_rejected(public_client):
    """惡意提交 request_created/visit_confirmed 不得改變成效統計——
    公開端點只接受點擊類事件。"""
    response = await public_client.post(
        "/api/website/v1/public/analytics-events",
        json={"event_type": "visit_confirmed", "campus_key": "yihua"},
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
            json={"event_type": "cta_click_phone", "campus_key": "yihua"},
        )
    funnel = await admin_client.get("/api/website/v1/admin/analytics/funnel?campus_key=yihua")
    assert funnel.json()["cta_click_phone"] == 5
    assert funnel.json()["request_created"] == 0


@pytest.mark.asyncio
async def test_click_event_rate_limited(public_client):
    last_status = None
    for _ in range(25):
        resp = await public_client.post(
            "/api/website/v1/public/analytics-events",
            json={"event_type": "cta_click_line", "campus_key": "yihua"},
        )
        last_status = resp.status_code
    assert last_status == 429


@pytest.mark.asyncio
async def test_request_created_event_recorded_internally(admin_client, public_client):
    await _submit_inquiry(admin_client, public_client, idempotency_key="ops-internal-01")
    funnel = await admin_client.get("/api/website/v1/admin/analytics/funnel?campus_key=yihua")
    assert funnel.json()["request_created"] == 1


@pytest.mark.asyncio
async def test_dashboard_scoped_by_campus_no_cross_campus_leak(
    admin_client, minghua_client, public_client
):
    await _submit_inquiry(admin_client, public_client, campus_key="yihua", idempotency_key="ops-dash-01")

    minghua_dashboard = await minghua_client.get("/api/website/v1/admin/dashboard")
    assert minghua_dashboard.status_code == 200
    # minghua 只看自己校，不因為 yihua 有案件而看到不屬於自己的資料
    assert minghua_dashboard.json()["campuses_without_active_booking"] == ["minghua"]


@pytest.mark.asyncio
async def test_export_visit_requests_does_not_leak_other_campus(
    admin_client, minghua_client, public_client
):
    await _submit_inquiry(admin_client, public_client, campus_key="yihua", idempotency_key="ops-export-01")

    minghua_export = await minghua_client.get(
        "/api/website/v1/admin/visit-requests/export?campus_key=minghua"
    )
    assert "陳媽媽" not in minghua_export.text

    # minghua 不能匯出 yihua 的資料
    forbidden = await minghua_client.get(
        "/api/website/v1/admin/visit-requests/export?campus_key=yihua"
    )
    assert forbidden.status_code == 404


@pytest.mark.asyncio
async def test_audit_log_records_booking_config_change_without_pii(admin_client):
    await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": 0, "mode": "phone", "phone": "07-392-8366"},
    )
    log = await admin_client.get("/api/website/v1/admin/audit-log?campus_key=yihua")
    assert log.status_code == 200
    entries = log.json()
    assert len(entries) == 1
    assert entries[0]["action"] == "booking_config.update"
    # 稽核紀錄不應該出現電話這種個資/聯絡資訊欄位值
    assert "07-392-8366" not in str(entries[0]["metadata"])


@pytest.mark.asyncio
async def test_audit_log_requires_permission(minghua_client):
    response = await minghua_client.get("/api/website/v1/admin/audit-log?campus_key=yihua")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_retention_dry_run_does_not_modify_data(admin_client, public_client, db_session):
    from uuid import UUID

    receipt_id = await _submit_inquiry(admin_client, public_client, idempotency_key="ops-retention-01")
    await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/cancel")

    request = await db_session.get(VisitRequest, UUID(receipt_id))
    request.created_at = datetime.now(timezone.utc) - timedelta(days=400)
    await db_session.commit()

    dry_run = await admin_client.post("/api/website/v1/admin/retention/dry-run?older_than_days=365")
    assert dry_run.status_code == 200
    assert dry_run.json()["candidate_count"] == 1

    await db_session.refresh(request)
    assert request.parent_name == "陳媽媽"  # dry-run 不改資料
    assert request.anonymized_at is None


@pytest.mark.asyncio
async def test_retention_real_run_disabled_by_default(admin_client, public_client):
    await _submit_inquiry(admin_client, public_client, idempotency_key="ops-retention-02")
    response = await admin_client.post("/api/website/v1/admin/retention/run?older_than_days=0")
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "RETENTION_REAL_RUN_DISABLED"


@pytest.mark.asyncio
async def test_retention_does_not_touch_active_requests(admin_client, public_client, db_session):
    """未結案（new/confirmed）的案件即使很舊也不會被匿名化，
    不破壞還在進行中的接待工作。"""
    from uuid import UUID

    receipt_id = await _submit_inquiry(admin_client, public_client, idempotency_key="ops-retention-03")
    request = await db_session.get(VisitRequest, UUID(receipt_id))
    request.created_at = datetime.now(timezone.utc) - timedelta(days=400)
    await db_session.commit()

    candidates = await retention_service.find_retention_candidates(db_session, older_than_days=365)
    assert len(candidates) == 0  # 狀態是 new，不在保存政策的清理範圍內


@pytest.mark.asyncio
async def test_site_settings_roundtrip(admin_client):
    update = await admin_client.patch(
        "/api/website/v1/admin/site-settings",
        json={
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


@pytest.mark.asyncio
async def test_site_settings_requires_super_admin(minghua_client):
    response = await minghua_client.patch(
        "/api/website/v1/admin/site-settings",
        json={
            "title": "x",
            "description": "x",
            "share_image": None,
            "noindex": True,
            "privacy_policy_version": "v1",
        },
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_dashboard_lists_today_visits_and_draft_kinds(admin_client, public_client):
    """總覽要回答「今天誰要來」和「哪幾項內容還沒發布」，不是只給兩個數字。
    數字沒辦法讓櫃台直接打電話，也沒辦法讓編輯知道要點進哪一頁。"""
    from app.common.timezones import today_local

    receipt_id = await _submit_inquiry(
        admin_client, public_client, campus_key="yihua", idempotency_key="ops-dash-today-01"
    )
    slot = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={
            "slot_date": today_local().isoformat(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "capacity": 2,
        },
    )
    assert slot.status_code == 201, slot.text
    confirm = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/confirm",
        json={"slot_id": slot.json()["id"]},
    )
    assert confirm.status_code == 200, confirm.text

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
