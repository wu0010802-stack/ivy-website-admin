"""前台 cookie 帶來的後台統計補齊（2026-11-19，docs/specs/2026-11-19-cookie-stats-design.md）：
同一瀏覽器的匿名代號與跨次統計、記住的校區、網站來源的天數／組合／自填對照、廣告助攻、
回傳廣告平台的狀態、這台裝置記住預約的使用次數。"""
from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.ad_conversions.models import AdConversionJob
from app.admissions import ad_roi
from app.booking.models import VisitRememberedDaily, VisitRequest
from app.common.timezones import today_local
from app.operations import booking_outcomes_service, engagement_service
from app.operations.models import EngagementVisit
from tests.analytics_fixtures import add_case, taipei
from tests.conftest import book_slot

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
ENGAGEMENT = f"{API}/public/engagement"
SUMMARY = f"{API}/admin/analytics/engagement"
ATTRIBUTION = f"{API}/admin/analytics/booking-attribution"
REMEMBERED = f"{API}/public/visit-remembered"
BROWSER_A = "AAAAAAAAAAAAAAAAAAAAAA"
BROWSER_B = "BBBBBBBBBBBBBBBBBBBBBB"


def _visit(**overrides) -> dict:
    return {
        "event": "engagement", "id": str(uuid.uuid4()), "session": str(uuid.uuid4()), "page": "home",
        "campus": None, "device": "mobile", "source": "direct", "active_ms": 20_000, "scroll": 60,
        "sections": {}, "actions": {}, **overrides,
    }


# ── 純函式 ─────────────────────────────────────────────────────────────────────


def test_browser_key_is_hmac_of_the_cookie_id():
    key = engagement_service.browser_key("secret", BROWSER_A)
    assert key == hmac.new(b"secret", BROWSER_A.encode(), hashlib.sha256).hexdigest()[:32]
    assert len(key) == 32 and key != engagement_service.browser_key("other-secret", BROWSER_A)
    assert engagement_service.browser_key("secret", None) is None


@pytest.mark.parametrize(("days", "bucket"), [
    (None, "unrecorded"), (-1, "unrecorded"), (0, "same_day"), (3, "days_1_3"), (7, "days_4_7"),
    (8, "days_8_30"), (30, "days_8_30"), (31, "days_31_plus"), (89, "days_31_plus"),
])
def test_delay_buckets(days, bucket):
    assert booking_outcomes_service._delay_bucket(days) == bucket


def test_median_days():
    assert booking_outcomes_service._median_days([]) is None
    assert booking_outcomes_service._median_days([5, 1, 3]) == 3.0
    assert booking_outcomes_service._median_days([1, 2, 3, 10]) == 2.5


def test_compute_ad_roi_counts_assists_without_moving_cases_or_cost():
    buckets = [
        # 最後一次是搜尋（非廣告），第一次是 Google 廣告：歸 organic，Google 記一次助攻。
        ad_roi.CaseBucket("organic", "yihua", "completed", True, False, 2, "2026-11", other_platform="google"),
        # 兩次都是 Google：不算助攻。
        ad_roi.CaseBucket("google", "yihua", "completed", False, False, 1, "2026-11", other_platform="google"),
        # 另一次是沒認出平台的廣告：記在 unknown。
        ad_roi.CaseBucket("meta", "yihua", "upcoming", False, False, 1, "2026-11", other_platform="mystery"),
    ]
    result = ad_roi.compute_ad_roi(["2026-11"], buckets, [], ad_roi.GoogleState(configured=False))
    rows = {row["key"]: row for row in result["rows"]}
    assert (rows["google"]["cases"], rows["google"]["assist_cases"], rows["google"]["assist_completed"], rows["google"]["assist_deposited"]) == (1, 2, 2, 2)
    assert rows["organic"]["cases"] == 2 and rows["organic"]["assist_cases"] == 0
    assert rows["unknown"]["cases"] == 0 and rows["unknown"]["assist_cases"] == 1
    assert rows["meta"]["assist_cases"] == 0


