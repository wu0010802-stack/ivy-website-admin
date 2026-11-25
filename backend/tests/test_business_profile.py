"""Google 商家檔案（docs/specs/2026-11-25-business-profile-keyword-planner-design.md §4）：回應解析、第一次往回補與之後的
增量同步、搜尋字詞的月份規則、失敗與重試、後台 API。假 Google 照官方文件的格式回應（值為 0 時不出現、int64 是字串）。"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select

from app.common.timezones import today_local
from app.insights.business_profile import (
    KeywordCount,
    add_months,
    merge_keywords,
    parse_daily,
    parse_keywords,
    sync_business_profile,
)
from app.insights.google_token import RefreshTokenAuth
from app.insights.http import GoogleApiError
from app.insights.models import GbpDailyMetric, GbpKeywordMonth, GbpMonthlyKeyword, GoogleSyncStatus
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.google_data_helpers import GBP_REFRESH, LOCATION, SECRETS, FakeGoogleData, settings_with

URL = "/api/website/v1/admin/business-profile"
# 台北 2026-11-25 10:00
NOW = datetime(2026, 11, 25, 2, 0, tzinfo=timezone.utc)
TODAY = date(2026, 11, 25)
YESTERDAY = date(2026, 11, 24)


# ── 解析 ─────────────────────────────────────────────────────────────────────


def test_parse_daily_missing_value_is_zero_and_unknown_metric_skipped():
    data = {"multiDailyMetricTimeSeries": [{"dailyMetricTimeSeries": [
        {"dailyMetric": "CALL_CLICKS", "timeSeries": {"datedValues": [
            {"date": {"year": 2026, "month": 11, "day": 1}, "value": "3"},
            {"date": {"year": 2026, "month": 11, "day": 2}},
        ]}},
        {"dailyMetric": "BUSINESS_FOOD_ORDERS", "timeSeries": {"datedValues": [{"date": {"year": 2026, "month": 11, "day": 1}, "value": "9"}]}},
        {"dailyMetric": "WEBSITE_CLICKS"},
    ]}]}
    assert parse_daily(data) == {(date(2026, 11, 1), "calls"): 3, (date(2026, 11, 2), "calls"): 0}


@pytest.mark.parametrize("bad", ["-1", "x", "9999999999", True])
def test_parse_daily_bad_value_is_malformed(bad):
    data = {"multiDailyMetricTimeSeries": [{"dailyMetricTimeSeries": [
        {"dailyMetric": "CALL_CLICKS", "timeSeries": {"datedValues": [{"date": {"year": 2026, "month": 11, "day": 1}, "value": bad}]}},
    ]}]}
    with pytest.raises(GoogleApiError) as exc:
        parse_daily(data)
    assert str(exc.value) == "查詢商家檔案每日指標（HTTP 200、回應格式不對）"


def test_parse_daily_empty_response_is_fine():
    assert parse_daily({}) == {}


def test_parse_keywords_value_threshold_and_token():
    rows, token = parse_keywords({
        "searchKeywordsCounts": [
            {"searchKeyword": "  常春藤  幼兒園 ", "insightsValue": {"value": "42"}},
            {"searchKeyword": "三民區 幼兒園", "insightsValue": {"threshold": "15"}},
            {"searchKeyword": "", "insightsValue": {"value": "1"}},
        ],
        "nextPageToken": "abc",
    })
    assert rows == [KeywordCount("常春藤 幼兒園", 42, None), KeywordCount("三民區 幼兒園", None, 15)]
    assert token == "abc"


def test_merge_keywords_prefers_exact_then_larger():
    rows = merge_keywords([KeywordCount("a", None, 15), KeywordCount("a", 3, None), KeywordCount("b", 2, None), KeywordCount("b", 5, None)])
    assert sorted(rows, key=lambda row: row.keyword) == [KeywordCount("a", 3, None), KeywordCount("b", 5, None)]


# ── 同步（真資料庫） ─────────────────────────────────────────────────────────────


@pytest.fixture
def fake():
    return FakeGoogleData(
        daily={(YESTERDAY, "CALL_CLICKS"): 4, (YESTERDAY, "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"): 120,
               (date(2026, 10, 3), "WEBSITE_CLICKS"): 7},
        history_from=date(2025, 9, 1),
        keywords={
            date(2026, 10, 1): [("常春藤幼兒園", 80, None), ("義華路 幼兒園", None, 15)],
            date(2026, 9, 1): [("常春藤", 30, None)],
        },
    )


async def _sync(app, fake, *, now=NOW, auth=None, **kwargs):
    return await sync_business_profile(
        app.state.session_factory, settings_with(app.state.settings, ads=False), auth or RefreshTokenAuth(),
        transport=httpx.MockTransport(fake.handler), now=now, **kwargs,
    )


async def _count(db, model, *where) -> int:
    return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def test_first_sync_backfills_until_google_runs_out(app, db_session, fake):
    [result] = await _sync(app, fake)
    assert result.outcome == "synced" and result.campus_key == "yihua"
    # 由新到舊、每段最多 3 個月；2025-09 以前回 400，就停在那裡。
    assert fake.daily_requests[0] == (date(2026, 9, 1), YESTERDAY)
    assert fake.daily_requests[-1][1] < date(2025, 9, 1)
    days = (await db_session.execute(select(func.min(GbpDailyMetric.day), func.max(GbpDailyMetric.day)))).one()
    assert days == (date(2025, 9, 1), YESTERDAY)
    value = await db_session.get(GbpDailyMetric, ("yihua", YESTERDAY, "calls"))
    assert value.value == 4
    # Google 沒給值的日子存 0（八個指標都有列）
    assert (await db_session.get(GbpDailyMetric, ("yihua", YESTERDAY, "website"))).value == 0
    assert await _count(db_session, GbpDailyMetric, GbpDailyMetric.day == YESTERDAY) == 8
    # 搜尋字詞：2025-09 到 2026-10 每個月都抓過（更早的回 400 → 記成抓過、沒有字詞），之後不再抓。
    months = set((await db_session.execute(select(GbpKeywordMonth.month))).scalars())
    assert date(2026, 10, 1) in months and date(2025, 5, 1) in months and date(2026, 11, 1) not in months
    assert await _count(db_session, GbpMonthlyKeyword) == 3
    status = await db_session.get(GoogleSyncStatus, "gbp:yihua")
    assert status.last_success_at == NOW and status.last_attempt_at == NOW and status.last_error is None


async def test_same_day_is_skipped_next_day_refetches_last_week(app, db_session, fake):
    auth = RefreshTokenAuth()
    await _sync(app, fake, auth=auth)
    fake.daily_requests.clear()
    fake.keyword_requests.clear()
    [again] = await _sync(app, fake, now=NOW + timedelta(hours=5), auth=auth)
    assert again.outcome == "skipped" and fake.daily_requests == []
    fake.daily[(TODAY, "CALL_CLICKS")] = 9
    [next_day] = await _sync(app, fake, now=NOW + timedelta(days=1), auth=auth)
    assert next_day.outcome == "synced"
    assert fake.daily_requests == [(YESTERDAY - timedelta(days=6), TODAY)]
    # 最近兩個整月每天重抓；更早的抓過就不再抓。
    assert sorted(fake.keyword_requests) == [date(2026, 9, 1), date(2026, 10, 1)]
    assert (await db_session.get(GbpDailyMetric, ("yihua", TODAY, "calls"))).value == 9
    # access token 有快取：兩輪只換了一次權杖。
    assert len(fake.token_requests) == 1
    assert fake.token_requests[0]["refresh_token"] == GBP_REFRESH


async def test_keyword_pages_are_followed(app, db_session, fake):
    fake.keyword_page_size = 2
    fake.keywords[date(2026, 10, 1)] = [(f"字詞{i}", i, None) for i in range(5)]
    await _sync(app, fake)
    assert await _count(db_session, GbpMonthlyKeyword, GbpMonthlyKeyword.month == date(2026, 10, 1)) == 5


async def test_refetched_month_replaces_keywords(app, db_session, fake):
    auth = RefreshTokenAuth()
    await _sync(app, fake, auth=auth)
    fake.keywords[date(2026, 10, 1)] = [("新字詞", 5, None)]
    await _sync(app, fake, now=NOW + timedelta(days=1), auth=auth)
    words = set((await db_session.execute(
        select(GbpMonthlyKeyword.keyword).where(GbpMonthlyKeyword.month == date(2026, 10, 1))
    )).scalars())
    assert words == {"新字詞"}


@pytest.mark.parametrize(("step", "message"), [
    ("daily", "查詢商家檔案每日指標（HTTP 403）"),
    ("keywords", "查詢商家檔案搜尋字詞（HTTP 429）"),
    ("token", "以 refresh token 取得 Google 權杖（HTTP 400）"),
])
async def test_failure_is_recorded_without_partial_data(app, db_session, fake, caplog, step, message):
    fake.fail[step] = {"daily": 403, "keywords": 429, "token": 400}[step]
    caplog.set_level(logging.WARNING)
    [result] = await _sync(app, fake)
    assert result.outcome == "failed" and result.error == message
    assert await _count(db_session, GbpDailyMetric) == 0
    status = await db_session.get(GoogleSyncStatus, "gbp:yihua")
    assert status.last_error == message and status.last_success_at is None
    for secret in (*SECRETS, LOCATION):
        assert secret not in caplog.text and secret not in result.error


async def test_failure_waits_three_hours_unless_forced(app, db_session, fake):
    fake.fail["daily"] = 403
    await _sync(app, fake)
    del fake.fail["daily"]
    [soon] = await _sync(app, fake, now=NOW + timedelta(hours=2))
    assert soon.outcome == "skipped"
    [forced] = await _sync(app, fake, now=NOW + timedelta(hours=2), force=True)
    assert forced.outcome == "synced"
    status = await db_session.get(GoogleSyncStatus, "gbp:yihua")
    assert status.last_error is None


async def test_later_retry_after_failure(app, db_session, fake):
    fake.fail["daily"] = 403
    await _sync(app, fake)
    del fake.fail["daily"]
    [later] = await _sync(app, fake, now=NOW + timedelta(hours=3))
    assert later.outcome == "synced"


async def test_not_configured_does_nothing(app, fake):
    settings = settings_with(app.state.settings, gbp=False, ads=False)
    assert await sync_business_profile(app.state.session_factory, settings, RefreshTokenAuth(),
                                       transport=httpx.MockTransport(fake.handler)) == []
    assert fake.token_requests == []


# ── 後台 API ─────────────────────────────────────────────────────────────────


@pytest.fixture
def configured(app):
    original = app.state.settings
    app.state.settings = settings_with(original, ads=False)
    yield
    app.state.settings = original


async def test_api_not_configured(admin_client):
    response = await admin_client.get(URL)
    assert response.status_code == 200
    assert response.json() == {"configured": False, "locations": []}


async def test_api_monthly_totals_and_top_keywords(app, admin_client, db_session, configured):
    this_month = today_local().replace(day=1)
    last_month = add_months(this_month, -1)
    rows = [
        GbpDailyMetric(campus_key="yihua", day=this_month, metric="mobile_search", value=100),
        GbpDailyMetric(campus_key="yihua", day=this_month, metric="calls", value=2),
        GbpDailyMetric(campus_key="yihua", day=last_month, metric="calls", value=5),
        GbpDailyMetric(campus_key="yihua", day=last_month + timedelta(days=1), metric="calls", value=1),
        GbpDailyMetric(campus_key="yihua", day=last_month + timedelta(days=1), metric="desktop_maps", value=7),
        # 13 個月以前的不列
        GbpDailyMetric(campus_key="yihua", day=add_months(this_month, -13), metric="calls", value=99),
    ]
    db_session.add_all(rows)
    db_session.add(GbpKeywordMonth(campus_key="yihua", month=last_month, fetched_at=NOW))
    db_session.add_all([
        GbpMonthlyKeyword(campus_key="yihua", month=last_month, keyword="少", impressions=None, below=15),
        GbpMonthlyKeyword(campus_key="yihua", month=last_month, keyword="多", impressions=40, below=None),
        GbpMonthlyKeyword(campus_key="yihua", month=last_month, keyword="中", impressions=12, below=None),
    ])
    db_session.add(GoogleSyncStatus(key="gbp:yihua", last_attempt_at=NOW, last_success_at=NOW))
    await db_session.commit()

    body = (await admin_client.get(URL)).json()
    assert body["configured"] is True
    [location] = body["locations"]
    assert location["campus_key"] == "yihua" and location["campus_name"]
    assert location["failed"] is False and location["error"] is None
    assert location["last_day"] == this_month.isoformat()
    assert [month["month"] for month in location["months"]] == [this_month.strftime("%Y-%m"), last_month.strftime("%Y-%m")]
    current, previous = location["months"]
    assert current["mobile_search"] == 100 and current["calls"] == 2 and current["days"] == 1
    assert previous["calls"] == 6 and previous["desktop_maps"] == 7 and previous["days"] == 2 and previous["website"] == 0
    assert previous["last_day"] == (last_month + timedelta(days=1)).isoformat()
    assert location["keywords_month"] == last_month.strftime("%Y-%m")
    assert [row["keyword"] for row in location["keywords"]] == ["多", "中", "少"]
    assert location["keywords"][2] == {"keyword": "少", "impressions": None, "below": 15}
    assert location["keyword_total"] == 3


async def test_api_reports_last_failure(admin_client, db_session, configured):
    db_session.add(GoogleSyncStatus(key="gbp:yihua", last_attempt_at=NOW, last_success_at=NOW - timedelta(days=1),
                                    last_error="查詢商家檔案每日指標（HTTP 403）"))
    await db_session.commit()
    [location] = (await admin_client.get(URL)).json()["locations"]
    assert location["failed"] is True and location["error"] == "查詢商家檔案每日指標（HTTP 403）"
    assert location["months"] == [] and location["keywords_month"] is None and location["last_day"] is None


async def test_api_forbidden_for_branch_roles(reception_yihua_client, readonly_yihua_client, minghua_client):
    for client in (reception_yihua_client, readonly_yihua_client, minghua_client):
        assert (await client.get(URL)).status_code == 403
