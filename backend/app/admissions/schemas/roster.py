"""編班與缺額 API 的 request／response schema（2026-11-15 計畫）。

request 一律 extra="forbid"；文字去頭尾空白、空字串當沒填。PATCH 用 model_fields_set
區分「沒送」與「送 null 清空」。回應裡的 `grade` 一律是實際年級。"""

from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.admissions.schemas._common import Grade, OptionalText, SchoolYear, _required_text

TeacherName = Annotated[str | None, Field(max_length=50)]
TargetSeats = Annotated[int | None, Field(ge=0, le=9999)]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ClassCreate(_Request):
    school_year: SchoolYear
    grade: Grade
    name: str = Field(max_length=50)
    class_code: str = Field(max_length=20)
    english_name: OptionalText = Field(default=None, max_length=50)
    head_teacher: OptionalText = Field(default=None, max_length=50)
    assistant_teacher: OptionalText = Field(default=None, max_length=50)
    english_teacher: OptionalText = Field(default=None, max_length=50)
    target_seats: TargetSeats = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _required_text(value, "請填班級名稱")

    @field_validator("class_code")
    @classmethod
    def _class_code(cls, value: str) -> str:
        return _required_text(value, "請填班序")


class ClassUpdate(_Request):
    """年級不能改（不收 grade 欄位，送了是 422）；只送要改的欄位。"""

    name: str | None = Field(default=None, max_length=50)
    class_code: str | None = Field(default=None, max_length=20)
    english_name: OptionalText = Field(default=None, max_length=50)
    head_teacher: OptionalText = Field(default=None, max_length=50)
    assistant_teacher: OptionalText = Field(default=None, max_length=50)
    english_teacher: OptionalText = Field(default=None, max_length=50)
    target_seats: TargetSeats = None
    expected_version: int = Field(ge=1)

    @field_validator("name", "class_code")
    @classmethod
    def _not_blank(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("不能清空")
        return _required_text(value, "不能清空")


class ClassOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campus_key: str
    school_year: int
    grade: str
    name: str
    class_code: str
    english_name: str | None
    head_teacher: str | None
    assistant_teacher: str | None
    english_teacher: str | None
    target_seats: int | None
    sort_order: int
    version: int
