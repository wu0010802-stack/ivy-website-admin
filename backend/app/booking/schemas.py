from __future__ import annotations

import re
import uuid
from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.booking.models import BookingMode
from app.booking.parent_policy import parent_change_deadline, parent_change_open
from app.common.timezones import today_local

ReferralSource = Literal["facebook", "google_reviews", "parent_community", "friends_family", "other"]
_REFERRAL_SOURCE_ORDER = ("facebook", "google_reviews", "parent_community", "friends_family", "other")

_PHONE_PATTERN = re.compile(r"09[0-9]{8}")
# 規格 190：「先移除空格與連字號」。含全形空白與各種破折號變體，家長從
# 通訊錄貼過來的 0912-345-678 或 0912 345 678 都要能通過。
_PHONE_STRIP_RE = re.compile(r"[\s\-\u2010-\u2015\u2212\uFF0D\u3000]")

VisitSource = Literal["web", "phone", "line", "walk_in", "external"]
ManualVisitSource = Literal["phone", "line", "walk_in", "external"]


def normalize_phone(value: str) -> str:
    # 回傳正規化後的值：validator 的回傳值就是實際落庫的內容，這樣
    # DB 裡一律是乾淨的 10 碼，後台搜尋與匯出才不會被空格分岔。
    normalized = _PHONE_STRIP_RE.sub("", value)
    # fullmatch 而不是 match：`$` 會允許結尾多一個換行，
    # "0912345678\n" 原本可以通過驗證。
    if not _PHONE_PATTERN.fullmatch(normalized):
        raise ValueError("手機號碼格式錯誤，需為 09 開頭的 10 碼數字")
    return normalized


_ALLOWED_LINK_SCHEMES = ("https://", "http://")
_INVISIBLE_RE = re.compile(r"[\x00-\x20\x7f\u00ad\u200b-\u200f\u2028\u2029\ufeff]")


def _validate_public_link(value: str | None) -> str | None:
    """line_url／external_url 會原封不動變成官網 CTA 的 href，只檢查非空
    等於讓管理端可以直接種一個 javascript: 連結到公開站。比對前先清掉
    不可見字元，避免 `java<TAB>script:` 這種寫法繞過。"""
    if value is None:
        return value
    candidate = _INVISIBLE_RE.sub("", value)
    if candidate == "":
        return value
    if not candidate.lower().startswith(_ALLOWED_LINK_SCHEMES):
        raise ValueError("連結必須以 https:// 或 http:// 開頭")
    return value


class BookingConfigOut(BaseModel):
    campus_key: str
    mode: BookingMode
    version: int
    line_url: str | None
    phone: str | None
    external_url: str | None
    message: str | None
    slots_auto_confirm: bool

    model_config = {"from_attributes": True}


class BookingConfigUpdateRequest(BaseModel):
    expected_version: int
    mode: BookingMode
    # 長度對齊 models.py 的欄位定義：沒有上限的話，後台貼一段稍長的暫停
    # 說明就會在 INSERT 時撞 varchar 長度，變成 500「更新失敗」。
    line_url: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=32)
    external_url: str | None = Field(default=None, max_length=500)
    message: str | None = Field(default=None, max_length=500)
    # 規格 197／222：slots 預設為人工確認（家長看到「待園方確認」），
    # 園方要自動確認才明確打開。
    slots_auto_confirm: bool = False

    @field_validator("line_url", "external_url")
    @classmethod
    def _links_safe(cls, value: str | None) -> str | None:
        return _validate_public_link(value)


class PublicBookingConfigOut(BaseModel):
    """公開端點只回前端 resolveBookingAction 需要的欄位，不外洩管理用資訊。"""

    campus_key: str
    mode: BookingMode
    version: int
    line_url: str | None
    phone: str | None
    external_url: str | None
    message: str | None
    slots_auto_confirm: bool

    model_config = {"from_attributes": True}


