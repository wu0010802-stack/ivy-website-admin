"""招生入學 API 的 request／response schema（規格 5、13）。

- 建立、編輯、狀態轉換、座位、名額的 request 一律 extra="forbid"（A 計畫調整第 11 條）：
  送狀態欄位（has_deposit、enrolled、enrolled_on、withdrawn_*、provisional_grade）或
  後端算的欄位（month、seq_no、version）會得到 FastAPI 標準 422，loc 指到該欄位。
- 文字欄位去掉頭尾空白，空字串當沒填（None）；不收控制字元（同預約）。
- 列舉一律由 constants 組成 Literal，不在這裡重寫一份。
- RecruitmentVisitUpdate 用 model_fields_set 區分「沒送」與「送 null 清空」。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, computed_field, field_validator

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


def _roc_visit_date(value: date | None) -> date | None:
    """民國年要落在 SCHOOL_YEAR_MIN～MAX，month 才會是三位數年份（roc_month 直接 year-1911）。"""
    if value is not None and not constants.SCHOOL_YEAR_MIN <= value.year - 1911 <= constants.SCHOOL_YEAR_MAX:
        raise ValueError(f"參觀日期的民國年必須在 {constants.SCHOOL_YEAR_MIN}～{constants.SCHOOL_YEAR_MAX} 之間")
    return value


class _VisitEditable(BaseModel):
    """新增與編輯共用、表單可以直接填的欄位。預繳、註冊、退出、保留座位只能
    走狀態轉換與保留座位（規格 6.1 第 3 點、6.6），不在這裡。district、
    geocoding_consent_at 本次不填（規格 5.1），也不收。"""

    model_config = ConfigDict(extra="forbid")

    grade: Grade | None = None
    phone: OptionalText = Field(default=None, max_length=constants.LEN_PHONE)
    contact_name: OptionalText = Field(default=None, max_length=constants.LEN_CONTACT)
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
    birthday: date | None
    grade: Grade | None
    phone: str | None
    contact_name: str | None
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
    """篩選與表單選項（規格 13 GET /options）：該校已用過的月份、來源、介紹者，
    以及園務的固定列舉與文案。"""

    # 民國月份，新到舊。
    months: list[str]
    # 次數多的在前，各最多 50 個。
    sources: list[str]
    referrers: list[str]
    grades: list[Grade]
    no_deposit_reasons: list[NoDepositReasonOption]
    # 來源分類代碼 → 園務文案，順序同園務（A 計畫調整第 17 條）。
    source_categories: dict[str, str]


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
    # 標記註冊：註冊日期（沒給用台北今天）、年級與入學學年學期（沒保留座位時必填）。
    enrolled_on: date | None = None
    grade: Grade | None = None
    target_school_year: SchoolYear | None = None
    target_semester: Semester | None = None


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
    # 在退出欄時是退預繳（deposited）還是退註冊（enrolled）。
    withdrawn_from: WithdrawnFrom | None
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


class ArrivalRowOut(BaseModel):
    """「官網預約」分頁一列（規格 10）：場次、家長稱呼、孩子姓名、參觀人數。"""

    visit_request_id: uuid.UUID
    slot_date: date | None
    start_time: time | None
    parent_name: str
    child_name: str | None
    party_size: int | None
    status: str


class ArrivalsOut(BaseModel):
    """兩份清單各最多 200 筆、新到舊；筆數以 *_total 為準（截斷前的總數）。"""

    # confirmed 且場次已開始、還沒確認到場；依場次日期與開始時間新到舊。
    awaiting: list[ArrivalRowOut]
    # 待確認的總筆數（分頁標籤上的數字）。
    awaiting_total: int
    # 已到場但沒有招生訪視，可以補建；依場次日期（沒有場次用建立時間）新到舊。
    missing: list[ArrivalRowOut]
    missing_total: int
