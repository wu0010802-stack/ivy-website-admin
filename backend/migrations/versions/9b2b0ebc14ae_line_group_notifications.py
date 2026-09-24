"""LINE 群組推播：bot 所在的群組與各校對應的推播群組。

只新增兩張表，與上一版程式相容。

Revision ID: 9b2b0ebc14ae
Revises: 7f0680b2eb47
Create Date: 2026-09-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "9b2b0ebc14ae"
down_revision = "7f0680b2eb47"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "line_groups",
        sa.Column("target_id", sa.String(64), primary_key=True),
        sa.Column("source_type", sa.String(8), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "line_campus_targets",
        sa.Column(
            "campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column(
            "target_id",
            sa.String(64),
            sa.ForeignKey("line_groups.target_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_line_campus_targets_target_id", "line_campus_targets", ["target_id"])


def downgrade() -> None:
    op.drop_index("ix_line_campus_targets_target_id", table_name="line_campus_targets")
    op.drop_table("line_campus_targets")
    op.drop_table("line_groups")
