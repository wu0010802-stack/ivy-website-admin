"""LINE 通知型訊息：各校開關、送出紀錄

Revision ID: f2b7c4e9a1d3
Revises: f2b7c4e9a813
Create Date: 2026-11-25

docs/specs/2026-11-25-line-notification-messages-research.md。line_parent_campus_accounts 加 pnp_enabled
（預設 false），新增 line_pnp_messages。不改既有資料，與上一版程式相容（上一版不讀這兩個欄位與表）。
預設全部關閉，部署後行為不變，不需要先備份。
downgrade 刪掉 line_pnp_messages（送出與送達紀錄會消失）與 pnp_enabled（各校的開關要重新打開）。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f2b7c4e9a1d3"
down_revision = "f2b7c4e9a813"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "line_parent_campus_accounts",
        sa.Column("pnp_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table(
        "line_pnp_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "outbox_message_id",
            sa.Uuid(),
            sa.ForeignKey("outbox_messages.id", ondelete="CASCADE", name="fk_line_pnp_messages_outbox_message_id"),
            nullable=False,
        ),
        sa.Column(
            "visit_request_id",
            sa.Uuid(),
            sa.ForeignKey("visit_requests.id", ondelete="CASCADE", name="fk_line_pnp_messages_visit_request_id"),
            nullable=False,
        ),
        sa.Column("account_key", sa.String(20), nullable=False),
        sa.Column("template_key", sa.String(64), nullable=False),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("outbox_message_id", name="uq_line_pnp_messages_outbox_message_id"),
    )
    op.create_index("ix_line_pnp_messages_visit_request_id", "line_pnp_messages", ["visit_request_id"])


def downgrade() -> None:
    op.drop_index("ix_line_pnp_messages_visit_request_id", table_name="line_pnp_messages")
    op.drop_table("line_pnp_messages")
    op.drop_column("line_parent_campus_accounts", "pnp_enabled")
