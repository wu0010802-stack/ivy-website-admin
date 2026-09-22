from __future__ import annotations

import uuid
from datetime import date, datetime, time

from pydantic import BaseModel, Field, field_validator

from app.booking.models import BookingMode

_PHONE_PATTERN = r"^09[0-9]{8}$"


class BookingConfigOut(BaseModel):
    campus_key: str
    mode: BookingMode
    version: int
    line_url: str | None
    phone: str | None
    external_url: str | None
    message: str | None

    model_config = {"from_attributes": True}


class BookingConfigUpdateRequest(BaseModel):
    expected_version: int
    mode: BookingMode
    line_url: str | None = None
    phone: str | None = None
    external_url: str | None = None
    message: str | None = None


class PublicBookingConfigOut(BaseModel):
    """公開端點只回前端 resolveBookingAction 需要的欄位，不外洩管理用資訊。"""

    campus_key: str
    mode: BookingMode
    version: int
    line_url: str | None
    phone: str | None
    external_url: str | None
    message: str | None

    model_config = {"from_attributes": True}


class VisitRequestCreate(BaseModel):
    campus_key: str
    config_version: int
    parent_name: str = Field(min_length=1, max_length=64)
    phone: str
    age: str | None = None
    preferred_time: str | None = None
    questions: str | None = Field(default=None, max_length=1000)
    consent_given: bool
    slot_id: uuid.UUID | None = None  # mode=slots 時必填

    @field_validator("phone")
    @classmethod
    def _validate_phone(cls, value: str) -> str:
        import re

        if not re.match(_PHONE_PATTERN, value):
            raise ValueError("手機號碼格式錯誤，需為 09 開頭的 10 碼數字")
        return value

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
    created_at: datetime

    model_config = {"from_attributes": True}


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
