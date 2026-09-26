from __future__ import annotations

import csv
import hashlib
import io
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.booking.models import OutboxMessage, VisitRequest
from app.booking.schemas import VisitRequestCreate
from app.booking.service import _hash_payload
from app.common.timezones import today_local
from app.operations import audit_service, retention_service
from app.operations.models import RetentionRunTrigger
from tests.conftest import set_booking_mode


# 預約表單要有已發布的同意文字（啟用 inquiry／slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")

_DETAIL_FIELDS = {"child_name", "child_birthdate", "email", "referral_sources"}


def _payload(version=1, **changes):
    return {
        "campus_key": "yihua",
        "config_version": version,
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "age": "3-4",
        "preferred_time": "平日上午",
        "questions": "想了解課程安排",
        "consent_given": True,
        **changes,
    }


async def _enable_inquiry(admin_client):
    current = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    updated = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": current.json()["version"], "mode": "inquiry"},
    )
    assert updated.status_code == 200, updated.text
    return updated.json()["version"]


async def _create_details(admin_client, public_client, key="visit-details-01", **changes):
    version = await _enable_inquiry(admin_client)
    body = _payload(
        version,
        child_name="陳小樹",
        child_birthdate="2022-06-18",
        email="parent@example.org",
        referral_sources=["google_reviews", "facebook", "facebook"],
    )
    body.update(changes)
    response = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=body,
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 201, response.text
    return response.json()["receipt_id"], body


def test_new_optional_defaults_preserve_legacy_payload_hash():
    # 與送單路由相同：同意說明版本另外傳，不在 payload 裡。
    body = VisitRequestCreate.model_validate(_payload()).model_dump(
        mode="json", exclude={"campus_key", "config_version", "consent_revision_id"}
    )
    # 參觀人數（2026-09-25）也是之後才加的選填欄位，空值不能改變舊 hash。
    legacy_body = {key: value for key, value in body.items() if key not in _DETAIL_FIELDS | {"party_size"}}
    # 更新前存的 hash 用的是官網送來的中文標籤；現在欄位存代碼，hash 仍要一樣。
    assert body["preferred_time"] == "weekday_morning"
    legacy_body["preferred_time"] = "平日上午"
    legacy_hash = hashlib.sha256(
        json.dumps(legacy_body, sort_keys=True, ensure_ascii=True).encode("utf-8")
    ).hexdigest()
    assert _hash_payload(body) == legacy_hash
    assert body["referral_sources"] == []  # hashing must not mutate submitted data
    assert _hash_payload({**body, "child_name": "小樹"}) != legacy_hash
    # 人數是家長填的內容：同一把 key 改了人數就是不同的送單。
    assert _hash_payload({**body, "party_size": 3}) != _hash_payload({**body, "party_size": 2})
    # 同意說明版本不是家長填的資料，不影響 hash。
    assert _hash_payload({**body, "consent_revision_id": "x"}) == legacy_hash


def test_details_normalize_names_email_and_referral_order():
    payload = VisitRequestCreate.model_validate(_payload(
        child_name="  陳小樹  ",
        child_birthdate="2022-06-18",
        email="parent@EXAMPLE.ORG",
        referral_sources=["friends_family", "facebook", "facebook"],
    ))
    assert payload.child_name == "陳小樹"
    assert payload.child_birthdate == date(2022, 6, 18)
    assert payload.email == "parent@example.org"
    assert payload.referral_sources == ["facebook", "friends_family"]


@pytest.mark.parametrize("changes", [
    {"child_name": " \t\u3000"},
    {"child_name": "樹" * 65},
    {"parent_name": " \t\u3000"},
    {"child_birthdate": "2022-02-30"},
    # 「明天」要在執行當下才算：寫死在 parametrize 會在收集測試時就算好，CI 跑到一半
    # 跨過台北午夜時「明天」變成今天而不報錯（2026-09-26 run 36157022816 發生過）。
    {"child_birthdate": lambda: (today_local() + timedelta(days=1)).isoformat()},
    {"email": "parent@"},
    {"email": ""},
    {"referral_sources": ["untrusted_source"]},
    {"referral_sources": ["facebook"] * 6},
    {"referral_sources": "facebook"},
])
def test_invalid_details_are_rejected(changes):
    changes = {key: value() if callable(value) else value for key, value in changes.items()}
    with pytest.raises(ValidationError):
        VisitRequestCreate.model_validate(_payload(**changes))


