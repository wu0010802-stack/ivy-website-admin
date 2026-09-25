"""2026-09-25 缺口 69：時段、案件（承辦人、下次聯絡時間）、每週規則、素材
metadata 都有 version，PATCH／PUT 帶 expected_version，不符回 409，不再後寫
蓋前寫。每週規則與全站設定的衝突測試在 test_visit_schedule.py、
test_operations.py。"""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest

from tests.conftest import _create_user
from app.auth.models import Role

pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
BASE = f"{API}/admin"
FIXTURES = Path("/tmp/media-fixtures")


async def _slot(client, days_ahead=3) -> dict:
    response = await client.post(
        f"{BASE}/slots?campus_key=yihua",
        json={
            "slot_date": (date.today() + timedelta(days=days_ahead)).isoformat(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "capacity": 3,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _case(client, key: str) -> dict:
    response = await client.post(
        f"{BASE}/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": "王媽媽", "phone": "0912345678", "consent_given": True},
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_slot_update_requires_current_version(admin_client):
    slot = await _slot(admin_client)
    assert slot["version"] == 1

    first = await admin_client.patch(f"{BASE}/slots/{slot['id']}", json={"capacity": 5, "expected_version": 1})
    assert first.status_code == 200, first.text
    assert first.json()["version"] == 2

    # 另一個人還開著舊畫面：關閉時段被擋下，容量維持前一個人改的 5。
    stale = await admin_client.patch(f"{BASE}/slots/{slot['id']}", json={"closed": True, "expected_version": 1})
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "SLOT_VERSION_CONFLICT"
    assert stale.json()["detail"]["current_version"] == 2

    missing = await admin_client.patch(f"{BASE}/slots/{slot['id']}", json={"closed": True})
    assert missing.status_code == 422


@pytest.mark.asyncio
async def test_holiday_closing_bumps_slot_version(admin_client):
    slot = await _slot(admin_client)
    holiday = await admin_client.post(
        f"{BASE}/visit-schedule/yihua/exceptions", json={"exception_date": slot["slot_date"]}
    )
    assert holiday.status_code == 201, holiday.text
    # 開著舊畫面的人不能把休假日關掉的時段又打開。
    reopen = await admin_client.patch(f"{BASE}/slots/{slot['id']}", json={"closed": False, "expected_version": 1})
    assert reopen.status_code == 409
    assert reopen.json()["detail"]["code"] == "SLOT_VERSION_CONFLICT"


@pytest.mark.asyncio
async def test_assignee_and_follow_up_use_case_version(admin_client, db_session):
    colleague = await _create_user(db_session, "desk-v@ivy.example", "desk-password-123456", Role.RECEPTION, ["yihua"])
    case = await _case(admin_client, "version-case-01")
    assert case["version"] == 1

    assigned = await admin_client.patch(
        f"{BASE}/visit-requests/{case['id']}/assignee",
        json={"assigned_staff_id": str(colleague.id), "expected_version": 1},
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["version"] == 2

    stale = await admin_client.patch(
        f"{BASE}/visit-requests/{case['id']}/assignee", json={"assigned_staff_id": None, "expected_version": 1}
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "VISIT_REQUEST_VERSION_CONFLICT"
    assert stale.json()["detail"]["current_version"] == 2

    # 改下次聯絡時間也要帶版本；只記一筆聯絡紀錄不用。
    needs_version = await admin_client.post(
        f"{BASE}/visit-requests/{case['id']}/contact-notes",
        json={"note": "再聯絡", "follow_up_at": "2999-01-01T09:00:00Z"},
    )
    assert needs_version.status_code == 422
    stale_note = await admin_client.post(
        f"{BASE}/visit-requests/{case['id']}/contact-notes",
        json={"note": "再聯絡", "follow_up_at": "2999-01-01T09:00:00Z", "expected_version": 1},
    )
    assert stale_note.status_code == 409
    assert stale_note.json()["detail"]["code"] == "VISIT_REQUEST_VERSION_CONFLICT"
    plain = await admin_client.post(f"{BASE}/visit-requests/{case['id']}/contact-notes", json={"note": "打過電話"})
    assert plain.status_code == 201, plain.text
    ok = await admin_client.post(
        f"{BASE}/visit-requests/{case['id']}/contact-notes",
        json={"note": "再聯絡", "follow_up_at": "2999-01-01T09:00:00Z", "expected_version": 2},
    )
    assert ok.status_code == 201, ok.text
    detail = (await admin_client.get(f"{BASE}/visit-requests/{case['id']}")).json()
    assert detail["version"] == 3
    assert detail["assigned_staff_id"] == str(colleague.id)

    # 狀態轉換不動版本：家長或同事改了狀態，開著的畫面仍可以改承辦人。
    assert (await admin_client.post(f"{BASE}/visit-requests/{case['id']}/contacting")).status_code == 200
    again = await admin_client.patch(
        f"{BASE}/visit-requests/{case['id']}/assignee", json={"assigned_staff_id": None, "expected_version": 3}
    )
    assert again.status_code == 200, again.text


@pytest.mark.asyncio
async def test_media_metadata_update_requires_current_version(admin_client):
    uploaded = await admin_client.post(
        f"{BASE}/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("a.jpg", (FIXTURES / "test.jpg").read_bytes(), "image/jpeg")},
    )
    asset = uploaded.json()
    assert asset["version"] == 1

    first = await admin_client.patch(f"{BASE}/media/{asset['id']}", json={"caption": "園慶", "expected_version": 1})
    assert first.status_code == 200, first.text
    assert first.json()["version"] == 2

    stale = await admin_client.patch(f"{BASE}/media/{asset['id']}", json={"caption": "舊的", "expected_version": 1})
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "MEDIA_VERSION_CONFLICT"
    assert (await admin_client.get(f"{BASE}/media/{asset['id']}")).json()["caption"] == "園慶"

    # 沒改到任何欄位不升版。
    same = await admin_client.patch(f"{BASE}/media/{asset['id']}", json={"caption": "園慶", "expected_version": 2})
    assert same.json()["version"] == 2
