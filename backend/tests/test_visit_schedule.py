"""每週規則、休假日與依規則產生時段（規格 6.3）。"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest

from app.common.timezones import today_local
from tests.test_visit_workflow import _enable_slots, _slot_payload


# 預約表單要有已發布的同意文字（啟用 slots、官網送單）。
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

# 2026-09-30 起存每週規則當下就會把場次補到「最遠開放天數」（回應 slot_sync.created），
# 不再等定期工作。下面的測試要讓存檔補出來的數量可預期，所以：
# - 只驗產生邏輯、不訂位的，最遠開放天數設 1（存檔只補今天與明天，測的日期都在 3 天後）；
# - 要訂位的，最遠開放天數設 4，並把規則掛在「3 天後」那天的星期（`_day_rule`），
#   今天到 4 天後之間只有那一天符合，存檔補出的就恰好是那一天的場次。


def _day_rule(day: date, **overrides) -> dict:
    """指定日期那個星期的規則：09:00–10:30、每 30 分鐘 3 場、名額 2。"""
    return {**WED_MORNING, "weekday": day.weekday(), **overrides}


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
    # 最遠開放天數 1：存檔只補今天與明天，3 天後以上的場次留給下面的產生來建。
    await _set_rules(admin_client, [WED_MORNING], advance=1)
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
    await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)], advance=1)
    holiday = today_local() + timedelta(days=5)
    exc = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions",
        json={"exception_date": holiday.isoformat(), "reason": "教師研習"},
    )
    assert exc.status_code == 201, exc.text

    start = today_local() - timedelta(days=3)
    end = today_local() + timedelta(days=6)
    # 存檔當下已經補好的場次（今天還沒開始的、明天）：產生時算「已存在」。
    already = await admin_client.get(
        f"{API}/admin/slots?campus_key=yihua&date_from={today_local()}&date_to={end}"
    )
    assert already.status_code == 200, already.text
    already_count = len(already.json())
    assert 3 <= already_count <= 6
    gen = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/generate",
        json={"date_from": start.isoformat(), "date_to": end.isoformat()},
    )
    body = gen.json()
    # 今天到 +6 共 7 天，扣掉休假日 1 天 → 6 天 × 3 格；其中存檔時補好的不再建。
    assert body["created"] == 18 - already_count
    assert body["skipped_existing"] == already_count
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
    version = await _enable_slots(admin_client)
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
    await _enable_slots(admin_client)
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
    # 先設休假日再存規則：存檔當下補場次時，休假日那天要被跳過（不會建了又關）。
    holiday = today_local() + timedelta(days=5)
    exc = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": holiday.isoformat()}
    )
    saved = await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)])
    assert saved["slot_sync"]["created"] > 0
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


async def _mark_extension_due(db_session, *, days_ago: int | None = None):
    """模擬「隔了一天」：清掉 rules_extended_on（或記成幾天前），定期工作才會再補一次。
    存檔當下已經補過並記下今天，不清掉的話當天的定期工作什麼都不會做。"""
    from sqlalchemy import update

    from app.booking.models import BookingConfig

    value = None if days_ago is None else today_local() - timedelta(days=days_ago)
    await db_session.execute(
        update(BookingConfig).where(BookingConfig.campus_key == "yihua").values(rules_extended_on=value)
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_rules_extend_daily_up_to_max_advance_days(app, admin_client, db_session):
    from sqlalchemy import update

    from app.booking.models import BookingConfig
    from app.workers.maintenance import run_cycle

    today = today_local()
    holiday = today + timedelta(days=4)
    await admin_client.post(f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": holiday.isoformat()})
    # 存檔當下就補到最遠開放天數（3 天）：今天還沒開始的場次到 3 天後。
    saved = await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)], advance=3)
    assert saved["slot_sync"]["created"] >= 9
    assert saved["rules_extended_on"] == today.isoformat()
    # 園方手動調過的時段：名額改 5、其中一場關閉。自動補不能覆蓋或重建。
    tweaked_day = today + timedelta(days=3)
    tweaked = await _slots_on(admin_client, tweaked_day)
    assert len(tweaked) == 3
    await admin_client.patch(f"{API}/admin/slots/{tweaked[0]['id']}", json={"capacity": 5, "expected_version": 1})
    await admin_client.patch(f"{API}/admin/slots/{tweaked[1]['id']}", json={"closed": True, "expected_version": 1})

    # 過了一天：最遠開放天數是 10 天，定期工作把後面的日子補上。
    await db_session.execute(
        update(BookingConfig)
        .where(BookingConfig.campus_key == "yihua")
        .values(max_advance_days=10, rules_extended_on=today - timedelta(days=1))
    )
    await db_session.commit()
    first = await run_cycle(app.state.session_factory, _cycle_settings(app), worker_id="test")
    assert first.failed_steps == []
    # 第 5 到第 10 天共 6 天 × 3 場（第 4 天是休假日，前 3 天存檔時已補好）。
    assert first.slots_generated == 18

    ahead = (
        await admin_client.get(
            f"{API}/admin/slots?campus_key=yihua&date_from={today + timedelta(days=1)}&date_to={today + timedelta(days=10)}"
        )
    ).json()
    # 明天到第 10 天共 10 天 × 3 場，扣掉休假日 3 場。
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

    # 同一天不再補；改了最遠開放天數，存檔當下就依新設定補，不必等下一輪。
    second = await run_cycle(app.state.session_factory, _cycle_settings(app), worker_id="test")
    assert second.slots_generated == 0
    saved = await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)], advance=12)
    assert saved["slot_sync"]["created"] == 6
    assert saved["rules_extended_on"] == today.isoformat()
    third = await run_cycle(app.state.session_factory, _cycle_settings(app), worker_id="test")
    assert third.slots_generated == 0
    assert len(await _slots_on(admin_client, today + timedelta(days=12))) == 3


@pytest.mark.asyncio
async def test_extension_skips_started_windows_inactive_campus_and_campus_without_rules(app, admin_client, db_session):
    from datetime import datetime, time, timezone

    from sqlalchemy import delete, func, select

    from app.booking import schedule_service
    from app.booking.models import VisitSlot
    from app.common.timezones import OPERATING_TZ
    from app.workers.maintenance import run_cycle

    await _set_rules(admin_client, [{**WED_MORNING, "weekday": d} for d in range(7)], advance=2)
    today = today_local()
    # 存檔當下已依真實時間補過一輪；這個測試要用「假的 09:45」驗定期工作，先清成沒補過。
    await db_session.execute(delete(VisitSlot).where(VisitSlot.campus_key == "yihua"))
    await db_session.commit()
    await _mark_extension_due(db_session)
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
    await _mark_extension_due(db_session)  # 隔天：定期工作到期，但分校停用就不補。
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
    45 分鐘後不能同時公開 09:00、09:30、09:45、10:00 四格。（規則掛在 3 天後那天的
    星期，存檔補出的場次恰好是那一天，見檔頭說明。）"""
    wed = today_local() + timedelta(days=3)
    rule = _day_rule(wed)
    first_save = await _set_rules(admin_client, [rule], advance=4)
    assert first_save["slot_sync"]["created"] == 3
    version = await _enable_slots(admin_client)
    assert len(await _slots_on(admin_client, wed)) == 3
    # 再產生一次不會多建（冪等）。
    assert (await _generate(admin_client, wed))["created"] == 0
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

    # 依新規則補場次（存檔當下就補）：09:00–09:45 建立；09:45–10:30 跟已排入的 10:00
    # 重疊不建。規則變更停用的 09:30 不佔時間。
    saved = await _set_rules(admin_client, [{**rule, "slot_minutes": 45}], advance=4)
    assert saved["slot_sync"] == {
        "removed": 1, "closed": 1, "reopened": 0, "capacity_updated": 0, "kept_booked": 1, "created": 1,
    }
    assert saved["rules_extended_on"] == today_local().isoformat()
    after = {s["start_time"]: s for s in await _slots_on(admin_client, wed)}
    assert (after["09:30:00"]["closed"], after["09:30:00"]["closed_source"]) == (True, "rule")
    assert after["10:00:00"]["closed"] is False  # 已有家長排入，維持原樣
    assert after["13:00:00"]["closed"] is False

    # 再產生一次：09:00–09:45 已在、09:45–10:30 跟 10:00 重疊，什麼都不建。
    generated = await _generate(admin_client, wed)
    assert generated["created"] == 0
    assert generated["skipped_existing"] == 2
    public = (await public_client.get(f"{API}/public/slots?campus_key=yihua&date_from={wed}&date_to={wed}")).json()
    assert _times(public) == [("09:00", "09:45"), ("10:00", "10:30"), ("13:00", "14:00")]

    # 規則改回每 30 分鐘：規則變更停用的 09:30 重新開放，沒人用的 09:00–09:45
    # 移除，補上 09:00–09:30。
    back = await _set_rules(admin_client, [rule], advance=4)
    assert back["slot_sync"] == {
        "removed": 1, "closed": 0, "reopened": 1, "capacity_updated": 0, "kept_booked": 0, "created": 1,
    }
    assert (await _generate(admin_client, wed))["created"] == 0
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
    # 「週三」「週四」取 3、4 天後那兩天的星期；最遠開放天數 1，存檔只補今天與明天，
    # 場次由下面明確產生的三天決定。
    wed = today_local() + timedelta(days=3)
    thu = today_local() + timedelta(days=4)
    wed_rule = _day_rule(wed)
    thu_rule = _day_rule(thu)
    await _set_rules(admin_client, [wed_rule, thu_rule], advance=1)
    await _enable_slots(admin_client)
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

    saved = await _set_rules(admin_client, [{**thu_rule, "capacity": 3}], advance=1)
    assert saved["slot_sync"] == {
        "removed": 6, "closed": 0, "reopened": 0, "capacity_updated": 1, "kept_booked": 0, "created": 0,
    }
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


