"""家長在 LINE 參觀提醒按「會準時到」（2026-11-25，docs/specs/2026-11-25-line-more-features-design.md §7）

- visit_requests 加兩個可為 NULL 的欄位：attendance_confirmed_at（按的時間）、attendance_confirmed_slot_id
  （按的時候是哪個場次；改期後不等於目前場次就不算）。不是個資，匿名化不清。

只新增欄位，不改寫既有資料，不需要事先備份正式庫。

Revision ID: f2b7c4e9a813
Revises: a6c3e9f2d417
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f2b7c4e9a813"
down_revision = "a6c3e9f2d417"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("visit_requests", sa.Column("attendance_confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("visit_requests", sa.Column("attendance_confirmed_slot_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    op.drop_column("visit_requests", "attendance_confirmed_slot_id")
    op.drop_column("visit_requests", "attendance_confirmed_at")
