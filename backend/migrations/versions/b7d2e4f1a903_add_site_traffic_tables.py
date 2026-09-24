"""官網瀏覽量（每日累計）與 Core Web Vitals 樣本。

Revision ID: b7d2e4f1a903
Revises: 8cf3e2b5a641
Create Date: 2026-09-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b7d2e4f1a903"
down_revision = "8cf3e2b5a641"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 只新增兩張表，不動既有資料。
    op.create_table(
        "page_view_daily",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("page", sa.String(length=16), nullable=False),
        sa.Column("campus_key", sa.String(length=32), nullable=False),
        sa.Column("device", sa.String(length=16), nullable=False),
        sa.Column("views", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("day", "page", "campus_key", "device", name="uq_page_view_daily_bucket"),
    )
    op.create_index(op.f("ix_page_view_daily_day"), "page_view_daily", ["day"], unique=False)
    op.create_table(
        "web_vital_samples",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("metric", sa.String(length=8), nullable=False),
        sa.Column("page", sa.String(length=16), nullable=False),
        sa.Column("campus_key", sa.String(length=32), nullable=False),
        sa.Column("device", sa.String(length=16), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_web_vital_samples_day_metric", "web_vital_samples", ["day", "metric"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_web_vital_samples_day_metric", table_name="web_vital_samples")
    op.drop_table("web_vital_samples")
    op.drop_index(op.f("ix_page_view_daily_day"), table_name="page_view_daily")
    op.drop_table("page_view_daily")
