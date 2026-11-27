"""後台 Passkey 登入（指紋／Face ID，2026-11-27）

- 新表 passkeys：管理員登記的 WebAuthn 憑證（只有公鑰與憑證代號）。
- users.passkey_count：這個帳號登記了幾組，預設 0。

只新增一張空表與一個有預設值的欄位，不改寫既有資料，不需要事先備份正式庫。

Revision ID: e2c5a8f1d937
Revises: d8b3f1a6c240
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e2c5a8f1d937"
down_revision = "d8b3f1a6c240"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("passkey_count", sa.Integer(), nullable=False, server_default="0"))
    op.create_table(
        "passkeys",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("credential_id", sa.LargeBinary(), nullable=False),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.BigInteger(), nullable=False),
        sa.Column("transports", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("name", sa.String(30), nullable=False),
        sa.Column("backed_up", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("credential_id", name="uq_passkeys_credential_id"),
    )
    op.create_index("ix_passkeys_user_id", "passkeys", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_passkeys_user_id", table_name="passkeys")
    op.drop_table("passkeys")
    op.drop_column("users", "passkey_count")