def test_birthdate_uses_taipei_today_at_utc_day_boundary(monkeypatch):
    monkeypatch.setattr(
        "app.common.timezones.now_utc",
        lambda: datetime(2026, 9, 21, 16, 30, tzinfo=timezone.utc),
    )
    today = VisitRequestCreate.model_validate(_payload(child_birthdate="2026-09-22"))
    assert today.child_birthdate == date(2026, 9, 22)
    with pytest.raises(ValidationError):
        VisitRequestCreate.model_validate(_payload(child_birthdate="2026-09-23"))


@pytest.mark.asyncio
async def test_new_details_roundtrip_stays_private_and_within_campus(
    admin_client, public_client, minghua_client, db_session
):
    receipt_id, _ = await _create_details(admin_client, public_client)
    detail = await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt_id}")
    assert detail.status_code == 200, detail.text
    expected = {
        "child_name": "陳小樹", "child_birthdate": "2022-06-18",
        "email": "parent@example.org", "referral_sources": ["facebook", "google_reviews"],
    }
    assert {key: detail.json()[key] for key in _DETAIL_FIELDS} == expected
    assert detail.json()["questions"] == "想了解課程安排"
    assert detail.json()["status"] == "new"

    stored = await db_session.get(VisitRequest, uuid.UUID(receipt_id))
    assert stored.child_birthdate == date(2022, 6, 18)
    assert stored.referral_sources == ["facebook", "google_reviews"]

    for query in ("小樹", "PARENT@EXAMPLE.ORG"):
        own = await admin_client.get("/api/website/v1/admin/visit-requests", params={"q": query})
        assert own.status_code == 200, own.text
        assert [row["id"] for row in own.json()] == [receipt_id]
        other = await minghua_client.get("/api/website/v1/admin/visit-requests", params={"q": query})
        assert other.json() == []
    assert (await minghua_client.get(
        f"/api/website/v1/admin/visit-requests/{receipt_id}"
    )).status_code == 404

    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    assert link.status_code == 200, link.text
    token = link.json()["manage_url_fragment"].split("token=")[1]
    exchange = await public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": token}
    )
    assert exchange.status_code == 200, exchange.text
    assert not (_DETAIL_FIELDS & exchange.json().keys())
    parent_view = await public_client.get("/api/website/v1/public/visit-manage/me")
    assert not (_DETAIL_FIELDS & parent_view.json().keys())

    messages = (await db_session.execute(select(OutboxMessage))).scalars().all()
    assert len(messages) == 1
    assert messages[0].payload == {"campus_key": "yihua", "receipt_id": receipt_id}


@pytest.mark.asyncio
async def test_legacy_replay_accepts_omitted_or_empty_new_details(
    admin_client, public_client, db_session
):
    version = await _enable_inquiry(admin_client)
    # 更新前的官網沒有參觀人數；明確送 None，測試 client 才不會補預設人數。
    body = {**_payload(version), "party_size": None}
    headers = {"Idempotency-Key": "legacy-details-replay"}
    legacy_body = {
        key: value for key, value in body.items() if key not in {"campus_key", "config_version", "party_size"}
    }
    legacy_body["slot_id"] = None
    expected_legacy_hash = hashlib.sha256(
        json.dumps(legacy_body, sort_keys=True, ensure_ascii=True).encode("utf-8")
    ).hexdigest()
    # 現在新送的需求一定要有人數；模擬更新前就建立的案件：照常建立後把人數
    # 拿掉、hash 換成當時的算法。
    created = await public_client.post(
        "/api/website/v1/public/visit-requests", json={**body, "party_size": 2}, headers=headers
    )
    assert created.status_code == 201, created.text
    receipt_id = created.json()["receipt_id"]
    stored = await db_session.get(VisitRequest, uuid.UUID(receipt_id))
    assert stored.payload_hash != expected_legacy_hash  # 人數算進 hash
    stored.party_size = None
    stored.payload_hash = expected_legacy_hash
    await db_session.commit()

    missing_size = await public_client.post(
        "/api/website/v1/public/visit-requests", json=body, headers={"Idempotency-Key": "legacy-new-case"}
    )
    assert missing_size.status_code == 422
    assert missing_size.json()["detail"][0]["loc"] == ["body", "party_size"]

    for request_body in (body, {
        **body, "child_name": None, "child_birthdate": None, "email": None, "referral_sources": [],
    }):
        replay = await public_client.post(
            "/api/website/v1/public/visit-requests", json=request_body, headers=headers
        )
        assert replay.status_code == 200, replay.text
        assert replay.json()["receipt_id"] == receipt_id


