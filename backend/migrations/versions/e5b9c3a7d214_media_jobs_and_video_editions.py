"""素材背景處理：media_jobs 表，衍生檔加中圖與桌機／手機影片版本

Revision ID: e5b9c3a7d214
Revises: d2b7f4c9e1a3
Create Date: 2026-10-03

1. `media_jobs`：影片 poster 與轉檔的背景工作（app/media/jobs.py）。同一個素材
   同時最多一筆 pending／running（部分唯一索引）。素材刪除時一起刪。
2. `media_variant_kind` 加 `MEDIUM`、`VIDEO_DESKTOP`、`VIDEO_MOBILE`。只新增
   enum 值與一張新表，不改既有資料，與上一版程式相容。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e5b9c3a7d214"
down_revision = "d2b7f4c9e1a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL 12 起 ADD VALUE 可以在交易裡執行，只是同一個交易內不能使用新值；
    # 這個 migration 沒有用到它們。
    for value in ("MEDIUM", "VIDEO_DESKTOP", "VIDEO_MOBILE"):
        op.execute(f"ALTER TYPE media_variant_kind ADD VALUE IF NOT EXISTS '{value}'")
    op.create_table(
        "media_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("media_id", sa.Uuid(), sa.ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("leased_by", sa.String(length=128), nullable=True),
        sa.Column("leased_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('process', 'backfill')", name="ck_media_jobs_kind"),
        sa.CheckConstraint("status IN ('pending', 'running', 'done', 'failed')", name="ck_media_jobs_status"),
    )
    op.create_index(
        "uq_media_jobs_active", "media_jobs", ["media_id"], unique=True,
        postgresql_where=sa.text("status IN ('pending', 'running')"),
    )
    op.create_index("ix_media_jobs_due", "media_jobs", ["status", "next_attempt_at"])


def downgrade() -> None:
    op.drop_index("ix_media_jobs_due", table_name="media_jobs")
    op.drop_index("uq_media_jobs_active", table_name="media_jobs")
    op.drop_table("media_jobs")
    # 新種類的衍生檔記錄拿掉（檔案留在儲存空間成為孤兒檔，舊版程式不認得它們）；
    # PostgreSQL 不能直接刪 enum 值，改重建型別（同 c4d8e2f6a913）。
    op.execute("DELETE FROM media_variants WHERE kind IN ('MEDIUM', 'VIDEO_DESKTOP', 'VIDEO_MOBILE')")
    op.execute("ALTER TYPE media_variant_kind RENAME TO media_variant_kind_old")
    op.execute("CREATE TYPE media_variant_kind AS ENUM ('THUMBNAIL', 'POSTER', 'LARGE')")
    op.execute(
        "ALTER TABLE media_variants ALTER COLUMN kind TYPE media_variant_kind "
        "USING kind::text::media_variant_kind"
    )
    op.execute("DROP TYPE media_variant_kind_old")
