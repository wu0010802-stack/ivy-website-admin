"""規格 190：孩子年齡、方便聯絡時段只存固定代碼；舊版中文標籤自動換成代碼。"""
from __future__ import annotations

import uuid

import pytest

from app.booking.schemas import VisitRequestCreate, VisitRequestManualCreate
from tests.conftest import create_slot, set_booking_mode


# 預約表單要有已發布的同意文字（啟用 slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"


def _base(**extra):
    # 送單一定要選場次、留 Email（2026-09-30）；缺任何一個都是 422，不能讓下面的測試因此假綠。
    payload = {
        "campus_key": "yihua", "config_version": 1, "parent_name": "林媽媽",
        "phone": "0912345678", "email": "parent@example.com", "slot_id": str(uuid.uuid4()),
        "consent_given": True,
    }
    payload.update(extra)
    return payload


@pytest.mark.parametrize(
    ("raw", "code"),
    [("weekday_morning", "weekday_morning"), ("平日上午", "weekday_morning"), ("其他，另行確認", "other"), ("", None), (None, None)],
)
def test_contact_time_codes_and_legacy_labels(raw, code):
    assert VisitRequestCreate(**_base(preferred_time=raw)).preferred_time == code


@pytest.mark.parametrize(("raw", "code"), [("3-4", "3-4"), ("3–4 歲", "3-4"), ("3-4 歲", "3-4"), ("2 歲以下", "under_2"), ("尚未確定", "unknown")])
def test_age_codes_and_legacy_labels(raw, code):
    assert VisitRequestCreate(**_base(age=raw)).age == code


@pytest.mark.parametrize("field,value", [("preferred_time", "晚上"), ("age", "7 歲"), ("preferred_time", "weekend")])
def test_unknown_values_rejected(field, value):
    with pytest.raises(ValueError):
        VisitRequestCreate(**_base(**{field: value}))
    with pytest.raises(ValueError):
        VisitRequestManualCreate(
            campus_key="yihua", source="phone", parent_name="a", phone="0912345678", slot_id=uuid.uuid4(), **{field: value}
        )


@pytest.mark.asyncio
async def test_submission_stores_code_and_label_retry_is_same_request(admin_client, public_client):
    slot_id = await create_slot(admin_client, capacity=5)
    updated = await set_booking_mode(admin_client, mode="slots")
    assert updated.status_code == 200, updated.text
    version = updated.json()["version"]
    first = await public_client.post(
        f"{API}/public/visit-requests",
        json=_base(config_version=version, slot_id=slot_id, preferred_time="平日下午"),
        headers={"Idempotency-Key": "codes-01"},
    )
    assert first.status_code == 201, first.text
    # 同一次送出、新版頁面改送代碼重試：內容一樣，回同一筆，不是 409。
    retry = await public_client.post(
        f"{API}/public/visit-requests",
        json=_base(config_version=version, slot_id=slot_id, preferred_time="weekday_afternoon"),
        headers={"Idempotency-Key": "codes-01"},
    )
    assert retry.status_code in (200, 201), retry.text
    assert retry.json()["receipt_id"] == first.json()["receipt_id"]

    detail = await admin_client.get(f"{API}/admin/visit-requests/{first.json()['receipt_id']}")
    assert detail.json()["preferred_time"] == "weekday_afternoon"
