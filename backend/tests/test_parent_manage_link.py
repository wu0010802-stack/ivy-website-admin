from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select

from app.booking import access_service
from app.booking.access_models import ParentAccessToken
from app.booking.models import OutboxMessage, VisitRequestEvent
from app.common.timezones import slot_start_utc
from tests.conftest import VISIT_SUBMIT_PATH, book_slot, create_slot, legacy_request, open_manage

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"


@pytest.mark.asyncio
async def test_submission_returns_a_manage_path_that_opens_the_booking(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)

    assert booked["manage_path"].startswith("/visit/manage#token=")
    assert booked["response"].headers["cache-control"] == "no-store"
    opened = await open_manage(public_client, booked["manage_path"])
    assert opened["id"] == booked["receipt_id"]


@pytest.mark.asyncio
async def test_replay_returns_the_same_manage_path(admin_client, public_client):
    booked = await book_slot(admin_client, public_client, idempotency_key="link-replay-01")
    body = {
        "campus_key": "yihua",
        "config_version": (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()["version"],
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "consent_given": True,
        "slot_id": booked["slot_id"],
    }

    replay = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers={"Idempotency-Key": "link-replay-01"})

    assert replay.status_code == 200, replay.text
    assert replay.json()["manage_path"] == booked["manage_path"]


@pytest.mark.asyncio
async def test_replay_after_cancel_has_no_manage_path(admin_client, public_client):
    booked = await book_slot(admin_client, public_client, idempotency_key="link-replay-02")
    config_version = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()["version"]
    await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})
    body = {
        "campus_key": "yihua",
        "config_version": config_version,
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "consent_given": True,
        "slot_id": booked["slot_id"],
    }

    replay = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers={"Idempotency-Key": "link-replay-02"})

    assert replay.status_code == 200, replay.text
    assert replay.json()["status"] == "cancelled"
    assert replay.json()["manage_path"] is None


@pytest.mark.asyncio
async def test_raw_token_is_never_stored(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)
    raw = booked["manage_path"].split("token=", 1)[1]

    tokens = (await db_session.execute(select(ParentAccessToken))).scalars().all()
    payloads = (await db_session.execute(select(OutboxMessage.payload))).scalars().all()

    assert [t.token_hash for t in tokens] == [hashlib.sha256(raw.encode()).hexdigest()]
    assert all(raw not in str(payload) for payload in payloads)


@pytest.mark.asyncio
async def test_link_lasts_until_a_week_after_a_far_visit(admin_client, public_client, db_session):
    near = await book_slot(admin_client, public_client, days_ahead=3, phone="0912000001")
    far = await book_slot(admin_client, public_client, days_ahead=40, phone="0912000002")

    tokens = {
        str(t.visit_request_id): t for t in (await db_session.execute(select(ParentAccessToken))).scalars().all()
    }
    near_token, far_token = tokens[near["receipt_id"]], tokens[far["receipt_id"]]
    assert near_token.expires_at - near_token.created_at >= timedelta(days=14) - timedelta(seconds=5)
    far_detail = (await admin_client.get(f"{API}/admin/visit-requests/{far['receipt_id']}")).json()
    far_start = slot_start_utc(
        date.fromisoformat(far_detail["slot"]["slot_date"]), time.fromisoformat(far_detail["slot"]["start_time"])
    )
    assert abs((far_token.expires_at - (far_start + timedelta(days=7))).total_seconds()) < 5


@pytest.mark.asyncio
async def test_staff_reschedule_to_a_later_day_extends_the_link(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client, days_ahead=3)
    later = await create_slot(admin_client, days_ahead=50)
    before = (await db_session.execute(select(ParentAccessToken.expires_at))).scalar_one()

    moved = await admin_client.post(
        f"{API}/admin/visit-requests/{booked['receipt_id']}/reschedule", json={"new_slot_id": later}
    )

    assert moved.status_code == 200, moved.text
    db_session.expire_all()
    after = (await db_session.execute(select(ParentAccessToken.expires_at))).scalar_one()
    assert after > before


@pytest.mark.asyncio
async def test_link_cannot_be_rederived_after_secret_rotation(app, admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)
    visit_id = uuid.UUID(booked["receipt_id"])

    assert await access_service.current_manage_path(db_session, visit_id, secret=app.state.settings.session_secret) == booked["manage_path"]
    assert await access_service.current_manage_path(db_session, visit_id, secret="rotated-secret-0930") is None
    # 已發出的連結仍能兌換（只比對雜湊），直到到期或被撤銷。
    await open_manage(public_client, booked["manage_path"])


@pytest.mark.asyncio
async def test_staff_regenerate_revokes_the_old_link(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)

    regenerated = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/access-link")
    old = await public_client.post(
        f"{API}/public/visit-manage/exchange", json={"token": booked["manage_path"].split("token=", 1)[1]}
    )

    assert regenerated.status_code == 200, regenerated.text
    assert old.status_code == 401
    await open_manage(public_client, regenerated.json()["manage_url_fragment"])


async def _slot_start(admin_client, visit_id: str) -> datetime:
    slot = (await admin_client.get(f"{API}/admin/visit-requests/{visit_id}")).json()["slot"]
    return slot_start_utc(date.fromisoformat(slot["slot_date"]), time.fromisoformat(slot["start_time"]))


async def _link_events(db_session, visit_id: str) -> list[VisitRequestEvent]:
    return (
        await db_session.execute(
            select(VisitRequestEvent).where(
                VisitRequestEvent.visit_request_id == uuid.UUID(visit_id),
                VisitRequestEvent.event_type == "access_link_created",
            )
        )
    ).scalars().all()


@pytest.mark.asyncio
async def test_resend_replaces_a_link_that_cannot_be_recomputed_and_records_it(app, admin_client, db_session):
    """2026-09-30 以前隨機產生的連結重算不出來：重寄確認信時撤換成新的，歷程記下是誰換的（不含 token）。"""
    visit_id = await legacy_request(db_session, status="confirmed", email="legacy@example.com")
    now = datetime.now(timezone.utc)
    old_id = uuid.uuid4()
    old = ParentAccessToken(
        id=old_id,
        visit_request_id=uuid.UUID(visit_id),
        token_hash=hashlib.sha256(b"random-link-before-0930").hexdigest(),
        created_at=now,
        expires_at=now + timedelta(days=14),
    )
    db_session.add(old)
    await db_session.commit()
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"

    resent = await admin_client.post(f"{API}/admin/visit-requests/{visit_id}/resend-confirmation")

    assert resent.status_code == 202, resent.text
    db_session.expire_all()
    assert (await db_session.get(ParentAccessToken, old_id)).revoked_at is not None
    path = await access_service.current_manage_path(
        db_session, uuid.UUID(visit_id), secret=app.state.settings.session_secret
    )
    assert path is not None
    [event] = await _link_events(db_session, visit_id)
    staff_id = (await admin_client.get(f"{API}/auth/me")).json()["user"]["id"]
    assert (event.source, str(event.actor_user_id)) == ("staff", staff_id)
    assert set(event.after) == {"expires_at", "replaced_previous"}
    assert event.after["replaced_previous"] is True
    assert path.split("token=", 1)[1] not in str(event.after)


@pytest.mark.asyncio
async def test_resend_with_a_recomputable_link_records_no_replacement(app, admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client, days_ahead=3)
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"

    resent = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/resend-confirmation")

    assert resent.status_code == 202, resent.text
    assert await _link_events(db_session, booked["receipt_id"]) == []
