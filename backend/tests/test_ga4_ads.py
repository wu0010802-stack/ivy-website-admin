"""GA4 廣告花費讀取器（docs/specs/2026-11-16-ad-roi-design.md §6.1）：花費與預約轉換兩次查詢合併、
錯誤只帶步驟與 HTTP 狀態、結果快取。假 Google 會真的驗 JWT 簽章與 scope。"""

from __future__ import annotations

from datetime import date

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.insights.ga4_ads import Ga4Ads, GoogleCampaignMonth
from app.insights.http import GoogleApiError
from tests.google_helpers import ACCESS_TOKEN, CLIENT_EMAIL, GA4_PROPERTY, FakeGoogle, make_service_account

SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
START, END = date(2026, 11, 1), date(2026, 11, 30)
CAMPAIGN = ["202611", "24468966410", "搜尋-五校招生-202611"]


def _settings(**overrides) -> Settings:
    base = dict(
        database_url="postgresql://localhost/ivy_website_dev",
        environment="test",
        test_database_url="postgresql://localhost/ivy_website_test",
        session_secret="test-only-secret-please-rotate",
    )
    return Settings(**{**base, **overrides})


@pytest.fixture
def account():
    return make_service_account()


@pytest.fixture
def fake(account):
    return FakeGoogle(account, scope=SCOPE, ga4_cost_rows=[(CAMPAIGN, ["8999.6", "310", "4120"])], ga4_lead_rows=[(CAMPAIGN, ["5"])])


@pytest.fixture
def settings(account):
    return _settings(google_sc_service_account_json=account.json_text, google_sc_property="sc-domain:ivykidschool.com", ga4_property_id=GA4_PROPERTY)


def _run(fake, settings):
    return Ga4Ads().report(settings, START, END, httpx.MockTransport(fake.handler))


async def test_ga4_report_merges_cost_and_leads(fake, settings):
    report = await _run(fake, settings)
    assert report.rows == [GoogleCampaignMonth("2026-11", "24468966410", "搜尋-五校招生-202611", 9000, 310, 4120, 5)]
    assert report.fetched_at is not None


async def test_ga4_drops_rows_without_ad_metrics(fake, settings):
    fake.ga4_cost_rows.append((["202611", "(not set)", "(not set)"], ["0", "0", "0"]))
    report = await _run(fake, settings)
    assert [row.campaign_id for row in report.rows] == ["24468966410"]


async def test_ga4_drops_not_set_campaign_even_with_leads_or_cost(fake, settings):
    fake.ga4_lead_rows.append((["202611", "(not set)", "(not set)"], ["7"]))
    fake.ga4_cost_rows.append((["202611", "(not set)", "(not set)"], ["12", "1", "1"]))
    fake.ga4_lead_rows.append((["202611", " ", ""], ["3"]))
    report = await _run(fake, settings)
    assert [row.campaign_id for row in report.rows] == ["24468966410"]
    assert report.rows[0].leads == 5


@pytest.mark.parametrize("bad", ["nan", "inf", "-inf"])
async def test_ga4_non_finite_metric_is_malformed(fake, settings, bad):
    fake.ga4_cost_rows[0] = (CAMPAIGN, [bad, "310", "4120"])
    with pytest.raises(GoogleApiError) as exc:
        await _run(fake, settings)
    assert exc.value.reason == "回應格式不對" and exc.value.status == 200


async def test_ga4_keeps_lead_only_rows_and_sorts(fake, settings):
    fake.ga4_lead_rows.append((["202610", "111", "舊活動"], ["2"]))
    report = await _run(fake, settings)
    assert [(r.month, r.campaign_id, r.campaign_name, r.leads, r.cost) for r in report.rows] == [
        ("2026-10", "111", "舊活動", 2, 0),
        ("2026-11", "24468966410", "搜尋-五校招生-202611", 5, 9000),
    ]


async def test_ga4_reports_currency(fake, settings):
    fake.ga4_currency = "USD"
    report = await _run(fake, settings)
    assert report.currency == "USD"
    assert report.time_zone == "Asia/Taipei"


async def test_ga4_token_uses_analytics_scope(fake, settings):
    await _run(fake, settings)
    assert len(fake.token_calls) == 1 and fake.token_calls[0]["scope"] == SCOPE
    assert fake.token_calls[0]["iss"] == CLIENT_EMAIL


async def test_ga4_request_shape(fake, settings):
    await _run(fake, settings)
    cost, leads = fake.ga4_calls
    assert cost["dateRanges"] == [{"startDate": "2026-11-01", "endDate": "2026-11-30"}]
    assert [d["name"] for d in cost["dimensions"]] == ["yearMonth", "sessionGoogleAdsCampaignId", "sessionGoogleAdsCampaignName"]
    assert [m["name"] for m in cost["metrics"]] == ["advertiserAdCost", "advertiserAdClicks", "advertiserAdImpressions"]
    assert cost["limit"] == 10000
    assert [m["name"] for m in leads["metrics"]] == ["keyEvents:generate_lead"]


async def test_ga4_errors_carry_step_and_status_only(fake, settings):
    fake.ga4_lead_status = 403
    with pytest.raises(GoogleApiError) as exc:
        await _run(fake, settings)
    assert str(exc.value) == "查詢 GA4 預約轉換（HTTP 403）"
    assert GA4_PROPERTY not in str(exc.value) and ACCESS_TOKEN not in str(exc.value)


async def test_ga4_row_count_overflow(fake, settings):
    fake.ga4_row_count = 20000
    with pytest.raises(GoogleApiError) as exc:
        await _run(fake, settings)
    assert exc.value.reason == "列數超過上限"


async def test_ga4_non_numeric_metric_is_malformed(fake, settings):
    fake.ga4_cost_rows[0] = (CAMPAIGN, ["abc", "310", "4120"])
    with pytest.raises(GoogleApiError) as exc:
        await _run(fake, settings)
    assert exc.value.reason == "回應格式不對" and exc.value.status == 200


async def test_ga4_results_are_cached(fake, settings):
    ga4 = Ga4Ads()
    transport = httpx.MockTransport(fake.handler)
    await ga4.report(settings, START, END, transport)
    await ga4.report(settings, START, END, transport)
    assert len(fake.ga4_calls) == 2


def test_ga4_property_id_must_be_digits(account):
    with pytest.raises(ValidationError) as exc:
        _settings(ga4_property_id="G-ABC")
    assert "WEBSITE_GA4_PROPERTY_ID" in str(exc.value)
    assert "G-ABC" not in str(exc.value)


def test_ga4_ads_enabled_needs_account_and_property(account):
    assert _settings().ga4_ads_enabled is False
    assert _settings(ga4_property_id="  ").ga4_property_id is None
    sc = dict(google_sc_service_account_json=account.json_text, google_sc_property="sc-domain:ivykidschool.com")
    assert _settings(**sc).ga4_ads_enabled is False
    assert _settings(**sc, ga4_property_id=GA4_PROPERTY).ga4_ads_enabled is True
