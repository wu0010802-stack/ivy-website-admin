"""手機推播：push_subscriptions 資料表與 error_groups.alerted_at（2026-11-05）

後台手機通知（Web Push）：每台裝置的瀏覽器訂閱存一列（notifications/web_push.py），新預約與網站錯誤
發生時送出推播；error_groups 加一欄 alerted_at 給「同一組錯誤 15 分鐘內不重複通知」用。
新增一張空表、一個索引與一個可為 NULL 的欄位，不改既有資料，上一版程式照常可用（沒有預設值的新欄位
在 PostgreSQL 只改目錄、不重寫整張表）。降級刪掉即可。

Revision ID: b5e8f1c3a7d2
Revises: 9d4e7a2c1f60
Create Date: 2026-11-05
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b5e8f1c3a7d2"
down_revision = "9d4e7a2c1f60"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(length=200), nullable=False),
        sa.Column("auth", sa.String(length=100), nullable=False),
        sa.Column("device_label", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failure_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_count", sa.Integer(), server_default="0", nullable=False),
        sa.UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])
    op.add_column("error_groups", sa.Column("alerted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("error_groups", "alerted_at")
    op.drop_index("ix_push_subscriptions_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
