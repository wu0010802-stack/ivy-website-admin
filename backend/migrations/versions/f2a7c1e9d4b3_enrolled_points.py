"""在籍學生分布：新增 enrolled_rosters、enrolled_student_points 兩張表（2026-10-15 規格 §4）

規格：docs/specs/2026-10-15-admissions-enrolled-map-design.md。
只新增表，不改既有資料，不需要先備份正式庫；上一版程式不讀新表，先跑 migration 再換程式也相容。
約束條件字串與 app/admissions/enrolled/models.py 逐字相同（tests/test_enrolled_schema.py 檢查）。
降級刪掉兩張表，已匯入的在籍學生點一併消失。

Revision ID: f2a7c1e9d4b3
Revises: c6a9e3f15d27
Create Date: 2026-10-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f2a7c1e9d4b3"
down_revision = "c6a9e3f15d27"
branch_labels = None
depends_on = None

GRADE_CHECK = "grade IN ('幼幼班', '小班', '中班', '大班', '其他')"
LEVEL_CHECK = "match_level IN ('exact', 'nearby', 'street', 'district', 'unlocated')"
REASON_CHECK = (
    "unlocated_reason IS NULL OR unlocated_reason IN ('no_address', 'outside_kaohsiung', 'no_doorplate', 'ambiguous_village')"
)
COORDS_CHECK = "(lat IS NULL) = (lng IS NULL)"
POINT_LEVEL_CHECK = "lat IS NULL OR match_level IN ('exact', 'nearby')"


def upgrade() -> None:
    op.create_table(
        "enrolled_rosters",
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), primary_key=True),
        sa.Column("roster_date", sa.Date(), nullable=False),
        sa.Column("school_year", sa.SmallInteger(), nullable=False),
        sa.Column("doorplate_version", sa.String(16), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "enrolled_student_points",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "campus_key", sa.String(32), sa.ForeignKey("enrolled_rosters.campus_key", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("grade", sa.String(8), nullable=False),
        sa.Column("district", sa.String(8), nullable=True),
        sa.Column("village", sa.String(16), nullable=True),
        sa.Column("match_level", sa.String(16), nullable=False),
        sa.Column("unlocated_reason", sa.String(24), nullable=True),
        sa.Column("lat", sa.Numeric(6, 3), nullable=True),
        sa.Column("lng", sa.Numeric(7, 3), nullable=True),
        sa.CheckConstraint(GRADE_CHECK, name="ck_enrolled_student_points_grade"),
        sa.CheckConstraint(LEVEL_CHECK, name="ck_enrolled_student_points_level"),
        sa.CheckConstraint(REASON_CHECK, name="ck_enrolled_student_points_reason"),
        sa.CheckConstraint(COORDS_CHECK, name="ck_enrolled_student_points_coords"),
        sa.CheckConstraint(POINT_LEVEL_CHECK, name="ck_enrolled_student_points_point_level"),
    )
    op.create_index("ix_enrolled_student_points_campus", "enrolled_student_points", ["campus_key"])


def downgrade() -> None:
    op.drop_index("ix_enrolled_student_points_campus", table_name="enrolled_student_points")
    op.drop_table("enrolled_student_points")
    op.drop_table("enrolled_rosters")
