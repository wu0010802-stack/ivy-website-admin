"""編班與缺額 API 的 request／response schema（2026-11-15 計畫）。

request 一律 extra="forbid"；文字去頭尾空白、空字串當沒填。PATCH 用 model_fields_set
區分「沒送」與「送 null 清空」。回應裡的 `grade` 一律是實際年級。"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.admissions.schemas._common import Grade, OptionalText, SchoolYear, Semester, _not_future, _required_text

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


NextYear = Literal["continue", "leave", "repeat"]
BoardNotice = Literal["deposit_removed", "enrolled"]
Birthday = Annotated[date | None, AfterValidator(_not_future)]


class PendingFields(_Request):
    """補登預繳未入園時共用的欄位（一次貼多個姓名共用同一組）。"""

    grade: Grade
    target_school_year: SchoolYear
    target_semester: Semester
    deposit_date: date
    planned_entry_date: date | None = None
    birthday: Birthday = None


class StudentsCreate(_Request):
    school_year: SchoolYear
    names: list[Annotated[str, Field(max_length=500)]] = Field(min_length=1, max_length=60)
    class_id: uuid.UUID | None = None
    pending: PendingFields | None = None


class StudentUpdate(_Request):
    """只送要改的欄位。可以清空的只有 birthday、note、enrollment_date、planned_entry_date。"""

    child_name: str | None = Field(default=None, max_length=50)
    birthday: Birthday = None
    note: OptionalText = Field(default=None, max_length=1000)
    enrollment_date: date | None = None
    planned_entry_date: date | None = None
    deposit_date: date | None = None
    target_school_year: SchoolYear | None = None
    target_semester: Semester | None = None
    grade: Grade | None = None
    is_special_education: bool | None = None
    is_indigenous: bool | None = None
    is_new_manual: bool | None = None
    underage_manual: bool | None = None
    next_year: NextYear | None = None
    expected_version: int = Field(ge=1)

    @model_validator(mode="after")
    def _non_nullable(self) -> "StudentUpdate":
        for name in self.model_fields_set - {"birthday", "note", "enrollment_date", "planned_entry_date", "expected_version"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} 不能清空")
        if "child_name" in self.model_fields_set:
            self.child_name = _required_text(self.child_name, "請填幼生姓名")
        return self


class StudentMove(_Request):
    class_id: uuid.UUID | None
    position: int = Field(ge=0)
    expected_version: int = Field(ge=1)


class StudentOut(BaseModel):
    id: uuid.UUID
    campus_key: str
    school_year: int
    class_id: uuid.UUID | None
    position: int | None
    grade: str | None
    child_name: str
    birthday: date | None
    note: str | None
    status: str
    enrollment_date: date | None
    planned_entry_date: date | None
    deposit_date: date | None
    left_date: date | None
    refunded_date: date | None
    target_school_year: int | None
    target_semester: int | None
    is_special_education: bool
    is_indigenous: bool
    is_new_manual: bool
    underage_manual: bool
    next_year: str
    from_funnel: bool
    version: int
    is_new: bool
    is_underage: bool | None
    board_notice: BoardNotice | None


class StudentsCreated(BaseModel):
    students: list[StudentOut]
    duplicates: list[str]


class EnterRequest(_Request):
    enrollment_date: date | None = None
    expected_version: int = Field(ge=1)


class LeaveRequest(_Request):
    left_date: date | None = None
    expected_version: int = Field(ge=1)


class RefundRequest(_Request):
    refunded_date: date | None = None
    expected_version: int = Field(ge=1)


class RestoreRequest(_Request):
    """已退預繳的恢復成還沒編班（忽略 class_id）；已離園的恢復成在籍，要選一個班。"""

    class_id: uuid.UUID | None = None
    expected_version: int = Field(ge=1)
