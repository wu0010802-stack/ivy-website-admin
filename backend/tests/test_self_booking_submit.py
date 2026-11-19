from __future__ import annotations

import pytest
from sqlalchemy import select, text

from app.booking.models import BookingMode, OutboxMessage
from app.booking import workflow_service
from tests.conftest import book_slot, create_slot, set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"


async def _slots_mode(admin_client) -> tuple[str, int]:
    slot_id = await create_slot(admin_client)
    response = await set_booking_mode(admin_client, "yihua", mode="slots")
    assert response.status_code == 200, response.text
    return slot_id, response.json()["version"]


def _body(version: int, **extra) -> dict:
    return {
        "campus_key": "yihua",
        "config_version": version,
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "consent_given": True,
        **extra,
    }


@pytest.mark.asyncio
async def test_submission_is_confirmed_without_hold(admin_client, public_client):
    slot_id, version = await _slots_mode(admin_client)

    response = await public_client.post(
        f"{API}/public/visit-requests", json=_body(version, slot_id=slot_id), headers={"Idempotency-Key": "self-01"}
    )

    assert response.status_code == 201, response.text
    assert response.json()["status"] == "confirmed"
    detail = (await admin_client.get(f"{API}/admin/visit-requests/{response.json()['receipt_id']}")).json()
    assert "hold_expires_at" not in detail
    assert detail["confirmed_at"] is not None


@pytest.mark.asyncio
async def test_submission_needs_a_slot(admin_client, public_client):
    _slot_id, version = await _slots_mode(admin_client)

    no_slot = await public_client.post(
        f"{API}/public/visit-requests", json=_body(version), headers={"Idempotency-Key": "self-02"}
    )

    assert no_slot.status_code == 422
    assert ["body", "slot_id"] in [error["loc"] for error in no_slot.json()["detail"]]


@pytest.mark.asyncio
async def test_email_is_optional(admin_client, public_client, db_session):
    # 2026-11-13 業主裁定：官網預約的 Email 改回選填。沒填照樣預約成立、拿得到修改連結，
    # 只是不排家長確認信。
    slot_id, version = await _slots_mode(admin_client)

    omitted = await public_client.post(
        f"{API}/public/visit-requests",
        json=_body(version, slot_id=slot_id, email=None),
        headers={"Idempotency-Key": "self-03"},
    )
    # 其他呼叫端送空字串也當成沒填，不回「Email 格式錯誤」。
    blank = await public_client.post(
        f"{API}/public/visit-requests",
        json=_body(version, slot_id=slot_id, email="  ", phone="0912345679"),
        headers={"Idempotency-Key": "self-03b"},
    )

    for response in (omitted, blank):
        assert response.status_code == 201, response.text
        assert response.json()["status"] == "confirmed"
        assert response.json()["manage_path"]
        detail = (await admin_client.get(f"{API}/admin/visit-requests/{response.json()['receipt_id']}")).json()
        assert detail["email"] is None
    parent_mails = (
        await db_session.execute(select(OutboxMessage.id).where(OutboxMessage.kind == "parent_visit_booked"))
    ).scalars().all()
    assert parent_mails == []


@pytest.mark.asyncio
async def test_email_format_is_still_checked_when_given(admin_client, public_client):
    slot_id, version = await _slots_mode(admin_client)

    bad_email = await public_client.post(
        f"{API}/public/visit-requests",
        json=_body(version, slot_id=slot_id, email="not-an-email"),
        headers={"Idempotency-Key": "self-03c"},
    )

    assert bad_email.status_code == 422
    assert ["body", "email"] in [error["loc"] for error in bad_email.json()["detail"]]


@pytest.mark.asyncio
async def test_inquiry_mode_no_longer_exists(admin_client, public_client, db_session):
    # 2026-10-06 拿掉 inquiry（c4e8a2f61b97）：API 不認得這個值，資料庫型別也沒有。
    response = await set_booking_mode(admin_client, "yihua", mode="inquiry")
    assert response.status_code == 422
    assert "inquiry" not in {mode.value for mode in BookingMode}
    labels = (
        await db_session.execute(text("SELECT unnest(enum_range(NULL::booking_mode))::text"))
    ).scalars().all()
    assert labels == ["SLOTS", "LINE", "PHONE", "EXTERNAL", "PAUSED"]

    public = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    assert "slots_auto_confirm" not in public


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["contacting", "confirm"])
async def test_retired_case_actions_no_longer_exist(admin_client, public_client, action):
    booked = await book_slot(admin_client, public_client)

    response = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/{action}", json={})

    assert response.status_code in (404, 405)


