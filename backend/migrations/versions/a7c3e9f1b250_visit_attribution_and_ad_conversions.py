"""網站來源欄位與回傳廣告平台的待送工作（2026-11-16 規格 docs/specs/2026-11-16-cookie-features-design.md §1、§2）

visit_requests 加七個可為 NULL 的欄位（第一次／最後一次進站的來源、活動代碼、日期，與點擊識別碼），
新增 ad_conversion_jobs 表。只新增，不改既有資料，不需要部署前備份；上一版程式不讀新欄位與新表。

Revision ID: a7c3e9f1b250
Revises: d4b7e1a95c26
Create Date: 2026-11-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7c3e9f1b250"
down_revision = "d4b7e1a95c26"
branch_labels = None
depends_on = None

SOURCES = "('direct', 'search', 'facebook', 'instagram', 'line', 'youtube', 'ads', 'other')"


def upgrade() -> None:
    for prefix in ("first_touch", "last_touch"):
        op.add_column("visit_requests", sa.Column(f"{prefix}_source", sa.String(16), nullable=True))
        op.add_column("visit_requests", sa.Column(f"{prefix}_campaign", sa.String(32), nullable=True))
        op.add_column("visit_requests", sa.Column(f"{prefix}_on", sa.Date(), nullable=True))
        op.create_check_constraint(
            f"ck_visit_requests_{prefix}_source",
            "visit_requests",
            f"{prefix}_source IS NULL OR {prefix}_source IN {SOURCES}",
        )
    op.add_column("visit_requests", sa.Column("ad_click_ids", sa.JSON(), nullable=True))

    op.create_table(
        "ad_conversion_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "visit_request_id",
            sa.Uuid(),
            sa.ForeignKey("visit_requests.id", ondelete="CASCADE", name="fk_ad_conversion_jobs_visit_request_id"),
            nullable=False,
        ),
        sa.Column("event", sa.String(32), nullable=False),
        sa.Column("platform", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(300), nullable=True),
        sa.UniqueConstraint("visit_request_id", "event", "platform", name="uq_ad_conversion_jobs_request_event_platform"),
        sa.CheckConstraint("platform IN ('ga4', 'meta', 'openai')", name="ck_ad_conversion_jobs_platform"),
        sa.CheckConstraint("event IN ('visit_attended', 'deposit_paid')", name="ck_ad_conversion_jobs_event"),
        sa.CheckConstraint("status IN ('pending', 'sent', 'failed', 'skipped')", name="ck_ad_conversion_jobs_status"),
    )
    op.create_index("ix_ad_conversion_jobs_due", "ad_conversion_jobs", ["status", "next_attempt_at"])
    op.create_index("ix_ad_conversion_jobs_visit_request_id", "ad_conversion_jobs", ["visit_request_id"])


def downgrade() -> None:
    op.drop_index("ix_ad_conversion_jobs_visit_request_id", table_name="ad_conversion_jobs")
    op.drop_index("ix_ad_conversion_jobs_due", table_name="ad_conversion_jobs")
    op.drop_table("ad_conversion_jobs")
    op.drop_column("visit_requests", "ad_click_ids")
    for prefix in ("last_touch", "first_touch"):
        op.drop_constraint(f"ck_visit_requests_{prefix}_source", "visit_requests", type_="check")
        op.drop_column("visit_requests", f"{prefix}_on")
        op.drop_column("visit_requests", f"{prefix}_campaign")
        op.drop_column("visit_requests", f"{prefix}_source")
