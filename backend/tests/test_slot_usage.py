"""場次使用情況：回推各時段填滿率與 API（2026-10-13 規格 §3、§4）。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest

from app.booking import slot_usage
from app.booking.models import SlotLookupDaily, VisitSlot
from app.common.timezones import today_local

from tests.conftest import legacy_request

API = "/api/website/v1"


@pytest.mark.parametrize(
    ("slot_count", "full_count", "fill_rate", "expected"),
    [
        (3, 3, 1.0, "too_few"),          # 不到 4 場：全額滿也不判斷
        (4, 2, 0.9, "often_full"),       # 剛好 4 場、剛好 50% 額滿
        (4, 1, 0.9, "normal"),           # 25% 額滿、填滿率高 → 不標
        (10, 4, 0.1, "rarely_booked"),
        (10, 0, 0.2, "rarely_booked"),   # 剛好 20%
        (10, 0, 0.21, "normal"),
        (10, 5, 0.1, "often_full"),      # 兩個條件都成立時常額滿優先
    ],
)
def test_signal_for_boundaries(slot_count, full_count, fill_rate, expected):
    assert slot_usage.signal_for(slot_count, full_count, fill_rate) == expected


async def _slot(db, *, day: date, start: time = time(10, 0), end: time = time(11, 0), capacity: int = 2,
                closed: bool = False, campus: str = "yihua") -> uuid.UUID:
    slot = VisitSlot(
        id=uuid.uuid4(), campus_key=campus, slot_date=day, start_time=start, end_time=end,
        capacity=capacity, closed=closed, created_at=datetime.now(timezone.utc),
    )
    db.add(slot)
    await db.commit()
    return slot.id


async def _book(db, slot_id, status: str, n: int = 1) -> None:
    for i in range(n):
        await legacy_request(db, status=status, slot_id=slot_id, phone=f"09100{uuid.uuid4().int % 100000:05d}")


def _monday_before(today: date, weeks_back: int) -> date:
    base = today - timedelta(weeks=weeks_back)
    return base - timedelta(days=base.weekday())


@pytest.mark.asyncio
async def test_booked_counts_confirmed_completed_no_show_but_not_cancelled(db_session):
    today = today_local()
    day = _monday_before(today, 2)
    slot_id = await _slot(db_session, day=day, capacity=5)
    await _book(db_session, slot_id, "confirmed")
    await _book(db_session, slot_id, "completed")
    await _book(db_session, slot_id, "no_show")
    await _book(db_session, slot_id, "cancelled", n=2)
    out = await slot_usage.slot_rows(db_session, "yihua", 4, today)
    [row] = out["rows"]
    assert (row["weekday"], row["slot_count"], row["capacity_total"], row["booked"], row["full_count"]) == (0, 1, 5, 3, 0)
    assert row["fill_rate"] == pytest.approx(0.6)


@pytest.mark.asyncio
async def test_closed_today_future_and_other_campus_slots_are_ignored(db_session):
    today = today_local()
    past = today - timedelta(days=3)
    await _slot(db_session, day=past, closed=True)
    await _slot(db_session, day=today)
    await _slot(db_session, day=today + timedelta(days=3))
    await _slot(db_session, day=past, campus="minghua")
    out = await slot_usage.slot_rows(db_session, "yihua", 4, today)
    assert out["rows"] == []
    assert out["date_to"] == today - timedelta(days=1)
    assert out["date_from"] == today - timedelta(weeks=4)


@pytest.mark.asyncio
async def test_group_key_includes_weekday_start_and_end_time(db_session):
    today = today_local()
    day = _monday_before(today, 1)
    await _slot(db_session, day=day, start=time(10, 0), end=time(11, 0))
    await _slot(db_session, day=day, start=time(10, 0), end=time(11, 30))   # 結束時間不同 → 另一列
    await _slot(db_session, day=day + timedelta(days=1), start=time(10, 0), end=time(11, 0))  # 星期二
    out = await slot_usage.slot_rows(db_session, "yihua", 4, today)
    keys = [(r["weekday"], r["start_time"], r["end_time"]) for r in out["rows"]]
    assert keys == [(0, time(10, 0), time(11, 0)), (0, time(10, 0), time(11, 30)), (1, time(10, 0), time(11, 0))]


@pytest.mark.asyncio
async def test_fill_rate_is_capped_at_100_percent_and_still_counts_as_full(db_session):
    today = today_local()
    day = _monday_before(today, 1)
    slot_id = await _slot(db_session, day=day, capacity=1)
    await _book(db_session, slot_id, "confirmed", n=3)   # 後來把容量調低到 1，已約仍是 3
    [row] = (await slot_usage.slot_rows(db_session, "yihua", 4, today))["rows"]
    assert row["fill_rate"] == 1.0 and row["full_count"] == 1 and row["booked"] == 3


@pytest.mark.asyncio
async def test_signals_over_a_real_group(db_session):
    today = today_local()
    full_slots = []
    for week in range(1, 5):   # 四個星期一，10:00，容量 1，全部額滿
        full_slots.append(await _slot(db_session, day=_monday_before(today, week), capacity=1))
    for slot_id in full_slots:
        await _book(db_session, slot_id, "confirmed")
    for week in range(1, 5):   # 四個星期二，14:00，容量 5，只有一場約 1 個
        sid = await _slot(db_session, day=_monday_before(today, week) + timedelta(days=1), start=time(14, 0), end=time(15, 0), capacity=5)
        if week == 1:
            await _book(db_session, sid, "completed")
    rows = {r["weekday"]: r for r in (await slot_usage.slot_rows(db_session, "yihua", 12, today))["rows"]}
    assert rows[0]["signal"] == "often_full" and rows[0]["slot_count"] == 4 and rows[0]["full_count"] == 4
    assert rows[1]["signal"] == "rarely_booked" and rows[1]["fill_rate"] == pytest.approx(0.05)


@pytest.mark.asyncio
async def test_taipei_date_boundary_uses_given_today(db_session):
    """today 由呼叫端用 today_local() 傳入；傳進去的「台北今天」之前的場次才算過去。"""
    today = date(2026, 10, 13)
    await _slot(db_session, day=date(2026, 10, 12))   # 台北昨天 → 算
    await _slot(db_session, day=date(2026, 10, 13))   # 台北今天 → 不算
    out = await slot_usage.slot_rows(db_session, "yihua", 4, today)
    assert [r["slot_count"] for r in out["rows"]] == [1]


URL = f"{API}/admin/visit-slot-usage"


@pytest.mark.asyncio
async def test_api_shape_for_super_admin(admin_client, db_session):
    today = today_local()
    slot_id = await _slot(db_session, day=_monday_before(today, 1), capacity=2)
    await _book(db_session, slot_id, "confirmed")
    db_session.add(SlotLookupDaily(day=today, campus_key="yihua", bucket="over_7", lookups=3))
    await db_session.commit()
    response = await admin_client.get(f"{URL}?campus_key=yihua&weeks=12")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"campus_key", "booking_mode", "today", "lookups", "slots"}
    assert body["campus_key"] == "yihua" and body["today"] == today.isoformat()
    assert [b["key"] for b in body["lookups"]["buckets"]] == ["within_1", "days_2_3", "days_4_7", "over_7", "none"]
    assert body["lookups"]["total"] == 3 and body["lookups"]["first_recorded_day"] == today.isoformat()
    assert body["slots"]["weeks"] == 12 and body["slots"]["thresholds"] == {"min_slots": 4, "often_full_share": 0.5, "rarely_booked_rate": 0.2}
    [row] = body["slots"]["rows"]
    assert row["start_time"] == "10:00:00" and row["booked"] == 1 and row["signal"] == "too_few"


@pytest.mark.asyncio
@pytest.mark.parametrize("weeks", ["0", "5", "52", "abc"])
async def test_api_rejects_unknown_weeks(admin_client, weeks):
    response = await admin_client.get(f"{URL}?campus_key=yihua&weeks={weeks}")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_api_rejects_control_characters_in_campus_key(admin_client):
    """網址上的 %00 不能一路送到 PostgreSQL（會被拒收成 500）；權限檢查過了之後回 422。"""
    response = await admin_client.get(f"{URL}?campus_key=yi%00hua&weeks=12")
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_api_requires_campus_key(admin_client):
    assert (await admin_client.get(f"{URL}?weeks=12")).status_code == 422


@pytest.mark.asyncio
async def test_api_campus_scope(minghua_client):
    assert (await minghua_client.get(f"{URL}?campus_key=minghua&weeks=4")).status_code == 200
    denied = await minghua_client.get(f"{URL}?campus_key=yihua&weeks=4")
    assert denied.status_code == 404   # 與接待月曆相同：範圍外的校區視為不存在


@pytest.mark.asyncio
async def test_api_requires_booking_read(editor_client):
    """內容編輯沒有 booking.read（見 permissions._CAPABILITY_ROLES），即使在自己的校區也是 403。"""
    assert (await editor_client.get(f"{URL}?campus_key=yihua&weeks=4")).status_code == 403


@pytest.mark.asyncio
async def test_api_requires_login(public_client):
    assert (await public_client.get(f"{URL}?campus_key=yihua&weeks=4")).status_code == 401


@pytest.mark.asyncio
async def test_api_reports_booking_mode(admin_client):
    from tests.conftest import set_booking_mode

    assert (await set_booking_mode(admin_client, mode="phone", phone="07-3928366")).status_code == 200
    body = (await admin_client.get(f"{URL}?campus_key=yihua&weeks=4")).json()
    assert body["booking_mode"] == "phone"
    assert body["lookups"]["first_recorded_day"] is None and body["slots"]["rows"] == []
