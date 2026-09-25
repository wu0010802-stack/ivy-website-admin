"""各校家長線上異動期限、每週規則自動延展、時段關閉來源

Revision ID: 2d6fce2f73c9
Revises: c8f2d4a6b913
Create Date: 2026-09-25

規格 L238：家長線上取消／改期依後台設定的期限，預設參觀前 24 小時。原本
寫死 24 小時，各校不能調。既有各校以 server_default 帶入 24，行為不變。

規格 L221-223：時段依每週規則開放到「最遠開放天數」。原本只能手動按
「依規則產生時段」，開放一段時間後家長就選不到時段。改由定期工作每天
補產生；rules_extended_on 記上次補到哪一天（台灣日期），一天只補一次，
改規則時清空讓下一輪立刻補。

休假日關閉的時段要能在取消休假時重新開放，但園方手動關的不能被打開，
所以時段要記關閉來源。舊資料一律維持 NULL（視同手動）：無法分辨以前是
休假日關的還是手動關的，猜錯會把園方刻意關掉的場次重新賣出去。

全部是新增欄位（NOT NULL 的有 server_default），正式庫有資料時可以直接
套用；舊版程式讀寫不受多出來的欄位影響。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "2d6fce2f73c9"
down_revision = "c8f2d4a6b913"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "booking_configs",
        sa.Column("parent_change_deadline_hours", sa.Integer(), nullable=False, server_default="24"),
    )
    op.create_check_constraint(
        "ck_booking_configs_parent_change_deadline_hours",
        "booking_configs",
        "parent_change_deadline_hours BETWEEN 1 AND 336",
    )
    op.add_column("booking_configs", sa.Column("rules_extended_on", sa.Date(), nullable=True))

    op.add_column("visit_slots", sa.Column("closed_source", sa.String(16), nullable=True))
    op.create_check_constraint(
        "ck_visit_slots_closed_source",
        "visit_slots",
        "closed_source IS NULL OR closed_source IN ('manual', 'exception')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_visit_slots_closed_source", "visit_slots", type_="check")
    op.drop_column("visit_slots", "closed_source")
    op.drop_column("booking_configs", "rules_extended_on")
    op.drop_constraint("ck_booking_configs_parent_change_deadline_hours", "booking_configs", type_="check")
    op.drop_column("booking_configs", "parent_change_deadline_hours")
