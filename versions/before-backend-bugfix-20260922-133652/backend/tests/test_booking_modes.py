from __future__ import annotations

import pytest


def _inquiry_payload(campus_key="yihua", config_version=1, parent_name="陳媽媽", phone="0912345678"):
    return {
        "campus_key": campus_key,
        "config_version": config_version,
        "parent_name": parent_name,
        "phone": phone,
        "age": "3-4",
        "preferred_time": "平日上午",
        "questions": "想了解課程安排",
        "consent_given": True,
    }


async def _enable_inquiry(admin_client, campus_key="yihua") -> int:
    current = await admin_client.get(f"/api/website/v1/admin/booking-config/{campus_key}")
    resp = await admin_client.patch(
        f"/api/website/v1/admin/booking-config/{campus_key}",
        json={"expected_version": current.json()["version"], "mode": "inquiry"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["version"]


@pytest.mark.asyncio
async def test_default_mode_is_paused(admin_client):
    response = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    assert response.status_code == 200
    assert response.json()["mode"] == "paused"
    assert response.json()["version"] == 0


@pytest.mark.asyncio
async def test_slots_mode_can_be_enabled(admin_client):
    # Task 7 起 slots 已開放；不需要額外欄位即可啟用。
    response = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": 0, "mode": "slots"},
    )
    assert response.status_code == 200
    assert response.json()["mode"] == "slots"


@pytest.mark.asyncio
async def test_line_mode_requires_line_url(admin_client):
    response = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": 0, "mode": "line"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "BOOKING_MODE_FIELD_MISSING"


@pytest.mark.asyncio
async def test_line_mode_succeeds_with_line_url(admin_client):
    response = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": 0, "mode": "line", "line_url": "https://lin.ee/example"},
    )
    assert response.status_code == 200
    assert response.json()["mode"] == "line"
    assert response.json()["version"] == 1


@pytest.mark.asyncio
async def test_phone_mode_requires_phone(admin_client):
    response = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": 0, "mode": "phone"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_external_mode_requires_url(admin_client):
    response = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": 0, "mode": "external"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_paused_mode_needs_no_fields(admin_client):
    response = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": 0, "mode": "paused", "message": "暫停參觀"},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_campus_admin_cannot_update_other_campus_config(minghua_client):
    response = await minghua_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": 0, "mode": "inquiry"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_campus_admin_can_update_own_campus_config(minghua_client):
    response = await minghua_client.patch(
        "/api/website/v1/admin/booking-config/minghua",
        json={"expected_version": 0, "mode": "inquiry"},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_config_version_conflict_on_update(admin_client):
    await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua", json={"expected_version": 0, "mode": "inquiry"}
    )
    stale = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": 0, "mode": "paused"},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "BOOKING_CONFIG_VERSION_CONFLICT"


@pytest.mark.asyncio
async def test_public_booking_config_visible_without_auth(admin_client, public_client):
    await _enable_inquiry(admin_client)
    response = await public_client.get("/api/website/v1/public/booking-config/yihua")
    assert response.status_code == 200
    assert response.json()["mode"] == "inquiry"


@pytest.mark.asyncio
async def test_unknown_campus_returns_404(public_client):
    response = await public_client.get("/api/website/v1/public/booking-config/not-a-campus")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_paused_campus_rejects_submission(admin_client, public_client):
    response = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_inquiry_payload(config_version=0),
        headers={"Idempotency-Key": "paused-test-01"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "BOOKING_UNAVAILABLE"


@pytest.mark.asyncio
async def test_line_mode_campus_rejects_form_submission(admin_client, public_client):
    await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": 0, "mode": "line", "line_url": "https://lin.ee/example"},
    )
    response = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_inquiry_payload(config_version=1),
        headers={"Idempotency-Key": "line-mode-test-01"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "BOOKING_UNAVAILABLE"


@pytest.mark.asyncio
async def test_inquiry_submission_succeeds(admin_client, public_client):
    version = await _enable_inquiry(admin_client)
    response = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_inquiry_payload(config_version=version),
        headers={"Idempotency-Key": "success-test-01"},
    )
    assert response.status_code == 201, response.text
    assert "receipt_id" in response.json()


@pytest.mark.asyncio
async def test_request_retry_is_same_case(admin_client, public_client):
    version = await _enable_inquiry(admin_client)
    payload = _inquiry_payload(config_version=version)
    headers = {"Idempotency-Key": "test-inquiry-01"}

    first = await public_client.post(
        "/api/website/v1/public/visit-requests", json=payload, headers=headers
    )
    second = await public_client.post(
        "/api/website/v1/public/visit-requests", json=payload, headers=headers
    )
    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["receipt_id"] == second.json()["receipt_id"]


@pytest.mark.asyncio
async def test_same_key_different_payload_rejected(admin_client, public_client):
    version = await _enable_inquiry(admin_client)
    headers = {"Idempotency-Key": "conflict-test-01"}

    first = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_inquiry_payload(config_version=version, parent_name="陳媽媽"),
        headers=headers,
    )
    assert first.status_code == 201

    second = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_inquiry_payload(config_version=version, parent_name="林媽媽"),
        headers=headers,
    )
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "IDEMPOTENCY_CONFLICT"


@pytest.mark.asyncio
async def test_stale_config_version_rejected_then_switch_to_line(admin_client, public_client):
    version = await _enable_inquiry(admin_client)

    # 建立成功後，切換為 line 模式
    await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={
            "expected_version": version,
            "mode": "line",
            "line_url": "https://lin.ee/example",
        },
    )

    # 拿舊 version 送出應該回 BOOKING_CONFIG_CHANGED
    stale = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_inquiry_payload(config_version=version),
        headers={"Idempotency-Key": "stale-version-test-01"},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "BOOKING_CONFIG_CHANGED"


@pytest.mark.asyncio
async def test_mode_switch_does_not_affect_existing_requests(admin_client, public_client):
    version = await _enable_inquiry(admin_client)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_inquiry_payload(config_version=version),
        headers={"Idempotency-Key": "existing-request-01"},
    )
    assert created.status_code == 201
    receipt_id = created.json()["receipt_id"]

    # 切換模式
    await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={
            "expected_version": version,
            "mode": "line",
            "line_url": "https://lin.ee/example",
        },
    )

    # 重播原本的請求，仍應回到原本那筆案件（不受模式切換影響）
    replay = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_inquiry_payload(config_version=version),
        headers={"Idempotency-Key": "existing-request-01"},
    )
    assert replay.status_code == 200
    assert replay.json()["receipt_id"] == receipt_id


@pytest.mark.asyncio
async def test_invalid_phone_rejected(admin_client, public_client):
    version = await _enable_inquiry(admin_client)
    response = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_inquiry_payload(config_version=version, phone="12345"),
        headers={"Idempotency-Key": "bad-phone-01"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_missing_consent_rejected(admin_client, public_client):
    version = await _enable_inquiry(admin_client)
    payload = _inquiry_payload(config_version=version)
    payload["consent_given"] = False
    response = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=payload,
        headers={"Idempotency-Key": "no-consent-01"},
    )
    assert response.status_code == 422