async def _book_then_cancel(admin_client, public_client, version, slot_id, key):
    """在時段留一筆已取消的案件：不占名額，但歷史紀錄指著，時段刪不掉。"""
    made = await public_client.post(
        f"{API}/public/visit-requests",
        json=_slot_payload("yihua", version, slot_id, parent_name="林爸爸"),
        headers={"Idempotency-Key": key},
    )
    assert made.status_code == 201, made.text
    cancelled = await admin_client.post(f"{API}/admin/visit-requests/{made.json()['receipt_id']}/cancel")
    assert cancelled.status_code == 200, cancelled.text


@pytest.mark.asyncio
@pytest.mark.parametrize("holiday_first", [True, False])
async def test_restoring_rules_keeps_holiday_slots_closed(admin_client, public_client, holiday_first):
    """有取消紀錄的舊時段因改規則停用後，規則改回來時如果當天是休假日，要維持
    關閉（改記 exception），取消休假才重開；不能無視休假日直接開放預約。"""
    wed = today_local() + timedelta(days=3)
    rule = _day_rule(wed)
    # 訂位要在最遠開放天數內（4 天，存檔補出的就是 wed 那天的 3 場）；改規則那一步用
    # 1 天，存檔不補 wed，才看得到「只剩停用的 09:30」。
    await _set_rules(admin_client, [rule], advance=4)
    version = await _enable_slots(admin_client)
    by_start = {s["start_time"]: s for s in await _slots_on(admin_client, wed)}
    assert sorted(by_start) == ["09:00:00", "09:30:00", "10:00:00"]
    await _book_then_cancel(admin_client, public_client, version, by_start["09:30:00"]["id"], f"holiday-{holiday_first}")

    async def add_holiday():
        resp = await admin_client.post(
            f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": wed.isoformat()}
        )
        assert resp.status_code in (200, 201), resp.text
        return resp.json()["id"]

    if holiday_first:
        exc_id = await add_holiday()
        await _set_rules(admin_client, [{**rule, "slot_minutes": 45}], advance=1)
    else:
        await _set_rules(admin_client, [{**rule, "slot_minutes": 45}], advance=1)
        exc_id = await add_holiday()
    assert [(s["start_time"], s["closed_source"]) for s in await _slots_on(admin_client, wed)] == [
        ("09:30:00", "rule")
    ]

    # 規則改回來、最遠開放天數 4：存檔補場次時 wed 是休假日，不建。
    back = await _set_rules(admin_client, [rule], advance=4)
    assert back["slot_sync"]["reopened"] == 0
    assert back["slot_sync"]["created"] == 0
    after = await _slots_on(admin_client, wed)
    assert [(s["start_time"], s["closed"], s["closed_source"]) for s in after] == [("09:30:00", True, "exception")]
    public = (await public_client.get(f"{API}/public/slots?campus_key=yihua&date_from={wed}&date_to={wed}")).json()
    assert public == []

    # 取消休假：09:30 照常重開，並補上其餘兩場。
    removed = await admin_client.delete(f"{API}/admin/visit-schedule/yihua/exceptions/{exc_id}")
    assert removed.json() == {"reopened_slots": 1, "created_slots": 2}
    reopened = await _slots_on(admin_client, wed)
    assert _times(reopened) == [("09:00", "09:30"), ("09:30", "10:00"), ("10:00", "10:30")]
    assert not any(s["closed"] for s in reopened)


