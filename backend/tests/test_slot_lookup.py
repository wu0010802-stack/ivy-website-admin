"""場次使用情況：記錄新預約表單讀場次（2026-10-13 規格 §2）。"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.booking import slot_lookup
from app.booking.models import LOOKUP_BUCKETS, SlotLookupDaily
from app.common.timezones import today_local

from tests.conftest import create_slot, create_slot_record, set_booking_mode

API = "/api/website/v1"


@pytest.mark.parametrize(
    ("days", "bucket"),
    [(None, "none"), (-1, "within_1"), (0, "within_1"), (1, "within_1"), (2, "days_2_3"), (3, "days_2_3"),
     (4, "days_4_7"), (7, "days_4_7"), (8, "over_7"), (60, "over_7")],
)
def test_bucket_for_boundaries(days, bucket):
    assert slot_lookup.bucket_for(days) == bucket


def test_every_bucket_is_reachable_and_known():
    seen = {slot_lookup.bucket_for(d) for d in (None, 0, 2, 4, 8)}
    assert seen == set(LOOKUP_BUCKETS)


@pytest.mark.asyncio
async def test_record_lookup_accumulates_per_day_campus_bucket(db_session):
    today = date(2026, 10, 13)
    for _ in range(3):
        await slot_lookup.record_lookup(db_session, campus_key="yihua", earliest=today + timedelta(days=2), today=today)
    await slot_lookup.record_lookup(db_session, campus_key="yihua", earliest=None, today=today)
    await slot_lookup.record_lookup(db_session, campus_key="minghua", earliest=today + timedelta(days=2), today=today)
    await db_session.commit()
    rows = {(r.campus_key, r.bucket): r.lookups for r in (await db_session.scalars(select(SlotLookupDaily))).all()}
    assert rows == {("yihua", "days_2_3"): 3, ("yihua", "none"): 1, ("minghua", "days_2_3"): 1}


@pytest.mark.asyncio
async def test_lookup_summary_has_five_ordered_buckets_and_first_recorded_day(db_session):
    today = date(2026, 10, 13)
    empty = await slot_lookup.lookup_summary(db_session, "yihua", today)
    assert [b["key"] for b in empty["buckets"]] == list(LOOKUP_BUCKETS)
    assert empty["total"] == 0 and empty["first_recorded_day"] is None
    assert empty["date_from"] == today - timedelta(days=27) and empty["date_to"] == today

    db_session.add_all([
        SlotLookupDaily(day=today - timedelta(days=40), campus_key="yihua", bucket="over_7", lookups=9),  # 窗外但算 first_recorded_day
        SlotLookupDaily(day=today - timedelta(days=27), campus_key="yihua", bucket="none", lookups=2),     # 窗內第一天
        SlotLookupDaily(day=today - timedelta(days=28), campus_key="yihua", bucket="none", lookups=5),     # 窗外
        SlotLookupDaily(day=today, campus_key="yihua", bucket="within_1", lookups=4),
        SlotLookupDaily(day=today, campus_key="minghua", bucket="within_1", lookups=7),                    # 別校
    ])
    await db_session.commit()
    summary = await slot_lookup.lookup_summary(db_session, "yihua", today)
    assert summary["first_recorded_day"] == today - timedelta(days=40)
    assert summary["total"] == 6
    assert {b["key"]: b["count"] for b in summary["buckets"]} == {"within_1": 4, "days_2_3": 0, "days_4_7": 0, "over_7": 0, "none": 2}


async def _lookups(db_session) -> dict[tuple[str, str], int]:
    await db_session.rollback()  # 結束舊交易，才讀得到端點剛提交的列
    return {(r.campus_key, r.bucket): r.lookups for r in (await db_session.scalars(select(SlotLookupDaily))).all()}


def _range(days: int = 60) -> str:
    return f"date_from={today_local().isoformat()}&date_to={(today_local() + timedelta(days=days)).isoformat()}"


@pytest.mark.asyncio
async def test_new_booking_purpose_records_one_lookup_with_earliest_bucket(admin_client, public_client, db_session):
    await create_slot(admin_client, days_ahead=5)
    await create_slot(admin_client, days_ahead=20, start_time="14:00:00", end_time="15:00:00")
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert response.status_code == 200
    assert [s["slot_date"] for s in response.json()] == sorted(s["slot_date"] for s in response.json())
    assert await _lookups(db_session) == {("yihua", "days_4_7"): 1}
    await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert await _lookups(db_session) == {("yihua", "days_4_7"): 2}


@pytest.mark.asyncio
async def test_no_slots_at_all_records_none(admin_client, public_client, db_session):
    slot_id = await create_slot(admin_client, days_ahead=58)  # 讓 slots 模式能啟用，之後停止申請
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    stopped = await admin_client.patch(f"{API}/admin/slots/{slot_id}", json={"closed": True, "expected_version": 1})
    assert stopped.status_code == 200, stopped.text
    response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert response.status_code == 200 and response.json() == []
    assert await _lookups(db_session) == {("yihua", "none"): 1}


@pytest.mark.asyncio
async def test_without_purpose_or_with_other_value(admin_client, public_client, db_session):
    await create_slot(admin_client, days_ahead=5)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    plain = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}")
    assert plain.status_code == 200 and len(plain.json()) == 1
    assert await _lookups(db_session) == {}
    bad = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=reschedule")
    assert bad.status_code == 422
    assert await _lookups(db_session) == {}


@pytest.mark.asyncio
async def test_purpose_does_not_change_the_response(admin_client, public_client):
    await create_slot(admin_client, days_ahead=5)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    plain = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}")
    tagged = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert plain.json() == tagged.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["line", "phone", "paused"])
async def test_non_slots_campus_is_not_recorded(admin_client, public_client, db_session, mode):
    extra = {"line": {"line_url": "https://line.me/R/ti/p/@ivy"}, "phone": {"phone": "07-3928366"}, "paused": {"message": "暫停參觀"}}[mode]
    assert (await set_booking_mode(admin_client, mode=mode, **extra)).status_code == 200
    response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert response.status_code == 200
    assert await _lookups(db_session) == {}


@pytest.mark.asyncio
async def test_unknown_campus_is_not_recorded(public_client, db_session):
    unknown = await public_client.get(f"{API}/public/slots?campus_key=nowhere&{_range()}&purpose=new_booking")
    assert unknown.status_code == 200 and unknown.json() == []
    assert await _lookups(db_session) == {}


@pytest.mark.asyncio
async def test_deactivated_campus_returns_no_slots_and_is_not_recorded(admin_client, public_client, db_session):
    """停用的分校不開放公開預約（routes.py 的 `not campus.active` 守衛）。
    先讓 renwu 是自選場次、有未來場次，確認啟用時真的會回場次、會記錄；停用後才斷言回空且不記錄，
    否則「沒設場次本來就回空」會讓守衛被拿掉也看不出來。"""
    from sqlalchemy import update
    from app.campuses.models import Campus

    await create_slot(admin_client, "renwu", days_ahead=5)
    assert (await set_booking_mode(admin_client, "renwu", mode="slots")).status_code == 200
    url = f"{API}/public/slots?campus_key=renwu&{_range()}&purpose=new_booking"

    active = await public_client.get(url)
    assert active.status_code == 200 and len(active.json()) == 1
    assert await _lookups(db_session) == {("renwu", "days_4_7"): 1}

    await db_session.execute(update(Campus).where(Campus.key == "renwu").values(active=False))
    await db_session.commit()
    stopped = await public_client.get(url)
    assert stopped.status_code == 200 and stopped.json() == []
    assert await _lookups(db_session) == {("renwu", "days_4_7"): 1}   # 還是 1：停用後沒有再記


@pytest.mark.asyncio
async def test_recording_failure_still_returns_the_slots_and_keeps_the_session_usable(
    admin_client, public_client, db_session, monkeypatch
):
    from sqlalchemy.exc import OperationalError

    await create_slot(admin_client, days_ahead=5)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200

    async def boom(*args, **kwargs):
        raise OperationalError("INSERT", {}, Exception("connection lost"))

    monkeypatch.setattr(slot_lookup, "record_lookup", boom)
    response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert response.status_code == 200 and len(response.json()) == 1
    monkeypatch.undo()
    # 之後的請求照常記（沒有被上一次的失敗卡住）。
    again = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert again.status_code == 200
    assert sum((await _lookups(db_session)).values()) == 1


@pytest.mark.asyncio
async def test_recording_and_rollback_both_failing_still_returns_the_slots(
    admin_client, public_client, db_session, monkeypatch
):
    """連線整個斷了：記錄失敗之後 rollback 自己也丟錯，家長照樣拿到場次（不是 500）。"""
    from sqlalchemy.exc import OperationalError, SQLAlchemyError
    from sqlalchemy.ext.asyncio import AsyncSession

    await create_slot(admin_client, days_ahead=5)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200

    async def boom(*args, **kwargs):
        raise OperationalError("INSERT", {}, Exception("connection lost"))

    async def dead_rollback(self, *args, **kwargs):
        raise SQLAlchemyError("connection already closed")

    # 只在這一次請求期間換掉 rollback；離開 context 就還原，後面的 fixture 收尾照常。
    with monkeypatch.context() as scoped:
        scoped.setattr(slot_lookup, "record_lookup", boom)
        scoped.setattr(AsyncSession, "rollback", dead_rollback)
        response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert response.status_code == 200 and len(response.json()) == 1
    assert await _lookups(db_session) == {}


@pytest.mark.asyncio
async def test_lookup_day_and_wait_come_from_the_routes_taipei_today(admin_client, public_client, db_session, monkeypatch):
    """記錄的日期與等待天數都取自路由的 today_local()（台北時間），不是 UTC 日期或 date.today()。"""
    from app.booking import routes as booking_routes

    created = await create_slot_record(admin_client, days_ahead=3)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    slot_date = date.fromisoformat(created["slot_date"])
    # 假裝台北今天是「場次日期 − 1 天」→ 最早場次離今天 1 天，記在 within_1，記錄日期是假的今天。
    fake_today = slot_date - timedelta(days=1)
    monkeypatch.setattr(booking_routes, "today_local", lambda *a, **k: fake_today)
    # 2026-10-20 稽核起只記從（路由的）今天查到開放範圍最後一天的查詢。
    response = await public_client.get(
        f"{API}/public/slots?campus_key=yihua&date_from={fake_today.isoformat()}"
        f"&date_to={(fake_today + timedelta(days=60)).isoformat()}&purpose=new_booking"
    )
    assert response.status_code == 200
    rows = await db_session.scalars(select(SlotLookupDaily))
    got = [(r.day, r.bucket) for r in rows.all()]
    assert got == [(fake_today, "within_1")]
