"""後台資料匯入：在籍清冊的預覽、確認與清除（2026-10-21 規格 §5、§8）。

預覽的輸入只有班別與地址（姓名、生日在瀏覽器就丟掉），一律 extra="forbid"；回應裡的點位和
EnrolledRosterIn 的內容相同，原樣送回「確認匯入」。地址只在預覽請求裡出現，不進任何回應。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.admissions import academic, constants
from app.admissions.schemas.enrolled import EnrolledGrade


# ---- 在籍清冊預覽（輸入）----


class EnrolledUploadStudentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grade: EnrolledGrade
    address: str = Field(min_length=1, max_length=120)


class EnrolledPreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    roster_date: date
    students: list[EnrolledUploadStudentIn] = Field(min_length=1, max_length=2000)

    @field_validator("roster_date")
    @classmethod
    def _plausible_term(cls, value: date) -> date:
        # 學年算出來要落在匯入端（EnrolledRosterIn.school_year）收得下的範圍，不然預覽通過、確認匯入卻被擋。
        if not constants.SCHOOL_YEAR_MIN <= academic.current_term(value)[0] <= constants.SCHOOL_YEAR_MAX:
            raise ValueError("清冊日期不在合理範圍")
        return value


# ---- 在籍清冊預覽（輸出）----


class EnrolledImportPointOut(BaseModel):
    grade: EnrolledGrade
    district: str | None
    village: str | None
    match_level: str
    unlocated_reason: str | None
    lat: float | None
    lng: float | None


class EnrolledImportPayloadOut(BaseModel):
    format: Literal["ivy-enrolled-points/1"]
    campus_key: str
    roster_date: date
    school_year: int
    doorplate_version: str
    students: list[EnrolledImportPointOut]


class EnrolledImportUnplacedOut(BaseModel):
    match_level: str
    unlocated_reason: str | None
    # masked_address() 的結果（「義華路…」），切不出街路是空字串；不會有門牌號碼或樓層。
    street: str


class EnrolledPreviewOut(BaseModel):
    roster_date: date
    school_year: int
    doorplate_version: str
    total: int
    placed: int
    placed_ratio: float
    # 有點比例達門檻（MIN_PLACED_RATIO），確認匯入才收。
    importable: bool
    levels: dict[str, int]
    methods: dict[str, int]
    inferred: int
    grades: dict[str, int]
    unplaced: list[EnrolledImportUnplacedOut]
    payload: EnrolledImportPayloadOut


# ---- 匯入狀態 ----


class EnrolledImportStatusOut(BaseModel):
    roster_date: date
    school_year: int
    doorplate_version: str
    total: int
    placed: int
    imported_at: datetime


class HistoryImportStatusOut(BaseModel):
    rows: int
    first_school_year: int
    first_semester: int
    last_school_year: int
    last_semester: int
    imported_at: datetime


class ImportStatusOut(BaseModel):
    # 使用中的門牌資料月份（「115-10」，和 EnrolledImportStatusOut.doorplate_version 同一種寫法）；還沒匯入過是 None。
    active_doorplate_version: str | None
    enrolled: EnrolledImportStatusOut | None
    history: HistoryImportStatusOut | None


class EnrolledApplyOut(BaseModel):
    students: int
    placed: int


class EnrolledClearOut(BaseModel):
    removed: bool
