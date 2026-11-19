"""Google Search Console（docs/specs/2026-11-12-external-integrations-design.md §3）：
服務帳戶 JWT 換 access token（記憶體快取到過期前 5 分鐘）、searchAnalytics.query 四次、
結果快取 6 小時、同時間只打一次、任何金鑰與 Google 回應內容都不出現在回應或 log。"""

from __future__ import annotations

import asyncio
import calendar
import json
import logging
from datetime import date, timedelta

import httpx
import pytest

from app.common.timezones import today_local
from tests.google_helpers import ACCESS_TOKEN, CLIENT_EMAIL, PROPERTY, FakeGoogle, make_service_account, search_row

URL = "/api/website/v1/admin/search-insights"
USER_AGENT = "Mozilla/5.0 (compatible; ivy-website-search-insights/1.0)"


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class Harness:
    def __init__(self, app, account, fake: FakeGoogle, clock: FakeClock) -> None:
        self.app, self.account, self.fake, self.clock = app, account, fake, clock


@pytest.fixture
def google(app):
    account = make_service_account()
    fake = FakeGoogle(account)
    clock = FakeClock()
    original = app.state.settings
    app.state.settings = original.model_copy(update={
        "google_sc_service_account_json": account.json_text,
        "google_sc_property": PROPERTY,
    })
    app.state.google_transport = httpx.MockTransport(fake.handler)
    app.state.search_console.clock = clock
    yield Harness(app, account, fake, clock)
    app.state.settings = original
    app.state.google_transport = None


def _range(days: int = 28) -> str:
    end = today_local()
    return f"?start={(end - timedelta(days=days - 1)).isoformat()}&end={end.isoformat()}"


async def _get(client, query: str | None = None) -> dict:
    response = await client.get(f"{URL}{_range() if query is None else query}")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_unconfigured_returns_only_configured_false_and_never_calls_google(app, admin_client):
    def forbidden(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"不該連外：{request.url}")

    app.state.google_transport = httpx.MockTransport(forbidden)
    try:
        assert await _get(admin_client) == {"configured": False}
    finally:
        app.state.google_transport = None


@pytest.mark.asyncio
async def test_only_super_admin_can_read(google, minghua_client, public_client):
    assert (await minghua_client.get(f"{URL}{_range()}")).status_code == 403
    assert (await public_client.get(f"{URL}{_range()}")).status_code == 401
    assert google.fake.query_calls == [] and google.fake.token_calls == []


@pytest.mark.asyncio
async def test_returns_totals_queries_pages_and_devices(google, admin_client):
    body = await _get(admin_client)

    assert body["configured"] is True and "error" not in body
    assert body["start"] == (today_local() - timedelta(days=27)).isoformat()
    assert body["end"] == today_local().isoformat()
    assert body["as_of"]
    assert body["totals"] == {"clicks": 42, "impressions": 1000, "ctr": 0.042, "position": 8.8}
    assert body["queries"][0] == {"query": "常春藤幼兒園", "clicks": 20, "impressions": 300, "ctr": 0.0667, "position": 2.3}
    assert [row["query"] for row in body["queries"]] == ["常春藤幼兒園", "義華 幼兒園"]
    # 頁面只回路徑：沒有網域、查詢字串或 #片段。
    assert [row["page"] for row in body["pages"]] == ["/", "/campus/yihua"]
    assert [(row["device"], row["clicks"]) for row in body["devices"]] == [("mobile", 30), ("desktop", 11), ("tablet", 1)]
    assert "ivykidschool.com" not in json.dumps(body["pages"])


@pytest.mark.asyncio
async def test_queries_google_four_times_with_the_documented_request(google, admin_client):
    await _get(admin_client)
    fake = google.fake

    assert sorted(map(str, fake.dimensions_asked())) == ["None", "device", "page", "query"]
    start, end = (today_local() - timedelta(days=27)).isoformat(), today_local().isoformat()
    for call in fake.query_calls:
        assert call["startDate"] == start and call["endDate"] == end
        assert call["rowLimit"] == 25
        assert call["type"] == "web"
        # 一次只問一個維度：query×page 合併會被 Search Console 匿名化丟掉大半。
        assert len(call.get("dimensions", [])) <= 1
    assert len(fake.token_calls) == 1
    assert set(fake.user_agents) == {USER_AGENT}
    # 存取權杖放標頭；網址裡只有資源與固定路徑。
    assert all("ya29" not in str(url) and "assertion" not in str(url) for url in fake.query_urls)


