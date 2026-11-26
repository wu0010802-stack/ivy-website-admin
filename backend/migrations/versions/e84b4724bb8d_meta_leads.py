"""Meta 名單型廣告（即時表單）的名單收件匣與每校拉取狀態（docs/specs/2026-11-26-meta-lead-inbox-design.md）

只新增兩張表，不改、不刪既有資料；舊版程式不讀不寫這兩張表，可直接回退。

Revision ID: e84b4724bb8d
Revises: c4e7b2a91f63
Create Date: 2026-11-26
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e84b4724bb8d"
down_revision = "c4e7b2a91f63"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "meta_leads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("campus_key", sa.String(length=32), nullable=False),
        sa.Column("lead_id", sa.String(length=32), nullable=False),
        sa.Column("form_id", sa.String(length=32), nullable=False),
        sa.Column("form_name", sa.String(length=200), nullable=True),
        sa.Column("ad_id", sa.String(length=32), nullable=True),
        sa.Column("campaign_id", sa.String(length=32), nullable=True),
        sa.Column("platform", sa.String(length=16), nullable=True),
        sa.Column("is_organic", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("parent_name", sa.String(length=64), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("answers", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="new", nullable=False),
        sa.Column("visit_request_id", sa.Uuid(), nullable=True),
        sa.Column("handled_by", sa.Uuid(), nullable=True),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('new', 'converted', 'dismissed')", name="ck_meta_leads_status"),
        sa.ForeignKeyConstraint(["campus_key"], ["campuses.key"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["visit_request_id"], ["visit_requests.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["handled_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lead_id"),
    )
    op.create_index(
        "ix_meta_leads_campus_status_created", "meta_leads", ["campus_key", "status", "created_at"], unique=False
    )
    op.create_table(
        "meta_lead_sync",
        sa.Column("campus_key", sa.String(length=32), nullable=False),
        sa.Column("page_id", sa.String(length=32), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=200), nullable=True),
        sa.Column("last_count", sa.Integer(), nullable=True),
        sa.Column("cursor_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["campus_key"], ["campuses.key"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("campus_key"),
    )


def downgrade() -> None:
    op.drop_table("meta_lead_sync")
    op.drop_index("ix_meta_leads_campus_status_created", table_name="meta_leads")
    op.drop_table("meta_leads")
