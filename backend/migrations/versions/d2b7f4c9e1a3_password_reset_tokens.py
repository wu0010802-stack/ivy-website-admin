"""後台帳號的重設密碼連結（總管理者寄出，30 分鐘內用一次）

Revision ID: d2b7f4c9e1a3
Revises: 4a7e2c9d1b63
Create Date: 2026-10-03

只新增一張表，不改既有資料；上一版程式不讀這張表，先跑 migration 再換程式也相容。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d2b7f4c9e1a3"
down_revision = "4a7e2c9d1b63"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], ondelete="SET NULL", name="fk_password_reset_tokens_created_by_users"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(op.f("ix_password_reset_tokens_user_id"), "password_reset_tokens", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_password_reset_tokens_user_id"), table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
