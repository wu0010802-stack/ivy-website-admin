"""在籍學生分布的兩張表（2026-10-15 規格 §4）：每校一份清冊快照，每位學生一列去識別的點。
不存地址、編號、生日、性別；座標取到小數 3 位（約 100 m）。約束字串與 migration
f2a7c1e9d4b3 逐字相同（tests/test_enrolled_schema.py 檢查）。"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.admissions.geo.models import _in
from app.db import Base

ENROLLED_GRADES: tuple[str, ...] = ("幼幼班", "小班", "中班", "大班", "其他")
ENROLLED_LEVELS: tuple[str, ...] = ("exact", "nearby", "street", "district", "unlocated")
ENROLLED_REASONS: tuple[str, ...] = ("no_address", "outside_kaohsiung", "no_doorplate", "ambiguous_village")
# 只有這兩種比對等級有座標（同 matcher：street 只到里、沒有座標）。
POINT_LEVELS: tuple[str, ...] = ("exact", "nearby")


class EnrolledRoster(Base):
    __tablename__ = "enrolled_rosters"

    campus_key: Mapped[str] = mapped_column(String(32), ForeignKey("campuses.key", ondelete="RESTRICT"), primary_key=True)
    roster_date: Mapped[date] = mapped_column(Date, nullable=False)
    school_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    doorplate_version: Mapped[str] = mapped_column(String(16), nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class EnrolledStudentPoint(Base):
    __tablename__ = "enrolled_student_points"
    __table_args__ = (
        CheckConstraint(_in("grade", ENROLLED_GRADES), name="ck_enrolled_student_points_grade"),
        CheckConstraint(_in("match_level", ENROLLED_LEVELS), name="ck_enrolled_student_points_level"),
        CheckConstraint(_in("unlocated_reason", ENROLLED_REASONS, nullable=True), name="ck_enrolled_student_points_reason"),
        CheckConstraint("(lat IS NULL) = (lng IS NULL)", name="ck_enrolled_student_points_coords"),
        CheckConstraint("lat IS NULL OR match_level IN ('exact', 'nearby')", name="ck_enrolled_student_points_point_level"),
        Index("ix_enrolled_student_points_campus", "campus_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(
        String(32), ForeignKey("enrolled_rosters.campus_key", ondelete="CASCADE"), nullable=False
    )
    grade: Mapped[str] = mapped_column(String(8), nullable=False)
    district: Mapped[str | None] = mapped_column(String(8), nullable=True)
    village: Mapped[str | None] = mapped_column(String(16), nullable=True)
    match_level: Mapped[str] = mapped_column(String(16), nullable=False)
    unlocated_reason: Mapped[str | None] = mapped_column(String(24), nullable=True)
    lat: Mapped[Decimal | None] = mapped_column(Numeric(6, 3), nullable=True)
    lng: Mapped[Decimal | None] = mapped_column(Numeric(7, 3), nullable=True)
