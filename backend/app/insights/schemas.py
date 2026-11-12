"""後台「Google 搜尋」與「Chrome 真實使用者」兩支 API 的回應。

路由用 response_model_exclude_unset：沒設定回 `{configured: false}`、Google 失敗回
`{configured: true, error: "…"}`，其餘欄位不出現；有資料時欄位都明寫（空值是 null，不是缺少）。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class SearchMetricsOut(BaseModel):
    clicks: int
    impressions: int
    # 點閱率是 0～1 的小數（0.042＝4.2%），平均排名是 1 起算的位置；沒有曝光時兩者都是 null。
    ctr: float | None
    position: float | None


class SearchQueryRowOut(BaseModel):
    query: str
    clicks: int
    impressions: int
    ctr: float
    position: float


class SearchPageRowOut(BaseModel):
    # 只有路徑（/campus/yihua），沒有網域、查詢字串或 #片段。
    page: str
    clicks: int
    impressions: int
    ctr: float
    position: float


class SearchDeviceRowOut(BaseModel):
    device: Literal["mobile", "desktop", "tablet"]
    clicks: int
    impressions: int
    ctr: float
    position: float


class SearchInsightsOut(BaseModel):
    configured: bool
    # 「<步驟>（HTTP n）」；只有 configured 為 true 且查詢失敗時才有。
    error: str | None = None
    start: date | None = None
    end: date | None = None
    # 最舊那份快取是什麼時候向 Google 查的（結果最多快取 6 小時）。
    as_of: datetime | None = None
    totals: SearchMetricsOut | None = None
    queries: list[SearchQueryRowOut] = Field(default_factory=list)
    pages: list[SearchPageRowOut] = Field(default_factory=list)
    devices: list[SearchDeviceRowOut] = Field(default_factory=list)


class CruxValueOut(BaseModel):
    """一個指標在一個 28 天視窗的 p75（LCP、INP 單位毫秒；CLS 無單位）與好／需要改善／不佳的比例（0～1）。
    那個視窗沒有資料時四個欄位都是 null。"""

    p75: float | None
    good: float | None
    needs_improvement: float | None
    poor: float | None


class CruxWeekOut(BaseModel):
    # 28 天滾動視窗的最後一天；每週更新一格，由舊到新。
    last_date: date
    lcp: CruxValueOut
    inp: CruxValueOut
    cls: CruxValueOut


class CruxDeviceOut(BaseModel):
    form_factor: Literal["phone", "desktop"]
    # insufficient＝Google 回 404：Chrome 使用者數量還不夠，沒有這個網站的數據。
    status: Literal["ok", "insufficient"]
    weeks: list[CruxWeekOut]


class CruxOut(BaseModel):
    configured: bool
    error: str | None = None
    origin: str | None = None
    as_of: datetime | None = None
    devices: list[CruxDeviceOut] = Field(default_factory=list)