@pytest.mark.asyncio
async def test_jwt_is_signed_with_the_service_account_key(google, admin_client):
    await _get(admin_client)
    # 假 Google 已用公鑰驗過簽章、iss、scope、aud（FakeGoogle._token）；這裡確認真的走過那一步。
    assert len(google.fake.token_calls) == 1
    assert google.fake.token_calls[0]["iss"] == CLIENT_EMAIL


@pytest.mark.asyncio
async def test_empty_period_gives_zero_totals_and_empty_tables(google, admin_client):
    google.fake.rows = {None: [], "query": [], "page": [], "device": []}
    body = await _get(admin_client)
    assert body["totals"] == {"clicks": 0, "impressions": 0, "ctr": None, "position": None}
    assert body["queries"] == [] and body["pages"] == [] and body["devices"] == []


@pytest.mark.asyncio
async def test_token_is_reused_until_five_minutes_before_expiry(google, admin_client):
    await _get(admin_client, _range(28))
    await _get(admin_client, _range(7))  # 不同期間 → 查詢要重打，權杖不必重換
    assert len(google.fake.token_calls) == 1
    assert len(google.fake.query_calls) == 8

    google.clock.advance(3600 - 301)  # 還沒到過期前 5 分鐘
    await _get(admin_client, _range(90))
    assert len(google.fake.token_calls) == 1

    google.clock.advance(2)  # 過了
    await _get(admin_client, _range(14))
    assert len(google.fake.token_calls) == 2


@pytest.mark.asyncio
async def test_results_are_cached_six_hours_per_period_and_dimension(google, admin_client):
    await _get(admin_client)
    await _get(admin_client)
    assert len(google.fake.query_calls) == 4

    await _get(admin_client, _range(7))  # 不同期間是另一份
    assert len(google.fake.query_calls) == 8

    google.clock.advance(6 * 3600 - 1)
    await _get(admin_client)
    assert len(google.fake.query_calls) == 8

    google.clock.advance(2)
    await _get(admin_client)
    assert len(google.fake.query_calls) == 12


@pytest.mark.asyncio
async def test_concurrent_requests_for_the_same_period_hit_google_once(google, admin_client):
    google.fake.delay = 0.02
    bodies = await asyncio.gather(*(_get(admin_client) for _ in range(6)))
    assert all(body["totals"]["clicks"] == 42 for body in bodies)
    assert len(google.fake.query_calls) == 4
    assert len(google.fake.token_calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("token_status", [400, 401, 403])
async def test_token_failure_reports_step_and_status_only(google, admin_client, caplog, token_status):
    google.fake.token_status = token_status
    caplog.set_level(logging.DEBUG)
    body = await _get(admin_client)

    assert body == {"configured": True, "error": f"取得 Google 權杖（HTTP {token_status}）"}
    text = json.dumps(body) + caplog.text
    assert google.account.private_pem not in text and "BEGIN PRIVATE KEY" not in text
    assert "Invalid JWT" not in text and CLIENT_EMAIL not in text
    assert google.fake.query_calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("query_status", [401, 403, 429, 500])
async def test_query_failure_reports_step_and_status_only(google, admin_client, caplog, query_status):
    google.fake.query_status = query_status
    caplog.set_level(logging.DEBUG)
    body = await _get(admin_client)

    assert body == {"configured": True, "error": f"查詢 Search Console（HTTP {query_status}）"}
    text = json.dumps(body) + caplog.text
    assert ACCESS_TOKEN not in text and "no access to" not in text and google.account.private_pem not in text


@pytest.mark.asyncio
async def test_failures_are_not_cached(google, admin_client):
    google.fake.query_status = 403
    assert (await _get(admin_client))["error"].startswith("查詢 Search Console")
    google.fake.query_status = 200
    body = await _get(admin_client)
    assert body["totals"]["clicks"] == 42 and "error" not in body


@pytest.mark.asyncio
async def test_a_rejected_access_token_is_dropped_so_the_next_request_signs_in_again(google, admin_client):
    await _get(admin_client, _range(28))
    assert len(google.fake.token_calls) == 1
    google.fake.query_status = 401
    assert (await _get(admin_client, _range(7)))["error"] == "查詢 Search Console（HTTP 401）"
    google.fake.query_status = 200
    await _get(admin_client, _range(7))
    assert len(google.fake.token_calls) == 2


@pytest.mark.asyncio
async def test_network_failure_names_the_exception_type_only(app, google, admin_client, caplog):
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"connection refused for {request.url} {ACCESS_TOKEN}")

    app.state.google_transport = httpx.MockTransport(broken)
    caplog.set_level(logging.DEBUG)
    body = await _get(admin_client)
    assert body == {"configured": True, "error": "取得 Google 權杖（ConnectError）"}
    assert ACCESS_TOKEN not in caplog.text + json.dumps(body)


