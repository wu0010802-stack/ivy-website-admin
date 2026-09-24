"""限流計數改存 PostgreSQL（原本在各 process 記憶體，多 worker 時上限倍增、重新部署歸零）。

只新增一張表，與上一版程式相容：舊版不讀這張表，新版上線前它是空的。

Revision ID: 7f0680b2eb47
Revises: d41e6c2a9f58
Create Date: 2026-09-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "7f0680b2eb47"
down_revision = "d41e6c2a9f58"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_counters",
        sa.Column("bucket", sa.String(64), primary_key=True),
        sa.Column("key_hash", sa.String(64), primary_key=True),
        sa.Column("window_start", sa.BigInteger(), primary_key=True),
        sa.Column("hits", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rate_limit_counters_expires_at", "rate_limit_counters", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_rate_limit_counters_expires_at", table_name="rate_limit_counters")
    op.drop_table("rate_limit_counters")
