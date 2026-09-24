"""參觀案件記錄來源與建立人（後台人工補登），並為承辦人加索引。

Revision ID: d3a8f1c5b742
Revises: c6e4a2b9d810
Create Date: 2026-09-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d3a8f1c5b742"
down_revision = "c6e4a2b9d810"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 既有案件全部來自官網表單，以 web 回填，不推測其他來源。
    op.add_column(
        "visit_requests",
        sa.Column("source", sa.String(16), nullable=False, server_default="web"),
    )
    op.add_column(
        "visit_requests",
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_visit_requests_created_by_users"),
            nullable=True,
        ),
    )
    # 「只看我的案件」依承辦人篩選。
    op.create_index(
        "ix_visit_requests_assigned_staff_id", "visit_requests", ["assigned_staff_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_visit_requests_assigned_staff_id", table_name="visit_requests")
    op.drop_column("visit_requests", "created_by")
    op.drop_column("visit_requests", "source")
