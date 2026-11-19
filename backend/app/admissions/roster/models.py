"""編班表四張表（2026-11-14 規格 §6）：班級、幼生、全校三段目標、結算紀錄。

欄名沿用園務 Classroom／Student（class_code、head_teacher、birthday、
enrollment_date、is_special_education…）。「目標人數」叫 target_seats，不叫
capacity（園務的 capacity 是容量）。約束字串與 migration d4b7e1a95c26 逐字相同。
created_at／updated_at 由程式填，沒有 server_default（同 admissions.models）。"""

from __future__ import annotations

import uuid
from datetime import date as date_, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.admissions.constants import GRADES
from app.admissions.models import _sql_in
from app.db import Base

STUDENT_STATUSES: tuple[str, ...] = ("pending", "enrolled", "left", "refunded")
NEXT_YEAR_CHOICES: tuple[str, ...] = ("continue", "leave", "repeat")

# 與 migration d4b7e1a95c26 的字面值逐字相同。
ENROLLED_NEEDS_CLASS_CHECK = "status <> 'enrolled' OR class_id IS NOT NULL"
GONE_HAS_NO_CLASS_CHECK = "status NOT IN ('left', 'refunded') OR (class_id IS NULL AND position IS NULL)"
POSITION_NEEDS_CLASS_CHECK = "class_id IS NOT NULL OR position IS NULL"


class RosterClass(Base):
    """一個學年的一個班級。同校同學年班序（class_code）不重複；班上沒有幼生才能刪。"""

    __tablename__ = "roster_classes"
    __table_args__ = (
        UniqueConstraint("campus_key", "school_year", "class_code", name="uq_roster_classes_code"),
        CheckConstraint(_sql_in("grade", GRADES, nullable=False), name="ck_roster_classes_grade"),
        CheckConstraint("target_seats IS NULL OR target_seats >= 0", name="ck_roster_classes_target_seats"),
        Index("ix_roster_classes_campus_year", "campus_key", "school_year"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False)
    school_year: Mapped[int] = mapped_column(Integer, nullable=False)
    grade: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    class_code: Mapped[str] = mapped_column(String(20), nullable=False)
    english_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    head_teacher: Mapped[str | None] = mapped_column(String(50), nullable=True)
    assistant_teacher: Mapped[str | None] = mapped_column(String(50), nullable=True)
    english_teacher: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 目標人數；None＝未設定，與 0 分開。
    target_seats: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class RosterStudent(Base):
    """編班表的一位幼生。狀態只能由已入園、離園、退預繳、恢復這幾個動作改；
    姓名、生日、特教生、原住民是敏感資料，不進稽核 metadata 與日誌。"""

    __tablename__ = "roster_students"
    __table_args__ = (
        CheckConstraint(_sql_in("status", STUDENT_STATUSES, nullable=False), name="ck_roster_students_status"),
        CheckConstraint(_sql_in("next_year", NEXT_YEAR_CHOICES, nullable=False), name="ck_roster_students_next_year"),
        CheckConstraint(_sql_in("grade", GRADES), name="ck_roster_students_grade"),
        CheckConstraint(
            "target_semester IS NULL OR target_semester IN (1, 2)", name="ck_roster_students_target_semester"
        ),
        CheckConstraint(ENROLLED_NEEDS_CLASS_CHECK, name="ck_roster_students_enrolled_class"),
        CheckConstraint(GONE_HAS_NO_CLASS_CHECK, name="ck_roster_students_gone_no_class"),
        CheckConstraint(POSITION_NEEDS_CLASS_CHECK, name="ck_roster_students_position_class"),
        Index(
            "uq_roster_students_active_visit",
            "recruitment_visit_id",
            unique=True,
            postgresql_where=text("recruitment_visit_id IS NOT NULL AND status IN ('pending', 'enrolled')"),
        ),
        Index("ix_roster_students_campus_year", "campus_key", "school_year"),
        Index("ix_roster_students_class_position", "class_id", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False)
    school_year: Mapped[int] = mapped_column(Integer, nullable=False)
    class_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("roster_classes.id", ondelete="RESTRICT"), nullable=True
    )
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 還沒編班（或已離園、已退預繳）的年級；排進班級後以班級的年級為準。
    grade: Mapped[str | None] = mapped_column(String(20), nullable=True)
    child_name: Mapped[str] = mapped_column(String(50), nullable=False)
    birthday: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    enrollment_date: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    planned_entry_date: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    deposit_date: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    left_date: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    refunded_date: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    target_school_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_semester: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_special_education: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_indigenous: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_new_manual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    underage_manual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    next_year: Mapped[str] = mapped_column(String(10), nullable=False, default="continue", server_default="continue")
    # 來源看板紀錄被刪時設為空；from_funnel 仍為真＝看板紀錄已被刪。
    recruitment_visit_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("recruitment_visits.id", ondelete="SET NULL"), nullable=True
    )
    from_funnel: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class RosterTierTarget(Base):
    """全校三段目標（基礎／激勵／超越），每校每學年每學期一列；三欄都可空。"""

    __tablename__ = "roster_tier_targets"
    __table_args__ = (
        CheckConstraint("semester IN (1, 2)", name="ck_roster_tier_targets_semester"),
        CheckConstraint("base IS NULL OR base >= 0", name="ck_roster_tier_targets_base"),
        CheckConstraint("boost IS NULL OR boost >= 0", name="ck_roster_tier_targets_boost"),
        CheckConstraint("top IS NULL OR top >= 0", name="ck_roster_tier_targets_top"),
    )

    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="RESTRICT"), primary_key=True)
    school_year: Mapped[int] = mapped_column(Integer, primary_key=True)
    semester: Mapped[int] = mapped_column(Integer, primary_key=True)
    base: Mapped[int | None] = mapped_column(Integer, nullable=True)
    boost: Mapped[int | None] = mapped_column(Integer, nullable=True)
    top: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class RosterSnapshot(Base):
    """結算紀錄：存下統計日期那天的數字，之後改名單不會改到它。"""

    __tablename__ = "roster_snapshots"
    __table_args__ = (
        UniqueConstraint("campus_key", "school_year", "as_of", name="uq_roster_snapshots_day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False)
    school_year: Mapped[int] = mapped_column(Integer, nullable=False)
    as_of: Mapped[date_] = mapped_column(Date, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
