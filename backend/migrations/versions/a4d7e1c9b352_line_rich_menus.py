"""LINE 圖文選單（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §4）

- 新表 line_rich_menus：程式替哪個官方帳號建了圖文選單、選單代號與模式。
- 新表 line_rich_menu_users：替哪些家長換上了「已預約」版，之後才知道要替誰換回去。

只新增兩張空表，不改寫既有資料，不需要事先備份正式庫。

Revision ID: a4d7e1c9b352
Revises: e2c5a8f1d937
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a4d7e1c9b352"
down_revision = "e2c5a8f1d937"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "line_rich_menus",
        sa.Column("account_key", sa.String(20), primary_key=True),
        sa.Column("mode", sa.String(10), nullable=False),
        sa.Column("default_menu_id", sa.String(64), nullable=True),
        sa.Column("booked_menu_id", sa.String(64), nullable=False),
        sa.Column("spec_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_line_rich_menus_created_by"),
            nullable=True,
        ),
    )
    op.create_table(
        "line_rich_menu_users",
        sa.Column("account_key", sa.String(20), primary_key=True),
        sa.Column("line_user_id", sa.String(64), primary_key=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("line_rich_menu_users")
    op.drop_table("line_rich_menus")
