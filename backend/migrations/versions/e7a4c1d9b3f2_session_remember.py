"""後台 session 記下「記住這台裝置」

2026-11-19：登入時勾「記住這台裝置」的 session 最長 30 天、閒置也是 30 天（app/auth/service.py）。
只新增一個有預設值的欄位（PostgreSQL 11 起只改目錄、不重寫表），既有 session 一律當成沒勾，
行為不變；不改既有資料，不需要事先備份正式庫。

Revision ID: e7a4c1d9b3f2
Revises: d5e1f7a3b9c2
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e7a4c1d9b3f2"
down_revision = "d5e1f7a3b9c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("remember", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("sessions", "remember")
