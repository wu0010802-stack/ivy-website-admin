"""內容送審（待審核／已核准／退回原因）與排程發布。

Revision ID: f2b8d6a1c953
Revises: e7a3c9d4b128
Create Date: 2026-09-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f2b8d6a1c953"
down_revision = "e7a3c9d4b128"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 既有 revision 都是草稿（發布與否看 current_published_revision_id）。
    op.add_column(
        "content_revisions",
        sa.Column("review_status", sa.String(16), nullable=False, server_default="draft"),
    )
    op.add_column("content_revisions", sa.Column("review_note", sa.String(500), nullable=True))
    op.add_column(
        "content_revisions",
        sa.Column("submitted_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("content_revisions", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "content_revisions",
        sa.Column("reviewed_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.add_column("content_revisions", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_content_revisions_review_status", "content_revisions", ["review_status"])

    op.create_table(
        "publish_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("content_item_id", sa.Uuid(), sa.ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("revision_id", sa.Uuid(), sa.ForeignKey("content_revisions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("publish_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="scheduled"),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("publish_jobs")
    op.drop_index("ix_content_revisions_review_status", table_name="content_revisions")
    for column in ("reviewed_at", "reviewed_by", "submitted_at", "submitted_by", "review_note", "review_status"):
        op.drop_column("content_revisions", column)
