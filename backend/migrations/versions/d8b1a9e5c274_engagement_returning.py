"""內容興趣紀錄加回訪分類、瀏覽器匿名代號、記住的校區；新增「記住預約」每日次數表

2026-11-18 起（回訪分類）、2026-11-19 補齊（docs/specs/2026-11-19-cookie-stats-design.md）。
只新增可空欄位與一張新表，不改既有資料，不需要事先備份正式庫。

Revision ID: d8b1a9e5c274
Revises: e7a4c1d9b3f2
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d8b1a9e5c274"
down_revision = "e7a4c1d9b3f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("engagement_visits", sa.Column("returning", sa.Boolean(), nullable=True))
    op.add_column("engagement_visits", sa.Column("browser_key", sa.String(32), nullable=True))
    op.add_column("engagement_visits", sa.Column("campus_pref", sa.String(32), nullable=True))
    op.create_index("ix_engagement_visits_browser_key", "engagement_visits", ["browser_key"])
    op.create_table(
        "visit_remembered_daily",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("campus_key", sa.String(32), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("has_email", sa.Boolean(), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.UniqueConstraint("day", "campus_key", "action", "has_email", name="uq_visit_remembered_daily"),
        sa.CheckConstraint("action IN ('shown', 'opened', 'dismissed')", name="ck_visit_remembered_daily_action"),
    )
    op.create_index("ix_visit_remembered_daily_day", "visit_remembered_daily", ["day"])


def downgrade() -> None:
    op.drop_index("ix_visit_remembered_daily_day", table_name="visit_remembered_daily")
    op.drop_table("visit_remembered_daily")
    op.drop_index("ix_engagement_visits_browser_key", table_name="engagement_visits")
    op.drop_column("engagement_visits", "campus_pref")
    op.drop_column("engagement_visits", "browser_key")
    op.drop_column("engagement_visits", "returning")
