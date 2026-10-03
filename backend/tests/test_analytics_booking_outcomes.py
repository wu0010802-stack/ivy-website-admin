"""成效統計「預約結果」（招生分析階段 1 第 1、4、5 項）：期間內送出的案件現在各是什麼
結果、到場率與未到率、五校並排只列授權範圍、現在的待處理三種與總覽同一份定義。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from tests.analytics_fixtures import add_case, add_slot, taipei
from tests.conftest import set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")

URL = "/api/website/v1/admin/analytics/booking-outcomes"
OUTCOME_KEYS = ("pending", "upcoming", "awaiting_attendance", "completed", "no_show", "cancelled", "unscheduled")


def _row(body: dict, campus_key: str = "yihua") -> dict:
    return next(row for row in body["campuses"] if row["campus_key"] == campus_key)


async def _get(client, query: str = "") -> dict:
    response = await client.get(f"{URL}{query}")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_each_case_lands_in_exactly_one_outcome_with_rates(admin_client, db_session):
    past = await add_slot(db_session, days_from_today=-1)
    future = await add_slot(db_session, days_from_today=3)
    for _ in range(2):
        await add_case(db_session, status="completed", slot_id=past)
    await add_case(db_session, status="no_show", slot_id=past)
    await add_case(db_session, status="confirmed", slot_id=past)
    await add_case(db_session, status="confirmed", slot_id=future, source="phone")
    await add_case(db_session, status="cancelled", slot_id=future, cancel_reason="parent")
    await add_case(db_session, status="cancelled", slot_id=future, cancel_reason=None)
    await add_case(db_session, status="new")
    await db_session.commit()

    row = _row(await _get(admin_client))
    assert row["cases"] == 8
    assert row["web_cases"] == 7
    assert {key: row[key] for key in OUTCOME_KEYS} == {
        "pending": 1, "upcoming": 1, "awaiting_attendance": 1, "completed": 2,
        "no_show": 1, "cancelled": 2, "unscheduled": 0,
    }
    assert sum(row[key] for key in OUTCOME_KEYS) == row["cases"]
    assert row["cancelled_by_reason"] == {"parent": 1, "staff": 0, "hold_expired": 0, "unknown": 1}
    # 參觀時間過了、還沒標記的那 1 筆不算進分母，也不當成到場。
    assert row["attendance_rate"] == {"value": 66.7, "numerator": 2, "denominator": 3}
    assert row["no_show_rate"] == {"value": 33.3, "numerator": 1, "denominator": 3}
    assert row["cancel_rate"] == {"value": 25.0, "numerator": 2, "denominator": 8}


@pytest.mark.asyncio
async def test_rates_are_null_when_nothing_to_divide(admin_client):
    row = _row(await _get(admin_client))
    assert row["cases"] == 0
    for key in ("attendance_rate", "no_show_rate", "cancel_rate"):
        assert row[key] == {"value": None, "numerator": 0, "denominator": 0}


@pytest.mark.asyncio
async def test_period_uses_taipei_days_of_created_at(admin_client, db_session):
    # 兩筆在 UTC 都是 09-30，台北分屬 09-30 與 10-01。
    await add_case(db_session, status="new", created_at=taipei(date(2026, 9, 30), 23, 59))
    await add_case(db_session, status="new", created_at=taipei(date(2026, 10, 1), 0, 0))
    await db_session.commit()
    assert _row(await _get(admin_client, "?from=2026-09-30&to=2026-09-30"))["cases"] == 1
    assert _row(await _get(admin_client, "?from=2026-10-01&to=2026-10-01"))["cases"] == 1
    assert _row(await _get(admin_client, "?from=2026-09-30&to=2026-10-01"))["cases"] == 2


@pytest.mark.asyncio
async def test_only_campuses_in_scope_are_listed(admin_client, minghua_client, db_session):
    await add_case(db_session, campus_key="yihua", status="new")
    await add_case(db_session, campus_key="minghua", status="new")
    await db_session.commit()

    everyone = await _get(admin_client)
    assert [row["campus_key"] for row in everyone["campuses"]] == ["yihua", "minghua", "chongde", "international", "renwu"]
    assert everyone["totals"]["cases"] == 2

    minghua = await _get(minghua_client)
    assert [row["campus_key"] for row in minghua["campuses"]] == ["minghua"]
    assert minghua["totals"]["cases"] == 1
    assert minghua["open_now_totals"]["legacy_pending"] == 1
    # 這支 API 沒有校區參數；自己加上別校也不會擴大範圍。
    tampered = await _get(minghua_client, "?campus_key=yihua")
    assert [row["campus_key"] for row in tampered["campuses"]] == ["minghua"]


@pytest.mark.asyncio
async def test_analytics_only_role_sees_counts_without_personal_data(editor_client, db_session):
    await add_case(db_session, status="new")
    await db_session.commit()
    body = await _get(editor_client)
    assert [row["campus_key"] for row in body["campuses"]] == ["yihua"]
    text = str(body)
    for personal in ("測試家長", "0911000222", "parent_name", "phone", "email", "birthdate"):
        assert personal not in text


@pytest.mark.asyncio
async def test_open_now_matches_dashboard_and_ignores_period(admin_client, db_session):
    old = taipei(date(2026, 9, 1))
    due = datetime.now(timezone.utc) - timedelta(hours=2)
    past = await add_slot(db_session, days_from_today=-1)
    future = await add_slot(db_session, days_from_today=2)
    await add_case(db_session, status="confirmed", slot_id=past, created_at=old)
    await add_case(db_session, status="new", created_at=old)
    await add_case(db_session, status="confirmed", slot_id=future, follow_up_at=due, created_at=old)
    await add_case(db_session, status="cancelled", follow_up_at=due, cancel_reason="staff", created_at=old)
    await db_session.commit()

    dashboard = (await admin_client.get("/api/website/v1/admin/dashboard")).json()
    row = _row(await _get(admin_client, "?from=2026-10-02&to=2026-10-02"))
    assert row["cases"] == 0  # 都是 09-01 送出的，不在期間內
    assert row["open_now"] == {
        "legacy_pending": 1,
        "awaiting_attendance": dashboard["awaiting_attendance"],
        "follow_up_due": dashboard["pending_follow_up"],
    }
    assert row["open_now"]["awaiting_attendance"] == 1
    assert row["open_now"]["follow_up_due"] == 1


@pytest.mark.asyncio
async def test_period_crossing_self_booking_switch_has_no_confirmation_rate(admin_client):
    body = await _get(admin_client, "?from=2026-09-20&to=2026-10-10")
    assert not any("confirm" in key for key in body["totals"])
    assert not any("confirm" in key for key in _row(body))


@pytest.mark.asyncio
async def test_reports_booking_mode_unit_and_validates_range(admin_client):
    switched = await set_booking_mode(admin_client, "yihua", mode="slots")
    assert switched.status_code == 200, switched.text
    body = await _get(admin_client)
    assert _row(body)["booking_mode"] == "slots"
    assert body["unit"] == "visit_request"
    assert body["as_of"]

    reversed_range = await admin_client.get(f"{URL}?from=2026-10-02&to=2026-10-01")
    assert reversed_range.status_code == 422
    assert reversed_range.json()["detail"]["code"] == "INVALID_DATE_RANGE"
    too_long = await admin_client.get(f"{URL}?from=2025-01-01&to=2026-10-01")
    assert too_long.status_code == 422
