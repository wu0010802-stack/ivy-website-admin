"""錯誤回報：error_groups 資料表（2026-11-05）

官網前端、後台與 API 的未處理錯誤依 fingerprint 分組存進這張表，總管理者在「系統狀態」頁
看得到、可標為已處理（operations/error_reports.py）。只新增一張空表與兩個索引，不改既有
資料、不動既有欄位，上一版程式照常可用（deploy/CICD.md：建表在 90 秒內遠遠跑得完）。
降級刪表即可。

Revision ID: 9d4e7a2c1f60
Revises: c3f1a9d27b54
Create Date: 2026-11-05
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "9d4e7a2c1f60"
down_revision = "c3f1a9d27b54"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "error_groups",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=8), nullable=False),
        sa.Column("kind", sa.String(length=120), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("location", sa.String(length=300), nullable=True),
        sa.Column("path", sa.String(length=300), nullable=False),
        sa.Column("release", sa.String(length=64), nullable=True),
        sa.Column("sample_stack", sa.Text(), nullable=True),
        sa.Column("sample_user_agent", sa.String(length=300), nullable=True),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("fingerprint", name="uq_error_groups_fingerprint"),
    )
    op.create_index("ix_error_groups_last_seen_at", "error_groups", ["last_seen_at"])


def downgrade() -> None:
    op.drop_index("ix_error_groups_last_seen_at", table_name="error_groups")
    op.drop_table("error_groups")
