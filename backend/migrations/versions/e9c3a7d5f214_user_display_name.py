"""後台帳號加「顯示名稱」（最多 12 字），承辦人、聯絡紀錄、歷程與操作紀錄顯示用

Revision ID: e9c3a7d5f214
Revises: e4c1a7f3b862
Create Date: 2026-09-29

2026-09-28 盤點的業主裁定：同事原本只看得到 Email 前綴，改成可以填顯示名稱。
只加一個可為 NULL 的欄位、不回填（沒填的畫面照舊用 Email），上一版程式讀寫
users 不受影響；PostgreSQL 加可為 NULL、沒有預設值的欄位只改目錄，不重寫資料表。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e9c3a7d5f214"
down_revision = "e4c1a7f3b862"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(12), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "display_name")
