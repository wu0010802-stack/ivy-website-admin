"""招生入學 API 的 request／response schema（規格 5、13）。

- 建立、編輯、狀態轉換、座位、名額的 request 一律 extra="forbid"（A 計畫調整第 11 條）：
  送狀態欄位（has_deposit、enrolled、enrolled_on、withdrawn_*、provisional_grade）或
  後端算的欄位（month、seq_no、version）會得到 FastAPI 標準 422，loc 指到該欄位。
- 文字欄位去掉頭尾空白，空字串當沒填（None）；不收控制字元（同預約）。
- 列舉一律由 constants 組成 Literal，不在這裡重寫一份。
- RecruitmentVisitUpdate 用 model_fields_set 區分「沒送」與「送 null 清空」。"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator

from app.admissions import constants
from app.admissions.funnel import Stage, derive_stage
from app.booking.schemas import has_control_chars
from app.common.timezones import today_local

Grade = Literal[constants.GRADES]
NoDepositReason = Literal[constants.NO_DEPOSIT_REASONS]
SourceCategory = Literal[tuple(constants.SOURCE_CATEGORIES)]
WithdrawnFrom = Literal[constants.WITHDRAWN_FROM]
EventType = Literal[constants.EVENT_TYPES]
Priority = Literal[tuple(constants.NO_DEPOSIT_PRIORITY)]
SchoolYear = Annotated[int, Field(ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX)]
Semester = Annotated[int, Field(ge=1, le=2)]


def clean_text(value):
    """去頭尾空白；空字串回 None；含控制字元丟 ValueError（換行、TAB 可以）。"""
    if not isinstance(value, str):
        return value
    if has_control_chars(value):
        raise ValueError("內容含有不允許的控制字元")
    return value.strip() or None


OptionalText = Annotated[str | None, AfterValidator(clean_text)]


def _required_text(value: str | None, message: str) -> str:
    cleaned = clean_text(value)
    if cleaned is None:
        raise ValueError(message)
    return cleaned


def _not_future(value: date | None) -> date | None:
    if value is not None and value > today_local():
        raise ValueError("生日不能晚於今天")
    return value


def _roc_date(value: date | None, label: str) -> date | None:
    """民國年要落在 SCHOOL_YEAR_MIN～MAX：參觀日期的 month 才會是三位數年份（roc_month
    直接 year-1911）；註冊日期用同一個範圍擋掉打錯的年份。"""
    if value is not None and not constants.SCHOOL_YEAR_MIN <= value.year - 1911 <= constants.SCHOOL_YEAR_MAX:
        raise ValueError(f"{label}的民國年必須在 {constants.SCHOOL_YEAR_MIN}～{constants.SCHOOL_YEAR_MAX} 之間")
    return value


def _roc_visit_date(value: date | None) -> date | None:
    return _roc_date(value, "參觀日期")


class _VisitEditable(BaseModel):
    """新增與編輯共用、表單可以直接填的欄位。預繳、註冊、退出、保留座位只能
    走狀態轉換與保留座位（規格 6.1 第 3 點、6.6），不在這裡。district 由伺服器依
    地址比對填寫（2026-10-08 區域分析規格 §5.5）、geocoding_consent_at 不填（規格 5.1），
    兩者都不收。"""

    model_config = ConfigDict(extra="forbid")

    grade: Grade | None = None
    english_name: OptionalText = Field(default=None, max_length=constants.LEN_ENGLISH_NAME)
    phone: OptionalText = Field(default=None, max_length=constants.LEN_PHONE)
    contact_name: OptionalText = Field(default=None, max_length=constants.LEN_CONTACT)
    father_occupation: OptionalText = Field(default=None, max_length=constants.LEN_OCCUPATION)
    mother_occupation: OptionalText = Field(default=None, max_length=constants.LEN_OCCUPATION)
    address: OptionalText = Field(default=None, max_length=constants.LEN_ADDRESS)
    source: OptionalText = Field(default=None, max_length=constants.LEN_SOURCE)
    referrer: OptionalText = Field(default=None, max_length=constants.LEN_REFERRER)
    deposit_collector: OptionalText = Field(default=None, max_length=constants.LEN_COLLECTOR)
    # 帶參觀老師：後台帳號；沒給 tour_guide_name 時用該帳號的顯示名稱當姓名快照。
    tour_guide_user_id: uuid.UUID | None = None
    tour_guide_name: OptionalText = Field(default=None, max_length=constants.LEN_TOUR_GUIDE)
    source_category: SourceCategory | None = None
    rides_bus: bool = False
    transfer_term: bool = False
    notes: OptionalText = Field(default=None, max_length=constants.TEXT_MAX)
    parent_response: OptionalText = Field(default=None, max_length=constants.TEXT_MAX)
    no_deposit_reason: NoDepositReason | None = None
    no_deposit_reason_detail: OptionalText = Field(default=None, max_length=constants.TEXT_MAX)


class RecruitmentVisitCreate(_VisitEditable):
    """手動新增（規格 6.1 第 3 點）。必填同園務表單：參觀日期、幼生姓名、生日、
    入學學年學期。campus_key 放 query（同 POST /admin/slots）。"""

    visit_date: date
    child_name: str = Field(min_length=1, max_length=constants.LEN_CHILD_NAME)
    birthday: date
    target_school_year: SchoolYear
    target_semester: Semester

    @field_validator("child_name")
    @classmethod
    def _child_name(cls, value: str) -> str:
        return _required_text(value, "請填寫幼生姓名")

    @field_validator("visit_date")
    @classmethod
    def _visit_date(cls, value: date) -> date:
        return _roc_visit_date(value)

    @field_validator("birthday")
    @classmethod
    def _birthday(cls, value: date) -> date:
        return _not_future(value)


class RecruitmentVisitUpdate(_VisitEditable):
    """編輯（規格 6.6）。只改有送的欄位；送 null 代表清空，但姓名、參觀日期、
    入學學年學期不能清空。"""

    # 畫面載入時的 version；不符回 409 RECRUITMENT_VISIT_VERSION_CONFLICT。
    expected_version: int = Field(ge=1)
    visit_date: date | None = None
    child_name: str | None = Field(default=None, min_length=1, max_length=constants.LEN_CHILD_NAME)
    birthday: date | None = None
    target_school_year: SchoolYear | None = None
    target_semester: Semester | None = None

    @field_validator("child_name")
    @classmethod
    def _child_name(cls, value: str | None) -> str:
        return _required_text(value, "幼生姓名不能清空")

    @field_validator("visit_date", "target_school_year", "target_semester")
    @classmethod
    def _not_cleared(cls, value):
        if value is None:
            raise ValueError("這個欄位不能清空")
        return value

    @field_validator("visit_date")
    @classmethod
    def _visit_date(cls, value: date | None) -> date | None:
        return _roc_visit_date(value)

    @field_validator("birthday")
    @classmethod
    def _birthday(cls, value: date | None) -> date | None:
        return _not_future(value)


# 區域分析（2026-10-08 規格 §5.4）：比對等級與未定位原因，與 app/admissions/geo/models.py 的
# MATCH_LEVELS、UNLOCATED_REASONS 相同。
MatchLevel = Literal["exact", "nearby", "street", "district", "unlocated", "pending"]
UnlocatedReason = Literal["no_address", "outside_kaohsiung", "no_doorplate", "ambiguous_village", "anonymized"]
# 統計裡列出的「有地址卻沒到里」原因，同時是這幾種原因在畫面上的固定順序（area.REASON_ORDER 取自這裡）；
# no_address、anonymized 各有自己的層級與筆數，不在其中。
AreaUnlocatedReason = Literal["outside_kaohsiung", "no_doorplate", "ambiguous_village"]


class VisitGeoOut(BaseModel):
    """一筆訪視的區域比對結果（規格 §8.5）。不含家長座標；distance_m 是到本校的直線距離，
    取整到 100 公尺，只有比對到門牌（exact／nearby）且本校座標已知時才有。"""

    village: str | None
    match_level: MatchLevel
    unlocated_reason: UnlocatedReason | None
    distance_m: int | None

    model_config = {"from_attributes": True}


class RecruitmentVisitOut(BaseModel):
    """規格 5.1 全部欄位，另加推導的 stage 與 has_visit_request。anonymized_at 有值＝
    已依保存政策匿名化：不能再編輯、轉換或保留座位（409 RECRUITMENT_VISIT_ANONYMIZED），
    可以刪除。"""

    id: uuid.UUID
    campus_key: str
    visit_request_id: uuid.UUID | None
    month: str
    seq_no: str | None
    visit_date: date
    child_name: str
    english_name: str | None
    birthday: date | None
    grade: Grade | None
    phone: str | None
    contact_name: str | None
    father_occupation: str | None
    mother_occupation: str | None
    address: str | None
    district: str | None
    source: str | None
    referrer: str | None
    deposit_collector: str | None
    tour_guide_user_id: uuid.UUID | None
    tour_guide_name: str | None
    source_category: SourceCategory | None
    has_deposit: bool
    rides_bus: bool
    notes: str | None
    parent_response: str | None
    geocoding_consent_at: datetime | None
    no_deposit_reason: NoDepositReason | None
    no_deposit_reason_detail: str | None
    enrolled: bool
    enrolled_on: date | None
    transfer_term: bool
    provisional_grade: Grade | None
    target_school_year: int | None
    target_semester: int | None
    withdrawn_at: datetime | None
    withdrawn_from: WithdrawnFrom | None
    withdraw_reason: str | None
    anonymized_at: datetime | None
    version: int
    created_at: datetime
    updated_at: datetime
    # 參觀後追蹤（官網延伸，2026-10-04 規格 5.1）：下次聯絡（null＝未排定）、追蹤負責人、
    # 最近一次聯絡時間。負責人名稱由後台用 GET /staff 對照。
    follow_up_at: datetime | None
    follow_up_owner_id: uuid.UUID | None
    last_contacted_at: datetime | None
    # 區域分析（2026-10-08 規格 §8.5）：上線前的舊訪視在背景重算前是 None。
    geo: VisitGeoOut | None = None

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def stage(self) -> Stage:
        return derive_stage(self)

    @computed_field
    @property
    def has_visit_request(self) -> bool:
        return self.visit_request_id is not None


class RecruitmentEventOut(BaseModel):
    """招生歷程一筆（規格 5.2），舊到新排序。"""

    id: uuid.UUID
    event_type: EventType
    from_stage: Stage | None
    to_stage: Stage
    reason: str | None
    metadata_json: dict | None
    actor_user_id: uuid.UUID | None
    # 操作者的顯示名稱，沒設定時是 Email；自動建立、帳號已刪除時為 None。
    actor_name: str | None = None
    created_at: datetime


class NoDepositReasonOption(BaseModel):
    value: NoDepositReason
    # 轉換潛力（園務 shared.py:59-75）；「未註明／待追蹤」不屬於任何一組，為 None。
    priority: Priority | None


class AdmissionsOptionsOut(BaseModel):
    """篩選與表單選項（規格 13 GET /options）：該校已用過的月份、來源、家長介紹、
    帶參觀老師，以及園務的固定列舉與文案。"""

    # 民國月份，新到舊。
    months: list[str]
    # 次數多的在前，各最多 50 個。
    sources: list[str]
    referrers: list[str]
    tour_guides: list[str]
    grades: list[Grade]
    no_deposit_reasons: list[NoDepositReasonOption]
    # 來源分類代碼 → 園務文案，順序同園務（A 計畫調整第 17 條）。
    source_categories: dict[str, str]
    # 聯絡方式代碼 → 後台文案（參觀後追蹤，2026-10-04 規格 9）。
    contact_channels: dict[str, str]


class TransitionRequest(BaseModel):
    """狀態轉換（規格 6.3）。後台一律送齊八個欄位，用不到的送 null；各轉換只讀
    自己需要的欄位。"""

    model_config = ConfigDict(extra="forbid")

    to_stage: Stage
    expected_version: int = Field(ge=1)
    # 退預繳、退註冊、取消註冊必填；其他轉換可以附註。
    reason: OptionalText = Field(default=None, max_length=constants.TEXT_MAX)
    # 標記預繳時選填。
    deposit_collector: OptionalText = Field(default=None, max_length=constants.LEN_COLLECTOR)
    # 標記註冊：註冊日期（沒給用台北今天；民國年同參觀日期要在 100～200）、年級與
    # 入學學年學期（沒保留座位時必填）。
    enrolled_on: date | None = None
    grade: Grade | None = None
    target_school_year: SchoolYear | None = None
    target_semester: Semester | None = None

    @field_validator("enrolled_on")
    @classmethod
    def _enrolled_on(cls, value: date | None) -> date | None:
        return _roc_date(value, "註冊日期")


class FunnelCardOut(BaseModel):
    id: uuid.UUID
    child_name: str
    grade: Grade | None
    # 保留座位或註冊的年級。
    provisional_grade: Grade | None
    target_school_year: int | None
    target_semester: int | None
    visit_date: date
    # 由官網預約建立（卡片上的標記）。
    has_visit_request: bool
    # 由哪一筆官網預約建立；招生入學點卡片時開那筆預約明細（2026-10-05 家庭頁規格 6.1）。
    visit_request_id: uuid.UUID | None
    # 在退出欄時是退預繳（deposited）還是退註冊（enrolled）。
    withdrawn_from: WithdrawnFrom | None
    # 下次聯絡（2026-10-04 規格 7.4）：卡片標「下次聯絡 10/08」或「該聯絡了」；null 不標。
    follow_up_at: datetime | None = None
    version: int


class FunnelColumnsOut(BaseModel):
    """四欄各自一個 list（A 計畫調整第 8 條：產生的 TS 型別不是索引簽章）。"""

    visited: list[FunnelCardOut]
    deposited: list[FunnelCardOut]
    enrolled: list[FunnelCardOut]
    withdrawn: list[FunnelCardOut]


class FunnelBoardOut(BaseModel):
    columns: FunnelColumnsOut
    # 這一校沒填入學學年的訪視數（不受學年篩選影響）。
    unscoped_count: int
    # 實際套用的篩選：校區、入學學年（沒帶時是目前學年）、學期（None＝整學年）。
    campus_key: str
    school_year: int
    semester: int | None
    # 資料讀取時間（UTC）。
    as_of: datetime


class SeatRequest(BaseModel):
    """保留座位（grade 有值）或釋放保留（grade 為 null）（規格 6.5）。"""

    model_config = ConfigDict(extra="forbid")

    grade: Grade | None
    # 保留時必填（缺了回 422 SEAT_NOT_ALLOWED「保留座位需指定目標學年」）。
    target_school_year: SchoolYear | None = None
    # 沒給用上學期。
    target_semester: Semester | None = None
    expected_version: int = Field(ge=1)


class SeatOut(BaseModel):
    """A 計畫調整第 12 條：超額只警示，警示代碼放在回應，不是錯誤。"""

    visit: RecruitmentVisitOut
    capacity_warning: bool
    warning_code: Literal["SEAT_CAPACITY_WARNING"] | None


class IntakePlanRowOut(BaseModel):
    grade: Grade
    # None＝未設定（沒有計畫列），與「計畫名額 0」分開。
    target_seats: int | None
    reserved: int
    enrolled: int
    # 計畫−已保留−已註冊，可以是負數；未設定時 None。
    remaining: int | None
    over_capacity: bool


class IntakePlanTotalsOut(BaseModel):
    # 計畫名額與剩餘只加總有設定的年級；一個都沒設定時 None。
    target_seats: int | None
    reserved: int
    enrolled: int
    remaining: int | None


class IntakePlanOut(BaseModel):
    # 實際套用的篩選。
    campus_key: str
    school_year: int
    semester: int
    # 資料讀取時間（UTC）。
    as_of: datetime
    rows: list[IntakePlanRowOut]
    totals: IntakePlanTotalsOut


class IntakeTargetsRequest(BaseModel):
    """同校同學期一次送多個年級（規格 13 PUT /intake-targets）。值是 null＝刪除
    該年級的計畫（回到「未設定」）；沒送的年級不動。"""

    model_config = ConfigDict(extra="forbid")

    school_year: SchoolYear
    semester: Semester
    targets: dict[Grade, Annotated[int, Field(ge=0, le=999)] | None]


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


# ---- 參觀後追蹤（docs/specs/2026-10-04-admissions-follow-up-design.md 第 6、9 節）----

ContactChannel = Literal[tuple(constants.CONTACT_CHANNELS)]
FollowUpKind = Literal[constants.FOLLOW_UP_KINDS]


class ContactLogCreate(BaseModel):
    """記錄一次聯絡（規格 6.3）。next_follow_up_at 必填、可為 null：一定要決定下次聯絡的
    時間或「不用再追」，已到期的訪視記完才會離開清單。"""

    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    # 沒帶用送出當下；可補登較早的時間，不能晚於現在。時間一律要帶時區（沒帶 422），
    # 才能和伺服器的現在比較。
    contacted_at: AwareDatetime | None = None
    channel: ContactChannel
    reached: bool
    # 聯絡到時必填；沒聯絡到時選填（例如「沒接」）。
    note: OptionalText = Field(default=None, max_length=constants.CONTACT_NOTE_MAX)
    next_follow_up_at: AwareDatetime | None
    # 把這次內容寫進電訪回應（取代原內容）；只在聯絡到時可用。
    update_parent_response: bool = False

    @model_validator(mode="after")
    def _reached_rules(self) -> "ContactLogCreate":
        if self.reached and self.note is None:
            raise ValueError("聯絡到時請寫下聯絡內容")
        if self.update_parent_response and not self.reached:
            raise ValueError("沒聯絡到時不能寫進電訪回應")
        return self


class ContactLogOut(BaseModel):
    id: uuid.UUID
    recruitment_visit_id: uuid.UUID
    contacted_at: datetime
    channel: ContactChannel
    reached: bool
    # 依保存政策匿名化後為 null。
    note: str | None
    next_follow_up_at: datetime | None
    created_by: uuid.UUID | None
    # 記錄者的顯示名稱，沒設定時是 Email；帳號已刪除時為 None。
    created_by_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ContactLogResultOut(BaseModel):
    """記錄聯絡的回應：新的聯絡紀錄與更新後的訪視（畫面不必再讀一次）。"""

    log: ContactLogOut
    visit: RecruitmentVisitOut


class FollowUpUpdate(BaseModel):
    """只改下次聯絡或負責人（規格 6.4）：沒送＝不動，送 null＝清除（用 model_fields_set 判斷）。"""

    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    follow_up_at: AwareDatetime | None = None
    follow_up_owner_id: uuid.UUID | None = None


class FollowUpRowOut(BaseModel):
    """待追蹤分頁的一列（規格 9）。只回追蹤要用的欄位：要打電話，所以有電話；不含生日、地址。"""

    visit_id: uuid.UUID
    child_name: str
    grade: Grade | None
    stage: Stage
    visit_date: date
    contact_name: str | None
    phone: str | None
    follow_up_at: datetime | None
    follow_up_owner_id: uuid.UUID | None
    # 顯示名稱，沒設定時是 Email；沒有負責人時為 null。
    follow_up_owner_name: str | None
    # 負責人帳號是否還啟用；沒有負責人時為 null。
    follow_up_owner_active: bool | None
    last_contacted_at: datetime | None
    last_contact_channel: ContactChannel | None
    last_contact_reached: bool | None
    has_visit_request: bool
    # 由哪一筆官網預約建立；招生入學點卡片時開那筆預約明細（2026-10-05 家庭頁規格 6.1）。
    visit_request_id: uuid.UUID | None
    version: int


class FollowUpTotalsOut(BaseModel):
    """全校區三種追蹤狀態的筆數（不受負責人篩選影響）；upcoming 只算 7 天內。"""

    due: int
    upcoming: int
    unscheduled: int


class FollowUpListOut(BaseModel):
    as_of: datetime
    campus_key: str
    scope: FollowUpKind
    totals: FollowUpTotalsOut
    # 目前範圍加負責人篩選後的筆數。
    total: int
    page: int
    page_size: int
    rows: list[FollowUpRowOut]


class AdmissionsStaffOut(BaseModel):
    """可以當這個校區追蹤負責人的帳號（啟用中、有 admissions.write、涵蓋該校區）。"""

    id: uuid.UUID
    display_name: str | None
    email: str


# ---- 區域分析（2026-10-08 區域分析規格 §8）----

DistanceBandKey = Literal["0-1", "1-3", "3-6", "6+", "none"]
KindergartenKind = Literal["public", "nonprofit", "quasi_public", "private"]
BabycareKind = Literal["center", "home"]
ProviderName = Literal["kindergarten", "babycare"]
ProviderChangeKind = Literal["opened", "closed", "kind_changed"]
ChangeDateBasis = Literal["registered", "observed"]
# 異動列的 kind：幼兒園是四種類型，托嬰是 center／home。
ChangeItemKind = Literal["public", "nonprofit", "quasi_public", "private", "center", "home"]
# 欄位叫 date 的 model 裡，用別名當型別，避免欄位名稱遮住 datetime.date。
DateOnly = date


class AreaFiltersOut(BaseModel):
    campus_key: str
    school_year: int | None
    semester: int | None


class AreaDataStatusOut(BaseModel):
    """公開資料的版本：門牌（民國年-月，例 115-10；還沒匯入是 null）、幼兒園更新時間、里界版本、
    各里人口月份（例 115-09，2026-10-13 招生機會；還沒匯入是 null）、托嬰名單更新時間（2026-10-14；還沒匯入是 null）。"""

    doorplate_version: str | None
    doorplates_synced_at: datetime | None
    kindergartens_synced_at: datetime | None
    babycare_synced_at: datetime | None
    boundary_version: str
    population_version: str | None
    population_synced_at: datetime | None


class AreaCampusOut(BaseModel):
    key: str
    name: str
    lat: float | None
    lng: float | None
    # 校址比對不到門牌的原因（no_address／no_doorplate／pending）；有座標時是 null。
    locate_error: str | None
    # 校址文字解析出的行政區（不看門牌）；沒有校址、外縣市或解析不出高雄的區時是 null。
    # 沒座標時後台地圖先框住這一區。
    district: str | None


class AreaReasonCountOut(BaseModel):
    # 只有有地址卻沒到里的三種原因；no_address、anonymized 各有自己的層級與筆數（見 AreaTotalsOut）。
    reason: AreaUnlocatedReason
    count: int


class AreaTotalsOut(BaseModel):
    """以有地址為母數（主控裁定 R5）。
    visit＝範圍內全部訪視＝with_address＋no_address＋anonymized。
    with_address＝未匿名化且有填地址（判斷同訪視明細的 geo=no_village 篩選）
    ＝village_level＋district_level＋unlocated＋pending。
    no_address＝未匿名化、沒填地址；anonymized＝已匿名化（地址已清掉，不算有地址）。
    unlocated_reasons 只算有地址、卻沒到里的原因（外縣市、查無門牌、里有歧義），
    只列筆數大於 0 的，筆數多的在前、同筆數依固定順序。"""

    visit: int
    with_address: int
    village_level: int
    district_level: int
    unlocated: int
    pending: int
    no_address: int
    anonymized: int
    unlocated_reasons: list[AreaReasonCountOut]


class AreaDistrictRowOut(BaseModel):
    district: str
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None
    visit_to_deposit_range: AdmissionsRateRange | None


class AreaVillageRowOut(BaseModel):
    district: str
    village: str
    # 內政部村里代碼（11 碼），對照里界 GeoJSON 的 VILLCODE；對不到是 null。
    village_code: str | None
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None
    visit_to_deposit_range: AdmissionsRateRange | None


class AreaDistanceBandOut(BaseModel):
    band: DistanceBandKey
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None
    visit_to_deposit_range: AdmissionsRateRange | None


class AdmissionsAreaOut(BaseModel):
    as_of: datetime
    filters: AreaFiltersOut
    data_status: AreaDataStatusOut
    campus: AreaCampusOut
    totals: AreaTotalsOut
    # 有行政區的訪視依行政區分組（含只到區、已匿名化），參觀人數降冪、區名升冪。
    districts: list[AreaDistrictRowOut]
    # 比對到里的訪視依（行政區, 里）分組，參觀人數降冪。
    villages: list[AreaVillageRowOut]
    # 固定五列：0-1、1-3、3-6、6+、none。校區沒有座標時全部歸 none。
    distance_bands: list[AreaDistanceBandOut]


class AreaKindergartenOut(BaseModel):
    source_id: str
    name: str
    kind: KindergartenKind
    pre_public_period: str | None
    address: str
    lat: float
    lng: float
    distance_m: int
    approved_capacity: int | None
    # kiang 依收費明細估算的月費，不是官方欄位。
    monthly_fee_estimate: int | None
    has_penalty: bool
    phone: str | None
    # 與任一校區座標相距 50 公尺內：畫面標「本機構」，不算競爭園所。
    is_own: bool


class AreaKindergartensOut(BaseModel):
    synced_at: datetime | None
    source_note: str
    campus: AreaCampusOut
    radius_km: int
    items: list[AreaKindergartenOut]


# ---- 托嬰與園所異動（2026-10-14 規格 §6）----


class AreaBabycareItemOut(BaseModel):
    source_id: str
    name: str
    kind: BabycareKind
    address: str
    lat: float
    lng: float
    distance_m: int
    # 核定人數與實際收托（官方回報，統計時點官方沒有說明）；來源沒給是 null，畫面寫「—」。
    approved_capacity: int | None
    enrolled: int | None
    phone: str | None


class AreaBabycareSummaryOut(BaseModel):
    """營業中的所數、核定合計、實際收托合計（null 不計入）。只放數量，不算任何比例。"""

    count: int
    approved_total: int
    enrolled_total: int


class AreaBabycareOut(BaseModel):
    synced_at: datetime | None
    source_note: str
    campus: AreaCampusOut
    radius_km: int
    summary: AreaBabycareSummaryOut
    items: list[AreaBabycareItemOut]


class AreaTrackingSinceOut(BaseModel):
    """各種名單開始記錄異動的日子（基準日）；還沒記錄過是 null。"""

    kindergarten: DateOnly | None
    babycare: DateOnly | None


class AreaChangeItemOut(BaseModel):
    provider: ProviderName
    source_id: str
    name: str
    kind: ChangeItemKind
    change: ProviderChangeKind
    # registered＝設立日（幼兒園新設）、observed＝我們同步到的那天（來源沒有停辦日）。
    date: DateOnly
    date_basis: ChangeDateBasis
    distance_m: int
    # 只有 kind_changed 才有：舊的與新的幼兒園類型。
    old_kind: KindergartenKind | None
    new_kind: KindergartenKind | None


class AreaChangesOut(BaseModel):
    campus: AreaCampusOut
    radius_km: int
    window_months: int
    tracking_since: AreaTrackingSinceOut
    items: list[AreaChangeItemOut]


# ---- 招生機會（2026-10-13 招生機會規格 §6）----

OpportunitySignal = Literal["below", "typical", "above", "few_children", "not_judged"]


class AreaPopulationOut(BaseModel):
    """各里人口的版本與口徑。version 是統計月份「115-09」，還沒匯入是 null；age_band 固定 "2-5"。"""

    version: str | None
    synced_at: datetime | None
    age_band: Literal["2-5"]
    source_note: str


class AreaOpportunityBaselineOut(BaseModel):
    """本校半徑內（里的面積重心在圈內）的合計。rate＝visit ÷ children 的百分比（小數一位，分母 0 是 null）；
    judged＝visit 至少 10 位，才判斷哪些里偏少。"""

    villages: int
    children: int
    infants: int
    visit: int
    rate: float | None
    judged: bool


class AreaOpportunityRowOut(BaseModel):
    """半徑內一個里。children＝2–5 歲、infants＝0–1 歲；rate＝visit ÷ children（百分比）；
    expected＝照附近的參觀率應有的參觀人數、shortfall＝expected − visit（皆小數一位，沒有附近平均是 null）。
    signal：below 明顯偏少、typical 差不多、above 比附近多、few_children 應有不到 1 位、not_judged 附近參觀不到 10 位。"""

    district: str
    village: str
    village_code: str
    # 本校到里界面積重心的直線距離，取整到 100 m。
    distance_m: int
    children: int
    infants: int
    visit: int
    rate: float | None
    expected: float | None
    shortfall: float | None
    signal: OpportunitySignal


class AreaOpportunityMissingOut(BaseModel):
    """半徑內、但各里人口沒有這個里（來源和里界的里清單有出入）：沒有孩子數，參觀不進附近平均，也不是半徑外。
    visit＝這個里的參觀人數。"""

    district: str
    village: str
    village_code: str
    distance_m: int
    visit: int


class AreaOpportunityOut(BaseModel):
    as_of: datetime
    filters: AreaFiltersOut
    radius_km: int
    population: AreaPopulationOut
    campus: AreaCampusOut
    # 沒有人口資料或本校沒座標時是 null（villages 也是空的）。
    baseline: AreaOpportunityBaselineOut | None
    # 比對到里、但里在半徑外的參觀人數；沒對到里的（只到區、未定位、待比對、沒填地址、已匿名化）參觀人數，
    # 和其中沒填地址的（未匿名化；畫面把它和「沒對到里」分開寫）。
    outside_visit: int
    unplaced_visit: int
    no_address_visit: int
    # 半徑內但人口表沒有的里（通常是空的）；參觀多的在前、再依距離、區、里名。
    no_population_villages: list[AreaOpportunityMissingOut]
    # 依「應有 − 實際」由大到小；同值依孩子數、區、里名。
    villages: list[AreaOpportunityRowOut]


class AreaTrendsPopulationSourceOut(BaseModel):
    """各里人口：使用中的月份 M；year_ago_month 是 M−12，年齡歷史裡 M 與 M−12 都在才有值。"""

    month: str | None
    year_ago_month: str | None


class AreaTrendsMonthsOut(BaseModel):
    """出生或遷入遷出：表裡最新的月份（還沒匯入是 null）、近 12 個月裡有資料的月份、沒有資料的月份（舊到新）。"""

    latest: str | None
    months: list[str]
    missing: list[str]


class AreaTrendsIncomeSourceOut(BaseModel):
    """各里所得（C 段）：使用中的年度（民國，還沒匯入是 null）；note 是畫面照引的顯名與官方附註（沒匯入是空字串）。"""

    year: int | None
    note: str


class AreaTrendsSchoolDistrictSourceOut(BaseModel):
    """國小學區（D 段）：隨程式提交的對照檔的學年度（民國）與來源說明。"""

    school_year: int
    note: str


class AreaTrendsNewHomesSourceOut(BaseModel):
    """新成屋交屋（B2 段）：使用中的最新季（還沒匯入是 null）、近 4 季裡表有資料的季（舊到新）、本校半徑內有里的區裡
    沒對到里的筆數（只到區、待比對、里名對不到里界；不進里表）；note 是畫面照引的來源（沒匯入是空字串）。"""

    latest: str | None
    seasons: list[str]
    unplaced: int
    note: str


class AreaTrendsSourcesOut(BaseModel):
    population: AreaTrendsPopulationSourceOut
    births: AreaTrendsMonthsOut
    migration: AreaTrendsMonthsOut
    # 內政部戶政司三個資料集的來源（一句）。
    note: str
    income: AreaTrendsIncomeSourceOut
    new_homes: AreaTrendsNewHomesSourceOut
    school_districts: AreaTrendsSchoolDistrictSourceOut


class AreaTrendsBirthPeriodOut(BaseModel):
    """半徑合計每 12 個月一期的出生數（2026-10-14 出生走勢規格 §4.2）。starts／ends 是「114-10」「115-09」；
    months 是這一期有資料的月數、missing 是這一期裡沒有資料的月份（舊到新）；change_pct 和前一期（更舊的）
    只比兩期都有資料的同月份（小數一位），比較的月份不到 6 個、前一期可比的出生不到 20 位、或沒有前一期時 null。"""

    starts: str
    ends: str
    months: int
    missing: list[str]
    births: int
    change_pct: float | None


class AreaTrendsBaselineOut(BaseModel):
    """本校半徑內（里界面積重心在圈內）的合計；里界調整合併的組整組算進來（含半徑外的組員）。
    children＝本月 2–5 歲；kids_net＝這一年淨增、kids_base＝一年前 1–4 歲（只加算得出的列）；
    births_change_pct＝和前一年同月份比的增減百分比（小數一位），比較的月份不到 6 個或前一年可比的出生不到 20 位時 null。"""

    villages: int
    children: int | None
    kids_net: int | None
    kids_base: int | None
    births_12m: int | None
    births_months: int
    births_compared_months: int
    births_change_pct: float | None
    # 每 12 個月一期，最新一期在前；沒有出生資料或湊不滿 10 個月時是空陣列。
    births_series: list[AreaTrendsBirthPeriodOut]
    migration_net_12m: int | None
    migration_months: int
    # 新成屋交屋（B2 段）：近 4 季到里的筆數、最近一季的筆數、近 4 季裡有資料的季數；沒匯入新成屋是 null、0。
    new_homes: int | None
    new_homes_latest: int | None
    new_homes_seasons: int


class AreaTrendsVillageSchoolOut(BaseModel):
    """一列對到的國小：partial＝只有部分鄰屬於這所（合併組裡有里不屬這所也算），free_zone＝和別校自由學區。
    district 是學校所在的區（有同名學校，畫面寫「區＋校名」）。"""

    code: str
    name: str
    district: str
    partial: bool
    free_zone: bool


class AreaTrendsVillageOut(BaseModel):
    """半徑內一個里，或同區里界調整過的一組（merged，key 是 group:<區>:<組內最小代碼>、village 是頓號連起的里名、
    codes 含已廢止的舊代碼）。kids_level：up2 增加多／up1 增加／flat 差不多／down1 減少／down2 減少多／
    few 一年前 1–4 歲不到 20 位／unknown 算不出來。migration_net_12m＝跨區遷入 − 遷出 ＋ 住址變更入 − 出。"""

    key: str
    district: str
    village: str
    codes: list[str]
    merged: bool
    # 本校到里界面積重心的直線距離，取整到 100 m；合併組取組內最近的里。
    distance_m: int
    children: int | None
    kids_net: int | None
    kids_base: int | None
    kids_level: Literal["up2", "up1", "flat", "down1", "down2", "few", "unknown"]
    births_12m: int | None
    migration_net_12m: int | None
    # 所得中位數（千元，規格 V9：只當背景，不排序、不分級）。沒有所得的里（115-07 新設）與合併組是 null（中位數
    # 不能相加）；income_boundary_changed＝里界在所得年度之後調整過（數字是調整前的範圍）。
    income_median: int | None
    income_boundary_changed: bool
    # 新成屋交屋（B2 段）：近 4 季、最近一季到里的筆數（含預售屋交屋，不等於已入住）。匯入了新成屋，沒有交屋的里是 0；
    # 還沒匯入是 null。合併組整組相加。
    new_homes: int | None
    new_homes_latest: int | None
    # 各代碼自己的近 4 季筆數（只列有交屋的里；沒匯入是空的）。合併組的 new_homes 是整組的，地圖用這個替組內各里上色。
    new_homes_by_code: dict[str, int]
    # 國小學區（D 段）：整里在前、部分在後。
    schools: list[AreaTrendsVillageSchoolOut]


class AreaTrendsSchoolOut(BaseModel):
    """依國小學區（D 段）：學區碰到本校半徑內任一個里的國小，每所合計整個學區（含半徑外的里）。部分里與自由學區
    的里同時算進每一所，各列不能相加。enrollment：district 一般學區／open 大學區（實驗教育）／spacious 空間充裕
    ／capped 總量管制。kids_net 只加算得出的里（kids_partial＝有里界調整過或缺一年前年齡的里沒算進去）；
    rate＝參觀人數 ÷ 2–5 歲（%，小數一位，沒有孩子數是 null）。"""

    code: str
    name: str
    district: str
    enrollment: Literal["district", "open", "spacious", "capped"]
    villages_full: int
    villages_partial: int
    children: int | None
    kids_net: int | None
    kids_partial: bool
    visit: int
    rate: float | None


class AreaTrendsOut(BaseModel):
    as_of: datetime
    filters: AreaFiltersOut
    radius_km: int
    campus: AreaCampusOut
    sources: AreaTrendsSourcesOut
    # 本校沒座標時是 null（villages 也是空的）。
    baseline: AreaTrendsBaselineOut | None
    # 這一年淨增算不出來的原因：no_population 人口還沒匯入、no_year_ago 一年前的年齡還沒匯入、
    # no_migration 遷入遷出不足 10 個月；算得出來是 null。
    kids_unavailable: Literal["no_population", "no_year_ago", "no_migration"] | None
    # 依這一年淨增由大到小（算不出來的在最後）；同值依 2–5 歲孩子、區、里名。
    villages: list[AreaTrendsVillageOut]
    # 依參觀人數由大到小；同值依 2–5 歲孩子、學校所在區、校名。本校沒座標時是空的。
    schools: list[AreaTrendsSchoolOut]


# ---- 預約全程漏斗（2026-10-15 預約全程規格 §3.2）----


class JourneyFiltersOut(BaseModel):
    campus_key: str
    date_from: date
    date_to: date
    source: Literal["all", "web", "assisted"]


class JourneyCasesOut(BaseModel):
    total: int
    # web／phone／line／walk_in／external 各幾筆（未知來源也會出現）。
    by_source: dict[str, int]


class JourneyCancelledOut(BaseModel):
    total: int
    parent: int
    staff: int
    # hold_expired 與沒記取消者。
    other: int


class JourneyOutcomesOut(BaseModel):
    completed: int
    no_show: int
    cancelled: JourneyCancelledOut
    # 時間已過、還沒標記到場或沒來。
    unmarked: int


class JourneyWithdrawnOut(BaseModel):
    total: int
    from_deposit: int
    from_enrolled: int


class JourneyWaitingOut(BaseModel):
    """參觀後未預繳：觀察中（0–13 天）、逾期（14–89 天）、冷名單（90 天以上）。"""

    observing: int
    overdue: int
    cold: int


class JourneyAdmissionsOut(BaseModel):
    with_visit: int
    completed_without_visit: int
    # 曾經到達該階段（預繳過含退出者；註冊過含退註冊者）。
    deposited: int
    enrolled: int
    withdrawn: JourneyWithdrawnOut
    not_deposited: JourneyWaitingOut


class JourneyRateOut(BaseModel):
    key: Literal["attendance", "cancel", "with_visit", "deposit", "enrolled", "withdrawn"]
    numerator: int
    denominator: int
    # 百分比到小數一位；分母 0 為 None。
    pct: float | None


class JourneyDaysOut(BaseModel):
    """天數的中位數（小數一位）與筆數；excluded＝缺時間或負值而不納入的筆數。"""

    median: float | None
    n: int
    excluded: int


class JourneyCancelBucketsOut(BaseModel):
    after_visit: int
    same_day: int
    day_1: int
    days_2_3: int
    days_4_7: int
    days_8_plus: int


class JourneyCancelTimingOut(BaseModel):
    n: int
    excluded: int
    parent: JourneyCancelBucketsOut
    staff: JourneyCancelBucketsOut
    other: JourneyCancelBucketsOut


class JourneyTimingOut(BaseModel):
    lead_days: JourneyDaysOut
    cancel_before_visit: JourneyCancelTimingOut
    visit_to_deposit: JourneyDaysOut
    deposit_to_enrolled: JourneyDaysOut
    deposit_to_withdrawn: JourneyDaysOut


class JourneyRescheduledOut(BaseModel):
    cases: int
    total: int


class JourneyCoverageOut(BaseModel):
    visits_without_request: int
    completed_without_visit: int
    undated_cases: int


class JourneyOut(BaseModel):
    filters: JourneyFiltersOut
    as_of: datetime
    cases: JourneyCasesOut
    visit_outcomes: JourneyOutcomesOut
    admissions: JourneyAdmissionsOut
    rates: list[JourneyRateOut]
    timing: JourneyTimingOut
    rescheduled: JourneyRescheduledOut
    coverage: JourneyCoverageOut


# ---- 在籍學生分布（2026-10-15 規格 §5）----

EnrolledGrade = Literal["幼幼班", "小班", "中班", "大班", "其他"]
EnrolledUnplacedReason = Literal["street", "district", "outside_kaohsiung", "unlocated"]


class AreaEnrolledGradeOut(BaseModel):
    grade: EnrolledGrade
    total: int
    placed: int


class AreaEnrolledPointOut(BaseModel):
    # 取到小數 3 位（約 100 m）的格子；同一格的學生合在一起，依班別計數。
    lat: float
    lng: float
    counts: dict[EnrolledGrade, int]


class AreaEnrolledUnplacedOut(BaseModel):
    reason: EnrolledUnplacedReason
    counts: dict[EnrolledGrade, int]


class AreaEnrolledBandOut(BaseModel):
    band: DistanceBandKey
    counts: dict[EnrolledGrade, int]


class AreaEnrolledVillageOut(BaseModel):
    district: str
    village: str
    village_code: str | None
    counts: dict[EnrolledGrade, int]
    total: int


class AreaEnrolledOut(BaseModel):
    status: Literal["ready", "not_imported"]
    roster_date: date | None
    school_year: int | None
    doorplate_version: str | None
    imported_at: datetime | None
    total: int
    grades: list[AreaEnrolledGradeOut]
    points: list[AreaEnrolledPointOut]
    unplaced: list[AreaEnrolledUnplacedOut]
    distance_bands: list[AreaEnrolledBandOut]
    villages: list[AreaEnrolledVillageOut]
