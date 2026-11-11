"""內容興趣統計第二輪：瀏覽順序與活動代碼。

Revision ID: e7a1c93b5d20
Revises: d2f6b8a13c47
Create Date: 2026-11-11
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e7a1c93b5d20"
down_revision = "d2f6b8a13c47"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 只加兩個可為 NULL 的欄位：既有紀錄不回填，上一版程式照常寫入。
    op.add_column("engagement_visits", sa.Column("seq", sa.Integer(), nullable=True))
    op.add_column("engagement_visits", sa.Column("campaign", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("engagement_visits", "campaign")
    op.drop_column("engagement_visits", "seq")
