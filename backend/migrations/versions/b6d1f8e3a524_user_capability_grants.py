"""使用者的明確授權（目前只有 content.shared：編輯全站共用內容）。

Revision ID: b6d1f8e3a524
Revises: a9c4e2f7d316
Create Date: 2026-09-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b6d1f8e3a524"
down_revision = "a9c4e2f7d316"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("capabilities", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    op.drop_column("users", "capabilities")
