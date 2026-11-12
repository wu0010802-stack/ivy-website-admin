"""Search Console 與 CrUX 的測試共用：臨時產生的服務帳戶金鑰、假 Google。

私鑰每次測試現產（cryptography），不放進 repo；假 Google 會真的驗證 JWT 簽章與聲明，
所以簽錯演算法、少了 scope、aud 不對都會被抓到。"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from urllib.parse import parse_qs, unquote

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from joserfc import jwt
from joserfc.jwk import RSAKey

CLIENT_EMAIL = "insights-reader@ivy-test-project.iam.gserviceaccount.com"
PROPERTY = "sc-domain:ivykidschool.com"
ACCESS_TOKEN = "ya29.test-access-token-never-leak"
CRUX_KEY = "AIzaSyTestCruxKeyNeverLeak0123456789abc"


@dataclass(frozen=True)
class ServiceAccount:
    json_text: str
    private_pem: str
    public_pem: str


def make_service_account(*, client_email: str = CLIENT_EMAIL) -> ServiceAccount:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    public_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    body = {
        "type": "service_account",
        "project_id": "ivy-test-project",
        "private_key_id": "0123456789abcdef",
        "private_key": private_pem,
        "client_email": client_email,
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    return ServiceAccount(json.dumps(body), private_pem, public_pem)


def search_row(keys: list[str] | None, clicks: int, impressions: int, ctr: float, position: float) -> dict:
    row = {"clicks": clicks, "impressions": impressions, "ctr": ctr, "position": position}
    return {"keys": keys, **row} if keys is not None else row


@dataclass
class FakeGoogle:
    """oauth2.googleapis.com 與 searchconsole.googleapis.com。"""

    account: ServiceAccount
    token_status: int = 200
    query_status: int = 200
    delay: float = 0.0
    token_calls: list[dict] = field(default_factory=list)
    query_calls: list[dict] = field(default_factory=list)
    query_urls: list[httpx.URL] = field(default_factory=list)
    user_agents: list[str] = field(default_factory=list)
    # 維度 → 回傳的 rows；沒有維度的總計用 None 當鍵。
    rows: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.rows:
            self.rows = {
                None: [search_row(None, 42, 1000, 0.042, 8.76)],
                "query": [search_row(["常春藤幼兒園"], 20, 300, 0.0667, 2.3), search_row(["義華 幼兒園"], 9, 200, 0.045, 5.5)],
                "page": [
                    search_row(["https://www.ivykidschool.com/"], 25, 500, 0.05, 4.0),
                    search_row(["https://www.ivykidschool.com/campus/yihua?utm_source=x#top"], 10, 250, 0.04, 6.0),
                ],
                "device": [
                    search_row(["MOBILE"], 30, 700, 0.043, 8.0),
                    search_row(["DESKTOP"], 11, 280, 0.039, 9.5),
                    search_row(["TABLET"], 1, 20, 0.05, 12.0),
                ],
            }

    async def handler(self, request: httpx.Request) -> httpx.Response:
        if self.delay:
            await asyncio.sleep(self.delay)
        self.user_agents.append(request.headers.get("user-agent", ""))
        host = request.url.host
        if host == "oauth2.googleapis.com":
            return self._token(request)
        if host == "searchconsole.googleapis.com":
            return self._query(request)
        return httpx.Response(404)

    def _token(self, request: httpx.Request) -> httpx.Response:
        form = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
        assert request.method == "POST" and request.url.path == "/token"
        assert form["grant_type"] == "urn:ietf:params:oauth:grant-type:jwt-bearer"
        decoded = jwt.decode(form["assertion"], RSAKey.import_key(self.account.public_pem), algorithms=["RS256"])
        claims = decoded.claims
        assert decoded.header["alg"] == "RS256"
        assert claims["iss"] == CLIENT_EMAIL
        assert claims["scope"] == "https://www.googleapis.com/auth/webmasters.readonly"
        assert claims["aud"] == "https://oauth2.googleapis.com/token"
        assert 0 < claims["exp"] - claims["iat"] <= 3600
        self.token_calls.append(claims)
        if self.token_status != 200:
            # Google 真的會在 error_description 帶一些細節；不能出現在我們的錯誤裡。
            return httpx.Response(
                self.token_status,
                json={"error": "invalid_grant", "error_description": f"Invalid JWT for {CLIENT_EMAIL}: {self.account.private_pem[:60]}"},
            )
        return httpx.Response(200, json={"access_token": ACCESS_TOKEN, "expires_in": 3600, "token_type": "Bearer"})

    def _query(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.headers["authorization"] == f"Bearer {ACCESS_TOKEN}"
        raw_path = request.url.raw_path.decode()
        assert raw_path.endswith("/searchAnalytics/query"), raw_path
        assert unquote(raw_path.split("/sites/", 1)[1].rsplit("/searchAnalytics", 1)[0]) == PROPERTY
        # 網站識別裡的冒號必須編碼，否則 Google 找不到資源。
        assert "sc-domain%3Aivykidschool.com" in raw_path
        body = json.loads(request.content)
        self.query_calls.append(body)
        self.query_urls.append(request.url)
        if self.query_status != 200:
            return httpx.Response(self.query_status, json={"error": {"code": self.query_status, "message": f"no access to {PROPERTY} {ACCESS_TOKEN}"}})
        dimensions = body.get("dimensions") or []
        key = dimensions[0] if dimensions else None
        rows = self.rows.get(key, [])
        payload = {"rows": rows, "responseAggregationType": "byProperty"} if rows else {"responseAggregationType": "byProperty"}
        return httpx.Response(200, json=payload)

    def dimensions_asked(self) -> list:
        return [(call.get("dimensions") or [None])[0] for call in self.query_calls]


def metric_history(p75s: list, good: list, ni: list, poor: list, *, string_p75: bool = False) -> dict:
    """CrUX History API 一個指標的時間序列；CLS 的 p75 在真實回應裡是字串。"""
    return {
        "histogramTimeseries": [
            {"start": 0, "end": 2500, "densities": good},
            {"start": 2500, "end": 4000, "densities": ni},
            {"start": 4000, "densities": poor},
        ],
        "percentilesTimeseries": {"p75s": [None if v is None else (str(v) if string_p75 else v) for v in p75s]},
    }


def crux_record(origin: str, form_factor: str, weeks: int = 25, *, lcp_base: int = 2000) -> dict:
    """最後一週（window 結束日 2026-11-08）往前每週一格，第 0 格（最舊）的資料是空的。"""
    from datetime import date, timedelta

    last = date(2026, 11, 8)
    periods = []
    for index in range(weeks):
        end = last - timedelta(days=7 * (weeks - 1 - index))
        start = end - timedelta(days=27)
        periods.append({
            "firstDate": {"year": start.year, "month": start.month, "day": start.day},
            "lastDate": {"year": end.year, "month": end.month, "day": end.day},
        })

    def series(base, step):
        return [None if i == 0 else base + step * i for i in range(weeks)]

    return {
        "record": {
            "key": {"formFactor": form_factor, "origin": origin},
            "metrics": {
                "largest_contentful_paint": metric_history(
                    series(lcp_base, 10), series(0.8, 0.001), series(0.15, 0.0), series(0.05, -0.001)
                ),
                "interaction_to_next_paint": metric_history(
                    series(180, 1), series(0.9, 0.0), series(0.07, 0.0), series(0.03, 0.0)
                ),
                "cumulative_layout_shift": metric_history(
                    series(0.05, 0.001), series(0.95, 0.0), series(0.04, 0.0), series(0.01, 0.0), string_p75=True
                ),
            },
            "collectionPeriods": periods,
        }
    }


@dataclass
class FakeCrux:
    api_key: str = CRUX_KEY
    origin: str = "https://www.ivykidschool.com"
    # 裝置 → HTTP 狀態；沒列的是 200。
    statuses: dict = field(default_factory=dict)
    delay: float = 0.0
    calls: list[dict] = field(default_factory=list)
    urls: list[httpx.URL] = field(default_factory=list)
    user_agents: list[str] = field(default_factory=list)
    weeks: int = 25

    async def handler(self, request: httpx.Request) -> httpx.Response:
        if self.delay:
            await asyncio.sleep(self.delay)
        assert request.url.host == "chromeuxreport.googleapis.com"
        assert request.method == "POST" and request.url.path == "/v1/records:queryHistoryRecord"
        # 金鑰只走標頭：網址（會被 httpx 的 INFO log 印出）不能有。
        assert request.headers["x-goog-api-key"] == self.api_key
        assert "key" not in request.url.params and self.api_key not in str(request.url)
        body = json.loads(request.content)
        self.calls.append(body)
        self.urls.append(request.url)
        self.user_agents.append(request.headers.get("user-agent", ""))
        form_factor = body["formFactor"]
        status = self.statuses.get(form_factor, 200)
        if status == 404:
            return httpx.Response(404, json={"error": {"code": 404, "message": "chrome ux report data not found", "status": "NOT_FOUND"}})
        if status != 200:
            return httpx.Response(status, json={"error": {"code": status, "message": f"API key {self.api_key} not valid"}})
        return httpx.Response(200, json=crux_record(body["origin"], form_factor, self.weeks))

    def form_factors_asked(self) -> list[str]:
        return [call["formFactor"] for call in self.calls]
