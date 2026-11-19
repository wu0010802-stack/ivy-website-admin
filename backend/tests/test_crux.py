"""CrUX 真實使用者數據（docs/specs/2026-11-12-external-integrations-design.md §4）：
History API、origin 層級、PHONE 與 DESKTOP 各一次、LCP／INP／CLS 的 p75 與好／需改善／差比例，
快取 12 小時；404＝資料量不足；金鑰只走 X-Goog-Api-Key 標頭，不進網址、log、例外、回應。"""

from __future__ import annotations

import asyncio
import json
import logging

import httpx
import pytest

from tests.google_helpers import CRUX_KEY, FakeCrux

URL = "/api/website/v1/admin/crux"
USER_AGENT = "Mozilla/5.0 (compatible; ivy-website-crux/1.0)"
ORIGIN = "https://www.ivykidschool.com"


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def crux(app):
    fake = FakeCrux(origin=ORIGIN)
    clock = FakeClock()
    original = app.state.settings
    app.state.settings = original.model_copy(update={"crux_api_key": CRUX_KEY, "public_origin": ORIGIN})
    app.state.google_transport = httpx.MockTransport(fake.handler)
    app.state.crux.clock = clock
    fake.clock = clock
    yield fake
    app.state.settings = original
    app.state.google_transport = None


async def _get(client) -> dict:
    response = await client.get(URL)
    assert response.status_code == 200, response.text
    return response.json()


def _device(body: dict, form_factor: str) -> dict:
    return next(device for device in body["devices"] if device["form_factor"] == form_factor)


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
async def test_only_super_admin_can_read(crux, minghua_client, public_client):
    assert (await minghua_client.get(URL)).status_code == 403
    assert (await public_client.get(URL)).status_code == 401
    assert crux.calls == []


@pytest.mark.asyncio
async def test_queries_phone_and_desktop_for_the_site_origin(crux, admin_client):
    body = await _get(admin_client)

    assert sorted(crux.form_factors_asked()) == ["DESKTOP", "PHONE"]
    for call in crux.calls:
        assert call["origin"] == ORIGIN
        assert call["collectionPeriodCount"] == 25
        assert sorted(call["metrics"]) == [
            "cumulative_layout_shift", "interaction_to_next_paint", "largest_contentful_paint",
        ]
    assert set(crux.user_agents) == {USER_AGENT}
    assert body["configured"] is True and "error" not in body
    assert body["origin"] == ORIGIN
    assert body["as_of"]
    assert [device["form_factor"] for device in body["devices"]] == ["phone", "desktop"]


@pytest.mark.asyncio
async def test_returns_weekly_p75_and_rating_shares_per_metric(crux, admin_client):
    body = await _get(admin_client)
    phone = _device(body, "phone")

    assert phone["status"] == "ok"
    assert len(phone["weeks"]) == 25
    first, last = phone["weeks"][0], phone["weeks"][-1]
    assert last["last_date"] == "2026-11-08"
    # 最舊一格沒有資料（index 0 是 None）：每個欄位都是 null，不是 0。
    assert first["lcp"] == {"p75": None, "good": None, "needs_improvement": None, "poor": None}
    # 最新一格：LCP p75 2000+10*24，好／需改善／差各自的比例。
    assert last["lcp"]["p75"] == 2240
    assert last["lcp"]["good"] == pytest.approx(0.824)
    assert last["lcp"]["needs_improvement"] == pytest.approx(0.15)
    assert last["lcp"]["poor"] == pytest.approx(0.026)
    assert last["inp"]["p75"] == 204
    # CLS 的 p75 在真實回應裡是字串，要轉成數字。
    assert last["cls"]["p75"] == pytest.approx(0.074)
    assert isinstance(last["cls"]["p75"], float)


@pytest.mark.asyncio
async def test_missing_data_is_reported_as_insufficient_not_as_an_error(crux, admin_client):
    crux.statuses = {"PHONE": 404}
    body = await _get(admin_client)
    assert "error" not in body
    assert _device(body, "phone") == {"form_factor": "phone", "status": "insufficient", "weeks": []}
    assert _device(body, "desktop")["status"] == "ok"

    crux.clock.advance(12 * 3600 + 1)  # 上一輪的結果過期了，才會重問
    crux.statuses = {"PHONE": 404, "DESKTOP": 404}
    both = await _get(admin_client)
    assert all(device["status"] == "insufficient" for device in both["devices"])
    assert "error" not in both


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [400, 401, 403, 429, 500])
async def test_failures_report_step_and_status_only(crux, admin_client, caplog, status):
    crux.statuses = {"PHONE": status, "DESKTOP": status}
    caplog.set_level(logging.DEBUG)
    body = await _get(admin_client)

    assert body == {"configured": True, "error": f"查詢 CrUX（HTTP {status}）"}
    assert CRUX_KEY not in json.dumps(body) + caplog.text
    assert "not valid" not in json.dumps(body) + caplog.text