@pytest.mark.asyncio
async def test_unusable_private_key_does_not_leak_the_key(app, google, admin_client, caplog):
    broken = json.loads(google.account.json_text)
    # 外型像私鑰、內容不是：啟動時的格式檢查放行，簽章時才會失敗。
    broken["private_key"] = "-----BEGIN PRIVATE KEY-----\nQUJDREVGRw==\n-----END PRIVATE KEY-----\n"
    app.state.settings = app.state.settings.model_copy(update={"google_sc_service_account_json": json.dumps(broken)})
    caplog.set_level(logging.DEBUG)
    body = await _get(admin_client)

    assert body["configured"] is True and body["error"].startswith("簽署服務帳戶憑證")
    assert "QUJDREVGRw" not in json.dumps(body) + caplog.text
    assert google.fake.token_calls == []


@pytest.mark.asyncio
async def test_secrets_never_reach_the_httpx_info_log(google, admin_client, caplog):
    caplog.set_level(logging.INFO)
    await _get(admin_client)
    assert caplog.text  # httpx 的 INFO 有印請求，下面的檢查才有意義
    assert ACCESS_TOKEN not in caplog.text
    assert google.account.private_pem not in caplog.text
    assert "assertion" not in caplog.text


@pytest.mark.asyncio
async def test_url_prefix_property_is_encoded_into_the_path(app, google, admin_client):
    seen: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "searchconsole.googleapis.com":
            seen.append(request.url.raw_path.decode())
            return httpx.Response(200, json={})
        return await google.fake.handler(request)

    app.state.settings = app.state.settings.model_copy(update={"google_sc_property": "https://www.ivykidschool.com/"})
    app.state.google_transport = httpx.MockTransport(handler)
    body = await _get(admin_client)
    assert body["configured"] is True and "error" not in body
    assert seen and all("/sites/https%3A%2F%2Fwww.ivykidschool.com%2F/searchAnalytics/query" in path for path in seen)


@pytest.mark.asyncio
async def test_long_or_odd_rows_are_bounded(google, admin_client):
    google.fake.rows["query"] = [search_row(["字" * 500], 1, 2, 0.5, 3.0)]
    google.fake.rows["page"] = [search_row(["https://www.ivykidschool.com"], 1, 2, 0.5, 3.0), search_row(["not a url"], 1, 2, 0.5, 3.0)]
    google.fake.rows["device"] = [search_row(["SMART_TV"], 1, 2, 0.5, 3.0), search_row(["MOBILE"], 1, 2, 0.5, 3.0)]
    body = await _get(admin_client)
    assert len(body["queries"][0]["query"]) <= 200
    assert [row["page"] for row in body["pages"]][0] == "/"
    assert [row["device"] for row in body["devices"]] == ["mobile"]


# ---- 期間 ----


@pytest.mark.asyncio
async def test_period_defaults_to_the_last_28_days(google, admin_client):
    body = await _get(admin_client, "")
    assert body["end"] == today_local().isoformat()
    assert body["start"] == (today_local() - timedelta(days=27)).isoformat()


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["start_after_end", "end_in_future", "older_than_16_months", "not_a_date"])
async def test_invalid_periods_are_rejected_without_calling_google(google, admin_client, bad):
    today = today_local()
    query = {
        "start_after_end": f"?start={today.isoformat()}&end={(today - timedelta(days=3)).isoformat()}",
        "end_in_future": f"?start={today.isoformat()}&end={(today + timedelta(days=1)).isoformat()}",
        "older_than_16_months": f"?start={(today - timedelta(days=16 * 31 + 10)).isoformat()}&end={today.isoformat()}",
        "not_a_date": "?start=yesterday&end=today",
    }[bad]
    response = await admin_client.get(f"{URL}{query}")
    assert response.status_code == 422
    assert google.fake.query_calls == [] and google.fake.token_calls == []


@pytest.mark.asyncio
async def test_sixteen_months_back_is_accepted(google, admin_client):
    today = today_local()
    month = today.month - 16
    year = today.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    start = date(year, month, min(today.day, calendar.monthrange(year, month)[1]))
    body = await _get(admin_client, f"?start={start.isoformat()}&end={today.isoformat()}")
    assert body["start"] == start.isoformat()