# ── 匿名代號與記住的校區寫進內容興趣紀錄 ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_engagement_stores_hmac_browser_key_and_campus_pref(app, public_client, db_session):
    assert (await public_client.post(ENGAGEMENT, json=_visit(browser=BROWSER_A, pref="minghua"))).status_code == 204
    assert (await public_client.post(ENGAGEMENT, json=_visit())).status_code == 204
    rows = sorted((await db_session.execute(select(EngagementVisit))).scalars().all(), key=lambda row: row.browser_key or "")
    secret = app.state.settings.session_secret
    assert [row.browser_key for row in rows] == [None, engagement_service.browser_key(secret, BROWSER_A)]
    assert [row.campus_pref for row in rows] == [None, "minghua"]
    # 代號一旦記下，後到的回報沒帶也不會清掉。
    first = next(row for row in rows if row.browser_key)
    first_id, session_id, key = first.id, first.session_id, first.browser_key
    again = _visit(id=str(first_id), session=str(session_id), active_ms=40_000)
    assert (await public_client.post(ENGAGEMENT, json=again)).status_code == 204
    stored = (await db_session.execute(
        select(EngagementVisit.browser_key, EngagementVisit.campus_pref, EngagementVisit.active_ms)
        .where(EngagementVisit.id == first_id).execution_options(populate_existing=True)
    )).one()
    assert tuple(stored) == (key, "minghua", 40_000)


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [_visit(browser="short"), _visit(browser="A" * 23), _visit(pref="tokyo")])
async def test_engagement_rejects_bad_browser_or_pref(public_client, body):
    assert (await public_client.post(ENGAGEMENT, json=body)).status_code == 422


async def _set_updated(db_session, visit: dict, minutes_ago: int) -> None:
    await db_session.execute(
        update(EngagementVisit).where(EngagementVisit.id == uuid.UUID(visit["id"]))
        .values(updated_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago))
    )


@pytest.mark.asyncio
async def test_browser_stats_follow_the_same_browser_across_visits(admin_client, public_client, db_session):
    first_session, second_session, other_session = (str(uuid.uuid4()) for _ in range(3))
    # 瀏覽器 A：第一次從廣告來看首頁與關於，第二次直接回來預約；預約完回頭看環境頁（不算進內容比較）。
    a_home = _visit(session=first_session, source="ads", browser=BROWSER_A, sections={"day": 5_000})
    a_about = _visit(session=first_session, source="ads", browser=BROWSER_A, page="about")
    a_return = _visit(session=second_session, browser=BROWSER_A)
    a_book = _visit(session=second_session, browser=BROWSER_A, page="visit", campus="yihua", actions={"booking_done": 1})
    a_after = _visit(session=second_session, browser=BROWSER_A, page="environment")
    # 瀏覽器 B：從搜尋來看首頁，沒有預約。沒有代號的造訪不算。
    b_home = _visit(session=other_session, source="search", browser=BROWSER_B)
    anonymous = _visit(source="line")
    timeline = [(a_home, 300), (a_about, 290), (a_return, 100), (a_book, 90), (a_after, 10), (b_home, 50), (anonymous, 40)]
    for visit, _ in timeline:
        assert (await public_client.post(ENGAGEMENT, json=visit)).status_code == 204
    for visit, minutes in timeline:
        await _set_updated(db_session, visit, minutes)
    await db_session.commit()

    browser = (await admin_client.get(f"{SUMMARY}?days=7")).json()["browser"]
    assert (browser["browsers"], browser["booked_browsers"], browser["multi_visit_browsers"]) == (2, 1, 1)
    assert browser["booked_rate"] == 0.5
    assert browser["first_day"] == today_local().isoformat()
    assert browser["visits_before_booking"] == [
        {"visits": "1", "browsers": 0}, {"visits": "2", "browsers": 1}, {"visits": "3", "browsers": 0}, {"visits": "4_plus", "browsers": 0},
    ]
    assert browser["sources"] == [
        {"source": "ads", "browsers": 1, "booked_browsers": 1, "booked_rate": 1.0},
        {"source": "search", "browsers": 1, "booked_browsers": 0, "booked_rate": 0.0},
    ]
    conversion = {(row["kind"], row["page"], row["key"]): (row["browsers"], row["booked_browsers"]) for row in browser["conversion"]}
    assert conversion[("page", "home", None)] == (2, 1)
    assert conversion[("page", "about", None)] == (1, 1)
    assert conversion[("section", "home", "day")] == (1, 1)
    # 預約之後才看的環境頁不算；預約頁本身不列。
    assert ("page", "environment", None) not in conversion
    assert not any(page == "visit" for _, page, _ in conversion)


@pytest.mark.asyncio
async def test_campus_prefs_and_permission_masking(admin_client, minghua_client, public_client):
    stay, switch, browse = (str(uuid.uuid4()) for _ in range(3))
    for visit in [
        _visit(session=stay, pref="yihua"),
        _visit(session=stay, pref="yihua", page="visit", campus="yihua", actions={"booking_done": 1}),
        _visit(session=switch, pref="minghua", page="visit", campus="yihua", actions={"booking_done": 1}),
        _visit(session=browse, pref="minghua", page="about"),
        _visit(page="visit", campus="yihua"),
    ]:
        assert (await public_client.post(ENGAGEMENT, json=visit)).status_code == 204
    full = (await admin_client.get(f"{SUMMARY}?days=7")).json()["campus_prefs"]
    assert full == [
        {"campus_key": "yihua", "sessions": 1, "visit_sessions": 1, "booked_same": 1, "booked_other": 0},
        {"campus_key": "minghua", "sessions": 2, "visit_sessions": 0, "booked_same": 0, "booked_other": 1},
    ]
    scoped = (await minghua_client.get(f"{SUMMARY}?days=7")).json()["campus_prefs"]
    assert [(row["sessions"], row["booked_same"], row["booked_other"]) for row in scoped] == [(1, None, None), (2, None, None)]


