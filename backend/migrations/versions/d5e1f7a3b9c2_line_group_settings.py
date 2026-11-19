"""LINE 群組設定與每日摘要紀錄

2026-11-17，docs/specs/2026-11-17-line-group-interactions-design.md §4.4。只新增兩張表，
不改既有資料，不需要事先備份正式庫。

Revision ID: d5e1f7a3b9c2
Revises: c4d2e8a1f6b3
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d5e1f7a3b9c2"
down_revision = "c4d2e8a1f6b3"
branch_labels = None
depends_on = None

DEFAULT_KINDS = (
    '["visit_request_created", "visit_request_confirmed", "visit_request_rescheduled",'
    ' "visit_request_cancelled"]'
)


def upgrade() -> None:
    op.create_table(
        "line_group_settings",
        sa.Column("target_id", sa.String(64), nullable=False),
        sa.Column(
            "kinds",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text(f"'{DEFAULT_KINDS}'::jsonb"),
        ),
        sa.Column("digest_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("mention_all_same_day", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_hq", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["target_id"], ["line_groups.target_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("target_id"),
    )
    op.create_table(
        "line_digest_runs",
        sa.Column("target_id", sa.String(64), nullable=False),
        sa.Column("digest_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["target_id"], ["line_groups.target_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("target_id", "digest_date"),
    )


def downgrade() -> None:
    op.drop_table("line_digest_runs")
    op.drop_table("line_group_settings")
