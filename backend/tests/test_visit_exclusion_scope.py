"""排除標記套用的每一處（2026-10-15 規格 §3.3；計畫裁定 P8–P11、P14）：「是」的地方只算一筆，「否」的地方兩筆都在。
每個測試建一筆一般案件與一筆排除案件。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.admissions import journey
from app.booking import readiness, slot_usage
from app.booking.models import BookingConfig, OutboxMessage, VisitRequest, VisitSlot
from app.booking.outbox import PARENT_VISIT_REMINDER
from app.common.timezones import slot_start_utc, today_local
from app.notifications import reminders
from tests.analytics_fixtures import add_case, add_slot
from tests.conftest import create_slot, legacy_request, set_booking_mode
from tests.test_admissions_journey import NOW as JOURNEY_NOW
from tests.test_admissions_journey import TODAY as JOURNEY_TODAY
from tests.test_admissions_journey import add_case as journey_case
from tests.test_admissions_journey import at, d
from tests.test_parent_visit_reminder import (
    CONTROL_EMAIL,
    PARENT_EMAIL,
    _confirmed_days_ago,
    _move_slot_start,
    _queue_reminder,
    _reminder_mails,
    _run,
    _status,
)

API = "/api/website/v1"


async def _exclude(db, case_id) -> None:
    await db.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(str(case_id)))
        .values(excluded_at=datetime.now(timezone.utc), exclude_reason="test")
    )
    await db.commit()


async def _slot(db, *, day: date, start: time = time(10, 0), capacity: int = 5, closed: bool = False,
                closed_source: str | None = None) -> uuid.UUID:
    slot = VisitSlot(
        id=uuid.uuid4(), campus_key="yihua", slot_date=day, start_time=start, end_time=time(start.hour + 1, 0),
        capacity=capacity, closed=closed, closed_source=closed_source, created_at=datetime.now(timezone.utc),
    )
    db.add(slot)
    await db.commit()
    return slot.id


async def _dashboard(client) -> dict:
    response = await client.get(f"{API}/admin/dashboard")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_dashboard_counts_skip_excluded_cases(admin_client, db_session):
    # 今天的兩筆放在 00:00 的場次、狀態 no_show：場次一定已經開始，數字和測試跑的時刻無關
    # （台北 23 點跑時，今天晚上的場次已開始，confirmed 會變成待標記到場）。
    today_slot = await _slot(db_session, day=today_local(), start=time(0, 0), capacity=3)
    keep = await legacy_request(db_session, status="no_show", slot_id=today_slot, parent_name="今天留著", phone="0912000101")
    drop = await legacy_request(db_session, status="no_show", slot_id=today_slot, parent_name="今天排除", phone="0912000102")
    past = await _slot(db_session, day=today_local() - timedelta(days=1))
    await legacy_request(db_session, status="confirmed", slot_id=past, phone="0912000103")
    past_drop = await legacy_request(db_session, status="confirmed", slot_id=past, phone="0912000104")
    closed = await _slot(db_session, day=today_local() + timedelta(days=3), closed=True, closed_source="exception")
    await legacy_request(db_session, status="confirmed", slot_id=closed, phone="0912000105")
    closed_drop = await legacy_request(db_session, status="confirmed", slot_id=closed, phone="0912000106")
    due = datetime.now(timezone.utc) - timedelta(hours=1)
    await db_session.execute(update(VisitRequest).where(VisitRequest.id.in_([uuid.UUID(keep), uuid.UUID(drop)])).values(follow_up_at=due))
    await db_session.commit()
    for case_id in (drop, past_drop, closed_drop):
        await _exclude(db_session, case_id)

    summary = await _dashboard(admin_client)
    assert [row["parent_name"] for row in summary["today_visit_list"]] == ["今天留著"]
    assert summary["today_visits"] == 1
    assert summary["awaiting_attendance"] == 1
    assert summary["pending_follow_up"] == 1
    assert summary["needs_attention"] == 1


@pytest.mark.asyncio
async def test_include_restores_the_counts(admin_client, db_session):
    past = await _slot(db_session, day=today_local() - timedelta(days=1))
    case_id = await legacy_request(db_session, status="confirmed", slot_id=past)
    await _exclude(db_session, case_id)
    assert (await _dashboard(admin_client))["awaiting_attendance"] == 0
    assert (await admin_client.post(f"{API}/admin/visit-requests/{case_id}/include")).status_code == 200
    assert (await _dashboard(admin_client))["awaiting_attendance"] == 1


@pytest.mark.asyncio
async def test_week_campuses_still_count_excluded_cases(admin_client, db_session):
    """計畫裁定 P10（排除規格 §3.3「本週五校」，使用者 10-16 確認）：已約／可約講的是名額，排除不扣。"""
    slot_id = await create_slot(admin_client, days_ahead=1, capacity=3)
    assert (await set_booking_mode(admin_client, "yihua", mode="slots")).status_code == 200
    await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000111")
    await _exclude(db_session, await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000112"))
    row = next(r for r in (await _dashboard(admin_client))["week_campuses"] if r["campus_key"] == "yihua")
    assert (row["booked"], row["open"]) == (2, 1)


@pytest.mark.asyncio
async def test_booking_outcomes_and_class_distribution_skip_excluded(admin_client, db_session):
    await add_case(db_session, status="cancelled", child_birthdate=date(2023, 3, 2))
    await _exclude(db_session, await add_case(db_session, status="cancelled", child_birthdate=date(2023, 3, 2)))
    await db_session.commit()
    outcomes = (await admin_client.get(f"{API}/admin/analytics/booking-outcomes")).json()
    yihua = next(r for r in outcomes["campuses"] if r["campus_key"] == "yihua")
    assert (yihua["cases"], yihua["excluded_cases"]) == (1, 1)
    assert (outcomes["totals"]["cases"], outcomes["totals"]["excluded_cases"]) == (1, 1)
    classes = (await admin_client.get(f"{API}/admin/analytics/class-distribution?campus_key=yihua&school_year=115")).json()
    assert (classes["total"], classes["excluded_cases"]) == (1, 1)


@pytest.mark.asyncio
async def test_open_now_in_booking_outcomes_skips_excluded(admin_client, db_session):
    past = await add_slot(db_session, days_from_today=-1)
    await add_case(db_session, status="confirmed", slot_id=past)
    await _exclude(db_session, await add_case(db_session, status="confirmed", slot_id=past))
    await db_session.commit()
    outcomes = (await admin_client.get(f"{API}/admin/analytics/booking-outcomes")).json()
    assert outcomes["open_now_totals"]["awaiting_attendance"] == 1


@pytest.mark.asyncio
async def test_journey_skips_excluded_and_reports_the_count(db_session):
    past = await _slot(db_session, day=today_local() - timedelta(days=3))
    await legacy_request(db_session, status="completed", slot_id=past, phone="0912000121")
    await _exclude(db_session, await legacy_request(db_session, status="completed", slot_id=past, phone="0912000122"))
    result = await journey.query_journey(db_session, "yihua", today_local() - timedelta(days=30), today_local(), "all")
    assert result["cases"]["total"] == 1
    assert result["coverage"]["excluded_cases"] == 1


@pytest.mark.asyncio
async def test_journey_counts_excluded_only_inside_the_batch(db_session):
    """已排除筆數要在既有批次篩選之後才計數：場次還沒開始就取消的、還沒結案的本來就不在批次，不算；
    預定參觀日算不出來（沒場次）的算，而且剔除之後不再進 undated_cases。固定「現在」是 10-15 12:00（台北）。"""
    # 對照：一般已到場，留在批次裡。
    await journey_case(db_session, slot_day=d(10, 10), created=at(d(10, 1)))
    # 批次內被排除：已到場、場次已開始就取消，各算 1 筆。
    await _exclude(db_session, await journey_case(db_session, slot_day=d(10, 11), created=at(d(10, 1))))
    await _exclude(db_session, await journey_case(
        db_session, status="cancelled", slot_day=d(10, 12), created=at(d(10, 1)), cancelled_at=at(d(10, 11)), cancel_reason="staff",
    ))
    # 預定參觀日算不出來（已到場、沒場次、沒有 completed 事件）：也算 1 筆，不再算進 undated_cases。
    await _exclude(db_session, await journey_case(db_session, slot_day=None, created=at(d(10, 2))))
    # 本來就不在批次：今天 15:00 的場次現在（12:00）還沒開始，取消的、還沒結案的都不算。
    await _exclude(db_session, await journey_case(
        db_session, status="cancelled", slot_day=JOURNEY_TODAY, slot_hour=15, created=at(d(10, 5)),
        cancelled_at=at(d(10, 14)), cancel_reason="parent",
    ))
    await _exclude(db_session, await journey_case(db_session, status="confirmed", slot_day=JOURNEY_TODAY, slot_hour=15, created=at(d(10, 5))))
    result = await journey.query_journey(db_session, "yihua", d(10, 1), JOURNEY_TODAY, "all", now=JOURNEY_NOW)
    assert result["cases"]["total"] == 1
    assert result["coverage"]["excluded_cases"] == 3
    assert result["coverage"]["undated_cases"] == 0


@pytest.mark.asyncio
async def test_slot_usage_skips_excluded_and_reports_the_count(db_session):
    day = today_local() - timedelta(weeks=2)
    slot_id = await _slot(db_session, day=day, capacity=5)
    await legacy_request(db_session, status="completed", slot_id=slot_id, phone="0912000131")
    await _exclude(db_session, await legacy_request(db_session, status="completed", slot_id=slot_id, phone="0912000132"))
    out = await slot_usage.slot_rows(db_session, "yihua", 4, today_local())
    [row] = out["rows"]
    assert row["booked"] == 1
    assert out["excluded_cases"] == 1


@pytest.mark.asyncio
async def test_slot_usage_excluded_cases_counts_only_seat_holding_cases(db_session):
    """excluded_cases 只數占名額的排除案件：已取消的本來就不在已約裡，不算進去。"""
    day = today_local() - timedelta(weeks=2)
    slot_id = await _slot(db_session, day=day, capacity=5)
    await _exclude(db_session, await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000133"))
    await _exclude(db_session, await legacy_request(db_session, status="cancelled", slot_id=slot_id, phone="0912000134"))
    out = await slot_usage.slot_rows(db_session, "yihua", 4, today_local())
    [row] = out["rows"]
    assert row["booked"] == 0
    assert out["excluded_cases"] == 1


@pytest.mark.asyncio
async def test_excluding_does_not_release_the_seat(admin_client, public_client, db_session):
    """Review Focus 5：排除不釋出名額（E6）。容量 2、一筆已確認：排除前後公開剩餘名額都是 1（場次一直列著，
    不是因為別的原因才不列），後台接待月曆的已約數也都是 1。"""
    slot_id = await create_slot(admin_client, days_ahead=3, capacity=2)
    assert (await set_booking_mode(admin_client, "yihua", mode="slots")).status_code == 200
    case_id = await legacy_request(db_session, status="confirmed", slot_id=slot_id)
    day = (today_local() + timedelta(days=3)).isoformat()

    async def public_remaining() -> list[int]:
        response = await public_client.get(f"{API}/public/slots?campus_key=yihua&date_from={day}&date_to={day}")
        assert response.status_code == 200, response.text
        return [s["remaining"] for s in response.json() if s["id"] == slot_id]

    async def calendar_booked() -> list[int]:
        response = await admin_client.get(f"{API}/admin/visit-calendar?campus_key=yihua&date_from={day}&date_to={day}")
        assert response.status_code == 200, response.text
        return [s["booked_count"] for s in response.json() if s["id"] == slot_id]

    assert await public_remaining() == [1]
    assert await calendar_booked() == [1]
    await _exclude(db_session, case_id)
    assert await public_remaining() == [1]
    assert await calendar_booked() == [1]


@pytest.mark.asyncio
async def test_staff_reminder_skips_excluded_cases(db_session):
    tomorrow = today_local() + timedelta(days=1)
    slot_id = await _slot(db_session, day=tomorrow, start=time(10, 0))
    keep = await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000141")
    drop = await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000142")
    # legacy_request 的確認時間是現在；提醒時間點要晚於確認時間才會排（reminders.py 的 _due_upcoming）。
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id.in_([uuid.UUID(keep), uuid.UUID(drop)]))
        .values(confirmed_at=datetime.now(timezone.utc) - timedelta(days=3))
    )
    await db_session.commit()
    await _exclude(db_session, drop)
    now = slot_start_utc(tomorrow, time(10, 0)) - timedelta(hours=23)
    await reminders.enqueue_due_reminders(db_session, now=now)
    await db_session.commit()
    rows = (await db_session.execute(select(OutboxMessage.visit_request_id).where(OutboxMessage.kind == reminders.UPCOMING_VISIT_KIND))).scalars().all()
    assert [str(r) for r in rows] == [keep]
    # 排入之後才排除的：寄出前 skipped。
    await _exclude(db_session, keep)
    payload = {"campus_key": "yihua", "receipt_id": keep, "slot_id": str(slot_id)}
    assert await reminders.still_applies(db_session, reminders.UPCOMING_VISIT_KIND, payload, now) is False


async def _visit_with_email(admin_client, db_session, slot_id: str, *, email: str, phone: str) -> str:
    """同一個場次上一筆有 Email 的已確認案件；確認時間改成 5 天前（確認時還沒進提醒範圍）。"""
    receipt = await legacy_request(db_session, status="confirmed", slot_id=slot_id, email=email, phone=phone)
    await _confirmed_days_ago(db_session, receipt)
    return receipt


@pytest.mark.asyncio
async def test_parent_reminder_is_not_queued_for_excluded_cases(admin_client, db_session):
    """員工與家長提醒共用 _due_upcoming 的到點判斷：一般案件有排（正向對照），排除的不排。"""
    slot = await create_slot(admin_client, capacity=5)
    await _move_slot_start(db_session, slot, hours=23)
    keep = await _visit_with_email(admin_client, db_session, slot, email=PARENT_EMAIL, phone="0912000161")
    drop = await _visit_with_email(admin_client, db_session, slot, email="drop@example.com", phone="0912000162")
    await _exclude(db_session, drop)
    assert await reminders.enqueue_due_parent_reminders(db_session) == 1
    await db_session.commit()
    rows = (
        await db_session.execute(select(OutboxMessage.visit_request_id).where(OutboxMessage.kind == PARENT_VISIT_REMINDER))
    ).scalars().all()
    assert [str(r) for r in rows] == [keep]


@pytest.mark.asyncio
async def test_parent_reminder_queued_before_the_exclusion_is_skipped(
    app, admin_client, db_session, recording_mail_adapter
):
    """排入之後才排除的：寄出時 skipped、沒寄；同一批的一般案件（對照組）照寄，證明不是整條寄送線壞了。"""
    slot = await create_slot(admin_client, capacity=5)
    await _move_slot_start(db_session, slot, hours=23)
    control = await _visit_with_email(admin_client, db_session, slot, email=CONTROL_EMAIL, phone="0912000171")
    excluded = await _visit_with_email(admin_client, db_session, slot, email=PARENT_EMAIL, phone="0912000172")
    control_id = await _queue_reminder(db_session, control, slot)
    excluded_id = await _queue_reminder(db_session, excluded, slot)
    await _exclude(db_session, excluded)

    await _run(app, db_session, recording_mail_adapter)

    assert await _status(db_session, excluded_id) == "skipped"
    assert await _status(db_session, control_id) == "sent"
    assert [mail["to"] for mail in _reminder_mails(recording_mail_adapter)] == [CONTROL_EMAIL]


@pytest.mark.asyncio
async def test_operational_checks_still_count_excluded_cases(admin_client, db_session):
    """計畫裁定 P14：切換預約方式前的確認數、停用分校的未結案件看實際狀態，不扣排除。"""
    slot_id = await create_slot(admin_client, days_ahead=2, capacity=3)
    await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000151")
    await _exclude(db_session, await legacy_request(db_session, status="confirmed", slot_id=slot_id, phone="0912000152"))
    config = await db_session.get(BookingConfig, "yihua")
    impact = await readiness.impact(db_session, "yihua", config)
    assert impact["open_requests"] == 2
    deactivated = await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": False, "reason": "測試"})
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["open_requests"] == 2
