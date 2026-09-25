"""每週規則、休假日與依規則產生時段（規格 6.3）。"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest

from app.common.timezones import today_local
from tests.test_visit_workflow import _enable_slots, _slot_payload


# 預約表單要有已發布的同意文字（啟用 inquiry／slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"


def _next_weekday(weekday: int, min_days_ahead: int = 3) -> date:
    day = date.today() + timedelta(days=min_days_ahead)
    while day.weekday() != weekday:
        day += timedelta(days=1)
    return day


async def _set_rules(client, rules, campus="yihua", lead=24, advance=60):
    current = (await client.get(f"{API}/admin/visit-schedule/{campus}")).json()
    resp = await client.put(
        f"{API}/admin/visit-schedule/{campus}",
        json={"expected_version": current["version"], "min_lead_hours": lead, "max_advance_days": advance, "rules": rules},
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
    assert replaced["version"] == saved["version"] + 1

    # 拿舊版本存：不蓋掉別人剛存的規則。
    stale = await admin_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={"expected_version": saved["version"], "min_lead_hours": 24, "max_advance_days": 60, "rules": [WED_MORNING]},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "VISIT_SCHEDULE_VERSION_CONFLICT"
    assert stale.json()["detail"]["current_version"] == replaced["version"]
    assert (await admin_client.get(f"{API}/admin/visit-schedule/yihua")).json()["rules"] == []


@pytest.mark.asyncio
async def test_rule_validation(admin_client):
    bad = await admin_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={"expected_version": 1, "min_lead_hours": 24, "max_advance_days": 60, "rules": [{**WED_MORNING, "end_time": "08:00:00"}]},
    )
    assert bad.status_code == 422
    bad_day = await admin_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={"expected_version": 1, "min_lead_hours": 24, "max_advance_days": 60, "rules": [{**WED_MORNING, "weekday": 7}]},
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
        json={"expected_version": 1, "min_lead_hours": 24, "max_advance_days": 60, "rules": []},
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
    manual = await admin_client.patch(f"{API}/admin/slots/{first['id']}", json={"closed": True, "expected_version": 1})
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
    await admin_client.patch(f"{API}/admin/slots/{tweaked[0]['id']}", json={"capacity": 5, "expected_version": 1})
    await admin_client.patch(f"{API}/admin/slots/{tweaked[1]['id']}", json={"closed": True, "expected_version": 1})
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


# ---------------------------------------------------------------------------
# 改規則時，依規則產生、還沒被使用的未來時段跟著新規則調整（規格 L227）；
# 依規則產生時不建跟既有時段重疊的場次
# ---------------------------------------------------------------------------


def _times(slots):
    return [(s["start_time"][:5], s["end_time"][:5]) for s in slots]


async def _generate(client, day):
    resp = await client.post(
        f"{API}/admin/visit-schedule/yihua/generate", json={"date_from": day.isoformat(), "date_to": day.isoformat()}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_changing_slot_length_retires_unused_old_slots_without_overlap(admin_client, public_client, db_session):
    """審查情境：週三 09:00–10:30 每 30 分鐘已產生 09:00、09:30、10:00，改成每
    45 分鐘後不能同時公開 09:00、09:30、09:45、10:00 四格。"""
    await _set_rules(admin_client, [WED_MORNING])
    version = await _enable_slots(admin_client, auto_confirm=True)
    wed = _next_weekday(2)
    assert (await _generate(admin_client, wed))["created"] == 3
    # 園方在時段頁手動加開的場次不受改規則影響。
    manual = await admin_client.post(
        f"{API}/admin/slots?campus_key=yihua",
        json={"slot_date": wed.isoformat(), "start_time": "13:00:00", "end_time": "14:00:00", "capacity": 1},
    )
    assert manual.status_code == 201, manual.text
    by_start = {s["start_time"]: s for s in await _slots_on(admin_client, wed)}
    # 10:00 有家長已確認；09:30 有一筆已取消的案件（歷史紀錄指著，刪不掉）。
    kept = await public_client.post(
        f"{API}/public/visit-requests",
        json=_slot_payload("yihua", version, by_start["10:00:00"]["id"]),
        headers={"Idempotency-Key": "b03-rule-sync-kept"},
    )
    assert kept.status_code == 201, kept.text
    gone = await public_client.post(
        f"{API}/public/visit-requests",
        json=_slot_payload("yihua", version, by_start["09:30:00"]["id"], parent_name="林爸爸"),
        headers={"Idempotency-Key": "b03-rule-sync-cancelled"},
    )
    assert gone.status_code == 201, gone.text
    cancelled = await admin_client.post(f"{API}/admin/visit-requests/{gone.json()['receipt_id']}/cancel")
    assert cancelled.status_code == 200, cancelled.text

    saved = await _set_rules(admin_client, [{**WED_MORNING, "slot_minutes": 45}])
    assert saved["slot_sync"] == {"removed": 1, "closed": 1, "reopened": 0, "capacity_updated": 0, "kept_booked": 1}
    assert saved["rules_extended_on"] is None
    after = {s["start_time"]: s for s in await _slots_on(admin_client, wed)}
    assert "09:00:00" not in after
    assert (after["09:30:00"]["closed"], after["09:30:00"]["closed_source"]) == (True, "rule")
    assert after["10:00:00"]["closed"] is False  # 已有家長排入，維持原樣
    assert after["13:00:00"]["closed"] is False

    # 依新規則補場次：09:00–09:45 建立；09:45–10:30 跟已排入的 10:00 重疊不建。
    # 規則變更停用的 09:30 不佔時間。
    generated = await _generate(admin_client, wed)
    assert generated["created"] == 1
    assert generated["skipped_existing"] == 1
    public = (await public_client.get(f"{API}/public/slots?campus_key=yihua&date_from={wed}&date_to={wed}")).json()
    assert _times(public) == [("09:00", "09:45"), ("10:00", "10:30"), ("13:00", "14:00")]

    # 規則改回每 30 分鐘：規則變更停用的 09:30 重新開放，沒人用的 09:00–09:45
    # 移除，補上 09:00–09:30。
    back = await _set_rules(admin_client, [WED_MORNING])
    assert back["slot_sync"] == {"removed": 1, "closed": 0, "reopened": 1, "capacity_updated": 0, "kept_booked": 0}
    assert (await _generate(admin_client, wed))["created"] == 1
    reopened = await _slots_on(admin_client, wed)
    assert _times(reopened) == [("09:00", "09:30"), ("09:30", "10:00"), ("10:00", "10:30"), ("13:00", "14:00")]
    assert not any(s["closed"] for s in reopened)

    from sqlalchemy import select

    from app.operations.models import AuditLogEntry

    audits = (
        await db_session.execute(
            select(AuditLogEntry).where(AuditLogEntry.action == "visit_schedule.update").order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    assert audits[-1].metadata_json["slot_sync"] == back["slot_sync"]


@pytest.mark.asyncio
async def test_removing_weekday_and_changing_capacity_follow_new_rules(admin_client, public_client):
    thu_rule = {**WED_MORNING, "weekday": 3}
    await _set_rules(admin_client, [WED_MORNING, thu_rule])
    await _enable_slots(admin_client, auto_confirm=True)
    wed = _next_weekday(2)
    thu = _next_weekday(3)
    later_wed = wed + timedelta(days=7)
    for day in (wed, thu, later_wed):
        await _generate(admin_client, day)
    # 之後那個週三設了休假，場次是休假日關的。
    holiday = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": later_wed.isoformat()}
    )
    assert holiday.json()["closed_slots"] == 3
    # 週四：第一場園方把名額調成 5、第二場手動關閉，都是園方的決定，不能被蓋掉。
    first, second, _ = await _slots_on(admin_client, thu)
    await admin_client.patch(f"{API}/admin/slots/{first['id']}", json={"capacity": 5, "expected_version": 1})
    await admin_client.patch(f"{API}/admin/slots/{second['id']}", json={"closed": True, "expected_version": 1})

    saved = await _set_rules(admin_client, [{**thu_rule, "capacity": 3}])
    assert saved["slot_sync"] == {"removed": 6, "closed": 0, "reopened": 0, "capacity_updated": 1, "kept_booked": 0}
    assert await _slots_on(admin_client, wed) == []
    assert await _slots_on(admin_client, later_wed) == []
    thu_after = await _slots_on(admin_client, thu)
    assert [(s["capacity"], s["closed"], s["closed_source"]) for s in thu_after] == [
        (5, False, None),
        (2, True, "manual"),
        (3, False, None),
    ]
    # 名額跟著改的那場版本加一，拿舊版本存檔會被擋下。
    assert thu_after[2]["version"] == 2
    public = (await public_client.get(f"{API}/public/slots?campus_key=yihua&date_from={wed}&date_to={wed}")).json()
    assert public == []


@pytest.mark.asyncio
async def test_generate_skips_windows_overlapping_existing_slots(admin_client):
    wed = _next_weekday(2)
    manual = await admin_client.post(
        f"{API}/admin/slots?campus_key=yihua",
        json={"slot_date": wed.isoformat(), "start_time": "09:15:00", "end_time": "09:45:00", "capacity": 1},
    )
    assert manual.status_code == 201, manual.text
    await _set_rules(admin_client, [WED_MORNING])
    result = await _generate(admin_client, wed)
    # 09:00–09:30、09:30–10:00 都跟 09:15–09:45 重疊，只建 10:00–10:30。
    assert result == {"created": 1, "skipped_existing": 2, "skipped_exception_days": 0}
    assert _times(await _slots_on(admin_client, wed)) == [("09:15", "09:45"), ("10:00", "10:30")]


RULE_ORIGIN_MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations" / "versions" / "eab4ead6271d_visit_slot_rule_origin.py"
)


@pytest.mark.asyncio
async def test_migration_marks_rule_generated_slots(app, admin_client, db_session):
    """正式庫回填：定期工作（沒有建立人）與「依規則產生時段」（同一個時間戳一批）
    建的是規則時段；後台「新增時段」一次一筆，維持手動。"""
    import importlib.util

    from sqlalchemy import select, update

    from app.booking import schedule_service
    from app.booking.models import VisitSlot

    await _set_rules(admin_client, [WED_MORNING], advance=10)
    wed = _next_weekday(2, min_days_ahead=11)
    await _generate(admin_client, wed)
    await schedule_service.extend_from_rules(db_session, "yihua")
    await db_session.commit()
    for start in ("13:00:00", "14:00:00"):
        created = await admin_client.post(
            f"{API}/admin/slots?campus_key=yihua",
            json={"slot_date": wed.isoformat(), "start_time": start, "end_time": start.replace(":00:00", ":30:00"), "capacity": 1},
        )
        assert created.status_code == 201, created.text
    await db_session.execute(update(VisitSlot).values(from_rule=False))
    await db_session.commit()

    spec = importlib.util.spec_from_file_location("visit_slot_rule_origin", RULE_ORIGIN_MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    captured: list = []

    class _Op:
        @staticmethod
        def execute(statement):
            captured.append(statement)

        @staticmethod
        def add_column(*args, **kwargs):
            pass

        @staticmethod
        def drop_constraint(*args, **kwargs):
            pass

        @staticmethod
        def create_check_constraint(*args, **kwargs):
            pass

    migration.op = _Op()
    migration.upgrade()
    [statement] = captured
    async with app.state.engine.begin() as conn:
        await conn.execute(statement)

    db_session.expire_all()
    rows = (await db_session.execute(select(VisitSlot.slot_date, VisitSlot.start_time, VisitSlot.created_by, VisitSlot.from_rule))).all()
    auto = [r for r in rows if r.created_by is None]
    assert auto and all(r.from_rule for r in auto)
    on_wed = {r.start_time.strftime("%H:%M"): r.from_rule for r in rows if r.slot_date == wed}
    assert on_wed == {"09:00": True, "09:30": True, "10:00": True, "13:00": False, "14:00": False}
