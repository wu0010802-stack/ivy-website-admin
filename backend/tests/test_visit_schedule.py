"""每週規則、休假日與依規則產生時段（規格 6.3）。"""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.common.timezones import today_local
from tests.test_visit_workflow import _enable_slots, _slot_payload

API = "/api/website/v1"


def _next_weekday(weekday: int, min_days_ahead: int = 3) -> date:
    day = date.today() + timedelta(days=min_days_ahead)
    while day.weekday() != weekday:
        day += timedelta(days=1)
    return day


async def _set_rules(client, rules, campus="yihua", lead=24, advance=60):
    resp = await client.put(
        f"{API}/admin/visit-schedule/{campus}",
        json={"min_lead_hours": lead, "max_advance_days": advance, "rules": rules},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


WED_MORNING = {"weekday": 2, "start_time": "09:00:00", "end_time": "10:30:00", "slot_minutes": 30, "capacity": 2}


@pytest.mark.asyncio
async def test_schedule_defaults_and_replace(admin_client):
    initial = await admin_client.get(f"{API}/admin/visit-schedule/yihua")
    assert initial.status_code == 200, initial.text
    assert initial.json()["min_lead_hours"] == 24
    assert initial.json()["max_advance_days"] == 60
    assert initial.json()["rules"] == []

    saved = await _set_rules(admin_client, [WED_MORNING], lead=48, advance=30)
    assert saved["min_lead_hours"] == 48
    assert len(saved["rules"]) == 1

    replaced = await _set_rules(admin_client, [])
    assert replaced["rules"] == []


@pytest.mark.asyncio
async def test_rule_validation(admin_client):
    bad = await admin_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={"min_lead_hours": 24, "max_advance_days": 60, "rules": [{**WED_MORNING, "end_time": "08:00:00"}]},
    )
    assert bad.status_code == 422
    bad_day = await admin_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={"min_lead_hours": 24, "max_advance_days": 60, "rules": [{**WED_MORNING, "weekday": 7}]},
    )
    assert bad_day.status_code == 422


@pytest.mark.asyncio
async def test_generate_slots_from_rules_is_idempotent(admin_client):
    await _set_rules(admin_client, [WED_MORNING])
    wed = _next_weekday(2)
    gen = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": wed.isoformat(), "date_to": wed.isoformat()},
    )
    assert gen.status_code == 200, gen.text
    # 09:00–10:30 每 30 分鐘 → 3 格。
    assert gen.json()["created"] == 3

    slots = (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={wed}&date_to={wed}")).json()
    assert [s["start_time"] for s in slots] == ["09:00:00", "09:30:00", "10:00:00"]
    assert all(s["capacity"] == 2 for s in slots)

    again = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": wed.isoformat(), "date_to": wed.isoformat()},
    )
    assert again.json() == {"created": 0, "skipped_existing": 3, "skipped_exception_days": 0}


