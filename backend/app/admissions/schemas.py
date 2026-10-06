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
    走狀態轉換與保留座位（規格 6.1 第 3 點、6.6），不在這裡。district、
    geocoding_consent_at 本次不填（規格 5.1），也不收。"""

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


class AdmissionsGradeRow(BaseModel):
    grade: str
    visit: int
    deposit: int
    enrolled: int
    visit_to_deposit_rate: float | None
    visit_to_enrolled_rate: float | None
    deposit_to_enrolled_rate: float | None


class AdmissionsSourceRow(BaseModel):
    source: str
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None


class AdmissionsGradeCount(BaseModel):
    visit: int
    deposit: int


class AdmissionsTourGuideRow(BaseModel):
    tour_guide: str
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None
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
    # 建檔滿 overdue_days 天（沒給用 14）仍未預繳。
    overdue_followup_count: int
    # 建檔滿 90 天仍未預繳。
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
    # 建檔滿 90 天（園務 COLD_LEAD_DAYS）。
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
