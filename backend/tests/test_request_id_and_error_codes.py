"""2026-09-25 缺口 68（不改錯誤格式的部分）：X-Request-ID 與錯誤本文的
request_id、已關閉的時段回 SLOT_CLOSED、素材未就緒回 MEDIA_NOT_READY、
/public/site 的 ETag 與 304。"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest

from app.media.models import MediaAsset, MediaKind, MediaStatus
from tests.conftest import set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
BASE = f"{API}/admin"


async def _slot(client, *, days_ahead=3, capacity=2) -> dict:
    response = await client.post(
        f"{BASE}/slots?campus_key=yihua",
        json={
            "slot_date": (date.today() + timedelta(days=days_ahead)).isoformat(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "capacity": capacity,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _close(client, slot: dict) -> None:
    closed = await client.patch(f"{BASE}/slots/{slot['id']}", json={"closed": True, "expected_version": slot["version"]})
    assert closed.status_code == 200, closed.text


# --- request id ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_every_response_carries_a_request_id(public_client):
    response = await public_client.get(f"{API}/health")
    assert response.status_code == 200
    assert len(response.headers["X-Request-ID"]) == 32

    passed = await public_client.get(f"{API}/health", headers={"X-Request-ID": "web-abc123-XYZ"})
    assert passed.headers["X-Request-ID"] == "web-abc123-XYZ"

    # 太短、太長或含奇怪字元的一律換成自己產生的。
    for bad in ("abc", "x" * 65, "a b c d e f g h"):
        replaced = await public_client.get(f"{API}/health", headers={"X-Request-ID": bad})
        assert replaced.headers["X-Request-ID"] != bad
        assert len(replaced.headers["X-Request-ID"]) == 32


@pytest.mark.asyncio
async def test_error_bodies_carry_request_id_without_changing_shape(admin_client, public_client, caplog):
    caplog.set_level(logging.INFO, logger="app")
    # detail 是物件：request_id 放進 detail，也放在最外層。
    missing = await public_client.post(
        f"{API}/public/visit-requests",
        json={"campus_key": "yihua"},
        headers={"Idempotency-Key": "rid-01", "X-Request-ID": "trace-0001-validation"},
    )
    assert missing.status_code == 422
    assert isinstance(missing.json()["detail"], list)
    assert missing.json()["request_id"] == "trace-0001-validation"

    conflict = await admin_client.get(
        f"{BASE}/visit-requests?needs_attention=maybe", headers={"X-Request-ID": "trace-0002-query"}
    )
    assert conflict.status_code == 422
    assert conflict.json()["request_id"] == "trace-0002-query"

    unknown = await admin_client.get(f"{BASE}/content-items/no_such_kind", headers={"X-Request-ID": "trace-0003-string"})
    assert unknown.status_code == 404
    # 字串 detail 維持字串，request_id 在最外層。
    assert isinstance(unknown.json()["detail"], str)
    assert unknown.json()["request_id"] == "trace-0003-string"
    assert unknown.headers["X-Request-ID"] == "trace-0003-string"

    slot = await _slot(admin_client)
    stale = await admin_client.patch(
        f"{BASE}/slots/{slot['id']}", json={"capacity": 3, "expected_version": 99},
        headers={"X-Request-ID": "trace-0004-object"},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "SLOT_VERSION_CONFLICT"
    assert stale.json()["detail"]["request_id"] == "trace-0004-object"
    assert stale.json()["request_id"] == "trace-0004-object"
    assert any("trace-0004-object" in record.getMessage() for record in caplog.records)


@pytest.mark.asyncio
async def test_unexpected_errors_report_request_id(app, caplog):

    @app.get("/api/website/v1/_boom")
    async def boom() -> dict:
        raise RuntimeError("boom")

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/website/v1/_boom", headers={"X-Request-ID": "trace-0005-boom"})
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "INTERNAL_ERROR"
    assert response.json()["detail"]["request_id"] == "trace-0005-boom"
    assert response.headers["X-Request-ID"] == "trace-0005-boom"
    assert any("trace-0005-boom" in record.getMessage() for record in caplog.records)


# --- SLOT_CLOSED ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_closed_slot_is_reported_as_closed_not_full(admin_client, public_client):
    response = await set_booking_mode(admin_client, "yihua", mode="slots", slots_auto_confirm=True)
    version = response.json()["version"]
    slot = await _slot(admin_client)
    await _close(admin_client, slot)

    submitted = await public_client.post(
        f"{API}/public/visit-requests",
        json={
            "campus_key": "yihua", "config_version": version, "parent_name": "陳媽媽", "phone": "0912345678",
            "consent_given": True, "slot_id": slot["id"],
        },
        headers={"Idempotency-Key": "closed-01"},
    )
    assert submitted.status_code == 409
    assert submitted.json()["detail"]["code"] == "SLOT_CLOSED"
    assert "已關閉" in submitted.json()["detail"]["message"]

    gone = await public_client.post(
        f"{API}/public/visit-requests",
        json={
            "campus_key": "yihua", "config_version": version, "parent_name": "陳媽媽", "phone": "0912345678",
            "consent_given": True, "slot_id": str(uuid.uuid4()),
        },
        headers={"Idempotency-Key": "closed-02"},
    )
    assert gone.status_code == 409
    assert gone.json()["detail"]["code"] == "SLOT_NOT_FOUND"


@pytest.mark.asyncio
async def test_admin_confirm_and_reschedule_into_closed_slot(admin_client):
    open_slot = await _slot(admin_client)
    closed_slot = await _slot(admin_client, days_ahead=4)
    await _close(admin_client, closed_slot)
    created = await admin_client.post(
        f"{BASE}/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": "王媽媽", "phone": "0912345678", "consent_given": True},
        headers={"Idempotency-Key": "closed-03"},
    )
    case_id = created.json()["id"]

    refused = await admin_client.post(f"{BASE}/visit-requests/{case_id}/confirm", json={"slot_id": closed_slot["id"]})
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "SLOT_CLOSED"

    assert (
        await admin_client.post(f"{BASE}/visit-requests/{case_id}/confirm", json={"slot_id": open_slot["id"]})
    ).status_code == 200
    moved = await admin_client.post(
        f"{BASE}/visit-requests/{case_id}/reschedule", json={"new_slot_id": closed_slot["id"]}
    )
    assert moved.status_code == 409
    assert moved.json()["detail"]["code"] == "SLOT_CLOSED"
    assert moved.json()["detail"]["message"] == "新時段已關閉，原時段維持不變"


# --- MEDIA_NOT_READY --------------------------------------------------------------


@pytest.mark.asyncio
async def test_publishing_with_unready_media_reports_media_not_ready(admin_client, db_session):
    media = MediaAsset(
        id=uuid.uuid4(), kind=MediaKind.IMAGE, status=MediaStatus.PROCESSING, storage_key=f"t/{uuid.uuid4()}",
        original_filename="share.jpg", content_type="image/jpeg", size_bytes=10, created_at=datetime.now(timezone.utc),
    )
    db_session.add(media)
    await db_session.commit()
    meta = {
        "title": "常春藤", "description": "描述", "header_phone_number": "07-0000000",
        "header_phone_note": "義華", "share_image": str(media.id),
    }
    saved = await admin_client.post(f"{BASE}/content-items/site_meta/revisions", json={"expected_version": 0, "payload": meta})
    assert saved.status_code == 201, saved.text
    published = await admin_client.post(f"{BASE}/content-items/site_meta/publish", json={"revision_id": saved.json()["latest_revision"]["id"]})
    assert published.status_code == 409
    assert published.json()["detail"]["code"] == "MEDIA_NOT_READY"


# --- ETag -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_public_site_etag_and_not_modified(admin_client, public_client):
    about = {"title": "關於常春藤", "since_label": "SINCE 1995", "body_text": "內文", "caption": "說明"}
    saved = await admin_client.post(f"{BASE}/content-items/home_about/revisions", json={"expected_version": 0, "payload": about})
    assert saved.status_code == 201, saved.text
    assert (
        await admin_client.post(f"{BASE}/content-items/home_about/publish", json={"revision_id": saved.json()["latest_revision"]["id"]})
    ).status_code == 200

    first = await public_client.get(f"{API}/public/site")
    assert first.status_code == 200
    etag = first.headers["ETag"]
    assert etag.startswith('"') and etag.endswith('"')
    assert first.headers["Cache-Control"] == "no-cache, max-age=0"
    assert first.json()["content"]["home_about"]["title"] == "關於常春藤"

    again = await public_client.get(f"{API}/public/site", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""
    assert again.headers["ETag"] == etag
    weak = await public_client.get(f"{API}/public/site", headers={"If-None-Match": f'"other", W/{etag}'})
    assert weak.status_code == 304

    saved = await admin_client.post(
        f"{BASE}/content-items/home_about/revisions", json={"expected_version": 1, "payload": {**about, "title": "新標題"}}
    )
    assert (
        await admin_client.post(f"{BASE}/content-items/home_about/publish", json={"revision_id": saved.json()["latest_revision"]["id"]})
    ).status_code == 200
    changed = await public_client.get(f"{API}/public/site", headers={"If-None-Match": etag})
    assert changed.status_code == 200
    assert changed.headers["ETag"] != etag
    assert changed.json()["content"]["home_about"]["title"] == "新標題"