@pytest.mark.asyncio
async def test_generate_skips_past_and_exception_days(admin_client):
    await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)])
    holiday = today_local() + timedelta(days=5)
    exc = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions",
        json={"exception_date": holiday.isoformat(), "reason": "教師研習"},
    )
    assert exc.status_code == 201, exc.text

    start = today_local() - timedelta(days=3)
    end = today_local() + timedelta(days=6)
    gen = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": start.isoformat(), "date_to": end.isoformat()},
    )
    body = gen.json()
    # 今天到 +6 共 7 天，扣掉休假日 1 天 → 6 天 × 3 格。
    assert body["created"] == 18
    assert body["skipped_exception_days"] == 1
    assert (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={holiday}&date_to={holiday}")).json() == []
    past = (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={start}&date_to={today_local() - timedelta(days=1)}")).json()
    assert past == []

    too_wide = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": today_local().isoformat(), "date_to": (today_local() + timedelta(days=200)).isoformat()},
    )
    assert too_wide.status_code == 422


@pytest.mark.asyncio
async def test_exception_closes_existing_slots_without_cancelling(admin_client, public_client):
    version = await _enable_slots(admin_client, auto_confirm=True)
    await _set_rules(admin_client, [WED_MORNING])
    wed = _next_weekday(2)
    await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": wed.isoformat(), "date_to": wed.isoformat()},
    )
    slot = (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={wed}&date_to={wed}")).json()[0]
    booked = await public_client.post(
        f"{API}/public/visit-requests",
        json=_slot_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "exception-close-01"},
    )
    assert booked.status_code == 201, booked.text

    exc = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions",
        json={"exception_date": wed.isoformat(), "reason": "颱風假"},
    )
    body = exc.json()
    assert body["closed_slots"] == 3
    assert body["affected_requests"] == 1

    slots = (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={wed}&date_to={wed}")).json()
    assert all(s["closed"] for s in slots)
    case = (await admin_client.get(f"{API}/admin/visit-requests/{booked.json()['receipt_id']}")).json()
    assert case["status"] == "confirmed"

    schedule = (await admin_client.get(f"{API}/admin/visit-schedule/yihua")).json()
    assert [e["reason"] for e in schedule["exceptions"]] == ["颱風假"]
    removed = await admin_client.delete(f"{API}/admin/visit-schedule/yihua/exceptions/{body['id']}")
    assert removed.status_code == 200, removed.text
    # 三場都是休假日關的，取消休假就全部重開；場次本來就在，不必補。
    assert removed.json() == {"reopened_slots": 3, "created_slots": 0}
    assert (await admin_client.get(f"{API}/admin/visit-schedule/yihua")).json()["exceptions"] == []


@pytest.mark.asyncio
async def test_public_window_follows_campus_settings(admin_client):
    await _enable_slots(admin_client, auto_confirm=True)
    near = date.today() + timedelta(days=2)
    created = await admin_client.post(
        f"{API}/admin/slots?campus_key=yihua",
        json={"slot_date": near.isoformat(), "start_time": "10:00:00", "end_time": "11:00:00", "capacity": 1},
    )
    assert created.status_code == 201
    listed = await admin_client.get(f"{API}/public/slots?campus_key=yihua&date_from={near}&date_to={near}")
    assert len(listed.json()) == 1

    # 提前時間拉到 7 天，兩天後的時段就不再公開。
    await _set_rules(admin_client, [], lead=24 * 7)
    listed = await admin_client.get(f"{API}/public/slots?campus_key=yihua&date_from={near}&date_to={near}")
    assert listed.json() == []


@pytest.mark.asyncio
async def test_schedule_is_campus_scoped(minghua_client):
    assert (await minghua_client.get(f"{API}/admin/visit-schedule/yihua")).status_code == 404
    assert (await minghua_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={"min_lead_hours": 24, "max_advance_days": 60, "rules": []},
    )).status_code == 404
    assert (await minghua_client.get(f"{API}/admin/visit-schedule/minghua")).status_code == 200


# ---------------------------------------------------------------------------
# 取消休假日只重開休假關掉的時段；每週規則每天自動補到最遠開放天數
# ---------------------------------------------------------------------------


async def _slots_on(client, day, campus="yihua"):
    resp = await client.get(f"{API}/admin/slots?campus_key={campus}&date_from={day}&date_to={day}")
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_removing_holiday_reopens_only_slots_it_closed(admin_client, db_session):
    await _set_rules(admin_client, [WED_MORNING])
    wed = _next_weekday(2)
    await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": wed.isoformat(), "date_to": wed.isoformat()},
    )
    first, *_ = await _slots_on(admin_client, wed)
    manual = await admin_client.patch(f"{API}/admin/slots/{first['id']}", json={"closed": True})
    assert manual.json()["closed_source"] == "manual"

    exc = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": wed.isoformat()}
    )
    # 手動關掉的那場本來就關著，不算休假日關的。
    assert exc.json()["closed_slots"] == 2
    sources = {s["start_time"]: s["closed_source"] for s in await _slots_on(admin_client, wed)}
    assert sources == {"09:00:00": "manual", "09:30:00": "exception", "10:00:00": "exception"}

    removed = await admin_client.delete(f"{API}/admin/visit-schedule/yihua/exceptions/{exc.json()['id']}")
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"reopened_slots": 2, "created_slots": 0}
    after = {s["start_time"]: (s["closed"], s["closed_source"]) for s in await _slots_on(admin_client, wed)}
    assert after == {"09:00:00": (True, "manual"), "09:30:00": (False, None), "10:00:00": (False, None)}

    from sqlalchemy import select

    from app.operations.models import AuditLogEntry

    audit = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "visit_exception.delete"))
    ).scalar_one()
    assert audit.metadata_json == {"reopened_slots": 2, "created_slots": 0}

    # 找不到（或別校的）休假日照舊回 404。
    again = await admin_client.delete(f"{API}/admin/visit-schedule/yihua/exceptions/{exc.json()['id']}")
    assert again.status_code == 404


@pytest.mark.asyncio
async def test_removing_holiday_fills_slots_skipped_while_it_existed(admin_client):
    await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)])
    holiday = today_local() + timedelta(days=5)
    exc = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": holiday.isoformat()}
    )
    await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": today_local().isoformat(), "date_to": (today_local() + timedelta(days=6)).isoformat()},
    )
    assert await _slots_on(admin_client, holiday) == []

    removed = await admin_client.delete(f"{API}/admin/visit-schedule/yihua/exceptions/{exc.json()['id']}")
    assert removed.json() == {"reopened_slots": 0, "created_slots": 3}
    assert [s["start_time"] for s in await _slots_on(admin_client, holiday)] == ["09:00:00", "09:30:00", "10:00:00"]


