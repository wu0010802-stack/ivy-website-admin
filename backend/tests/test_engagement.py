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
    _visit(seq=0),
    _visit(seq=501),
    _visit(campaign="Spring Sale"),
    _visit(campaign="x" * 33),
    _visit(campaign="a:b"),
    _visit(rev=0),
    _visit(page="news", item="a/b"),
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
        "median_active_ms": 0, "median_session_ms": 0, "pages_per_session": None, "mobile_sessions": 0,
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
        _visit(session=reader, source="search", device="desktop", active_ms=12_000, scroll=40, sections={"hero": 9_000, "day": 2_000}),
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
        "median_active_ms": 30_000, "median_session_ms": 70_000, "pages_per_session": 2.33, "mobile_sessions": 2,
    }
    home = body["pages"][0]
    assert home == {"page": "home", "campus_key": None, "visits": 3, "previous_visits": 0, "median_active_ms": 12_000,
                    "bounce_rate": 0.3333, "median_scroll_pct": 40}
    assert {"page": "visit", "campus_key": "yihua", "visits": 1, "previous_visits": 0, "median_active_ms": 90_000,
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
        {"id": "garden", "title": None, "visits": 1, "previous_visits": 0, "median_active_ms": 50_000, "read_rate": 1.0},
        {"id": "garden-2", "title": None, "visits": 1, "previous_visits": 0, "median_active_ms": 8_000, "read_rate": 0.0},
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


@pytest.mark.asyncio
async def test_booking_form_steps_classes_and_campuses(admin_client, minghua_client, public_client, db_session):
    """第二輪：預約表單卡在哪一步、入學試算的班別、各校興趣對照實際預約。"""
    from app.operations.models import AnalyticsEvent, AnalyticsEventType
    from app.common.timezones import now_utc

    done, stuck, no_slots, chooser = (str(uuid.uuid4()) for _ in range(4))
    visits = [
        _visit(session=done, seq=1, actions={"campus_yihua": 2, "map_yihua": 1, "campus_renwu": 1}),
        _visit(session=done, seq=2, page="admission", actions={"class_small": 1, "class_big": 1}),
        _visit(session=done, seq=3, page="visit", campus="yihua",
               actions={"form_date": 1, "form_slot": 1, "form_contact": 1, "form_submit": 2, "form_invalid": 1, "booking_done": 1}),
        # 選了日期和場次就離開。
        _visit(session=stuck, seq=1, page="admission", actions={"class_small": 1}),
        _visit(session=stuck, seq=2, page="visit", campus="yihua", actions={"form_date": 1, "form_slot": 1}),
        # 進到仁武校預約頁，看到沒有場次。
        _visit(session=no_slots, seq=1, page="visit", campus="renwu", actions={"form_no_slots": 1}),
        # 只到選校那一步。
        _visit(session=chooser, seq=1, page="visit"),
        # 沒進預約頁的造訪不算進表單統計；別頁亂送的表單代碼也不算。
        _visit(actions={"form_submit": 1, "class_big": 1, "campus_taipei": 1}),
    ]
    for body in visits:
        assert (await public_client.post(URL, json=body)).status_code == 204
    db_session.add_all([
        AnalyticsEvent(event_type=AnalyticsEventType.REQUEST_CREATED, campus_key="yihua", created_at=now_utc()),
        AnalyticsEvent(event_type=AnalyticsEventType.REQUEST_CREATED, campus_key="yihua", created_at=now_utc()),
        AnalyticsEvent(event_type=AnalyticsEventType.REQUEST_CREATED, campus_key="minghua", created_at=now_utc()),
        AnalyticsEvent(event_type=AnalyticsEventType.VISIT_CANCELLED, campus_key="renwu", created_at=now_utc()),
    ])
    await db_session.commit()

    body = (await admin_client.get(f"{ADMIN_URL}?days=7")).json()
    form = body["booking_form"]
    assert (form["sessions"], form["no_slots_sessions"], form["invalid_sessions"]) == (4, 1, 1)
    assert [(step["key"], step["sessions"]) for step in form["steps"]] == [
        ("visit", 4), ("campus", 3), ("form_date", 2), ("form_slot", 2), ("form_contact", 1), ("form_submit", 1), ("booking_done", 1),
    ]
    assert form["steps"][1]["rate"] == 0.75

    assert body["classes"] == [
        {"key": "class_young", "visits": 0}, {"key": "class_toddler", "visits": 0}, {"key": "class_small", "visits": 2},
        {"key": "class_middle", "visits": 0}, {"key": "class_big", "visits": 1}, {"key": "class_school", "visits": 0},
    ]
    # 表單進度與試算班別有自己的統計，不列在互動表。
    assert not any(row["key"].startswith(("form_", "class_")) for row in body["actions"])

    campuses = {row["campus_key"]: row for row in body["campuses"]}
    assert campuses["yihua"] == {"campus_key": "yihua", "tab_visits": 1, "map_visits": 1, "visit_sessions": 2, "bookings": 2}
    assert campuses["renwu"] == {"campus_key": "renwu", "tab_visits": 1, "map_visits": 0, "visit_sessions": 1, "bookings": 0}
    assert campuses["minghua"]["bookings"] == 1
    assert list(campuses) == ["yihua", "minghua", "chongde", "international", "renwu"]

    # 校區帳號只看得到自己範圍內校區的實際預約數；瀏覽類的匿名統計照樣看得到。
    scoped = {row["campus_key"]: row for row in (await minghua_client.get(f"{ADMIN_URL}?days=7")).json()["campuses"]}
    assert scoped["yihua"]["bookings"] is None and scoped["yihua"]["visit_sessions"] == 2
    assert scoped["minghua"]["bookings"] in (1, None)


@pytest.mark.asyncio
async def test_journey_campaigns_device_and_trend(admin_client, public_client, db_session):
    """第二輪：進站頁／離開頁／瀏覽順序、活動代碼、只看手機或電腦、每日與上一期。"""
    a, b, c, legacy = (str(uuid.uuid4()) for _ in range(4))
    visits = [
        _visit(session=a, seq=1, source="facebook", campaign="open-day"),
        _visit(session=a, seq=2, source="facebook", campaign="open-day", page="admission"),
        _visit(session=a, seq=3, source="facebook", campaign="open-day", page="visit", campus="yihua", actions={"booking_done": 1}),
        _visit(session=b, seq=1, source="facebook", campaign="open-day"),
        _visit(session=b, seq=2, source="facebook", campaign="open-day", page="admission"),
        _visit(session=c, seq=1, source="line", campaign="line-oct", page="news", item="garden", device="desktop"),
        # 還開著舊版頁面的瀏覽器不帶順序與活動代碼：照樣算瀏覽，但不進順序統計。
        _visit(session=legacy, page="about", device="desktop"),
    ]
    for body in visits:
        assert (await public_client.post(URL, json=body)).status_code == 204
    # 上一期的資料：7 天期間的上一期是往前 7～13 天。
    old = _visit(page="about")
    await public_client.post(URL, json=old)
    await db_session.execute(
        text("UPDATE engagement_visits SET day = :day WHERE id = :id"),
        {"day": today_local() - timedelta(days=9), "id": old["id"]},
    )
    await db_session.commit()

    body = (await admin_client.get(f"{ADMIN_URL}?days=7")).json()
    journey = body["journey"]
    assert journey["sessions"] == 3
    assert journey["entries"] == [
        {"page": "home", "sessions": 2, "rate": 0.6667}, {"page": "news", "sessions": 1, "rate": 0.3333},
    ]
    assert journey["exits"] == [
        {"page": "admission", "sessions": 1, "rate": 0.3333}, {"page": "news", "sessions": 1, "rate": 0.3333},
        {"page": "visit", "sessions": 1, "rate": 0.3333},
    ]
    assert {"pages": ["home", "admission", "visit"], "sessions": 1, "rate": 0.3333} in journey["paths"]
    assert {"pages": ["home", "admission"], "sessions": 1, "rate": 0.3333} in journey["paths"]

    assert body["campaigns"] == [
        {"campaign": "open-day", "source": "facebook", "sessions": 2, "booked_sessions": 1, "booked_rate": 0.5},
        {"campaign": "line-oct", "source": "line", "sessions": 1, "booked_sessions": 0, "booked_rate": 0.0},
    ]

    assert len(body["daily"]) == 7
    assert body["daily"][-1] == {"day": today_local().isoformat(), "visits": 7, "sessions": 4}
    assert body["previous"] == {
        "visits": 1, "sessions": 1, "booked_sessions": 0, "booked_rate": 0.0, "median_session_ms": 20_000, "pages_per_session": 1.0,
    }
    about = next(row for row in body["pages"] if row["page"] == "about")
    assert (about["visits"], about["previous_visits"]) == (1, 1)
    assert body["totals"]["mobile_sessions"] == 2
    assert sum(row["visits"] for row in body["hours"]) == 7
    assert all(1 <= row["weekday"] <= 7 and 0 <= row["hour"] <= 23 for row in body["hours"])

    desktop = (await admin_client.get(f"{ADMIN_URL}?days=7&device=desktop")).json()
    assert desktop["device"] == "desktop"
    assert (desktop["totals"]["visits"], desktop["totals"]["sessions"]) == (2, 2)
    assert [row["page"] for row in desktop["pages"]] == ["about", "news"]
    assert desktop["campaigns"] == [{"campaign": "line-oct", "source": "line", "sessions": 1, "booked_sessions": 0, "booked_rate": 0.0}]
    assert (await admin_client.get(f"{ADMIN_URL}?days=7&device=tablet")).status_code == 422
    # 紀錄只留 90 天：選 90 天沒有完整的上一期。
    ninety = (await admin_client.get(f"{ADMIN_URL}?days=90")).json()
    assert ninety["previous"] is None and ninety["pages"][0]["previous_visits"] is None


@pytest.mark.asyncio
async def test_home_stories_resolve_titles_from_published_news(admin_client, public_client, db_session):
    from app.content import service as content_service
    from app.operations import engagement_service as service

    async def fake_content(db):
        return {"news": {"garden": "小小園丁"}, "event": {"visit": "秋季校園開放日"}, "film": {}}

    original = service._news_content
    service._news_content = fake_content
    try:
        await public_client.post(URL, json=_visit(actions={"sn_garden": 1, "se_visit": 1, "sn_forged": 1, "sf_x": 1}))
        await public_client.post(URL, json=_visit(actions={"sn_garden": 2}))
        # 別頁送來的不算首頁點開的消息。
        await public_client.post(URL, json=_visit(page="about", actions={"sn_garden": 1}))
        body = (await admin_client.get(f"{ADMIN_URL}?days=7")).json()
    finally:
        service._news_content = original
    assert body["stories"] == [
        {"kind": "news", "id": "garden", "title": "小小園丁", "visits": 2},
        {"kind": "event", "id": "visit", "title": "秋季校園開放日", "visits": 1},
    ]
    assert not any(row["key"].startswith(("sn_", "se_", "sf_")) for row in body["actions"])
    assert content_service is not None


@pytest.mark.asyncio
async def test_late_stale_report_does_not_overwrite_newer_maps(public_client, db_session):
    """#69 審查：回報不保證照順序到。帶序號的，晚到的舊回報不能把預約成功、讀到文末蓋掉。"""
    base = _visit(page="visit", campus="yihua")
    newer = {**base, "rev": 3, "active_ms": 50_000, "sections": {"form": 9_000}, "actions": {"form_submit": 1, "booking_done": 1}}
    older = {**base, "rev": 2, "active_ms": 60_000, "scroll": 90, "sections": {"form": 4_000}, "actions": {"form_submit": 1}}
    for body in (newer, older):
        assert (await public_client.post(URL, json=body)).status_code == 204
    row = (await db_session.execute(select(EngagementVisit))).scalar_one()
    # 停留與捲動照舊取大的；區塊與互動留序號新的那一筆。
    assert (row.active_ms, row.scroll_pct, row.rev) == (60_000, 90, 3)
    assert row.sections == {"form": 9_000}
    assert row.actions == {"form_submit": 1, "booking_done": 1}
    # 序號更新的照常蓋；沒帶序號的舊版頁面照舊以後到的為準。
    assert (await public_client.post(URL, json={**base, "rev": 4, "actions": {"form_submit": 2, "booking_done": 1}})).status_code == 204
    await db_session.refresh(row)
    assert (row.rev, row.actions) == (4, {"form_submit": 2, "booking_done": 1})
    assert (await public_client.post(URL, json={**base, "actions": {"form_date": 1}})).status_code == 204
    await db_session.refresh(row)
    assert (row.rev, row.actions) == (4, {"form_date": 1})


@pytest.mark.asyncio
async def test_campus_news_ids_are_counted_and_titled(admin_client, public_client):
    """#69 審查：各校消息的代號帶校區前綴（yihua:open-day），單篇消息與首頁分篇都要算得到、對得到標題。"""
    from app.operations import engagement_service as service

    async def fake_payload(db, kind, campus_key):
        if kind == "home_news":
            return {"articles": [{"id": "garden", "title": "小小園丁"}], "events": [], "films": []}
        if kind == "campus_news" and campus_key == "yihua":
            return {"articles": [{"id": "open-day", "title": "義華開放日"}], "events": [{"id": "fair", "title": "園遊會"}]}
        return None

    original = service.content_service.published_payload
    service.content_service.published_payload = fake_payload
    try:
        await public_client.post(URL, json=_visit(page="news", item="yihua:open-day", actions={"read_end": 1}))
        await public_client.post(URL, json=_visit(actions={"sn_yihua:open-day": 1, "se_yihua:fair": 1, "sn_minghua:open-day": 1}))
        body = (await admin_client.get(f"{ADMIN_URL}?days=7")).json()
    finally:
        service.content_service.published_payload = original
    assert body["news"] == [
        {"id": "yihua:open-day", "title": "義華開放日", "visits": 1, "previous_visits": 0, "median_active_ms": 20_000, "read_rate": 1.0},
    ]
    assert body["stories"] == [
        {"kind": "event", "id": "yihua:fair", "title": "園遊會", "visits": 1},
        {"kind": "news", "id": "yihua:open-day", "title": "義華開放日", "visits": 1},
    ]
