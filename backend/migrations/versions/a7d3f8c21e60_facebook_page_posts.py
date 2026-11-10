"""各校 Facebook 粉專貼文收件匣與同步狀態（docs/specs/2026-10-28-facebook-news-sync-design.md）

只建兩張新表，舊版程式不讀不寫，可直接回退。

Revision ID: a7d3f8c21e60
Revises: b5e8f1c3a7d2
Create Date: 2026-10-28
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7d3f8c21e60"
down_revision = "b5e8f1c3a7d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "facebook_page_posts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campus_key", sa.String(32), nullable=False),
        sa.Column("post_id", sa.String(64), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("permalink_url", sa.String(500), nullable=True),
        sa.Column("picture_url", sa.Text(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), server_default="new", nullable=False),
        sa.Column("article_id", sa.String(64), nullable=True),
        sa.Column("media_id", sa.Uuid(), nullable=True),
        sa.Column("handled_by", sa.Uuid(), nullable=True),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('new', 'imported', 'dismissed')", name="ck_facebook_page_posts_status"),
        sa.ForeignKeyConstraint(["campus_key"], ["campuses.key"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["media_id"], ["media_assets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["handled_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("post_id"),
    )
    op.create_index("ix_facebook_page_posts_campus_posted", "facebook_page_posts", ["campus_key", "posted_at"])
    op.create_table(
        "facebook_page_sync",
        sa.Column("campus_key", sa.String(32), nullable=False),
        sa.Column("page_id", sa.String(32), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(200), nullable=True),
        sa.Column("last_count", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["campus_key"], ["campuses.key"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("campus_key"),
    )


def downgrade() -> None:
    op.drop_table("facebook_page_sync")
    op.drop_index("ix_facebook_page_posts_campus_posted", table_name="facebook_page_posts")
    op.drop_table("facebook_page_posts")
