"""Instagram 貼文進同一個粉專收件匣：貼文來源與 Instagram 同步狀態（docs/specs/2026-11-12-external-integrations-design.md §2）

只加欄位（與 source 的 CHECK），不改、不刪既有資料：facebook_page_posts.source 預設 'facebook'，
既有的列與舊版程式的寫入都落在預設值；facebook_page_sync 的四個 ig_ 欄位可為 NULL。
舊版程式不讀不寫這些欄位，可直接回退。

Revision ID: f3b8d2a6c19e
Revises: e7a1c93b5d20
Create Date: 2026-11-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f3b8d2a6c19e"
down_revision = "e7a1c93b5d20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "facebook_page_posts",
        sa.Column("source", sa.String(length=16), server_default="facebook", nullable=False),
    )
    op.create_check_constraint(
        "ck_facebook_page_posts_source", "facebook_page_posts", "source IN ('facebook', 'instagram')"
    )
    op.add_column("facebook_page_sync", sa.Column("ig_last_attempt_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("facebook_page_sync", sa.Column("ig_last_success_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("facebook_page_sync", sa.Column("ig_last_error", sa.String(length=200), nullable=True))
    op.add_column("facebook_page_sync", sa.Column("ig_last_count", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("facebook_page_sync", "ig_last_count")
    op.drop_column("facebook_page_sync", "ig_last_error")
    op.drop_column("facebook_page_sync", "ig_last_success_at")
    op.drop_column("facebook_page_sync", "ig_last_attempt_at")
    op.drop_constraint("ck_facebook_page_posts_source", "facebook_page_posts", type_="check")
    op.drop_column("facebook_page_posts", "source")
