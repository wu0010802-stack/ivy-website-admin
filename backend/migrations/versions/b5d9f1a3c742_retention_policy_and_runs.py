"""個資保存政策與清理紀錄

Revision ID: b5d9f1a3c742
Revises: a8c3e5f7b219
Create Date: 2026-09-25

規格 L282、L333：保存期限要能設定並持久化，每次清理要留紀錄。天數與範圍依
使用者 2026-09-25 裁定：各類預設 365 天（30–3650），自動清理預設關閉。

1. `retention_policies`：單列（id=1），已取消／未到場、已完成的保留天數，未結案
   提醒天數，是否每天自動執行。不在這裡寫入預設列：程式第一次讀取時才建立。
2. `retention_runs`：每次真正清理的時間、手動或定期、執行者、當時天數與各類
   筆數。不存案件 id。

兩張都是新表，不動既有資料；結案時間由既有的 cancelled_at 與歷程推算，不另
加欄位。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b5d9f1a3c742"
down_revision = "a8c3e5f7b219"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "retention_policies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cancelled_days", sa.Integer(), nullable=False),
        sa.Column("completed_days", sa.Integer(), nullable=False),
        sa.Column("open_overdue_days", sa.Integer(), nullable=False),
        sa.Column("auto_run_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_scheduled_on", sa.Date(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint(
            "cancelled_days BETWEEN 30 AND 3650 AND completed_days BETWEEN 30 AND 3650 "
            "AND open_overdue_days BETWEEN 30 AND 3650",
            name="ck_retention_policies_days",
        ),
    )
    op.create_table(
        "retention_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("trigger", sa.String(length=16), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("policy", sa.JSON(), nullable=False),
        sa.Column("counts", sa.JSON(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("open_overdue_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_retention_runs_created_at", "retention_runs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_retention_runs_created_at", table_name="retention_runs")
    op.drop_table("retention_runs")
    op.drop_table("retention_policies")
