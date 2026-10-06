"""拿掉舊預約流程的欄位，案件狀態只允許四種（拿掉舊狀態程式的第二版）

Revision ID: e870893fac95
Revises: d65fa082ff87
Create Date: 2026-10-06

第一版（d65fa082ff87 那次部署）的程式已不讀寫這兩個欄位、也不會產生舊狀態，
資料也清過了；這一版才動結構（CICD.md：先停用、再移除）。

1. drop `visit_requests.hold_expires_at`（含索引）：人工待確認的占位期限，占位流程
   已拿掉。
2. drop `booking_configs.slots_auto_confirm`：送出即成立之後固定為 true，沒人讀。
3. CHECK `ck_visit_requests_status`：status 只能是 confirmed、completed、no_show、
   cancelled。
4. CHECK `ck_visit_requests_confirmed_slot`：已確認一定有場次。

使用者確認正式庫預約資料都是測試資料；兩個欄位在第一版之後都沒有有意義的值。
downgrade 加回欄位（值為空／false）並拿掉約束，資料不還原。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e870893fac95"
down_revision = "d65fa082ff87"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index(op.f("ix_visit_requests_hold_expires_at"), table_name="visit_requests")
    op.drop_column("visit_requests", "hold_expires_at")
    op.drop_column("booking_configs", "slots_auto_confirm")
    op.create_check_constraint(
        "ck_visit_requests_status",
        "visit_requests",
        "status IN ('confirmed', 'completed', 'no_show', 'cancelled')",
    )
    op.create_check_constraint(
        "ck_visit_requests_confirmed_slot",
        "visit_requests",
        "status <> 'confirmed' OR slot_id IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint("ck_visit_requests_confirmed_slot", "visit_requests", type_="check")
    op.drop_constraint("ck_visit_requests_status", "visit_requests", type_="check")
    op.add_column(
        "booking_configs",
        sa.Column("slots_auto_confirm", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("visit_requests", sa.Column("hold_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_visit_requests_hold_expires_at"), "visit_requests", ["hold_expires_at"], unique=False)
