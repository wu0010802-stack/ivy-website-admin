"""參觀案件來源（官網／電話／LINE／現場／外部）與人工補登建立人。

Revision ID: c4e8a1d3f210
Revises: c6e4a2b9d810
Create Date: 2026-09-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c4e8a1d3f210"
down_revision = "c6e4a2b9d810"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 既有案件都是官網表單送進來的，server_default 直接補成 web。
    op.add_column(
        "visit_requests",
        sa.Column("source", sa.String(16), nullable=False, server_default="web"),
    )
    op.add_column(
        "visit_requests",
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
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
    op.create_index("ix_visit_requests_assigned_staff_id", "visit_requests", ["assigned_staff_id"])


def downgrade() -> None:
    op.drop_index("ix_visit_requests_assigned_staff_id", table_name="visit_requests")
    op.drop_column("visit_requests", "related_request_id")
    op.drop_column("visit_requests", "created_by")
    op.drop_column("visit_requests", "source")
