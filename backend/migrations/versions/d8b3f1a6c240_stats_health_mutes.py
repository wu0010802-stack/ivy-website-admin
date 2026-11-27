"""統計異常提醒的「知道了」（2026-11-27，docs/specs/2026-11-27-line-card-buttons-design.md §4）

- 新表 stats_health_mutes：某種統計異常暫停推 LINE 到哪一天（含）。

只新增一張空表，不需要事先備份正式庫。

Revision ID: d8b3f1a6c240
Revises: c7a2d9e4b615
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d8b3f1a6c240"
down_revision = "c7a2d9e4b615"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stats_health_mutes",
        sa.Column("issue_key", sa.String(32), primary_key=True),
        sa.Column("muted_until", sa.Date(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("stats_health_mutes")