@pytest.mark.asyncio
async def test_manual_entry_requires_a_slot_and_is_confirmed(admin_client):
    base = {"campus_key": "yihua", "source": "phone", "parent_name": "王先生", "phone": "0933111222", "consent_given": True}

    missing = await admin_client.post(
        f"{API}/admin/visit-requests", json=base, headers={"Idempotency-Key": "manual-self-01"}
    )
    slot_id = await create_slot(admin_client, days_ahead=1)  # 24 小時預約窗內，園方仍可排
    created = await admin_client.post(
        f"{API}/admin/visit-requests", json={**base, "slot_id": slot_id}, headers={"Idempotency-Key": "manual-self-02"}
    )

    assert missing.status_code == 422
    assert ["body", "slot_id"] in [error["loc"] for error in missing.json()["detail"]]
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "confirmed"
    assert created.json()["slot"]["id"] == slot_id


@pytest.mark.asyncio
async def test_cancel_records_who_cancelled(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    cancelled = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})
    assert cancelled.status_code == 200, cancelled.text

    staff = (await admin_client.get(f"{API}/admin/visit-requests/{booked['receipt_id']}")).json()
    assert staff["cancel_reason"] == "staff"


def test_hold_expiry_flow_is_gone():
    """占位逾期取消的流程已整個刪除，不會再有人把案件標成 hold_expired。"""
    assert not hasattr(workflow_service, "expire_holds")
    assert not hasattr(workflow_service, "confirm_with_slot")


@pytest.mark.asyncio
async def test_same_phone_cannot_book_the_same_slot_twice(admin_client, public_client):
    """2026-11-12 QA M4／M5：回應在路上斷掉後重新整理再送、或成功後按上一頁再送一次，
    都是新的 Idempotency-Key；同一家庭就占掉同一場次的兩個名額。同校同場次同一支手機
    已經有一筆占名額的預約時回 409 ALREADY_BOOKED，不建第二筆。"""
    slot_id = await create_slot(admin_client, capacity=3)
    version = (await set_booking_mode(admin_client, "yihua", mode="slots")).json()["version"]
    body = _body(version, slot_id=slot_id)

    first = await public_client.post(f"{API}/public/visit-requests", json=body, headers={"Idempotency-Key": "dup-01"})
    assert first.status_code == 201, first.text

    # 換一把 key、內容一模一樣（重新整理後再送）；或換了孩子姓名（上一頁改一改再送）。
    again = await public_client.post(f"{API}/public/visit-requests", json=body, headers={"Idempotency-Key": "dup-02"})
    edited = await public_client.post(
        f"{API}/public/visit-requests", json={**body, "child_name": "小安"}, headers={"Idempotency-Key": "dup-03"}
    )
    for response in (again, edited):
        assert response.status_code == 409, response.text
        assert response.json()["detail"]["code"] == "ALREADY_BOOKED"

    listed = (await admin_client.get(f"{API}/admin/visit-requests?campus_key=yihua")).json()
    assert [item["id"] for item in listed] == [first.json()["receipt_id"]]
    # 原本那把 key 照樣重播同一張收據。
    replay = await public_client.post(f"{API}/public/visit-requests", json=body, headers={"Idempotency-Key": "dup-01"})
    assert replay.status_code == 200 and replay.json()["receipt_id"] == first.json()["receipt_id"]


@pytest.mark.asyncio
async def test_same_phone_can_book_another_slot_or_rebook_after_cancelling(admin_client, public_client):
    """只擋「同一場次還占著名額」：別的場次、別支手機、或取消後再約同一場都照常。"""
    slot_id = await create_slot(admin_client, capacity=3)
    other_slot = await create_slot(admin_client, days_ahead=4, capacity=3)
    version = (await set_booking_mode(admin_client, "yihua", mode="slots")).json()["version"]
    body = _body(version, slot_id=slot_id)

    async def submit(key: str, **changes):
        return await public_client.post(
            f"{API}/public/visit-requests", json={**body, **changes}, headers={"Idempotency-Key": key}
        )

    first = await submit("re-01")
    assert first.status_code == 201, first.text
    assert (await submit("re-02", slot_id=other_slot)).status_code == 201
    assert (await submit("re-03", phone="0922333444")).status_code == 201

    case_id = first.json()["receipt_id"]
    detail = (await admin_client.get(f"{API}/admin/visit-requests/{case_id}")).json()
    cancelled = await admin_client.post(
        f"{API}/admin/visit-requests/{case_id}/cancel",
        json={"expected_version": detail["version"], "reason": "家長來電取消"},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert (await submit("re-04")).status_code == 201
