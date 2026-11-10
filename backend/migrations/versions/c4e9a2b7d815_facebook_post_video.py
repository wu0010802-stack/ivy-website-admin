"""粉專影片貼文：收件匣多記影片檔網址與轉成消息時放進素材庫的影片（docs/specs/2026-10-28-facebook-news-sync-design.md §8）

只加兩個可空欄位，不改既有資料；舊版程式不讀不寫，可直接回退。

Revision ID: c4e9a2b7d815
Revises: a7d3f8c21e60
Create Date: 2026-11-10
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c4e9a2b7d815"
down_revision = "a7d3f8c21e60"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("facebook_page_posts", sa.Column("video_url", sa.Text(), nullable=True))
    op.add_column("facebook_page_posts", sa.Column("video_media_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "facebook_page_posts_video_media_id_fkey",
        "facebook_page_posts",
        "media_assets",
        ["video_media_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("facebook_page_posts_video_media_id_fkey", "facebook_page_posts", type_="foreignkey")
    op.drop_column("facebook_page_posts", "video_media_id")
    op.drop_column("facebook_page_posts", "video_url")