# ── 網站來源：天數、組合、自填對照、記住預約 ───────────────────────────────────────


@pytest.mark.asyncio
async def test_attribution_delay_rows_paths_and_referrals(admin_client, db_session):
    day = date(2026, 11, 18)
    cases = [
        # (第一次來源, 第一次日期相隔天數, 最後來源, 自填, 狀態)
        ("ads", 0, None, ["friends_family", "online"], "completed"),
        ("ads", 12, "search", [], "no_show"),
        ("search", 40, None, ["friends_family"], "cancelled"),
        (None, None, None, ["flyer"], "cancelled"),
    ]
    for first, gap, last, referrals, status in cases:
        key = await add_case(db_session, created_at=taipei(day, 10), status=status)
        values = {"referral_sources": referrals}
        if first:
            values.update(first_touch_source=first, first_touch_on=day - timedelta(days=gap), last_touch_source=last)
        await db_session.execute(update(VisitRequest).where(VisitRequest.id == key).values(**values))
    db_session.add_all([
        VisitRememberedDaily(day=day, campus_key="yihua", action="shown", has_email=False, count=3),
        VisitRememberedDaily(day=day, campus_key="yihua", action="opened", has_email=False, count=2),
        VisitRememberedDaily(day=day, campus_key="yihua", action="opened", has_email=True, count=1),
        VisitRememberedDaily(day=day - timedelta(days=5), campus_key="yihua", action="dismissed", has_email=True, count=9),
        VisitRememberedDaily(day=day, campus_key="minghua", action="shown", has_email=True, count=7),
    ])
    await db_session.commit()
    report = (await admin_client.get(ATTRIBUTION, params={
        "campus_key": "yihua", "from": day.isoformat(), "to": day.isoformat(),
    })).json()

    assert report["delays"] == {"same_day": 1, "days_1_3": 0, "days_4_7": 0, "days_8_30": 1, "days_31_plus": 1, "unrecorded": 1}
    assert report["median_days"] == 12.0
    assert [(row["source"], row["cases"], row["same_day"], row["days_8_30"], row["days_31_plus"], row["median_days"]) for row in report["delay_rows"]] == [
        ("ads", 2, 1, 1, 0, 6.0), ("search", 1, 0, 0, 1, 40.0),
    ]
    paths = {(row["first"], row["last"]): row for row in report["source_paths"]}
    assert paths[("ads", "no_external")]["completed"] == 1
    assert paths[("ads", "search")]["no_show"] == 1
    assert paths[("search", "no_external")]["cases"] == 1
    assert paths[("unrecorded", "unrecorded")]["cases"] == 1
    referrals = {row["referral"]: row for row in report["referral_rows"]}
    assert referrals["friends_family"]["cases"] == 2
    assert {item["source"]: item["cases"] for item in referrals["friends_family"]["sources"]} == {"ads": 1, "search": 1}
    assert referrals["none"]["sources"] == [{"source": "ads", "cases": 1}]
    # 沒記到第一次來源的案件（勾了傳單）不進對照表；沒勾的排最後。
    assert "flyer" not in referrals
    assert report["referral_rows"][-1]["referral"] == "none"
    assert report["remembered"] == {"shown": 3, "opened": 3, "opened_without_email": 2, "dismissed": 0, "first_day": (day - timedelta(days=5)).isoformat()}


@pytest.mark.asyncio
async def test_remembered_endpoints_count_usage(admin_client, public_client, db_session):
    await book_slot(admin_client, public_client)
    assert (await public_client.get(REMEMBERED)).status_code == 200
    assert (await public_client.get(REMEMBERED)).status_code == 200
    assert (await public_client.post(f"{REMEMBERED}/open")).status_code == 200
    assert (await public_client.delete(REMEMBERED)).status_code == 204
    # cookie 已清：再按一次「不是我」不記。
    assert (await public_client.delete(REMEMBERED)).status_code == 204
    rows = (await db_session.execute(select(VisitRememberedDaily))).scalars().all()
    counts = {(row.action, row.has_email): row.count for row in rows}
    assert {action: total for (action, _), total in counts.items()} == {"shown": 2, "opened": 1, "dismissed": 1}
    assert {row.day for row in rows} == {today_local()} and {row.campus_key for row in rows} == {"yihua"}
    summary = (await admin_client.get(ATTRIBUTION, params={"campus_key": "yihua"})).json()["remembered"]
    assert (summary["shown"], summary["opened"], summary["dismissed"]) == (2, 1, 1)