class VisitRequestCreate(BaseModel):
    campus_key: str
    config_version: int
    parent_name: str = Field(min_length=1, max_length=64)
    phone: str
    # 新欄位保持選填，既有前端與舊的重試請求不必補資料才能送出。
    child_name: str | None = Field(default=None, min_length=1, max_length=64)
    child_birthdate: date | None = None
    email: EmailStr | None = Field(default=None, max_length=254)
    referral_sources: list[ReferralSource] = Field(default_factory=list, max_length=5)
    # 規格 190 的固定 enum 是 unknown|under_2|2-3|3-4|4-5|5-6 與
    # flexible|weekday_morning|weekday_afternoon|other，但公開表單目前送
    # 的是 CMS 的中文標籤（web/server/data/site-fixture.json），直接收緊
    # 成 Literal 會讓現行表單全部送不出去。這裡先對齊 models.py 的欄位
    # 長度擋掉 500，enum 化需要 web/ 與 CMS 選項一起改。
    age: str | None = Field(default=None, max_length=32)
    preferred_time: str | None = Field(default=None, max_length=32)
    questions: str | None = Field(default=None, max_length=1000)
    consent_given: bool
    slot_id: uuid.UUID | None = None  # mode=slots 時必填

    @field_validator("parent_name")
    @classmethod
    def _parent_name_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("請填寫家長稱呼")
        # 舊欄位保留原值，避免改寫已成立案件的冪等 payload hash。
        return value

    @field_validator("child_name", mode="before")
    @classmethod
    def _normalize_child_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("child_birthdate")
    @classmethod
    def _birthdate_not_future(cls, value: date | None) -> date | None:
        if value is not None and value > today_local():
            raise ValueError("寶貝出生日期不能晚於今天")
        return value

    @field_validator("referral_sources")
    @classmethod
    def _unique_referral_sources(cls, value: list[ReferralSource]) -> list[ReferralSource]:
        # 多選是集合；固定順序也讓相同選項的重試不因點選順序不同而衝突。
        return [source for source in _REFERRAL_SOURCE_ORDER if source in value]

    @field_validator("phone")
    @classmethod
    def _validate_phone(cls, value: str) -> str:
        return normalize_phone(value)

    @field_validator("consent_given")
    @classmethod
    def _require_consent(cls, value: bool) -> bool:
        if not value:
            raise ValueError("需要勾選同意才能送出")
        return value


class VisitRequestOut(BaseModel):
    receipt_id: uuid.UUID
    status: str
    created_at: datetime


class VisitSlotOut(BaseModel):
    id: uuid.UUID
    campus_key: str
    slot_date: date
    start_time: time
    end_time: time
    capacity: int
    closed: bool
    booked_count: int

    model_config = {"from_attributes": True}


class PublicVisitSlotOut(BaseModel):
    """公開端點只回可用性，不回誰訂走了名額。"""

    id: uuid.UUID
    slot_date: date
    start_time: time
    end_time: time
    remaining: int


class VisitSlotCreateRequest(BaseModel):
    slot_date: date
    start_time: time
    end_time: time
    capacity: int = Field(gt=0, le=200)

    @field_validator("end_time")
    @classmethod
    def _end_after_start(cls, value: time, info) -> time:
        start = info.data.get("start_time")
        if start is not None and value <= start:
            raise ValueError("結束時間必須晚於開始時間")
        return value


class VisitSlotUpdateRequest(BaseModel):
    capacity: int | None = Field(default=None, ge=0, le=200)
    closed: bool | None = None


class VisitSlotBriefOut(BaseModel):
    """案件上要顯示的「參觀時間」。容量與已預約數是時段管理頁的事，
    這裡只回日期與起訖；後台明細與列表都直接顯示這一份，不必再打一次
    /admin/slots 去換算家長約在哪一天。"""

    id: uuid.UUID
    slot_date: date
    start_time: time
    end_time: time

    model_config = {"from_attributes": True}


