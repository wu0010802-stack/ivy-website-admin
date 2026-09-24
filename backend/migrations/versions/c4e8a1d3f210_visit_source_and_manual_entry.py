"""參觀案件關聯舊案（結案後重新預約另建新案）。

來源與建立人欄位由 main 的 d3a8f1c5b742 新增，這裡只補關聯欄位。

Revision ID: c4e8a1d3f210
Revises: d3a8f1c5b742
Create Date: 2026-09-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c4e8a1d3f210"
down_revision = "d3a8f1c5b742"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 規格 6.2：結案後重新預約另建新案並關聯舊案。
    op.add_column(
        "visit_requests",
        sa.Column(
            "related_request_id",
            sa.Uuid(),
            sa.ForeignKey("visit_requests.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("visit_requests", "related_request_id")
