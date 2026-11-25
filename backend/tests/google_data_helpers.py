"""商家檔案與 Keyword Planner 測試共用：假的 oauth2.googleapis.com（refresh token）、businessprofileperformance、googleads。

假 Google 會驗 refresh token、用戶端、Authorization 標頭與查詢參數，回應格式照官方文件（int64 是字串、值為 0 時不出現）。"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from urllib.parse import parse_qs

import httpx

from app.config import Settings

CLIENT_ID = "1234567890-test.apps.googleusercontent.com"
CLIENT_SECRET = "GOCSPX-test-client-secret-never-leak"
GBP_REFRESH = "1//gbp-refresh-token-never-leak"
ADS_REFRESH = "1//ads-refresh-token-never-leak"
GBP_ACCESS = "ya29.gbp-access-never-leak"
ADS_ACCESS = "ya29.ads-access-never-leak"
LOCATION = "11223344556677889900"
CUSTOMER = "5823451021"
MANAGER = "1112223333"
DEV_TOKEN = "dev-token-never-leak"
SECRETS = (CLIENT_SECRET, GBP_REFRESH, ADS_REFRESH, GBP_ACCESS, ADS_ACCESS, DEV_TOKEN)
MONTH_NAMES = (
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
)


def settings_with(base: Settings | None = None, *, gbp: bool = True, ads: bool = True, **overrides) -> Settings:
    values = dict(
        database_url="postgresql://localhost/ivy_website_dev",
        environment="test",
        test_database_url="postgresql://localhost/ivy_website_test",
        session_secret="test-only-secret-please-rotate",
    )
    google: dict = {"google_api_client_id": CLIENT_ID, "google_api_client_secret": CLIENT_SECRET}
    if gbp:
        google |= {"gbp_refresh_token": GBP_REFRESH, "gbp_locations": f"yihua={LOCATION}"}
    if ads:
        google |= {"google_ads_refresh_token": ADS_REFRESH, "google_ads_customer_id": "582-345-1021"}
    if base is not None:
        # model_copy 不跑驗證器：帳戶編號直接給正規化後的寫法。
        if ads:
            google["google_ads_customer_id"] = CUSTOMER
        return base.model_copy(update={**google, **overrides})
    return Settings(**{**values, **google, **overrides})


def _date(params: dict, prefix: str) -> date:
    return date(int(params[f"{prefix}.year"][0]), int(params[f"{prefix}.month"][0]), int(params[f"{prefix}.day"][0]))


@dataclass
class FakeGoogleData:
    # 每日值：(日, DailyMetric 名稱) → 數字；沒列的日子在 Google 的範圍內就回沒有 value 的點（＝0）。
    daily: dict[tuple[date, str], int] = field(default_factory=dict)
    # 只有這一天（含）以後的日子有資料；更早的段落回 400（模擬「超出保留範圍」）。
    history_from: date | None = None
    # 搜尋字詞：月（1 號）→ [(字詞, 值或 None, 門檻或 None)]
    keywords: dict[date, list[tuple[str, int | None, int | None]]] = field(default_factory=dict)
    keyword_page_size: int = 100
    # Keyword Planner：地區代碼 → results 清單（官方 JSON 形狀）；沒列的地區回空 results。
    ads_results: dict[str, list[dict]] = field(default_factory=dict)
    # 各種故障：步驟 → HTTP 狀態
    fail: dict[str, int] = field(default_factory=dict)
    ads_fail_geos: dict[str, int] = field(default_factory=dict)
    token_requests: list[dict] = field(default_factory=list)
    daily_requests: list[tuple[date, date]] = field(default_factory=list)
    keyword_requests: list[date] = field(default_factory=list)
    ads_requests: list[tuple[dict, dict]] = field(default_factory=list)

    async def handler(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host == "oauth2.googleapis.com":
            return self._token(request)
        if host == "businessprofileperformance.googleapis.com":
            return self._gbp(request)
        if host == "googleads.googleapis.com":
            return self._ads(request)
        return httpx.Response(404)

    def _token(self, request: httpx.Request) -> httpx.Response:
        form = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
        self.token_requests.append(form)
        if "token" in self.fail:
            return httpx.Response(self.fail["token"], json={"error": "invalid_grant", "error_description": GBP_REFRESH})
        if form.get("grant_type") != "refresh_token" or form.get("client_id") != CLIENT_ID or form.get("client_secret") != CLIENT_SECRET:
            return httpx.Response(401, json={"error": "invalid_client"})
        access = {GBP_REFRESH: GBP_ACCESS, ADS_REFRESH: ADS_ACCESS}.get(form.get("refresh_token", ""))
        if access is None:
            return httpx.Response(400, json={"error": "invalid_grant"})
        return httpx.Response(200, json={"access_token": access, "expires_in": 3599, "token_type": "Bearer"})

    def _gbp(self, request: httpx.Request) -> httpx.Response:
        if request.headers.get("authorization") != f"Bearer {GBP_ACCESS}":
            return httpx.Response(401)
        params = parse_qs(request.url.query.decode(), keep_blank_values=True)
        path = request.url.path
        if path == f"/v1/locations/{LOCATION}:fetchMultiDailyMetricsTimeSeries":
            if "daily" in self.fail:
                return httpx.Response(self.fail["daily"], json={"error": {"message": LOCATION}})
            start, end = _date(params, "dailyRange.startDate"), _date(params, "dailyRange.endDate")
            self.daily_requests.append((start, end))
            if self.history_from is not None and end < self.history_from:
                return httpx.Response(400, json={"error": {"message": "out of range"}})
            series = []
            for metric in params["dailyMetrics"]:
                points = []
                day = max(start, self.history_from or start)
                while day <= end:
                    point: dict = {"date": {"year": day.year, "month": day.month, "day": day.day}}
                    value = self.daily.get((day, metric), 0)
                    if value:
                        point["value"] = str(value)
                    points.append(point)
                    day += timedelta(days=1)
                series.append({"dailyMetric": metric, "timeSeries": {"datedValues": points}})
            return httpx.Response(200, json={"multiDailyMetricTimeSeries": [{"dailyMetricTimeSeries": series}]})
        if path == f"/v1/locations/{LOCATION}/searchkeywords/impressions/monthly":
            if "keywords" in self.fail:
                return httpx.Response(self.fail["keywords"])
            month = date(int(params["monthlyRange.startMonth.year"][0]), int(params["monthlyRange.startMonth.month"][0]), 1)
            assert params["monthlyRange.endMonth.year"][0] == str(month.year)
            assert params["monthlyRange.endMonth.month"][0] == str(month.month)
            if self.history_from is not None and month < self.history_from.replace(day=1):
                return httpx.Response(400)
            offset = int(params.get("pageToken", ["0"])[0])
            if offset == 0:
                self.keyword_requests.append(month)
            rows = self.keywords.get(month, [])
            page = rows[offset:offset + self.keyword_page_size]
            body: dict = {"searchKeywordsCounts": [
                {"searchKeyword": text, "insightsValue": {"value": str(value)} if value is not None else {"threshold": str(below)}}
                for text, value, below in page
            ]}
            if offset + self.keyword_page_size < len(rows):
                body["nextPageToken"] = str(offset + self.keyword_page_size)
            return httpx.Response(200, json=body)
        return httpx.Response(404)

    def _ads(self, request: httpx.Request) -> httpx.Response:
        if request.headers.get("authorization") != f"Bearer {ADS_ACCESS}":
            return httpx.Response(401)
        if request.url.path != f"/v26/customers/{CUSTOMER}:generateKeywordHistoricalMetrics":
            return httpx.Response(404)
        body = json.loads(request.content)
        self.ads_requests.append((body, dict(request.headers)))
        geo = body["geoTargetConstants"][0]
        if geo in self.ads_fail_geos:
            return httpx.Response(self.ads_fail_geos[geo], json={"error": {"message": DEV_TOKEN}})
        return httpx.Response(200, json={"results": self.ads_results.get(geo, [])})


def ads_result(text: str, months: dict[date, int | None], close_variants: list[str] | None = None) -> dict:
    volumes = []
    for month, searches in months.items():
        item = {"year": str(month.year), "month": MONTH_NAMES[month.month - 1]}
        if searches is not None:
            item["monthlySearches"] = str(searches)
        volumes.append(item)
    result: dict = {"text": text, "keywordMetrics": {"monthlySearchVolumes": volumes, "competition": "LOW"}}
    if close_variants:
        result["closeVariants"] = close_variants
    return result