class VisitRequestDetailOut(BaseModel):
    id: uuid.UUID
    campus_key: str
    status: str
    parent_name: str
    phone: str
    child_name: str | None = None
    child_birthdate: date | None = None
    email: str | None = None
    referral_sources: list[ReferralSource] = Field(default_factory=list)
    age: str | None
    preferred_time: str | None
    questions: str | None
    slot_id: uuid.UUID | None
    # 未排時段（inquiry 待處理）時為 None。序列化會讀 VisitRequest.slot
    # relationship，取這個 schema 的查詢一律要 selectinload，否則 async
    # 下會踩到 lazy load。
    slot: VisitSlotBriefOut | None = None
    assigned_staff_id: uuid.UUID | None
    confirmed_at: datetime | None
    cancelled_at: datetime | None
    follow_up_at: datetime | None
    hold_expires_at: datetime | None = None
    source: VisitSource = "web"
    created_by: uuid.UUID | None = None
    related_request_id: uuid.UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class VisitRequestManualCreate(BaseModel):
    """規格 6.2 人工補登。欄位規則與公開表單相同（手機一樣正規化成 10
    碼），但不需要 config_version／同意勾選／冪等鍵：這是園方自己在後台建
    的案子，不是家長從官網送的。"""

    campus_key: str
    source: ManualVisitSource
    parent_name: str = Field(min_length=1, max_length=64)
    phone: str
    child_name: str | None = Field(default=None, max_length=64)
    child_birthdate: date | None = None
    email: EmailStr | None = Field(default=None, max_length=254)
    age: str | None = Field(default=None, max_length=32)
    preferred_time: str | None = Field(default=None, max_length=32)
    questions: str | None = Field(default=None, max_length=1000)
    # 結案後重新預約時指回舊案；跨校關聯只有總管理者可以做。
    related_request_id: uuid.UUID | None = None

    @field_validator("parent_name")
    @classmethod
    def _parent_name_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("請填寫家長稱呼")
        return value.strip()

    @field_validator("child_name", mode="before")
    @classmethod
    def _normalize_child_name(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator("child_birthdate")
    @classmethod
    def _birthdate_not_future(cls, value: date | None) -> date | None:
        if value is not None and value > today_local():
            raise ValueError("寶貝出生日期不能晚於今天")
        return value

    @field_validator("phone")
    @classmethod
    def _validate_phone(cls, value: str) -> str:
        return normalize_phone(value)


class VisitRequestAssignRequest(BaseModel):
    """None 代表取消指派。"""

    assigned_staff_id: uuid.UUID | None


class StaffOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str


def _mask_phone(phone: str) -> str:
    """規格 6.4：家長頁只顯示遮罩手機。保留前 4 碼與後 3 碼供本人辨識。"""
    if len(phone) < 7:
        return "*" * len(phone)
    return f"{phone[:4]}***{phone[-3:]}"


class ParentVisitRequestOut(BaseModel):
    """家長端（憑安全連結）看到的案件。刻意不沿用 VisitRequestDetailOut：
    那是後台用的，含未遮罩手機、家長姓名、提問與 assigned_staff_id 等內部
    欄位，連結一旦外流就等於把整份個資交出去。"""

    id: uuid.UUID
    campus_key: str
    status: str
    phone_masked: str
    slot: VisitSlotBriefOut | None = None
    confirmed_at: datetime | None
    cancelled_at: datetime | None
    hold_expires_at: datetime | None
    created_at: datetime
    change_deadline: datetime | None
    can_cancel: bool
    can_reschedule: bool
    reschedule_pending: bool = False

    @classmethod
    def from_visit_request(cls, visit_request) -> "ParentVisitRequestOut":
        return cls(
            id=visit_request.id,
            campus_key=visit_request.campus_key,
            status=visit_request.status,
            phone_masked=_mask_phone(visit_request.phone),
            slot=(
                VisitSlotBriefOut.model_validate(visit_request.slot)
                if visit_request.slot is not None
                else None
            ),
            confirmed_at=visit_request.confirmed_at,
            cancelled_at=visit_request.cancelled_at,
            hold_expires_at=visit_request.hold_expires_at,
            created_at=visit_request.created_at,
            change_deadline=parent_change_deadline(visit_request),
            can_cancel=visit_request.status in {"new", "contacting", "pending_confirmation", "confirmed"} and parent_change_open(visit_request),
            can_reschedule=visit_request.status == "confirmed" and parent_change_open(visit_request),
        )


class VisitContactNoteOut(BaseModel):
    id: uuid.UUID
    note: str
    created_at: datetime

    model_config = {"from_attributes": True}


class VisitRequestConfirmRequest(BaseModel):
    slot_id: uuid.UUID


class VisitRequestRescheduleRequest(BaseModel):
    new_slot_id: uuid.UUID


class VisitContactNoteCreateRequest(BaseModel):
    note: str = Field(min_length=1, max_length=1000)
    follow_up_at: datetime | None = None


class VisitRuleIn(BaseModel):
    """0＝週一 … 6＝週日。"""

    weekday: int = Field(ge=0, le=6)
    start_time: time
    end_time: time
    slot_minutes: int = Field(ge=10, le=240)
    capacity: int = Field(gt=0, le=200)

    @field_validator("end_time")
    @classmethod
    def _end_after_start(cls, value: time, info) -> time:
        start = info.data.get("start_time")
        if start is not None and value <= start:
            raise ValueError("結束時間必須晚於開始時間")
        return value


class VisitRuleOut(VisitRuleIn):
    id: uuid.UUID

    model_config = {"from_attributes": True}


class VisitExceptionIn(BaseModel):
    exception_date: date
    reason: str | None = Field(default=None, max_length=200)


class VisitExceptionOut(BaseModel):
    id: uuid.UUID
    exception_date: date
    reason: str | None

    model_config = {"from_attributes": True}


class VisitExceptionCreatedOut(VisitExceptionOut):
    closed_slots: int
    affected_requests: int


class VisitScheduleOut(BaseModel):
    campus_key: str
    min_lead_hours: int
    max_advance_days: int
    rules: list[VisitRuleOut]
    exceptions: list[VisitExceptionOut]


class VisitScheduleUpdate(BaseModel):
    min_lead_hours: int = Field(ge=0, le=24 * 14)
    max_advance_days: int = Field(ge=1, le=365)
    rules: list[VisitRuleIn] = Field(default_factory=list, max_length=50)


class VisitSlotGenerateRequest(BaseModel):
    date_from: date
    date_to: date


class VisitSlotGenerateOut(BaseModel):
    created: int
    skipped_existing: int
    skipped_exception_days: int
