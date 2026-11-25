"""Google 商家檔案與 Keyword Planner（2026-11-25，docs/specs/2026-11-25-business-profile-keyword-planner-design.md）

- 商家檔案：每日指標 gbp_daily_metrics、每月搜尋字詞 gbp_monthly_keywords、抓過的月份 gbp_keyword_months。
- Keyword Planner：關鍵字清單 search_keywords、每月搜尋量 search_keyword_volumes。
- 兩者共用的同步狀態 google_sync_status。

只新增資料表，不改既有資料，不需要事先備份正式庫。

Revision ID: c4e7b2a91f63
Revises: a6c3e9f2d417
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c4e7b2a91f63"
down_revision = "a6c3e9f2d417"
branch_labels = None
depends_on = None

_METRICS = (
    "'desktop_search', 'mobile_search', 'desktop_maps', 'mobile_maps', 'calls', 'directions', 'website', 'messages'"
)


def upgrade() -> None:
    op.create_table(
        "gbp_daily_metrics",
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("metric", sa.String(16), nullable=False),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("campus_key", "day", "metric"),
        sa.CheckConstraint(f"metric IN ({_METRICS})", name="ck_gbp_daily_metrics_metric"),
    )
    op.create_table(
        "gbp_keyword_months",
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="CASCADE"), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("campus_key", "month"),
        sa.CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_gbp_keyword_months_first_day"),
    )
    op.create_table(
        "gbp_monthly_keywords",
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="CASCADE"), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("keyword", sa.String(200), nullable=False),
        sa.Column("impressions", sa.Integer(), nullable=True),
        sa.Column("below", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("campus_key", "month", "keyword"),
        sa.CheckConstraint("(impressions IS NULL) <> (below IS NULL)", name="ck_gbp_monthly_keywords_value"),
        sa.CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_gbp_monthly_keywords_first_day"),
    )
    op.create_table(
        "search_keywords",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("text", sa.String(80), nullable=False, unique=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "search_keyword_volumes",
        sa.Column("keyword_id", sa.Uuid(), sa.ForeignKey("search_keywords.id", ondelete="CASCADE"), nullable=False),
        sa.Column("geo", sa.String(16), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("searches", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("keyword_id", "geo", "month"),
        sa.CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_search_keyword_volumes_first_day"),
        sa.CheckConstraint("searches IS NULL OR searches >= 0", name="ck_search_keyword_volumes_searches"),
    )
    op.create_table(
        "google_sync_status",
        sa.Column("key", sa.String(32), primary_key=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(200), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("google_sync_status")
    op.drop_table("search_keyword_volumes")
    op.drop_table("search_keywords")
    op.drop_table("gbp_monthly_keywords")
    op.drop_table("gbp_keyword_months")
    op.drop_table("gbp_daily_metrics")
