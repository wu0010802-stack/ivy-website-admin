"""GA4 的 Google 廣告花費與預約轉換（docs/specs/2026-11-16-ad-roi-design.md §6.1）。

與 Search Console 共用同一個服務帳戶（scope 改為 analytics.readonly），向 GA4 Data API runReport 問兩次：
花費（advertiserAdCost／Clicks／Impressions）與預約轉換（keyEvents:generate_lead），維度都是
月份、廣告活動編號、活動名稱；兩份依（月份, 活動編號）合併。結果依「資源＋期間＋種類」快取 6 小時。

access token、私鑰、GA4 資源編號、Google 回應內容都不進 log、例外、回應。"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime

import httpx

from app.config import Settings
from app.insights.cache import Cached, TtlCache
from app.insights.google_token import ServiceAccountToken
from app.insights.http import GA4_USER_AGENT, GoogleApiError, new_client, post_json

SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
REPORT_URL = "https://analyticsdata.googleapis.com/v1beta/properties/{property}:runReport"
ROW_LIMIT = 10000
RESULT_TTL_SECONDS = 6 * 3600

STEP_COST = "查詢 GA4 廣告花費"
STEP_LEADS = "查詢 GA4 預約轉換"

_DIMENSIONS = ["yearMonth", "sessionGoogleAdsCampaignId", "sessionGoogleAdsCampaignName"]
_COST_METRICS = ["advertiserAdCost", "advertiserAdClicks", "advertiserAdImpressions"]
_LEAD_METRICS = ["keyEvents:generate_lead"]
_MALFORMED = "回應格式不對"


@dataclass(frozen=True)
class GoogleCampaignMonth:
    month: str  # "2026-11"
    campaign_id: str
    campaign_name: str
    cost: int
    clicks: int
    impressions: int
    leads: int


@dataclass(frozen=True)
class Ga4AdsReport:
    currency: str | None
    time_zone: str | None
    rows: list[GoogleCampaignMonth]
    fetched_at: datetime


@dataclass(frozen=True)
class _Table:
    """一次 runReport 解析後的結果：(月, 編號, 名稱) → 指標數字。"""

    rows: dict[tuple[str, str], tuple[str, list[float]]]
    currency: str | None
    time_zone: str | None


def _parse(step: str, status: int, data: dict, metric_count: int) -> _Table:
    def bad() -> GoogleApiError:
        return GoogleApiError(step, status=status, reason=_MALFORMED)

    raw_rows = data.get("rows", [])
    if not isinstance(raw_rows, list):
        raise bad()
    row_count = data.get("rowCount", len(raw_rows))
    if isinstance(row_count, int) and not isinstance(row_count, bool) and row_count > len(raw_rows):
        raise GoogleApiError(step, status=status, reason="列數超過上限")
    rows: dict[tuple[str, str], tuple[str, list[float]]] = {}
    for row in raw_rows:
        try:
            dims = [str(item["value"]) for item in row["dimensionValues"]]
            metrics = [float(item["value"]) for item in row["metricValues"]]
        except (KeyError, TypeError, ValueError):
            raise bad() from None
        if len(dims) != len(_DIMENSIONS) or len(metrics) != metric_count:
            raise bad()
        month, campaign_id, name = dims
        if len(month) != 6 or not month.isdigit():
            raise bad()
        key = (f"{month[:4]}-{month[4:]}", campaign_id)
        previous = rows.get(key)
        # 同一個鍵理論上只會有一列；萬一重複就加總，名稱取先出現的。
        rows[key] = (previous[0] if previous else name, [a + b for a, b in zip(previous[1], metrics)] if previous else metrics)
    metadata = data.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    currency, zone = metadata.get("currencyCode"), metadata.get("timeZone")
    return _Table(rows, currency if isinstance(currency, str) else None, zone if isinstance(zone, str) else None)


class Ga4Ads:
    """一個程序一份（app.state.ga4_ads）：權杖與結果快取都在這裡。"""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self.clock = clock
        self._auth = ServiceAccountToken(SCOPE, clock=lambda: self.clock())
        self._results: TtlCache[_Table] = TtlCache(RESULT_TTL_SECONDS, clock=lambda: self.clock())

    async def _run(
        self, client: httpx.AsyncClient, settings: Settings, start: date, end: date, kind: str
    ) -> Cached[_Table]:
        account = settings.google_sc_service_account
        prop = settings.ga4_property_id
        assert account is not None and prop
        step, metrics = (STEP_COST, _COST_METRICS) if kind == "cost" else (STEP_LEADS, _LEAD_METRICS)

        async def fetch() -> _Table:
            token = await self._auth.get(client, account)
            body = {
                "dateRanges": [{"startDate": start.isoformat(), "endDate": end.isoformat()}],
                "dimensions": [{"name": name} for name in _DIMENSIONS],
                "metrics": [{"name": name} for name in metrics],
                "limit": ROW_LIMIT,
            }
            status, data = await post_json(
                client, step, REPORT_URL.format(property=prop), json=body, headers={"Authorization": f"Bearer {token}"}
            )
            if status == 401:
                self._auth.drop()
            if status != 200 or not isinstance(data, dict):
                raise GoogleApiError(step, status=status)
            return _parse(step, status, data, len(metrics))

        return await self._results.get((prop, start, end, kind), fetch)

    async def report(
        self, settings: Settings, start: date, end: date, transport: httpx.AsyncBaseTransport | None = None
    ) -> Ga4AdsReport:
        """兩次查詢都成功才回資料；任何一步失敗丟 GoogleApiError（已成功的那份仍留在快取）。"""
        async with new_client(GA4_USER_AGENT, transport) as client:
            cost = await self._run(client, settings, start, end, "cost")
            leads = await self._run(client, settings, start, end, "leads")

        merged: list[GoogleCampaignMonth] = []
        for key in sorted(cost.value.rows.keys() | leads.value.rows.keys()):
            cost_name, cost_values = cost.value.rows.get(key, ("", [0.0, 0.0, 0.0]))
            lead_name, lead_values = leads.value.rows.get(key, ("", [0.0]))
            row = GoogleCampaignMonth(
                month=key[0], campaign_id=key[1], campaign_name=cost_name or lead_name,
                cost=round(cost_values[0]), clicks=round(cost_values[1]), impressions=round(cost_values[2]),
                leads=round(lead_values[0]),
            )
            if row.cost or row.clicks or row.impressions or row.leads:
                merged.append(row)
        return Ga4AdsReport(
            currency=cost.value.currency or leads.value.currency,
            time_zone=cost.value.time_zone or leads.value.time_zone,
            rows=merged,
            fetched_at=min(cost.fetched_at, leads.fetched_at),
        )