@pytest.mark.asyncio
async def test_restoring_rules_does_not_reopen_slot_overlapping_booked_slot(admin_client, public_client):
    """30→45→30 分鐘：45 分鐘規則期間家長排入 09:45–10:30，規則改回 30 分鐘時，
    停用中的 09:30–10:00 跟它重疊，不能重新開放。"""
    wed = today_local() + timedelta(days=3)
    rule = _day_rule(wed)
    await _set_rules(admin_client, [rule], advance=4)
    version = await _enable_slots(admin_client)
    by_start = {s["start_time"]: s for s in await _slots_on(admin_client, wed)}
    assert sorted(by_start) == ["09:00:00", "09:30:00", "10:00:00"]
    await _book_then_cancel(admin_client, public_client, version, by_start["09:30:00"]["id"], "overlap-cancelled")

    # 改成 45 分鐘：存檔當下補上 09:00–09:45、09:45–10:30（停用的 09:30 不佔時間）。
    forty_five = await _set_rules(admin_client, [{**rule, "slot_minutes": 45}], advance=4)
    assert forty_five["slot_sync"]["created"] == 2
    by_start = {s["start_time"]: s for s in await _slots_on(admin_client, wed)}
    booked = await public_client.post(
        f"{API}/public/visit-requests",
        json=_slot_payload("yihua", version, by_start["09:45:00"]["id"]),
        headers={"Idempotency-Key": "overlap-booked"},
    )
    assert booked.status_code == 201, booked.text

    back = await _set_rules(admin_client, [rule], advance=4)
    # 沒人用的 09:00–09:45 移除；已排入的 09:45 保留；停用的 09:30 跟它重疊不重開；
    # 補上 09:00–09:30（09:30–10:00、10:00–10:30 都跟 09:45–10:30 重疊，不建）。
    assert back["slot_sync"] == {
        "removed": 1, "closed": 0, "reopened": 0, "capacity_updated": 0, "kept_booked": 1, "created": 1,
    }
    await _generate(admin_client, wed)
    public = (await public_client.get(f"{API}/public/slots?campus_key=yihua&date_from={wed}&date_to={wed}")).json()
    assert _times(public) == [("09:00", "09:30"), ("09:45", "10:30")]
    retired = {s["start_time"]: s for s in await _slots_on(admin_client, wed)}["09:30:00"]
    assert (retired["closed"], retired["closed_source"]) == (True, "rule")


@pytest.mark.asyncio
async def test_generate_skips_windows_overlapping_existing_slots(admin_client):
    wed = _next_weekday(2)
    manual = await admin_client.post(
        f"{API}/admin/slots?campus_key=yihua",
        json={"slot_date": wed.isoformat(), "start_time": "09:15:00", "end_time": "09:45:00", "capacity": 1},
    )
    assert manual.status_code == 201, manual.text
    await _set_rules(admin_client, [WED_MORNING], advance=1)  # 存檔只補今天與明天，wed 由下面產生
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
