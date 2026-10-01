"""招生入學三張表（規格 5.1–5.3）。表名與欄位名沿用園務 models/recruitment.py，
型別依官網慣例：uuid 主鍵、timestamptz、用 campus_key 取代 tenant_id。

列舉用 String＋CheckConstraint，條件字串由 constants 組出來，與 migration
4a7e2c9d1b63 的字面值逐字相同（tests/test_admissions_schema.py 檢查）。
created_at／updated_at 由程式填 datetime.now(timezone.utc)，沒有 server_default。"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import date as date_, datetime

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
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.admissions.constants import GRADES, NO_DEPOSIT_REASONS, SOURCE_CATEGORIES, WITHDRAWN_FROM
from app.db import Base


def _sql_in(column: str, values: Iterable[str], *, nullable: bool = True) -> str:
    listed = ", ".join(f"'{value}'" for value in values)
    condition = f"{column} IN ({listed})"
    return f"{column} IS NULL OR {condition}" if nullable else condition


class RecruitmentVisit(Base):
    """招生訪視：一筆＝一個孩子的一次參觀（規格 5.1）。階段由 withdrawn_at、
    enrolled、has_deposit 推導（funnel.derive_stage），不另存欄位；這三個欄位
    與 enrolled_on、withdrawn_* 只能由狀態轉換改變。"""

    __tablename__ = "recruitment_visits"
    __table_args__ = (
        UniqueConstraint("visit_request_id", name="uq_recruitment_visits_visit_request"),
        UniqueConstraint("campus_key", "month", "seq_no", name="uq_recruitment_visits_seq"),
        CheckConstraint(_sql_in("grade", GRADES), name="ck_recruitment_visits_grade"),
        CheckConstraint(_sql_in("provisional_grade", GRADES), name="ck_recruitment_visits_provisional_grade"),
        CheckConstraint(_sql_in("source_category", SOURCE_CATEGORIES), name="ck_recruitment_visits_source_category"),
        CheckConstraint(_sql_in("no_deposit_reason", NO_DEPOSIT_REASONS), name="ck_recruitment_visits_no_deposit_reason"),
        CheckConstraint(_sql_in("withdrawn_from", WITHDRAWN_FROM), name="ck_recruitment_visits_withdrawn_from"),
        CheckConstraint("target_semester IS NULL OR target_semester IN (1, 2)", name="ck_recruitment_visits_target_semester"),
        CheckConstraint("enrolled = false OR enrolled_on IS NOT NULL", name="ck_recruitment_visits_enrolled_on"),
        Index("ix_recruitment_visits_campus_month", "campus_key", "month"),
        Index(
            "ix_recruitment_visits_campus_target",
            "campus_key",
            "target_school_year",
            "target_semester",
            "provisional_grade",
        ),
        Index("ix_recruitment_visits_campus_deposit", "campus_key", "has_deposit"),
        Index("ix_recruitment_visits_campus_grade", "campus_key", "grade"),
        Index("ix_recruitment_visits_withdrawn_at", "withdrawn_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False)
    # 由官網預約建立（已到場或補建）時填入；一筆預約最多一筆招生訪視。
    visit_request_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="SET NULL"), nullable=True
    )
    # 民國月份「115.09」，後端依 visit_date 算，不接受前端直送。
    month: Mapped[str] = mapped_column(String(10), nullable=False)
    # 同校同月份內的序號（同月份現有最大開頭數字＋1），後端配號。
    seq_no: Mapped[str | None] = mapped_column(String(10), nullable=True)
    visit_date: Mapped[date_] = mapped_column(Date, nullable=False)
    child_name: Mapped[str] = mapped_column(String(50), nullable=False)
    birthday: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    # 適讀班級（四個年級名稱之一）。
    grade: Mapped[str | None] = mapped_column(String(20), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # 主要聯絡人（不一定是家長，園務 rvcontact01）。
    contact_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    address: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # 本次不填、不顯示，保留給之後的區域分析。
    district: Mapped[str | None] = mapped_column(String(30), nullable=True)
    source: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 園務表單稱「介紹者」、統計稱「接待人員」。
    referrer: Mapped[str | None] = mapped_column(String(50), nullable=True)
    deposit_collector: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 帶參觀老師：官網後台帳號＋姓名快照（轉移時依姓名對應園務員工）。
    tour_guide_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    tour_guide_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 園務九類來源代碼（constants.SOURCE_CATEGORIES）；NULL＝待歸類。
    source_category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    has_deposit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    rides_bus: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 電訪後家長回應。
    parent_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 本次不提供勾選，保留給之後的熱點分析。
    geocoding_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    no_deposit_reason: Mapped[str | None] = mapped_column(String(60), nullable=True)
    no_deposit_reason_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    enrolled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # 註冊日期（官網延伸；園務以學生檔為準）。enrolled=true 時必填（CHECK）。
    enrolled_on: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    # 轉到其他學期（統計的「有效預繳」排除它）。
    transfer_term: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # 保留座位的年級（園務 provisional_grade_id；官網沒有 class_grades，存名稱）。
    provisional_grade: Mapped[str | None] = mapped_column(String(20), nullable=True)
    target_school_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_semester: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 非空即落在「退預繳／退註冊」。
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawn_from: Mapped[str | None] = mapped_column(String(20), nullable=True)
    withdraw_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 樂觀鎖：每次編輯、狀態轉換、保留座位、匿名化都加一。
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    anonymized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # 刪除訪視時歷程交給資料庫 ON DELETE CASCADE（async 不能 lazy load 再逐筆刪）。
    events: Mapped[list[RecruitmentEventLog]] = relationship(
        back_populates="visit",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="RecruitmentEventLog.created_at",
    )


class RecruitmentEventLog(Base):
    """招生歷程（規格 5.2）：階段變化、保留座位與建立。reason 是人員填的自由
    文字，保存政策匿名化時清掉；metadata_json 不放個資。"""

    __tablename__ = "recruitment_event_log"
    __table_args__ = (
        Index("ix_recruitment_event_log_visit_time", "recruitment_visit_id", "created_at"),
        Index("ix_recruitment_event_log_event_type", "event_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    recruitment_visit_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("recruitment_visits.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    from_stage: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_stage: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    visit: Mapped[RecruitmentVisit] = relationship(back_populates="events")


class GradeIntakeTarget(Base):
    """各校各學年學期、各年級的計畫名額（規格 5.3）。沒有列＝「未設定」，
    與「計畫名額 0」分開顯示。"""

    __tablename__ = "grade_intake_targets"
    __table_args__ = (
        UniqueConstraint("campus_key", "grade", "school_year", "semester", name="uq_grade_intake_target"),
        CheckConstraint(_sql_in("grade", GRADES, nullable=False), name="ck_grade_intake_targets_grade"),
        CheckConstraint("semester IN (1, 2)", name="ck_grade_intake_targets_semester"),
        CheckConstraint("target_seats >= 0", name="ck_grade_intake_targets_seats"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False)
    grade: Mapped[str] = mapped_column(String(20), nullable=False)
    school_year: Mapped[int] = mapped_column(Integer, nullable=False)
    semester: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    target_seats: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
