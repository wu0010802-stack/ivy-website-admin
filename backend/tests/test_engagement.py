"""內容興趣統計：公開寫入規則、同一次瀏覽的更新、保存期限與後台彙總。"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select, text

from app.common.timezones import today_local
from app.operations import engagement_service
from app.operations.models import ENGAGEMENT_RETENTION_DAYS, EngagementVisit

URL = "/api/website/v1/public/engagement"
ADMIN_URL = "/api/website/v1/admin/analytics/engagement"


def _visit(**overrides) -> dict:
    return {
        "event": "engagement", "id": str(uuid.uuid4()), "session": str(uuid.uuid4()), "page": "home",
        "campus": None, "device": "mobile", "source": "direct", "active_ms": 20_000, "scroll": 60,
        "sections": {}, "actions": {}, **overrides,
    }


@pytest.mark.asyncio
async def test_same_visit_keeps_latest_and_cannot_be_overwritten_by_another_session(public_client, db_session):
    first = _visit(active_ms=5_000, scroll=30, sections={"hero": 4_000})
    assert (await public_client.post(URL, json=first)).status_code == 204
    later = {**first, "active_ms": 42_000, "scroll": 80, "sections": {"hero": 6_000, "day": 30_000}, "actions": {"polaroid_morning": 2}}
    assert (await public_client.post(URL, json=later)).status_code == 204
    # 晚到的舊回報不能把數字改小；別的造訪拿同一個 id 也蓋不掉。
    assert (await public_client.post(URL, json={**later, "active_ms": 1_000, "scroll": 10})).status_code == 204
    assert (await public_client.post(URL, json={**later, "session": str(uuid.uuid4()), "active_ms": 900_000})).status_code == 204
    rows = (await db_session.execute(select(EngagementVisit))).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert (row.active_ms, row.scroll_pct, row.campus_key, row.item, row.day) == (42_000, 80, "", "", today_local())
    assert row.sections == {"hero": 6_000, "day": 30_000}
    assert row.actions == {"polaroid_morning": 2}


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [
    _visit(page="home", campus="yihua"),
    _visit(page="about", item="garden"),
    _visit(page="news", item="../etc"),
    _visit(source="https://example.com"),
    _visit(active_ms=-1),
    _visit(active_ms=1_800_001),
    _visit(scroll=101),
    _visit(sections={"Hero": 1000}),
    _visit(sections={"hero": -5}),
    _visit(sections={f"s{i}": 1 for i in range(25)}),
    _visit(actions={"faq": 0}),
    _visit(actions={"faq": 100}),
    _visit(session="not-a-uuid"),
    _visit(ip="1.2.3.4"),
    _visit(referrer="https://www.facebook.com/"),
])
async def test_rejects_malformed_or_extra_fields(public_client, body):
    assert (await public_client.post(URL, json=body)).status_code == 422


@pytest.mark.asyncio
async def test_old_visits_are_purged(public_client, db_session):
    await public_client.post(URL, json=_visit(active_ms=1_111))
    old_day = today_local() - timedelta(days=ENGAGEMENT_RETENTION_DAYS + 1)
    await db_session.execute(text("UPDATE engagement_visits SET day = :day"), {"day": old_day})
    await db_session.commit()
    engagement_service._last_purge = None
    await public_client.post(URL, json=_visit(active_ms=2_222))
    assert (await db_session.execute(select(EngagementVisit.active_ms))).scalars().all() == [2_222]


@pytest.mark.asyncio
async def test_admin_summary(admin_client, minghua_client, public_client):
    empty = (await admin_client.get(f"{ADMIN_URL}?days=7")).json()
    assert empty["totals"] == {
        "visits": 0, "sessions": 0, "booked_sessions": 0, "booked_rate": None,
        "median_active_ms": 0, "median_session_ms": 0, "pages_per_session": None,
    }
    assert empty["pages"] == empty["sections"] == empty["conversion"] == []

    booker, reader, bouncer = (str(uuid.uuid4()) for _ in range(3))
    visits = [
        # 從 Facebook 來、看了孩子的一天、最後送出預約的造訪。
        _visit(session=booker, source="facebook", active_ms=60_000, scroll=90,
               sections={"hero": 5_000, "day": 40_000}, actions={"polaroid_morning": 2, "polaroid_lunch": 1}),
        _visit(session=booker, source="facebook", page="admission", active_ms=30_000, scroll=70,
               sections={"faq": 20_000}, actions={"faq_fee": 1}),
        _visit(session=booker, source="facebook", page="visit", campus="yihua", active_ms=90_000, scroll=100,
               actions={"booking_done": 1}),
        # 只看消息、沒有預約的造訪；一篇讀完、一篇沒讀完。
        _visit(session=reader, source="search", page="news", item="garden", device="desktop", active_ms=50_000,
               scroll=100, actions={"read_end": 1}),
        _visit(session=reader, source="search", page="news", item="garden-2", device="desktop", active_ms=8_000, scroll=20),
        _visit(session=reader, source="search", active_ms=12_000, scroll=40, sections={"hero": 9_000, "day": 2_000}),
        # 進首頁 3 秒就走。
        _visit(session=bouncer, active_ms=3_000, scroll=10, sections={"hero": 500}),
    ]
    for body in visits:
        assert (await public_client.post(URL, json=body)).status_code == 204

    response = await minghua_client.get(f"{ADMIN_URL}?days=7")
    assert response.status_code == 200
    body = response.json()
    assert body["totals"] == {
        "visits": 7, "sessions": 3, "booked_sessions": 1, "booked_rate": 0.3333,
        "median_active_ms": 30_000, "median_session_ms": 70_000, "pages_per_session": 2.33,
    }
    home = body["pages"][0]
    assert home == {"page": "home", "campus_key": None, "visits": 3, "median_active_ms": 12_000,
                    "bounce_rate": 0.3333, "median_scroll_pct": 40}
    assert {"page": "visit", "campus_key": "yihua", "visits": 1, "median_active_ms": 90_000,
            "bounce_rate": 0.0, "median_scroll_pct": 100} in body["pages"]

    sections = {(row["page"], row["key"]): row for row in body["sections"]}
    # 首頁 3 次瀏覽：hero 兩次停滿 1 秒（0.5 秒那次不算），孩子的一天兩次。
    assert sections[("home", "hero")] == {"page": "home", "key": "hero", "reached": 2, "visits": 3, "reach_rate": 0.6667, "median_ms": 7_000}
    assert sections[("home", "day")]["median_ms"] == 21_000
    assert sections[("admission", "faq")]["reach_rate"] == 1.0

    actions = {(row["page"], row["key"]): row for row in body["actions"]}
    assert actions[("home", "polaroid_morning")] == {"page": "home", "key": "polaroid_morning", "visits": 1, "total": 2}
    # 預約成功與讀完是內部標記，不列在互動表。
    assert not any(key in ("booking_done", "read_end") for _, key in actions)

    assert body["news"] == [
        {"id": "garden", "title": None, "visits": 1, "median_active_ms": 50_000, "read_rate": 1.0},
        {"id": "garden-2", "title": None, "visits": 1, "median_active_ms": 8_000, "read_rate": 0.0},
    ]
    assert body["sources"] == [
        {"source": "direct", "sessions": 1, "booked_sessions": 0, "booked_rate": 0.0},
        {"source": "facebook", "sessions": 1, "booked_sessions": 1, "booked_rate": 1.0},
        {"source": "search", "sessions": 1, "booked_sessions": 0, "booked_rate": 0.0},
    ]

    conversion = {(row["kind"], row["page"], row["key"]): row for row in body["conversion"]}
    assert conversion[("page", "home", None)] == {"kind": "page", "page": "home", "key": None, "sessions": 3, "booked_sessions": 1, "booked_rate": 0.3333}
    # 孩子的一天要停滿 3 秒才算看過：只有送出預約的那個造訪。
    assert conversion[("section", "home", "day")]["sessions"] == 1
    assert conversion[("section", "home", "day")]["booked_rate"] == 1.0
    assert conversion[("page", "news", None)]["booked_rate"] == 0.0
    assert not any(page == "visit" for _, page, _ in conversion)

    assert (await admin_client.get(f"{ADMIN_URL}?days=3")).status_code == 422
    assert (await public_client.get(ADMIN_URL)).status_code == 401
