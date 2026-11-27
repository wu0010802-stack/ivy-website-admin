"""成效統計補強（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md）：每月彙總、健康檢查、404、爬蟲、
電話與 LINE 的點擊時段、AI 助理來源。"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, time, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select, update

from app.booking.models import VisitRequest
from app.common.timezones import OPERATING_TZ, today_local
from app.insights.ga4_ads import Ga4Ads
from app.notifications.line import LineMessagingClient
from app.notifications.models import LineGroupSetting
from app.operations import crawler_service, monthly_service, stats_health
from app.operations.models import (
    NOT_FOUND_DAILY_PATHS,
    AnalyticsEvent,
    AnalyticsEventType,
    CrawlerHitDaily,
    EngagementMonthly,
    EngagementVisit,
    NotFoundDaily,
    PageViewDaily,
    StatsHealthRun,
)
from tests.conftest import book_slot
from tests.test_line_notifications import (  # noqa: F401  (fixtures)
    GROUP,
    OTHER_GROUP,
    TOKEN,
    FakeLine,
    _event,
    _webhook,
    fake_line,
    line_app,
)

BASE = "/api/website/v1"


def _visit_row(day: date, *, session: uuid.UUID | None = None, page: str = "home", source: str = "direct",
               device: str = "mobile", actions: dict | None = None, active_ms: int = 20_000, campus_key: str = "",
               returning: bool | None = None) -> EngagementVisit:
    return EngagementVisit(
        id=uuid.uuid4(), session_id=session or uuid.uuid4(), day=day, page=page, campus_key=campus_key, item="",
        device=device, source=source, active_ms=active_ms, scroll_pct=50, sections={}, actions=actions or {},
        updated_at=datetime.combine(day, time(12), tzinfo=OPERATING_TZ), returning=returning,
    )


async def _views(db, day: date, views: int) -> None:
    db.add(PageViewDaily(day=day, page="home", campus_key="", device="mobile", views=views))


# ---------------------------------------------------------------------------------------------- 每月彙總

def test_months_to_rollup_skips_purged_and_unfinished_days():
    today = date(2027, 3, 15)
    # 90 天前是 2026-12-15：12 月的月初已經被清，不再重算；1、2 月整月、3 月到昨天。
    assert monthly_service.months_to_rollup(today, None, date(2026, 11, 20)) == [
        (date(2027, 1, 1), date(2027, 1, 1), date(2027, 1, 31)),
        (date(2027, 2, 1), date(2027, 2, 1), date(2027, 2, 28)),
        (date(2027, 3, 1), date(2027, 3, 1), date(2027, 3, 14)),
    ]
    # 起算日在月中：那個月從起算日算起。
    assert monthly_service.months_to_rollup(date(2026, 11, 21), date(2026, 11, 13), date(2026, 10, 24)) == [
        (date(2026, 11, 1), date(2026, 11, 13), date(2026, 11, 20)),
    ]
    # 月初第一天：本月還沒有過完的一天，只重算上個月。
    assert monthly_service.months_to_rollup(date(2026, 12, 1), date(2026, 11, 13), date(2026, 11, 13)) == [
        (date(2026, 11, 1), date(2026, 11, 13), date(2026, 11, 30)),
    ]
    assert monthly_service.months_to_rollup(today, None, None) == []


@pytest.mark.asyncio
async def test_rollup_and_monthly_summary(admin_client, minghua_client, public_client, db_session):
    today = today_local()
    last_month_day = today.replace(day=1) - timedelta(days=3)
    booked_session = uuid.uuid4()
    db_session.add_all([
        _visit_row(last_month_day, source="search", returning=False),
        _visit_row(last_month_day, source="ai", device="desktop", returning=True),
        _visit_row(last_month_day, session=booked_session, page="visit", campus_key="yihua", source="ai",
                   actions={"form_date": 1, "booking_done": 1}),
        _visit_row(last_month_day, session=booked_session, page="about", source="ai"),
    ])
    if today.day > 1:
        db_session.add(_visit_row(today - timedelta(days=1), source="facebook"))
    db_session.add(_visit_row(today, source="line"))  # 今天還沒過完，不算
    await _views(db_session, last_month_day, 40)
    await db_session.commit()

    count = await monthly_service.rollup(db_session, None, today)
    await db_session.commit()
    assert count == (2 if today.day > 1 else 1)
    month = last_month_day.replace(day=1)
    rows = {(row.kind, row.key): row for row in (await db_session.execute(
        select(EngagementMonthly).where(EngagementMonthly.month == month)
    )).scalars()}
    total = rows[("total", "")]
    assert (total.sessions, total.visits, total.booked_sessions) == (3, 4, 1)
    # 從有紀錄的第一天算到月底。
    assert (total.first_day, total.last_day) == (last_month_day, today.replace(day=1) - timedelta(days=1))
    assert rows[("source", "ai")].sessions == 2 and rows[("source", "ai")].booked_sessions == 1
    assert rows[("device", "desktop")].sessions == 1
    assert rows[("returning", "new")].sessions == 1 and rows[("returning", "returning")].sessions == 1
    assert rows[("page", "home")].visits == 2
    assert rows[("form", "visit")].sessions == 1 and rows[("form", "booking_done")].sessions == 1

    # 重算同一個月不會疊加。
    await monthly_service.rollup(db_session, None, today)
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(EngagementMonthly).where(
        EngagementMonthly.month == month, EngagementMonthly.kind == "total")) == 1

    # 官網預約：只有招生統計權限的帳號看得到數字。
    admin = (await admin_client.get(f"{BASE}/admin/analytics/monthly")).json()
    months = {item["month"]: item for item in admin["months"]}
    item = months[month.isoformat()[:7]]
    assert item["page_views"] == 40 and item["sessions"] == 3 and item["complete"] is True
    assert item["bookings"] == 0
    assert [row["key"] for row in item["form"]][:2] == ["visit", "campus"]
    assert {row["key"] for row in item["sources"]} == {"ai", "search"}
    other = (await minghua_client.get(f"{BASE}/admin/analytics/monthly")).json()
    assert {item["month"]: item for item in other["months"]}[month.isoformat()[:7]]["bookings"] is None


@pytest.mark.asyncio
async def test_monthly_bookings_follow_case_month_and_exclusions(admin_client, public_client, db_session):
    first = await book_slot(admin_client, public_client, "yihua", idempotency_key="m1", phone="0912000001")
    await book_slot(admin_client, public_client, "yihua", idempotency_key="m2", phone="0912000002", start_time="12:00:00", end_time="12:30:00")
    # 一筆搬到上個月（台北時間），另一筆標成測試：本月 0、上個月 1。
    last_month = datetime.combine(today_local().replace(day=1) - timedelta(days=2), time(23, 30), tzinfo=OPERATING_TZ)
    await db_session.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(first["receipt_id"])).values(created_at=last_month))
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id != uuid.UUID(first["receipt_id"]))
        .values(excluded_at=datetime.now(timezone.utc), exclude_reason="test")
    )
    await db_session.commit()
    body = (await admin_client.get(f"{BASE}/admin/analytics/monthly")).json()
    months = {item["month"]: item for item in body["months"]}
    assert months[last_month.date().isoformat()[:7]]["bookings"] == 1
    assert today_local().isoformat()[:7] not in months or months[today_local().isoformat()[:7]]["bookings"] == 0


# ---------------------------------------------------------------------------------------------- 404 與爬蟲

@pytest.mark.asyncio
async def test_not_found_from_visitors_and_crawlers(admin_client, public_client, db_session):
    url = f"{BASE}/public/not-found"
    for body in (
        {"event": "not_found", "path": "/Blank-1/", "ref": "search"},
        {"event": "not_found", "path": "/blank-1", "ref": "search"},
        {"event": "not_found", "path": "/blank-1", "ref": "none"},
        {"event": "not_found", "path": "/copy-of-about", "ref": "internal"},
    ):
        assert (await public_client.post(url, json=body)).status_code == 204
    for bad in (
        {"event": "not_found", "path": "blank", "ref": "none"},
        {"event": "not_found", "path": "/a?b=1", "ref": "none"},
        {"event": "not_found", "path": "/a", "ref": "crawler"},
        {"event": "not_found", "path": "/" + "a" * 200, "ref": "none"},
        {"event": "not_found", "path": "/a", "ref": "none", "extra": 1},
    ):
        assert (await public_client.post(url, json=bad)).status_code == 422, bad
    batch = {
        "hits": [
            {"bot": "googlebot", "page": "home", "status": "2xx", "hits": 5},
            {"bot": "googlebot", "page": "other", "status": "4xx", "hits": 2},
            {"bot": "gptbot", "page": "llms", "status": "2xx", "hits": 1},
            {"bot": "chatgpt-user", "page": "about", "status": "2xx", "hits": 3},
            {"bot": "made-up-bot", "page": "home", "status": "2xx", "hits": 9},
        ],
        "not_found": [{"path": "/blank-1", "hits": 2}],
    }
    assert (await public_client.post(f"{BASE}/public/crawler-hits", json=batch)).status_code == 204
    assert (await public_client.post(f"{BASE}/public/crawler-hits", json=batch)).status_code == 204

    body = (await admin_client.get(f"{BASE}/admin/analytics/not-found?days=7")).json()
    assert body["paths_total"] == 2
    first = body["paths"][0]
    assert first["path"] == "/blank-1" and first["hits"] == 7 and first["visitor_hits"] == 3
    assert {row["ref"]: row["hits"] for row in first["refs"]} == {"search": 2, "none": 1, "crawler": 4}
    assert {row["ref"]: row["hits"] for row in body["totals"]}["internal"] == 1

    crawlers = (await admin_client.get(f"{BASE}/admin/analytics/crawlers?days=7")).json()
    assert crawlers["hits"] == 22
    assert [group["group"] for group in crawlers["groups"]] == ["ai_user", "ai_train", "search"]
    google = crawlers["groups"][2]["bots"][0]
    assert (google["bot"], google["hits"], google["errors"]) == ("googlebot", 14, 4)
    assert await db_session.scalar(select(func.count()).select_from(CrawlerHitDaily).where(CrawlerHitDaily.bot == "made-up-bot")) == 0
    assert (await admin_client.get(f"{BASE}/admin/analytics/crawlers?days=3")).status_code == 422


@pytest.mark.asyncio
async def test_not_found_caps_distinct_paths_and_purges_old_days(db_session):
    today = today_local()
    old = today - timedelta(days=91)
    db_session.add(NotFoundDaily(day=old, path="/old", ref="none", hits=1))
    await db_session.commit()
    rows = [(f"/p{i}", "none", 1) for i in range(NOT_FOUND_DAILY_PATHS + 5)]
    await crawler_service.record_not_found(db_session, rows, today)
    await crawler_service.record_not_found(db_session, [("/p0", "none", 1), ("/new-after-cap", "none", 1)], today)
    await db_session.commit()
    assert await db_session.scalar(select(func.count(func.distinct(NotFoundDaily.path))).where(NotFoundDaily.day == today)) == NOT_FOUND_DAILY_PATHS
    assert await db_session.scalar(select(NotFoundDaily.hits).where(NotFoundDaily.path == "/p0")) == 2
    assert await db_session.scalar(select(func.count()).select_from(NotFoundDaily).where(NotFoundDaily.day == old)) == 0


def test_clean_path():
    assert crawler_service.clean_path("/Blank-1/?a=1#x") == "/blank-1"
    assert crawler_service.clean_path("/") == "/"
    assert crawler_service.clean_path("blank") is None
    assert crawler_service.clean_path("/a\x00b") is None


# ---------------------------------------------------------------------------------------------- 電話與 LINE 的時段

@pytest.mark.asyncio
async def test_contact_hours_split_office_and_evening(admin_client, db_session):
    today = today_local()
    monday = today - timedelta(days=today.weekday() + 7)

    def click(kind: AnalyticsEventType, day: date, hour: int, campus: str | None = "yihua") -> AnalyticsEvent:
        return AnalyticsEvent(event_type=kind, campus_key=campus, created_at=datetime.combine(day, time(hour, 15), tzinfo=OPERATING_TZ))

    db_session.add_all([
        click(AnalyticsEventType.CTA_CLICK_PHONE, monday, 9),
        click(AnalyticsEventType.CTA_CLICK_PHONE, monday, 21),
        click(AnalyticsEventType.CTA_CLICK_LINE, monday, 21, "minghua"),
        click(AnalyticsEventType.CTA_CLICK_LINE, monday + timedelta(days=5), 10),  # 星期六不算上班時間
        click(AnalyticsEventType.BOOKING_CTA_CLICKED, monday, 9),  # 不是聯絡按鈕
    ])
    await db_session.commit()
    body = (await admin_client.get(f"{BASE}/admin/analytics/contact-hours?days=28")).json()
    assert (body["clicks"], body["office"]) == (4, 1)
    assert {row["channel"]: (row["clicks"], row["office"]) for row in body["channels"]} == {"phone": (2, 1), "line": (2, 0)}
    assert {(cell["weekday"], cell["hour"]): (cell["phone"], cell["line"]) for cell in body["cells"]} == {
        (1, 9): (1, 0), (1, 21): (1, 1), (6, 10): (0, 1),
    }
    assert body["campuses"][0]["campus_key"] == "yihua" and body["campuses"][0]["clicks"] == 3
    assert body["office_hours"] == {"weekdays": [1, 5], "hours": [8, 18]}


# ---------------------------------------------------------------------------------------------- 健康檢查

class _FakeGa4(Ga4Ads):
    def __init__(self, events: int | Exception):
        super().__init__()
        self.events = events
        self.asked: list[date] = []

    def configured(self, settings) -> bool:
        return True

    async def event_count(self, settings, day, transport=None) -> int:
        self.asked.append(day)
        if isinstance(self.events, Exception):
            raise self.events
        return self.events


@pytest.mark.asyncio
async def test_health_checks(app, db_session):
    settings = app.state.settings
    today = today_local()
    yesterday = today - timedelta(days=1)
    for back in range(2, 9):
        await _views(db_session, today - timedelta(days=back), 30)
    await _views(db_session, yesterday, 30)
    db_session.add_all([_visit_row(yesterday) for _ in range(3)])
    await db_session.commit()

    day, issues = await stats_health.check(db_session, settings, today=today, ga4=_FakeGa4(0))
    assert day == yesterday
    assert [issue.key for issue in issues] == ["engagement_low", "ga4_silent"]
    assert "30 次瀏覽" in issues[0].message and "只記到 3 次" in issues[0].message

    # 內容興趣正常、GA4 有事件、讀不到 GA4 都不報。
    db_session.add_all([_visit_row(yesterday) for _ in range(27)])
    await db_session.commit()
    assert (await stats_health.check(db_session, settings, today=today, ga4=_FakeGa4(120)))[1] == []
    assert (await stats_health.check(db_session, settings, today=today, ga4=_FakeGa4(httpx.ConnectError("x"))))[1] == []

    # 昨天歸零。
    await db_session.execute(update(PageViewDaily).where(PageViewDaily.day == yesterday).values(views=0))
    await db_session.commit()
    keys = [issue.key for issue in (await stats_health.check(db_session, settings, today=today, ga4=_FakeGa4(5)))[1]]
    assert keys == ["traffic_zero"]

    # 起算日還沒到昨天：不查。
    later = settings.model_copy(update={"analytics_stats_start": today})
    assert (await stats_health.check(db_session, later, today=today, ga4=_FakeGa4(0)))[1] == []


@pytest.mark.asyncio
async def test_health_attribution_missing(app, admin_client, public_client, db_session):
    for i in range(3):
        await book_slot(admin_client, public_client, "yihua", idempotency_key=f"h{i}", phone=f"091200010{i}",
                        start_time=f"{9 + i:02d}:00:00", end_time=f"{9 + i:02d}:30:00")
    await db_session.execute(update(VisitRequest).values(created_at=datetime.now(timezone.utc) - timedelta(days=1)))
    await db_session.commit()
    _, issues = await stats_health.check(db_session, app.state.settings, ga4=_FakeGa4(0))
    assert [issue.key for issue in issues] == ["attribution_missing"]
    await db_session.execute(update(VisitRequest).values(first_touch_source="ai"))
    await db_session.commit()
    assert (await stats_health.check(db_session, app.state.settings, ga4=_FakeGa4(0)))[1] == []


@pytest.mark.asyncio
async def test_health_endpoint(admin_client):
    body = (await admin_client.get(f"{BASE}/admin/analytics/health")).json()
    assert body["day"] == (today_local() - timedelta(days=1)).isoformat() and body["issues"] == []


@pytest.mark.asyncio
async def test_health_alert_goes_to_hq_groups_that_opted_in_once_a_day(line_app, fake_line):
    await _webhook(line_app, [_event("join", GROUP), _event("join", OTHER_GROUP)])
    today = today_local()
    yesterday = today - timedelta(days=1)
    async with line_app.state.session_factory() as db:
        now = datetime.now(timezone.utc)
        # 總部群組開了統計異常；另一個總部群組沒開（GROUP 改成總部但不開）。
        await db.merge(LineGroupSetting(target_id=OTHER_GROUP, is_hq=True, kinds=["visit_request_created", "stats_health"], updated_at=now))
        await db.merge(LineGroupSetting(target_id=GROUP, is_hq=True, kinds=["visit_request_created"], updated_at=now))
        await _views(db, yesterday, 50)
        await db.commit()

    async def run(hour: int) -> int:
        line = LineMessagingClient(TOKEN, transport=fake_line.transport())
        try:
            async with line_app.state.session_factory() as db:
                return await stats_health.send_due_alerts(
                    db, line_app.state.settings, line_client=line,
                    now=datetime.combine(today, time(hour), tzinfo=OPERATING_TZ), ga4=_FakeGa4(10),
                )
        finally:
            await line.aclose()

    assert await run(8) == 0
    assert await run(9) == 1
    assert await run(10) == 0
    assert len(fake_line.pushes) == 1
    push = fake_line.pushes[0]["body"]
    assert push["to"] == OTHER_GROUP
    # 2026-11-27 起是卡片（「知道了」與「開成效統計」兩顆按鈕，tests/test_line_card_buttons_20261127.py）。
    message = push["messages"][0]
    assert message["type"] == "flex"
    assert message["altText"].startswith(f"官網統計可能有狀況（{yesterday.month}/{yesterday.day}")
    assert "內容興趣只記到 0 次" in json.dumps(message["contents"], ensure_ascii=False)
    async with line_app.state.session_factory() as db:
        assert (await db.execute(select(StatsHealthRun.target_id))).scalars().all() == [OTHER_GROUP]


# ---------------------------------------------------------------------------------------------- AI 助理來源

@pytest.mark.asyncio
async def test_engagement_accepts_ai_source(public_client, db_session):
    body = {
        "event": "engagement", "id": str(uuid.uuid4()), "session": str(uuid.uuid4()), "page": "home", "campus": None,
        "device": "mobile", "source": "ai", "active_ms": 1000, "scroll": 10, "sections": {}, "actions": {},
    }
    assert (await public_client.post(f"{BASE}/public/engagement", json=body)).status_code == 204
    assert await db_session.scalar(select(EngagementVisit.source)) == "ai"
    assert json.dumps(body)  # 只是確認可序列化
