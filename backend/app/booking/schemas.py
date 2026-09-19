from __future__ import annotations

import uuid
from datetime import datetime

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
