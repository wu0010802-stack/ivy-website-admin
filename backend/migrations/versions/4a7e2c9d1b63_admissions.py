"""招生入學：recruitment_visits、recruitment_event_log、grade_intake_targets 三張表
（表名沿用園務），以及保存政策的招生訪視天數 retention_policies.admissions_days。

只新增表與可空欄位，不改既有資料，與上一版程式相容。CheckConstraint 的條件字串
與 app/admissions/models.py 逐字相同（tests/test_admissions_schema.py 檢查）。

Revision ID: 4a7e2c9d1b63
Revises: c7d2e9f4a1b8
Create Date: 2026-10-01
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "4a7e2c9d1b63"
down_revision = "c7d2e9f4a1b8"
branch_labels = None
depends_on = None

GRADE_CHECK = "grade IS NULL OR grade IN ('幼幼班', '小班', '中班', '大班')"
PROVISIONAL_GRADE_CHECK = "provisional_grade IS NULL OR provisional_grade IN ('幼幼班', '小班', '中班', '大班')"
SOURCE_CATEGORY_CHECK = "source_category IS NULL OR source_category IN ('sibling_current', 'sibling_split', 'sibling_graduate', 'self_report', 'referral', 'invite_success', 'invite_origin', 'home_deposit', 'returning')"
NO_DEPOSIT_REASON_CHECK = "no_deposit_reason IS NULL OR no_deposit_reason IN ('時程未到／仍在觀望', '已有其他就學選項／比較他校', '未註明／待追蹤', '距離／地點因素', '家庭照顧安排考量', '特殊需求／名額限制', '課程／環境仍在評估', '費用考量')"
WITHDRAWN_FROM_CHECK = "withdrawn_from IS NULL OR withdrawn_from IN ('deposited', 'enrolled')"
TARGET_SEMESTER_CHECK = "target_semester IS NULL OR target_semester IN (1, 2)"
ENROLLED_ON_CHECK = "enrolled = false OR enrolled_on IS NOT NULL"
TARGET_GRADE_CHECK = "grade IN ('幼幼班', '小班', '中班', '大班')"
TARGET_SEMESTER_ONLY_CHECK = "semester IN (1, 2)"
TARGET_SEATS_CHECK = "target_seats >= 0"
ADMISSIONS_DAYS_CHECK = "admissions_days IS NULL OR admissions_days BETWEEN 30 AND 3650"


def upgrade() -> None:
    op.create_table(
        "recruitment_visits",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False),
        sa.Column("visit_request_id", sa.Uuid(), sa.ForeignKey("visit_requests.id", ondelete="SET NULL"), nullable=True),
        sa.Column("month", sa.String(10), nullable=False),
        sa.Column("seq_no", sa.String(10), nullable=True),
        sa.Column("visit_date", sa.Date(), nullable=False),
        sa.Column("child_name", sa.String(50), nullable=False),
        sa.Column("birthday", sa.Date(), nullable=True),
        sa.Column("grade", sa.String(20), nullable=True),
        sa.Column("phone", sa.String(100), nullable=True),
        sa.Column("contact_name", sa.String(50), nullable=True),
        sa.Column("address", sa.String(200), nullable=True),
        sa.Column("district", sa.String(30), nullable=True),
        sa.Column("source", sa.String(50), nullable=True),
        sa.Column("referrer", sa.String(50), nullable=True),
        sa.Column("deposit_collector", sa.String(50), nullable=True),
        sa.Column("tour_guide_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("tour_guide_name", sa.String(50), nullable=True),
        sa.Column("source_category", sa.String(30), nullable=True),
        sa.Column("has_deposit", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("rides_bus", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("parent_response", sa.Text(), nullable=True),
        sa.Column("geocoding_consent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("no_deposit_reason", sa.String(60), nullable=True),
        sa.Column("no_deposit_reason_detail", sa.Text(), nullable=True),
        sa.Column("enrolled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("enrolled_on", sa.Date(), nullable=True),
        sa.Column("transfer_term", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("provisional_grade", sa.String(20), nullable=True),
        sa.Column("target_school_year", sa.Integer(), nullable=True),
        sa.Column("target_semester", sa.Integer(), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdrawn_from", sa.String(20), nullable=True),
        sa.Column("withdraw_reason", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("anonymized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("visit_request_id", name="uq_recruitment_visits_visit_request"),
        sa.UniqueConstraint("campus_key", "month", "seq_no", name="uq_recruitment_visits_seq"),
        sa.CheckConstraint(GRADE_CHECK, name="ck_recruitment_visits_grade"),
        sa.CheckConstraint(PROVISIONAL_GRADE_CHECK, name="ck_recruitment_visits_provisional_grade"),
        sa.CheckConstraint(SOURCE_CATEGORY_CHECK, name="ck_recruitment_visits_source_category"),
        sa.CheckConstraint(NO_DEPOSIT_REASON_CHECK, name="ck_recruitment_visits_no_deposit_reason"),
        sa.CheckConstraint(WITHDRAWN_FROM_CHECK, name="ck_recruitment_visits_withdrawn_from"),
        sa.CheckConstraint(TARGET_SEMESTER_CHECK, name="ck_recruitment_visits_target_semester"),
        sa.CheckConstraint(ENROLLED_ON_CHECK, name="ck_recruitment_visits_enrolled_on"),
    )
    op.create_index("ix_recruitment_visits_campus_month", "recruitment_visits", ["campus_key", "month"])
    op.create_index(
        "ix_recruitment_visits_campus_target",
        "recruitment_visits",
        ["campus_key", "target_school_year", "target_semester", "provisional_grade"],
    )
    op.create_index("ix_recruitment_visits_campus_deposit", "recruitment_visits", ["campus_key", "has_deposit"])
    op.create_index("ix_recruitment_visits_campus_grade", "recruitment_visits", ["campus_key", "grade"])
    op.create_index("ix_recruitment_visits_withdrawn_at", "recruitment_visits", ["withdrawn_at"])

    op.create_table(
        "recruitment_event_log",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "recruitment_visit_id",
            sa.Uuid(),
            sa.ForeignKey("recruitment_visits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("from_stage", sa.String(20), nullable=True),
        sa.Column("to_stage", sa.String(20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_recruitment_event_log_visit_time", "recruitment_event_log", ["recruitment_visit_id", "created_at"]
    )
    op.create_index("ix_recruitment_event_log_event_type", "recruitment_event_log", ["event_type"])

    op.create_table(
        "grade_intake_targets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False),
        sa.Column("grade", sa.String(20), nullable=False),
        sa.Column("school_year", sa.Integer(), nullable=False),
        sa.Column("semester", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("target_seats", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("campus_key", "grade", "school_year", "semester", name="uq_grade_intake_target"),
        sa.CheckConstraint(TARGET_GRADE_CHECK, name="ck_grade_intake_targets_grade"),
        sa.CheckConstraint(TARGET_SEMESTER_ONLY_CHECK, name="ck_grade_intake_targets_semester"),
        sa.CheckConstraint(TARGET_SEATS_CHECK, name="ck_grade_intake_targets_seats"),
    )

    op.add_column("retention_policies", sa.Column("admissions_days", sa.Integer(), nullable=True))
    op.create_check_constraint("ck_retention_policies_admissions_days", "retention_policies", ADMISSIONS_DAYS_CHECK)


def downgrade() -> None:
    op.drop_constraint("ck_retention_policies_admissions_days", "retention_policies", type_="check")
    op.drop_column("retention_policies", "admissions_days")
    op.drop_table("grade_intake_targets")
    op.drop_table("recruitment_event_log")
    op.drop_table("recruitment_visits")