@pytest.mark.asyncio
async def test_details_replay_deduplicates_sources_but_rejects_changed_child(admin_client, public_client):
    receipt_id, body = await _create_details(admin_client, public_client, key="details-replay")
    headers = {"Idempotency-Key": "details-replay"}
    replay = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json={**body, "referral_sources": ["facebook", "google_reviews"]}, headers=headers,
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["receipt_id"] == receipt_id
    changed = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json={**body, "child_name": "另一個孩子"}, headers=headers,
    )
    assert changed.status_code == 409
    assert changed.json()["detail"]["code"] == "IDEMPOTENCY_CONFLICT"


@pytest.mark.asyncio
async def test_csv_includes_details_and_slot_with_formula_protection(admin_client, public_client):
    receipt_id, _ = await _create_details(
        admin_client, public_client, child_name="=1+1", email="+parent@example.org"
    )
    slot_date = (today_local() + timedelta(days=3)).isoformat()
    slot = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={"slot_date": slot_date, "start_time": "10:00:00", "end_time": "11:00:00", "capacity": 2},
    )
    assert slot.status_code == 201, slot.text
    confirmed = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/confirm", json={"slot_id": slot.json()["id"]}
    )
    assert confirmed.status_code == 200, confirmed.text
    exported = await admin_client.get("/api/website/v1/admin/visit-requests/export?campus_key=yihua")
    assert exported.status_code == 200, exported.text
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    assert len(rows) == 1
    assert rows[0]["child_name"] == "'=1+1"
    assert rows[0]["child_birthdate"] == "2022-06-18"
    assert rows[0]["email"] == "'+parent@example.org"
    assert rows[0]["referral_sources"] == "facebook;google_reviews"
    assert rows[0]["slot_date"] == slot_date
    assert rows[0]["start_time"] == "10:00:00"
    assert rows[0]["end_time"] == "11:00:00"


@pytest.mark.asyncio
async def test_retention_clears_new_details_and_audit_rejects_personal_fields(
    admin_client, public_client, db_session
):
    receipt_id, _ = await _create_details(admin_client, public_client)
    stored = await db_session.get(VisitRequest, uuid.UUID(receipt_id))
    stored.status = "cancelled"
    stored.created_at = datetime.now(timezone.utc) - timedelta(days=400)
    await db_session.commit()

    days = {"cancelled_days": 365, "completed_days": 365, "open_overdue_days": 365}
    found = await retention_service.find_candidates(db_session, days)
    assert [str(v.id) for v in found["cancelled"]] == [receipt_id]
    assert stored.child_name == "陳小樹"
    await retention_service.run_sweep(db_session, days, trigger=RetentionRunTrigger.MANUAL)
    await db_session.commit()
    await db_session.refresh(stored)
    assert stored.child_name is None
    assert stored.child_birthdate is None
    assert stored.email is None
    assert stored.referral_sources == []
    assert stored.questions is None
    assert stored.status == "cancelled"
    assert stored.anonymized_at is not None

    entry = await audit_service.log_action(
        db_session, actor_user_id=None, action="test.details", target_type="visit_request",
        target_id=receipt_id, metadata={
            "row_count": 1, "child_name": "陳小樹", "child_birthdate": "2022-06-18",
            "email": "parent@example.org", "referral_sources": ["facebook"],
        },
    )
    assert entry.metadata_json == {"row_count": 1}


