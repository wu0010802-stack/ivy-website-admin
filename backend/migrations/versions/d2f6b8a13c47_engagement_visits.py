"""內容興趣統計：單次頁面瀏覽的停留、區塊與互動。

Revision ID: d2f6b8a13c47
Revises: c4e9a2b7d815
Create Date: 2026-11-11
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d2f6b8a13c47"
down_revision = "c4e9a2b7d815"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 只新增一張表，不動既有資料。
    op.create_table(
        "engagement_visits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("page", sa.String(length=16), nullable=False),
        sa.Column("campus_key", sa.String(length=32), nullable=False),
        sa.Column("item", sa.String(length=64), nullable=False),
        sa.Column("device", sa.String(length=16), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("active_ms", sa.Integer(), nullable=False),
        sa.Column("scroll_pct", sa.Integer(), nullable=False),
        sa.Column("sections", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("actions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_engagement_visits_day_page", "engagement_visits", ["day", "page"], unique=False)
    op.create_index("ix_engagement_visits_session", "engagement_visits", ["session_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_engagement_visits_session", table_name="engagement_visits")
    op.drop_index("ix_engagement_visits_day_page", table_name="engagement_visits")
    op.drop_table("engagement_visits")
