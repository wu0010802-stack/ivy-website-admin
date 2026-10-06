"""操作紀錄加 IP 與 User-Agent

Revision ID: a3c7e9d1f5b2
Revises: e870893fac95
Create Date: 2026-10-06

2026-10-06 使用者要求操作紀錄看得到 IP 與裝置。只加兩個可為 NULL 的欄位、
不回填（之前的紀錄沒有這些資料，畫面不顯示）；PostgreSQL 加可為 NULL、沒有
預設值的欄位只改目錄，不重寫資料表。上一版程式不讀寫這兩欄，不受影響。

原本接 d65fa082ff87；同一天 e870893fac95（拿掉舊預約欄位）先上 main，改接它。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a3c7e9d1f5b2"
down_revision = "e870893fac95"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("audit_log_entries", sa.Column("ip_address", sa.String(64), nullable=True))
    op.add_column("audit_log_entries", sa.Column("user_agent", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("audit_log_entries", "user_agent")
    op.drop_column("audit_log_entries", "ip_address")
