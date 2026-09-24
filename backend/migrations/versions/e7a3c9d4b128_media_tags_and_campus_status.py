"""素材標籤、圖說與授權註記；分校停用時間與原因。

Revision ID: e7a3c9d4b128
Revises: d1f5b2c8e437
Create Date: 2026-09-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e7a3c9d4b128"
down_revision = "d1f5b2c8e437"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media_assets", sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("media_assets", sa.Column("caption", sa.String(500), nullable=True))
    op.add_column("media_assets", sa.Column("license_note", sa.String(255), nullable=True))
    op.add_column("campuses", sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campuses", sa.Column("deactivated_reason", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("campuses", "deactivated_reason")
    op.drop_column("campuses", "deactivated_at")
    op.drop_column("media_assets", "license_note")
    op.drop_column("media_assets", "caption")
    op.drop_column("media_assets", "tags")
