"""成效統計每日趨勢（招生分析階段 1 第 2、8 項）：事件依台北日期分天、沒事件的日子
補 0、開站至今從第一筆事件起最多 400 天、越權校區 404；funnel 與 traffic 帶更新時間。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

import pytest

from app.common.timezones import today_local
from app.operations.models import AnalyticsEvent, AnalyticsEventType
from tests.analytics_fixtures import taipei

BASE = "/api/website/v1/admin/analytics"
ZERO = {"request_created": 0, "visit_completed": 0, "visit_cancelled": 0, "clicks": 0}


def _event(db, event_type: AnalyticsEventType, at: datetime, campus_key: str = "yihua") -> None:
    db.add(AnalyticsEvent(id=uuid.uuid4(), event_type=event_type, campus_key=campus_key, created_at=at))


async def _trend(client, query: str) -> dict:
    response = await client.get(f"{BASE}/event-trend?campus_key=yihua{query}")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_days_are_taipei_dates_and_zero_filled(admin_client, db_session):
    _event(db_session, AnalyticsEventType.REQUEST_CREATED, taipei(date(2026, 9, 30), 23, 59))
    _event(db_session, AnalyticsEventType.REQUEST_CREATED, taipei(date(2026, 10, 1), 0, 0))
    _event(db_session, AnalyticsEventType.BOOKING_CTA_CLICKED, taipei(date(2026, 10, 1), 9))
    _event(db_session, AnalyticsEventType.CTA_CLICK_LINE, taipei(date(2026, 10, 1), 10))
    _event(db_session, AnalyticsEventType.VISIT_CONFIRMED, taipei(date(2026, 10, 1), 10))  # 不在趨勢裡
    _event(db_session, AnalyticsEventType.VISIT_CANCELLED, taipei(date(2026, 10, 3), 10))
    _event(db_session, AnalyticsEventType.REQUEST_CREATED, taipei(date(2026, 10, 1), 11), campus_key="minghua")
    await db_session.commit()

    body = await _trend(admin_client, "&from=2026-09-30&to=2026-10-03")
    assert body["unit"] == "event" and body["truncated"] is False
    assert [day["day"] for day in body["days"]] == ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]
    assert body["days"][0] == {"day": "2026-09-30", **ZERO, "request_created": 1}
    assert body["days"][1] == {"day": "2026-10-01", **ZERO, "request_created": 1, "clicks": 2}
    assert body["days"][2] == {"day": "2026-10-02", **ZERO}
    assert body["days"][3] == {"day": "2026-10-03", **ZERO, "visit_cancelled": 1}


@pytest.mark.asyncio
async def test_open_start_begins_at_first_event_and_caps_at_400_days(admin_client, db_session):
    today = today_local()
    _event(db_session, AnalyticsEventType.REQUEST_CREATED, taipei(today - timedelta(days=10)))
    await db_session.commit()
    body = await _trend(admin_client, "")
    assert body["date_from"] == (today - timedelta(days=10)).isoformat()
    assert body["date_to"] == today.isoformat()
    assert len(body["days"]) == 11

    _event(db_session, AnalyticsEventType.REQUEST_CREATED, taipei(today - timedelta(days=500)))
    await db_session.commit()
    capped = await _trend(admin_client, "")
    assert capped["truncated"] is True
    assert len(capped["days"]) == 400
    assert capped["date_from"] == (today - timedelta(days=399)).isoformat()


@pytest.mark.asyncio
async def test_no_events_gives_one_zero_day(admin_client):
    body = await _trend(admin_client, "")
    assert body["days"] == [{"day": today_local().isoformat(), **ZERO}]


@pytest.mark.asyncio
async def test_other_campus_is_hidden(minghua_client):
    response = await minghua_client.get(f"{BASE}/event-trend?campus_key=yihua")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_funnel_and_traffic_report_as_of(admin_client):
    funnel = await admin_client.get(f"{BASE}/funnel?campus_key=yihua")
    traffic = await admin_client.get(f"{BASE}/traffic?days=7")
    for response in (funnel, traffic):
        assert response.status_code == 200, response.text
        datetime.fromisoformat(response.json()["as_of"].replace("Z", "+00:00"))
