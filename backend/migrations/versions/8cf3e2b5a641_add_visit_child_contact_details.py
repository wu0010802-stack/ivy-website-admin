"""預約案件新增寶貝資料、聯絡 Email 與得知來源。

Revision ID: 8cf3e2b5a641
Revises: a1c4f7e92b30
Create Date: 2026-09-22
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "8cf3e2b5a641"
down_revision = "a1c4f7e92b30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("visit_requests", sa.Column("child_name", sa.String(64), nullable=True))
    op.add_column("visit_requests", sa.Column("child_birthdate", sa.Date(), nullable=True))
    op.add_column("visit_requests", sa.Column("email", sa.String(254), nullable=True))
    # 既有案件沒有得知來源；以空陣列表達尚未提供，不推測來源。
    op.add_column(
        "visit_requests",
        sa.Column("referral_sources", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("visit_requests", "referral_sources")
    op.drop_column("visit_requests", "email")
    op.drop_column("visit_requests", "child_birthdate")
    op.drop_column("visit_requests", "child_name")
