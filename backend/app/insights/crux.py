"""CrUX（Chrome 使用者體驗報告）真實使用者數據（docs/specs/2026-11-12-external-integrations-design.md §4）。

History API `records:queryHistoryRecord`：官網 origin 層級，PHONE 與 DESKTOP 各查一次，LCP／INP／CLS 的 p75 與
好／需要改善／不佳比例，最近 25 個收集視窗（每週一格、各涵蓋 28 天）。每個裝置的結果快取 12 小時。

API 金鑰只放 X-Goog-Api-Key 標頭。放在網址（?key=）會被 httpx 的 INFO 紀錄原樣印出
（2026-11-10 Facebook 同步曾因此把 token 寫進 log），所以這支 client 的網址從頭到尾不帶任何秘密。
Google 回 404 代表 Chrome 使用者數量不夠、沒有這個網站的數據：那是正常狀態（status=insufficient），不是錯誤。"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from datetime import date

import httpx

from app.config import Settings
from app.insights.cache import Cached, TtlCache
from app.insights.http import CRUX_USER_AGENT, GoogleApiError, new_client, post_json
from app.insights.schemas import CruxDeviceOut, CruxOut, CruxValueOut, CruxWeekOut

logger = logging.getLogger("app.insights")

QUERY_URL = "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord"
PERIOD_COUNT = 25
RESULT_TTL_SECONDS = 12 * 3600
STEP_QUERY = "查詢 CrUX"
# 輸出的裝置名 → CrUX 的 formFactor；順序就是畫面的順序。
FORM_FACTORS = (("phone", "PHONE"), ("desktop", "DESKTOP"))
# 輸出的指標名 → CrUX 的指標名。
METRICS = (
    ("lcp", "largest_contentful_paint"),
    ("inp", "interaction_to_next_paint"),
    ("cls", "cumulative_layout_shift"),
)


def _number(value: object) -> float | None:
    """CrUX 的 CLS p75 是字串（"0.05"），其餘是數字；缺資料是 null。其他一律當沒有。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _at(series: object, index: int) -> float | None:
    return _number(series[index]) if isinstance(series, list) and index < len(series) else None


def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)


def _density(bins: object, rank: int, index: int) -> float | None:
    """histogramTimeseries 依序是 good、needs improvement、poor 三格。"""
    if not isinstance(bins, list) or rank >= len(bins) or not isinstance(bins[rank], dict):
        return None
    return _round(_at(bins[rank].get("densities"), index), 4)


def _value(metric: object, index: int) -> CruxValueOut:
    percentiles = metric.get("percentilesTimeseries") if isinstance(metric, dict) else None
    p75s = percentiles.get("p75s") if isinstance(percentiles, dict) else None
    bins = metric.get("histogramTimeseries") if isinstance(metric, dict) else None
    return CruxValueOut(
        p75=_round(_at(p75s, index), 3),
        good=_density(bins, 0, index),
        needs_improvement=_density(bins, 1, index),
        poor=_density(bins, 2, index),
    )


def _date(value: object) -> date | None:
    if not isinstance(value, dict):
        return None
    try:
        return date(int(value["year"]), int(value["month"]), int(value["day"]))
    except (KeyError, TypeError, ValueError):
        return None


def parse_history(data: object) -> list[CruxWeekOut]:
    """一個裝置的時間序列轉成每個收集視窗一列（由舊到新）；日期不合法的視窗整格略過。"""
    record = data.get("record") if isinstance(data, dict) else None
    if not isinstance(record, dict):
        raise GoogleApiError(STEP_QUERY, status=200, reason="回應格式不對")
    metrics = record.get("metrics") if isinstance(record.get("metrics"), dict) else {}
    periods = record.get("collectionPeriods")
    weeks: list[CruxWeekOut] = []
    for index, period in enumerate(periods if isinstance(periods, list) else []):
        last = _date(period.get("lastDate")) if isinstance(period, dict) else None
        if last is None:
            continue
        weeks.append(CruxWeekOut(
            last_date=last,
            **{name: _value(metrics.get(crux_name), index) for name, crux_name in METRICS},
        ))
    return weeks


class CruxHistory:
    """一個程序一份（app.state.crux）：兩個裝置各自的快取。clock 可由測試換成假時鐘。"""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self.clock = clock
        self._results: TtlCache[CruxDeviceOut] = TtlCache(RESULT_TTL_SECONDS, clock=lambda: self.clock())

    async def _device(
        self, client: httpx.AsyncClient, settings: Settings, origin: str, name: str, form_factor: str
    ) -> Cached[CruxDeviceOut]:
        assert settings.crux_api_key
        api_key = settings.crux_api_key

        async def fetch() -> CruxDeviceOut:
            status, data = await post_json(
                client, STEP_QUERY, QUERY_URL,
                json={
                    "origin": origin,
                    "formFactor": form_factor,
                    "metrics": [crux_name for _, crux_name in METRICS],
                    "collectionPeriodCount": PERIOD_COUNT,
                },
                headers={"X-Goog-Api-Key": api_key},
            )
            if status == 404:
                return CruxDeviceOut(form_factor=name, status="insufficient", weeks=[])  # type: ignore[arg-type]
            if status != 200:
                raise GoogleApiError(STEP_QUERY, status=status)
            return CruxDeviceOut(form_factor=name, status="ok", weeks=parse_history(data))  # type: ignore[arg-type]

        return await self._results.get((origin, form_factor), fetch)

    async def history(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> CruxOut:
        """兩個裝置都查到才回資料；任何一步失敗丟 GoogleApiError（已成功的那個裝置仍留在快取）。"""
        if not settings.crux_enabled:
            return CruxOut(configured=False)
        origin = settings.crux_origin
        if not origin:
            return CruxOut(
                configured=True,
                error="查詢 CrUX（沒有官網網址，請設定 WEBSITE_PUBLIC_ORIGIN 或 WEBSITE_ADMIN_ORIGIN）",
            )
        async with new_client(CRUX_USER_AGENT, transport) as client:
            # 兩個裝置同時問；其中一個失敗時另一個照樣跑完、結果進快取（任務不被取消，下次就不必再問）。
            results = await asyncio.gather(
                *(self._device(client, settings, origin, name, form_factor) for name, form_factor in FORM_FACTORS),
                return_exceptions=True,
            )
        for result in results:
            if isinstance(result, BaseException):
                raise result
        parts: list[Cached[CruxDeviceOut]] = list(results)  # type: ignore[arg-type]
        return CruxOut(
            configured=True,
            origin=origin,
            as_of=min(part.fetched_at for part in parts),
            devices=[part.value for part in parts],
        )
