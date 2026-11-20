"""成效統計補強（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md）

- 每月彙總 engagement_monthly、404 每日次數 not_found_daily、爬蟲每日次數 crawler_hits_daily、
  統計健康檢查的 LINE 推播紀錄 stats_health_runs：四張新表。
- 預約案件的網站來源約束加 ai（AI 助理）：只放寬允許的值，不改既有資料。

不改寫既有資料，不需要事先備份正式庫。

Revision ID: a6c3e9f2d417
Revises: d8b1a9e5c274
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a6c3e9f2d417"
down_revision = "d8b1a9e5c274"
branch_labels = None
depends_on = None

_OLD_SOURCES = "('direct', 'search', 'facebook', 'instagram', 'line', 'youtube', 'ads', 'other')"
_NEW_SOURCES = "('direct', 'search', 'ai', 'facebook', 'instagram', 'line', 'youtube', 'ads', 'other')"


def _source_checks(values: str) -> None:
    for column in ("first_touch_source", "last_touch_source"):
        name = f"ck_visit_requests_{column}"
        op.drop_constraint(name, "visit_requests", type_="check")
        op.create_check_constraint(name, "visit_requests", f"{column} IS NULL OR {column} IN {values}")


def upgrade() -> None:
    op.create_table(
        "engagement_monthly",
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("key", sa.String(32), nullable=False),
        sa.Column("sessions", sa.Integer(), nullable=False),
        sa.Column("visits", sa.Integer(), nullable=False),
        sa.Column("booked_sessions", sa.Integer(), nullable=False),
        sa.Column("median_ms", sa.Integer(), nullable=True),
        sa.Column("first_day", sa.Date(), nullable=True),
        sa.Column("last_day", sa.Date(), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("month", "kind", "key"),
    )
    op.create_table(
        "not_found_daily",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("path", sa.String(160), nullable=False),
        sa.Column("ref", sa.String(16), nullable=False),
        sa.Column("hits", sa.Integer(), nullable=False),
        sa.UniqueConstraint("day", "path", "ref", name="uq_not_found_daily_bucket"),
        sa.CheckConstraint(
            "ref IN ('none', 'internal', 'search', 'external', 'crawler')", name="ck_not_found_daily_ref"
        ),
    )
    op.create_index("ix_not_found_daily_day", "not_found_daily", ["day"])
    op.create_table(
        "crawler_hits_daily",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("bot", sa.String(32), nullable=False),
        sa.Column("page", sa.String(16), nullable=False),
        sa.Column("status_class", sa.String(3), nullable=False),
        sa.Column("hits", sa.Integer(), nullable=False),
        sa.UniqueConstraint("day", "bot", "page", "status_class", name="uq_crawler_hits_daily_bucket"),
    )
    op.create_index("ix_crawler_hits_daily_day", "crawler_hits_daily", ["day"])
    op.create_table(
        "stats_health_runs",
        sa.Column("target_id", sa.String(64), sa.ForeignKey("line_groups.target_id", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("target_id", "day"),
    )
    _source_checks(_NEW_SOURCES)


def downgrade() -> None:
    # 降版前已經記成 ai 的案件改回 other（舊版只認得這幾種）。
    op.execute("UPDATE visit_requests SET first_touch_source = 'other' WHERE first_touch_source = 'ai'")
    op.execute("UPDATE visit_requests SET last_touch_source = 'other' WHERE last_touch_source = 'ai'")
    _source_checks(_OLD_SOURCES)
    op.drop_table("stats_health_runs")
    op.drop_index("ix_crawler_hits_daily_day", table_name="crawler_hits_daily")
    op.drop_table("crawler_hits_daily")
    op.drop_index("ix_not_found_daily_day", table_name="not_found_daily")
    op.drop_table("not_found_daily")
    op.drop_table("engagement_monthly")