async def _pending_last_slot(admin_client, public_client, *, key="pending-details"):
    config = await set_booking_mode(admin_client, "yihua", mode="slots")
    assert config.status_code == 200, config.text
    assert config.json()["slots_auto_confirm"] is False
    slot_date = (today_local() + timedelta(days=3)).isoformat()
    slot = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={"slot_date": slot_date, "start_time": "10:00:00", "end_time": "11:00:00", "capacity": 1},
    )
    assert slot.status_code == 201, slot.text
    body = _payload(config.json()["version"], slot_id=slot.json()["id"])
    created = await public_client.post(
        "/api/website/v1/public/visit-requests", json=body, headers={"Idempotency-Key": key}
    )
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "pending_confirmation"
    return created.json()["receipt_id"], slot.json(), body


@pytest.mark.asyncio
async def test_pending_can_confirm_own_last_slot_without_opening_capacity(admin_client, public_client):
    receipt_id, slot, body = await _pending_last_slot(admin_client, public_client)
    # 等待人工確認期間，其他家庭仍不能取得同一個最後名額。
    other_body = {**body, "parent_name": "林爸爸", "phone": "0922345678"}
    before = await public_client.post(
        "/api/website/v1/public/visit-requests", json=other_body,
        headers={"Idempotency-Key": "pending-last-other"},
    )
    assert before.status_code == 409
    assert before.json()["detail"]["code"] == "SLOT_FULL"

    confirmed = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/confirm", json={"slot_id": slot["id"]}
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    assert confirmed.json()["slot_id"] == slot["id"]
    assert confirmed.json()["hold_expires_at"] is None

    after = await public_client.post(
        "/api/website/v1/public/visit-requests", json=other_body,
        headers={"Idempotency-Key": "confirmed-last-other"},
    )
    assert after.status_code == 409
    assert after.json()["detail"]["code"] == "SLOT_FULL"
    slots = await admin_client.get("/api/website/v1/admin/slots", params={
        "campus_key": "yihua", "date_from": slot["slot_date"], "date_to": slot["slot_date"],
    })
    assert slots.json()[0]["booked_count"] == 1


@pytest.mark.asyncio
async def test_pending_cannot_confirm_into_another_familys_full_slot(admin_client, public_client):
    receipt_id, own_slot, body = await _pending_last_slot(admin_client, public_client)
    other_slot = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={"slot_date": own_slot["slot_date"], "start_time": "14:00:00", "end_time": "15:00:00", "capacity": 1},
    )
    assert other_slot.status_code == 201, other_slot.text
    other = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json={**body, "slot_id": other_slot.json()["id"], "phone": "0922345678"},
        headers={"Idempotency-Key": "pending-different-other"},
    )
    assert other.status_code == 201, other.text
    changed = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/confirm",
        json={"slot_id": other_slot.json()["id"]},
    )
    assert changed.status_code == 409
    assert changed.json()["detail"]["code"] == "SLOT_FULL"
    detail = await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt_id}")
    assert detail.json()["status"] == "pending_confirmation"
    assert detail.json()["slot_id"] == own_slot["id"]


@pytest.mark.asyncio
async def test_expired_pending_hold_cannot_be_confirmed_before_or_after_sweep(
    admin_client, public_client, db_session
):
    from app.booking import workflow_service

    receipt_id, slot, _ = await _pending_last_slot(admin_client, public_client)
    stored = await db_session.get(VisitRequest, uuid.UUID(receipt_id))
    stored.hold_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()

    before_sweep = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/confirm", json={"slot_id": slot["id"]}
    )
    assert before_sweep.status_code == 409
    assert before_sweep.json()["detail"]["code"] == "INVALID_TRANSITION"
    await db_session.refresh(stored)
    assert stored.status == "pending_confirmation"
    assert stored.confirmed_at is None

    assert await workflow_service.expire_holds(db_session) == 1
    await db_session.commit()
    after_sweep = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/confirm", json={"slot_id": slot["id"]}
    )
    assert after_sweep.status_code == 409
    assert after_sweep.json()["detail"]["code"] == "INVALID_TRANSITION"
    await db_session.refresh(stored)
    assert stored.status == "cancelled"
    assert stored.confirmed_at is None
    messages = (await db_session.execute(
        select(OutboxMessage).where(OutboxMessage.visit_request_id == uuid.UUID(receipt_id))
    )).scalars().all()
    assert not any(message.kind == "visit_request_confirmed" for message in messages)
