"""場次使用情況：新預約表單讀場次的每日彙總表（2026-10-13 規格 §2.1）

規格：docs/specs/2026-10-13-visit-slot-usage-design.md。只新增 slot_lookup_daily，不改既有資料，
不需要先備份正式庫。上一版程式不讀新表，先跑 migration 再換程式也相容。約束條件字串與
app/booking/models.py 逐字相同（tests/test_slot_lookup_schema.py 檢查）。

Revision ID: b4d7e1a92c58
Revises: f3c8a2d47b19
Create Date: 2026-10-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b4d7e1a92c58"
down_revision = "f3c8a2d47b19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "slot_lookup_daily",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("campus_key", sa.String(32), nullable=False),
        sa.Column("bucket", sa.String(16), nullable=False),
        sa.Column("lookups", sa.Integer(), nullable=False),
        sa.UniqueConstraint("day", "campus_key", "bucket", name="uq_slot_lookup_daily_bucket"),
        sa.CheckConstraint(
            "bucket IN ('within_1', 'days_2_3', 'days_4_7', 'over_7', 'none')",
            name="ck_slot_lookup_daily_bucket",
        ),
    )
    op.create_index("ix_slot_lookup_daily_day", "slot_lookup_daily", ["day"])


def downgrade() -> None:
    op.drop_index("ix_slot_lookup_daily_day", table_name="slot_lookup_daily")
    op.drop_table("slot_lookup_daily")