@pytest.mark.asyncio
async def test_forged_remembered_cookie_counts_nothing(public_client, db_session):
    public_client.cookies.set("ivy_visit_remember", "not-a-real-token")
    assert (await public_client.get(REMEMBERED)).status_code == 204
    assert (await public_client.post(f"{REMEMBERED}/open")).status_code == 401
    assert (await public_client.delete(REMEMBERED)).status_code == 204
    assert (await db_session.execute(select(VisitRememberedDaily))).scalars().all() == []


# ── 廣告成效的助攻／收尾 ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ad_roi_assist_columns_follow_touch(admin_client, db_session):
    month = today_local().strftime("%Y-%m")
    for first, first_platform, last, last_platform in [
        ("ads", "google", "search", None),   # 最後一次口徑：Google 助攻
        ("search", None, "ads", "meta"),     # 第一次口徑：Meta 收尾
        ("ads", "google", "ads", "google"),  # 同一平台：不算
    ]:
        key = await add_case(db_session)
        await db_session.execute(update(VisitRequest).where(VisitRequest.id == key).values(
            first_touch_source=first, first_touch_ad_platform=first_platform, first_touch_on=today_local(),
            last_touch_source=last, last_touch_ad_platform=last_platform, last_touch_on=today_local(),
        ))
    await db_session.commit()

    last = {row["key"]: row for row in (await admin_client.get(f"{API}/admin/admissions/ad-roi", params={"from": month, "to": month})).json()["rows"]}
    assert (last["google"]["cases"], last["google"]["assist_cases"]) == (1, 1)
    assert (last["meta"]["cases"], last["meta"]["assist_cases"]) == (1, 0)
    first = {row["key"]: row for row in (await admin_client.get(
        f"{API}/admin/admissions/ad-roi", params={"from": month, "to": month, "touch": "first"},
    )).json()["rows"]}
    assert (first["google"]["cases"], first["google"]["assist_cases"]) == (2, 0)
    assert (first["meta"]["cases"], first["meta"]["assist_cases"]) == (0, 1)


# ── 回傳廣告平台的狀態 ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ad_conversion_status(app, admin_client, minghua_client, db_session):
    app.state.settings = app.state.settings.model_copy(update={"ga4_measurement_id": "G-TEST12345", "ga4_api_secret": "ga-secret"})
    now = datetime.now(timezone.utc)
    with_ids = await add_case(db_session)
    without_ids = await add_case(db_session)
    old = await add_case(db_session, created_at=now - timedelta(days=60))
    await db_session.execute(update(VisitRequest).where(VisitRequest.id.in_([with_ids, old])).values(ad_click_ids={"ga_client_id": "1.2", "fbp": "fb.1.1763000000000.42"}))

    def job(case, event, platform, status, *, minutes_ago=10, error=None):
        finished = None if status == "pending" else now - timedelta(minutes=minutes_ago)
        return AdConversionJob(
            visit_request_id=case, event=event, platform=platform, status=status, occurred_at=now,
            attempts=1, next_attempt_at=now, created_at=now - timedelta(minutes=minutes_ago), finished_at=finished, last_error=error,
        )

    db_session.add_all([
        job(with_ids, "visit_attended", "ga4", "sent", minutes_ago=30),
        job(with_ids, "deposit_paid", "ga4", "failed", minutes_ago=5, error="HTTP 400 bad"),
        job(without_ids, "visit_attended", "ga4", "skipped", minutes_ago=20, error="no_identifier"),
        job(with_ids, "visit_attended", "meta", "pending"),
    ])
    await db_session.commit()

    response = await admin_client.get(f"{API}/admin/admissions/ad-conversions", params={"days": 30})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["days"] == 30 and body["cases"] == 2
    platforms = {row["platform"]: row for row in body["platforms"]}
    assert list(platforms) == ["ga4", "meta", "openai", "line"]
    ga4 = platforms["ga4"]
    assert ga4["configured"] is True and platforms["meta"]["configured"] is False
    assert ga4["events"] == [
        {"event": "visit_attended", "pending": 0, "sent": 1, "failed": 0, "skipped": 1},
        {"event": "deposit_paid", "pending": 0, "sent": 0, "failed": 1, "skipped": 0},
    ]
    assert ga4["last_sent_at"] is not None
    assert ga4["last_problem"] == "HTTP 400 bad"
    assert ga4["cases_with_ids"] == 1 and platforms["meta"]["cases_with_ids"] == 1 and platforms["openai"]["cases_with_ids"] == 0
    assert platforms["meta"]["events"][0]["pending"] == 1
    assert (await minghua_client.get(f"{API}/admin/admissions/ad-conversions")).status_code == 403
    assert (await admin_client.get(f"{API}/admin/admissions/ad-conversions", params={"days": 0})).status_code == 422
