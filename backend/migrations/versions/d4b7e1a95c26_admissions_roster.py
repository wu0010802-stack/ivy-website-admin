"""招生入學「編班與缺額」：班級、幼生、全校三段目標、結算紀錄四張新表（2026-11-14 規格 §6）

規格：docs/specs/2026-11-14-admissions-roster-gap-design.md。
只新增表，不改既有資料，不需要部署前備份；上一版程式不讀新表。
約束字串與 app/admissions/roster/models.py 逐字相同。

Revision ID: d4b7e1a95c26
Revises: f3b8d2a6c19e
Create Date: 2026-11-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d4b7e1a95c26"
down_revision = "f3b8d2a6c19e"
branch_labels = None
depends_on = None

GRADE_CHECK = "grade IN ('幼幼班', '小班', '中班', '大班')"
STUDENT_GRADE_CHECK = "grade IS NULL OR grade IN ('幼幼班', '小班', '中班', '大班')"


def upgrade() -> None:
    op.create_table(
        "roster_classes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False),
        sa.Column("school_year", sa.Integer(), nullable=False),
        sa.Column("grade", sa.String(20), nullable=False),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("class_code", sa.String(20), nullable=False),
        sa.Column("english_name", sa.String(50)),
        sa.Column("head_teacher", sa.String(50)),
        sa.Column("assistant_teacher", sa.String(50)),
        sa.Column("english_teacher", sa.String(50)),
        sa.Column("target_seats", sa.Integer()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.UniqueConstraint("campus_key", "school_year", "class_code", name="uq_roster_classes_code"),
        sa.CheckConstraint(GRADE_CHECK, name="ck_roster_classes_grade"),
        sa.CheckConstraint("target_seats IS NULL OR target_seats >= 0", name="ck_roster_classes_target_seats"),
    )
    op.create_index("ix_roster_classes_campus_year", "roster_classes", ["campus_key", "school_year"])

    op.create_table(
        "roster_students",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False),
        sa.Column("school_year", sa.Integer(), nullable=False),
        sa.Column("class_id", sa.Uuid(), sa.ForeignKey("roster_classes.id", ondelete="RESTRICT")),
        sa.Column("position", sa.Integer()),
        sa.Column("grade", sa.String(20)),
        sa.Column("child_name", sa.String(50), nullable=False),
        sa.Column("birthday", sa.Date()),
        sa.Column("note", sa.Text()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("enrollment_date", sa.Date()),
        sa.Column("planned_entry_date", sa.Date()),
        sa.Column("deposit_date", sa.Date()),
        sa.Column("left_date", sa.Date()),
        sa.Column("refunded_date", sa.Date()),
        sa.Column("target_school_year", sa.Integer()),
        sa.Column("target_semester", sa.Integer()),
        sa.Column("is_special_education", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_indigenous", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_new_manual", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("underage_manual", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("next_year", sa.String(10), nullable=False, server_default="continue"),
        sa.Column("recruitment_visit_id", sa.Uuid(), sa.ForeignKey("recruitment_visits.id", ondelete="SET NULL")),
        sa.Column("from_funnel", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.CheckConstraint("status IN ('pending', 'enrolled', 'left', 'refunded')", name="ck_roster_students_status"),
        sa.CheckConstraint("next_year IN ('continue', 'leave', 'repeat')", name="ck_roster_students_next_year"),
        sa.CheckConstraint(STUDENT_GRADE_CHECK, name="ck_roster_students_grade"),
        sa.CheckConstraint(
            "target_semester IS NULL OR target_semester IN (1, 2)", name="ck_roster_students_target_semester"
        ),
        sa.CheckConstraint("status <> 'enrolled' OR class_id IS NOT NULL", name="ck_roster_students_enrolled_class"),
        sa.CheckConstraint(
            "status NOT IN ('left', 'refunded') OR (class_id IS NULL AND position IS NULL)",
            name="ck_roster_students_gone_no_class",
        ),
        sa.CheckConstraint("class_id IS NOT NULL OR position IS NULL", name="ck_roster_students_position_class"),
    )
    op.create_index(
        "uq_roster_students_active_visit",
        "roster_students",
        ["recruitment_visit_id"],
        unique=True,
        postgresql_where=sa.text("recruitment_visit_id IS NOT NULL AND status IN ('pending', 'enrolled')"),
    )
    op.create_index("ix_roster_students_campus_year", "roster_students", ["campus_key", "school_year"])
    op.create_index("ix_roster_students_class_position", "roster_students", ["class_id", "position"])

    op.create_table(
        "roster_tier_targets",
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), primary_key=True),
        sa.Column("school_year", sa.Integer(), primary_key=True),
        sa.Column("semester", sa.Integer(), primary_key=True),
        sa.Column("base", sa.Integer()),
        sa.Column("boost", sa.Integer()),
        sa.Column("top", sa.Integer()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.CheckConstraint("semester IN (1, 2)", name="ck_roster_tier_targets_semester"),
        sa.CheckConstraint("base IS NULL OR base >= 0", name="ck_roster_tier_targets_base"),
        sa.CheckConstraint("boost IS NULL OR boost >= 0", name="ck_roster_tier_targets_boost"),
        sa.CheckConstraint("top IS NULL OR top >= 0", name="ck_roster_tier_targets_top"),
    )

    op.create_table(
        "roster_snapshots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False),
        sa.Column("school_year", sa.Integer(), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.UniqueConstraint("campus_key", "school_year", "as_of", name="uq_roster_snapshots_day"),
    )


def downgrade() -> None:
    op.drop_table("roster_snapshots")
    op.drop_table("roster_tier_targets")
    op.drop_index("ix_roster_students_class_position", table_name="roster_students")
    op.drop_index("ix_roster_students_campus_year", table_name="roster_students")
    op.drop_index("uq_roster_students_active_visit", table_name="roster_students")
    op.drop_table("roster_students")
    op.drop_index("ix_roster_classes_campus_year", table_name="roster_classes")
    op.drop_table("roster_classes")