def _cycle_settings(app):
    return app.state.settings.model_copy(update={"notification_email_sink_dir": None, "smtp_host": None})


@pytest.mark.asyncio
async def test_rules_extend_daily_up_to_max_advance_days(app, admin_client):
    from app.workers.maintenance import run_cycle

    await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)], advance=10)
    today = today_local()
    # 園方手動調過的時段：名額改 5、其中一場關閉。自動補不能覆蓋或重建。
    tweaked_day = today + timedelta(days=3)
    await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": tweaked_day.isoformat(), "date_to": tweaked_day.isoformat()},
    )
    tweaked = await _slots_on(admin_client, tweaked_day)
    await admin_client.patch(f"{API}/admin/slots/{tweaked[0]['id']}", json={"capacity": 5})
    await admin_client.patch(f"{API}/admin/slots/{tweaked[1]['id']}", json={"closed": True})
    holiday = today + timedelta(days=4)
    await admin_client.post(f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": holiday.isoformat()})

    first = await run_cycle(app.state.session_factory, _cycle_settings(app), worker_id="test")
    assert first.failed_steps == []
    # 明天到第 10 天共 10 天 × 3 場，扣掉休假日 3 場、已存在的 3 場；今天的場次
    # 視測試執行時間可能已開始，不列入斷言。
    assert first.slots_generated >= 24

    ahead = (
        await admin_client.get(
            f"{API}/admin/slots?campus_key=yihua&date_from={today + timedelta(days=1)}&date_to={today + timedelta(days=10)}"
        )
    ).json()
    assert len(ahead) == 27
    assert await _slots_on(admin_client, holiday) == []
    assert (
        await admin_client.get(
            f"{API}/admin/slots?campus_key=yihua&date_from={today + timedelta(days=11)}&date_to={today + timedelta(days=20)}"
        )
    ).json() == []
    kept = {s["id"]: s for s in await _slots_on(admin_client, tweaked_day)}
    assert len(kept) == 3
    assert kept[tweaked[0]["id"]]["capacity"] == 5
    assert kept[tweaked[1]["id"]]["closed"] is True
    schedule = (await admin_client.get(f"{API}/admin/visit-schedule/yihua")).json()
    assert schedule["rules_extended_on"] == today.isoformat()

    # 同一天不再補；改了最遠開放天數就清掉標記，下一輪立刻依新設定補。
    second = await run_cycle(app.state.session_factory, _cycle_settings(app), worker_id="test")
    assert second.slots_generated == 0
    saved = await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)], advance=12)
    assert saved["rules_extended_on"] is None
    third = await run_cycle(app.state.session_factory, _cycle_settings(app), worker_id="test")
    assert third.slots_generated == 6
    assert len(await _slots_on(admin_client, today + timedelta(days=12))) == 3


@pytest.mark.asyncio
async def test_extension_skips_started_windows_inactive_campus_and_campus_without_rules(app, admin_client, db_session):
    from datetime import datetime, time, timezone

    from sqlalchemy import func, select

    from app.booking import schedule_service
    from app.booking.models import VisitSlot
    from app.common.timezones import OPERATING_TZ
    from app.workers.maintenance import run_cycle

    await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)], advance=2)
    today = today_local()
    # 台灣時間 09:45：今天 09:00、09:30 已開始不建，10:00 還來得及。
    at = datetime.combine(today, time(9, 45), tzinfo=OPERATING_TZ).astimezone(timezone.utc)
    assert await schedule_service.extend_from_rules(db_session, "yihua", now=at) == 1 + 3 + 3
    await db_session.commit()
    assert [s["start_time"] for s in await _slots_on(admin_client, today)] == ["10:00:00"]
    # 同一天再叫一次不做事（冪等）。
    assert await schedule_service.extend_from_rules(db_session, "yihua", now=at) == 0
    await db_session.commit()

    # 停用中的分校不補；沒有規則的分校（明華）本來就不在名單上。
    await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)], advance=5)
    off = await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": False})
    assert off.status_code == 200
    try:
        assert await schedule_service.campuses_due_for_extension(db_session, today) == []
        result = await run_cycle(app.state.session_factory, _cycle_settings(app), worker_id="test")
        assert result.slots_generated == 0
    finally:
        await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": True})
    assert await schedule_service.campuses_due_for_extension(db_session, today) == ["yihua"]
    count = (
        await db_session.execute(select(func.count()).select_from(VisitSlot).where(VisitSlot.campus_key == "minghua"))
    ).scalar_one()
    assert count == 0
