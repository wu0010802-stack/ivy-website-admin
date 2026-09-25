"""排程沒有發布時可以按「知道了」

Revision ID: d6f2a8c41b37
Revises: eab4ead6271d
Create Date: 2026-09-26

B06 審查意見：排程到期檢查不過（failed）會一直列在總覽「排程發布沒有執行」，
只有之後重新發布過這項內容才會消失。分校已停用、園方決定不發布那一版這類
情況沒有辦法清掉待辦，編輯頁的「排程沒有發布／已略過」提示也一樣。加兩個
欄位記誰在什麼時候看過、處理過。

兩個欄位都可為空、沒有預設值，正式庫既有的排程維持「還沒按過」，總覽照舊
依「之後有沒有重新發布」判斷；舊版程式不讀這兩個欄位。
downgrade 直接刪欄位（按過「知道了」的失敗排程會重新出現在總覽）。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d6f2a8c41b37"
down_revision = "eab4ead6271d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("publish_jobs", sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "publish_jobs",
        sa.Column(
            "acknowledged_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_publish_jobs_acknowledged_by_users"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("publish_jobs", "acknowledged_by")
    op.drop_column("publish_jobs", "acknowledged_at")
