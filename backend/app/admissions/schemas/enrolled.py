"""在籍學生分布（2026-10-15 規格 §5）。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.admissions.schemas.area import DistanceBandKey


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