@pytest.mark.asyncio
async def test_a_failing_device_fails_the_whole_answer_but_keeps_the_good_one_cached(crux, admin_client):
    crux.statuses = {"DESKTOP": 500}
    assert (await _get(admin_client))["error"] == "查詢 CrUX（HTTP 500）"
    asked_before = crux.form_factors_asked().count("PHONE")
    crux.statuses = {}
    body = await _get(admin_client)
    assert body["devices"][0]["status"] == "ok" and "error" not in body
    # 手機那份上一輪已成功，不必再問 Google。
    assert crux.form_factors_asked().count("PHONE") == asked_before


@pytest.mark.asyncio
async def test_results_are_cached_for_twelve_hours(crux, admin_client):
    await _get(admin_client)
    await _get(admin_client)
    assert len(crux.calls) == 2

    crux.clock.advance(12 * 3600 - 1)
    await _get(admin_client)
    assert len(crux.calls) == 2

    crux.clock.advance(2)
    await _get(admin_client)
    assert len(crux.calls) == 4


@pytest.mark.asyncio
async def test_insufficient_answers_are_cached_too(crux, admin_client):
    crux.statuses = {"PHONE": 404, "DESKTOP": 404}
    await _get(admin_client)
    await _get(admin_client)
    assert len(crux.calls) == 2


@pytest.mark.asyncio
async def test_concurrent_requests_hit_google_once_per_device(crux, admin_client):
    crux.delay = 0.02
    bodies = await asyncio.gather(*(_get(admin_client) for _ in range(6)))
    assert all(body["devices"][0]["status"] == "ok" for body in bodies)
    assert len(crux.calls) == 2


@pytest.mark.asyncio
async def test_api_key_is_only_ever_sent_as_a_header(crux, admin_client, caplog):
    caplog.set_level(logging.INFO)
    body = await _get(admin_client)

    assert caplog.text  # httpx 的 INFO 紀錄會印出完整網址；金鑰在網址裡就會出現在這裡
    assert CRUX_KEY not in caplog.text
    assert CRUX_KEY not in json.dumps(body)
    assert all(CRUX_KEY not in str(url) and "key=" not in str(url) for url in crux.urls)


@pytest.mark.asyncio
async def test_network_failure_names_the_exception_type_only(app, crux, admin_client, caplog):
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout(f"timed out {request.headers['x-goog-api-key']}")

    app.state.google_transport = httpx.MockTransport(broken)
    caplog.set_level(logging.DEBUG)
    body = await _get(admin_client)
    assert body == {"configured": True, "error": "查詢 CrUX（ReadTimeout）"}
    assert CRUX_KEY not in caplog.text + json.dumps(body)


@pytest.mark.asyncio
async def test_without_a_site_origin_it_says_so_instead_of_guessing(app, crux, admin_client):
    app.state.settings = app.state.settings.model_copy(update={"public_origin": None, "admin_origin": None})
    body = await _get(admin_client)
    assert body["configured"] is True
    assert "WEBSITE_PUBLIC_ORIGIN" in body["error"]
    assert crux.calls == []


@pytest.mark.asyncio
async def test_odd_payloads_degrade_to_nulls(app, crux, admin_client):
    async def odd(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        record = {
            "record": {
                "key": {"formFactor": body["formFactor"], "origin": body["origin"]},
                "metrics": {
                    # 只有 LCP，而且 p75 與比例的長度跟 collectionPeriods 不一致、混了垃圾值。
                    "largest_contentful_paint": {
                        "histogramTimeseries": [{"densities": [0.5, "x"]}, {"densities": [0.3]}, {"densities": [0.2, 0.1, 0.1]}],
                        "percentilesTimeseries": {"p75s": [2100, "bad", None]},
                    },
                },
                "collectionPeriods": [
                    {"lastDate": {"year": 2026, "month": 11, "day": 1}},
                    {"lastDate": {"year": 2026, "month": 11, "day": 8}},
                    {"lastDate": {"year": 2026, "month": 13, "day": 40}},  # 不合法的日期整格略過
                ],
            }
        }
        return httpx.Response(200, json=record)

    app.state.google_transport = httpx.MockTransport(odd)
    body = await _get(admin_client)
    weeks = _device(body, "phone")["weeks"]
    assert [week["last_date"] for week in weeks] == ["2026-11-01", "2026-11-08"]
    assert weeks[0]["lcp"] == {"p75": 2100, "good": 0.5, "needs_improvement": 0.3, "poor": 0.2}
    assert weeks[1]["lcp"]["p75"] is None and weeks[1]["lcp"]["good"] is None
    assert weeks[0]["inp"]["p75"] is None and weeks[0]["cls"]["p75"] is None
