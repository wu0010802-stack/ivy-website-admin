"""統計、比較與未預繳明細（C1、C2b）。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


# ── 統計（C1）：欄位照園務 api/recruitment/stats.py::_query_stats，比率分母 0 為 None ──

AdmissionsStatsTarget = Literal["records", "nodeposit", "source"]


class AdmissionsMetricSnapshot(BaseModel):
    visit: int
    deposit: int
    enrolled: int
    transfer_term: int
    pending_deposit: int
    effective_deposit: int
    visit_to_deposit_rate: float | None
    visit_to_enrolled_rate: float | None
    deposit_to_enrolled_rate: float | None
    effective_to_enrolled_rate: float | None


class AdmissionsStatsKpi(AdmissionsMetricSnapshot):
    # 以「姓名|生日」去重，匿名化的列以列 id 計（園務 stats.py:122-139）。
    unique_visit: int
    unique_deposit: int


class AdmissionsMonthlyRow(AdmissionsMetricSnapshot):
    month: str


class AdmissionsYearlyRow(AdmissionsMetricSnapshot):
    # 民國年（月份字串的年份部分），不是學年。
    year: str


class AdmissionsDecisionSummary(BaseModel):
    current_month: AdmissionsMetricSnapshot
    rolling_30d: AdmissionsMetricSnapshot
    rolling_90d: AdmissionsMetricSnapshot
    ytd: AdmissionsMetricSnapshot


class AdmissionsFunnelSnapshot(BaseModel):
    visit: int
    deposit: int
    enrolled: int
    transfer_term: int
    effective_deposit: int
    pending_deposit: int


class AdmissionsCountDiff(BaseModel):
    current: int
    previous: int
    delta: int


class AdmissionsRateDiff(BaseModel):
    current: float | None
    previous: float | None
    # 任一邊是 None（分母 0）就是 None。
    delta: float | None


class AdmissionsMonthOverMonth(BaseModel):
    current_month: str | None
    previous_month: str | None
    visit: AdmissionsCountDiff
    deposit: AdmissionsCountDiff
    enrolled: AdmissionsCountDiff
    effective_deposit: AdmissionsCountDiff
    pending_deposit: AdmissionsCountDiff
    visit_to_deposit_rate: AdmissionsRateDiff
    visit_to_enrolled_rate: AdmissionsRateDiff
    deposit_to_enrolled_rate: AdmissionsRateDiff
    effective_to_enrolled_rate: AdmissionsRateDiff


class AdmissionsStatsAlert(BaseModel):
    code: Literal["FUNNEL_DROP", "HIGH_POTENTIAL_BACKLOG", "SOURCE_IMBALANCE"]
    level: Literal["warning", "danger", "info"]
    title: str
    message: str
    # records＝訪視明細（帶 month）、nodeposit＝統計的未預繳原因、source＝統計的來源分析。
    target_tab: AdmissionsStatsTarget
    target_filter: dict[str, str | int]


class AdmissionsStatsAction(BaseModel):
    code: Literal["FOLLOW_HIGH_POTENTIAL", "REVIEW_CURRENT_MONTH", "REVIEW_SOURCE"]
    title: str
    description: str
    target_tab: AdmissionsStatsTarget
    target_filter: dict[str, str | int]


class AdmissionsRateRange(BaseModel):
    # 可能範圍（2026-10-12 規格 §7）：預繳率的 Beta 收縮 80% 範圍，百分比到小數一位。
    low: float
    high: float


class AdmissionsGradeRow(BaseModel):
    grade: str
    visit: int
    deposit: int
    enrolled: int
    visit_to_deposit_rate: float | None
    visit_to_deposit_range: AdmissionsRateRange | None
    visit_to_enrolled_rate: float | None
    deposit_to_enrolled_rate: float | None


class AdmissionsSourceRow(BaseModel):
    source: str
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None
    visit_to_deposit_range: AdmissionsRateRange | None


class AdmissionsGradeCount(BaseModel):
    visit: int
    deposit: int


class AdmissionsTourGuideRow(BaseModel):
    tour_guide: str
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None
    visit_to_deposit_range: AdmissionsRateRange | None
    by_grade: dict[str, AdmissionsGradeCount]


class AdmissionsTourGuideCrossRow(BaseModel):
    tour_guide: str
    sources: dict[str, int]
    # 該位帶參觀老師全部來源的合計（含前 10 名以外），不一定等於 sources 加總。
    total: int


class AdmissionsTourGuideSourceCross(BaseModel):
    tour_guides: list[AdmissionsTourGuideCrossRow]
    sources: list[str]


class AdmissionsNoDepositReason(BaseModel):
    reason: str
    count: int
    by_grade: dict[str, int]
    priority: Literal["high", "medium", "low"] | None


class AdmissionsWithdrawReason(BaseModel):
    """退出原因分佈一列（2026-10-15 規格 W8）：八項依清單順序，「未分類」排最後；0 筆的列也回。"""

    reason: str
    deposited: int
    enrolled: int
    total: int


class AdmissionsNoDepositPriority(BaseModel):
    high: int
    medium: int
    low: int
    # 「未註明／待追蹤」與沒填原因（未分類）。
    other: int


class AdmissionsNoDepositSummary(BaseModel):
    high_potential_count: int
    overdue_followup_count: int
    cold_count: int
    high_potential_backlog_count: int


class AdmissionsTimingCheckpoint(BaseModel):
    day: int
    # 參觀後第 day 天的累積預繳率（%）；沒有人參觀滿 day 天時是 None。
    cumulative_rate: float | None
    visits_reached: int


class AdmissionsDepositTiming(BaseModel):
    """預繳速度卡（2026-10-12 規格 §5、§9.1）。預繳不到 min_events 筆時 status＝insufficient、checkpoints 是空的。"""

    status: Literal["ok", "insufficient"]
    visits: int
    deposited: int
    missing_time: int
    min_events: int
    checkpoints: list[AdmissionsTimingCheckpoint]
    half_by_day: int | None


class AdmissionsDepositPace(BaseModel):
    """參考月份家長的預繳速度比較（規格 §6.2、§6.4）；slow＝true 時另有 FUNNEL_DROP 警示。"""

    evaluable: bool
    reason: Literal["no_reference_month", "no_visits", "insufficient_baseline"] | None
    month: str | None
    visits: int
    expected: float | None
    observed: int
    slow: bool


class AdmissionsStatsFilters(BaseModel):
    campus_key: str
    school_year: int | None
    semester: int | None
    reference_month: str | None


class AdmissionsStatsOut(BaseModel):
    as_of: datetime
    filters: AdmissionsStatsFilters
    reference_month: str | None
    kpi: AdmissionsStatsKpi
    decision_summary: AdmissionsDecisionSummary
    funnel_snapshot: AdmissionsFunnelSnapshot
    month_over_month: AdmissionsMonthOverMonth
    alerts: list[AdmissionsStatsAlert]
    top_action_queue: list[AdmissionsStatsAction]
    monthly: list[AdmissionsMonthlyRow]
    by_year: list[AdmissionsYearlyRow]
    by_grade: list[AdmissionsGradeRow]
    # {民國月份: {年級: 筆數, "合計": 筆數}}；畫面依 monthly 的月份順序取用。
    month_grade: dict[str, dict[str, int]]
    by_source: list[AdmissionsSourceRow]
    top_source_names: list[str]
    by_tour_guide: list[AdmissionsTourGuideRow]
    tour_guide_source_cross: AdmissionsTourGuideSourceCross
    no_deposit_reasons: list[AdmissionsNoDepositReason]
    no_deposit_total: int
    no_deposit_priority: AdmissionsNoDepositPriority
    no_deposit_summary: AdmissionsNoDepositSummary
    withdraw_reasons: list[AdmissionsWithdrawReason]
    withdraw_total: int
    deposit_timing: AdmissionsDepositTiming
    deposit_pace: AdmissionsDepositPace


class AdmissionsRate(BaseModel):
    # 百分比到小數一位；分母 0 為 None。五校比較同時顯示分子與分母（規格 9.3）。
    value: float | None
    numerator: int
    denominator: int


class AdmissionsCompareRow(BaseModel):
    """五校比較的一列：所選學年學期的「招生案件數」，不是跨校去重後的孩子數。"""

    campus_key: str
    visit: int
    deposit: int
    enrolled: int
    transfer_term: int
    effective_deposit: int
    pending_deposit: int
    visit_to_deposit_rate: AdmissionsRate
    # 只有參觀→預繳有可能範圍（2026-10-12 規格 §9.3）。
    visit_to_deposit_range: AdmissionsRateRange | None
    visit_to_enrolled_rate: AdmissionsRate
    deposit_to_enrolled_rate: AdmissionsRate
    effective_to_enrolled_rate: AdmissionsRate
    # 只加總有計畫名額列的年級（計畫 0 也算有設定）；一個都沒有＝None（畫面「未設定」）。
    target_seats: int | None
    remaining_seats: int | None
    grades_with_target: int


class AdmissionsCompareOut(BaseModel):
    # 資料讀取時間（UTC）與實際套用的學年學期（規格 13）。
    as_of: datetime
    school_year: int
    # 請求的學期；null＝件數算整學年。
    semester: int | None
    # 名額剩餘實際用的學期（名額規劃逐學期設定；沒帶學期時用上學期）。
    seat_semester: int
    rows: list[AdmissionsCompareRow]


# ── 未預繳明細（C2b）：園務 GET /no-deposit-analysis（stats.py:938-1005）。
# 名單含孩子姓名（2026-10-01 使用者裁定統計頁要列名單），只放畫面要的欄位，不含電話、地址、生日。


class NoDepositSummaryOut(BaseModel):
    """只受 reason／grade 篩選影響（園務 base_query）；潛力、冷名單篩選不改這三個數字。"""

    high_potential_count: int
    # 參觀滿 overdue_days 天（沒給用 14）仍未預繳；看參觀日、台北日期（2026-10-06 起，園務看建檔時間）。
    overdue_followup_count: int
    # 參觀滿 90 天仍未預繳。
    cold_count: int


class NoDepositRecordOut(BaseModel):
    id: uuid.UUID
    month: str
    seq_no: str | None
    child_name: str
    grade: str | None
    no_deposit_reason: str | None
    no_deposit_reason_detail: str | None
    source: str | None
    referrer: str | None
    parent_response: str | None
    created_at: datetime
    # 「未註明／待追蹤」與沒填原因是 None（畫面寫「—」）。
    priority: Literal["high", "medium", "low"] | None
    # 參觀滿 90 天（園務 COLD_LEAD_DAYS；園務看建檔時間）。
    cold: bool


class NoDepositRecordsOut(BaseModel):
    total: int
    page: int
    page_size: int
    summary: NoDepositSummaryOut
    records: list[NoDepositRecordOut]
