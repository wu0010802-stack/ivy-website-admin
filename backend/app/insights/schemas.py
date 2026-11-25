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


SearchQueryGroup = Literal["brand", "local", "category", "other"]


class SearchQueryRowOut(BaseModel):
    query: str
    # 2026-11-20：brand＝找我們、local＝帶高雄地名、category＝找園所沒帶地名、other（search_console.query_group）。
    group: SearchQueryGroup
    clicks: int
    impressions: int
    ctr: float
    position: float


class SearchQueryGroupOut(BaseModel):
    group: SearchQueryGroup
    queries: int
    clicks: int
    impressions: int
    ctr: float | None
    position: float | None


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
    # 2026-11-20：Google 回了幾個搜尋字詞（最多 500）、各群加總、曝光多點擊少的字詞（最多 10 個）。
    queries_seen: int | None = None
    query_groups: list[SearchQueryGroupOut] = Field(default_factory=list)
    missed_queries: list[SearchQueryRowOut] = Field(default_factory=list)


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


class LineFollowerAccountOut(BaseModel):
    """一個 LINE 官方帳號在期間內的好友數（2026-11-16）。key：main＝園方群組推播帳號，其餘是校區鍵。"""

    key: str
    display_name: str | None
    basic_id: str | None
    # 實際比較的兩天（UTC+9）：開始日前一天、結束日（今天的還沒算好就往前一天）。
    from_date: date
    to_date: date
    # LINE 還沒算好（status 不是 ready）時是 False，數字為 null。
    ready: bool | None = None
    # 累計加好友次數（封鎖不會減少）、目前封鎖人數、可以精準發送的人數。
    followers: int | None = None
    blocks: int | None = None
    targeted_reaches: int | None = None
    new_followers: int | None = None
    blocks_change: int | None = None
    # 查不到：LINE 回的 HTTP 狀態碼（連不上時為 0）。
    error_status: int | None = None


class LineCampusClicksOut(BaseModel):
    # None＝官網上不分校區的 LINE 按鈕（頁首、頁尾）。
    campus_key: str | None
    campus_name: str
    # 期間內官網 LINE 按鈕的點擊數（成效事件 cta_click_line）。
    line_clicks: int
    # 期間內綁定 LINE 通知的預約數。
    linked: int


class LineInsightsOut(BaseModel):
    # 有沒有任何一個官方帳號設好 Messaging API 金鑰；沒有時 accounts 是空的，校區列照常回。
    configured: bool
    start: date
    end: date
    accounts: list[LineFollowerAccountOut]
    campuses: list[LineCampusClicksOut]


# ---- Google 商家檔案（2026-11-25，docs/specs/2026-11-25-business-profile-keyword-planner-design.md §4.4）----


class GbpMonthOut(BaseModel):
    month: str  # "2026-11"
    # 這個月實際有幾天的資料、最後一天（本月還沒過完、Google 晚幾天才有數字時，畫面寫「到 11/22」）。
    days: int
    last_day: date
    desktop_search: int
    mobile_search: int
    desktop_maps: int
    mobile_maps: int
    calls: int
    directions: int
    website: int
    messages: int


class GbpKeywordOut(BaseModel):
    keyword: str
    # 兩者恰好一個有值：impressions＝確切的曝光次數；below＝Google 只說「少於這個數」。
    impressions: int | None
    below: int | None


class GbpLocationOut(BaseModel):
    campus_key: str
    campus_name: str
    # 背景同步的狀態；error 只有「哪一步、HTTP 幾號」。failed＝最近一次同步失敗（error 是那次的原因）。
    last_success_at: datetime | None
    last_attempt_at: datetime | None
    failed: bool
    error: str | None
    # 每日指標最後一天（還沒同步過是 null）；months 由新到舊，最多 13 個月（本月與前 12 個月）。
    last_day: date | None
    months: list[GbpMonthOut]
    # 最近一個有抓過搜尋字詞的整月與它的前 25 個字詞（確切值依曝光由多到少，接著是「少於 N」的）；keyword_total＝那個月共幾個字詞。
    keywords_month: str | None
    keywords: list[GbpKeywordOut]
    keyword_total: int


class BusinessProfileOut(BaseModel):
    configured: bool
    locations: list[GbpLocationOut]


# ---- 搜尋需求（Keyword Planner，2026-11-25 同規格 §5.4）----


class SearchDemandGeoOut(BaseModel):
    key: str
    label: str


class SearchVolumeCellOut(BaseModel):
    month: str  # "2026-10"
    # available＝Google 有回這個月；searches 是 null 而 available 是 true＝量太少；available 是 false＝還沒有這個月的數字。
    available: bool
    searches: int | None


class SearchKeywordVolumesOut(BaseModel):
    geo: str
    cells: list[SearchVolumeCellOut]


class SearchKeywordOut(BaseModel):
    id: str
    text: str
    created_at: datetime
    # null＝加進來之後還沒同步過。
    synced_at: datetime | None
    # 每個地區一份，順序同 SearchDemandOut.geos；每份的 cells 對齊 SearchDemandOut.months。
    volumes: list[SearchKeywordVolumesOut]


class SearchDemandOut(BaseModel):
    configured: bool
    geos: list[SearchDemandGeoOut]
    # 最近 12 個整月，由舊到新。
    months: list[str]
    keywords: list[SearchKeywordOut]
    keyword_limit: int
    last_success_at: datetime | None
    last_attempt_at: datetime | None
    failed: bool
    # 最近一次失敗的原因；成功但有區查不到時是那幾區的原因（failed 是 false）。
    error: str | None


class SearchKeywordIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)
