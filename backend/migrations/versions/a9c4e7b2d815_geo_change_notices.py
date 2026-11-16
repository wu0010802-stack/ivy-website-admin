"""園所異動與裁罰通知的記帳表（2026-11-16 區域分析年份滑桿、五校並排、異動通知規格 §9）

規格：docs/specs/2026-11-16-area-compare-notices-design.md。
只新增 geo_change_notices、geo_change_notice_baselines 兩張表，不改既有資料，不需要部署前備份；上一版程式不讀新表。

Revision ID: a9c4e7b2d815
Revises: d4b7e1a95c26
Create Date: 2026-11-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a9c4e7b2d815"
down_revision = "d4b7e1a95c26"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "geo_change_notices",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="CASCADE"), nullable=False),
        sa.Column("dedupe_key", sa.String(400), nullable=False, unique=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("notified", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_geo_change_notices_campus_kind", "geo_change_notices", ["campus_key", "kind", "created_at"])
    op.create_table(
        "geo_change_notice_baselines",
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="CASCADE"), primary_key=True),
        sa.Column("kind", sa.String(32), primary_key=True),
        sa.Column("established_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("geo_change_notice_baselines")
    op.drop_index("ix_geo_change_notices_campus_kind", table_name="geo_change_notices")
    op.drop_table("geo_change_notices")
