"""成效事件：點擊去重、入口代碼、取消事件與來源快照

Revision ID: e7a3c9d1f482
Revises: c4d8e2f6a913
Create Date: 2026-09-25

1. `analytics_event_type` 加兩個值：`BOOKING_CTA_CLICKED`（點了往官網預約
   表單的按鈕）與 `VISIT_CANCELLED`（伺服器在取消案件時產生）。只新增 enum
   值，既有資料不動。
2. `analytics_events` 加五個 nullable 欄位：`event_id`（公開點擊由瀏覽器產生，
   唯一約束去重）、`entry`（入口代碼）、`source`／`referral_sources`（案件來源
   快照）、`reason`（取消原因）。既有事件無從回推，維持 NULL，後台顯示成
   「未記錄」。唯一約束在 NULL 上不衝突，套在有資料的正式庫也安全。
3. 依校區＋時間的複合索引，給依日期區間查漏斗用。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e7a3c9d1f482"
down_revision = "c4d8e2f6a913"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL 12 起 ADD VALUE 可以在交易裡執行，只是同一個交易內不能使用
    # 這個新值；這個 migration 沒有用到它。
    op.execute("ALTER TYPE analytics_event_type ADD VALUE IF NOT EXISTS 'BOOKING_CTA_CLICKED'")
    op.execute("ALTER TYPE analytics_event_type ADD VALUE IF NOT EXISTS 'VISIT_CANCELLED'")
    op.add_column("analytics_events", sa.Column("event_id", sa.Uuid(), nullable=True))
    op.add_column("analytics_events", sa.Column("entry", sa.String(length=32), nullable=True))
    op.add_column("analytics_events", sa.Column("source", sa.String(length=16), nullable=True))
    op.add_column("analytics_events", sa.Column("referral_sources", sa.JSON(), nullable=True))
    op.add_column("analytics_events", sa.Column("reason", sa.String(length=32), nullable=True))
    op.create_unique_constraint("uq_analytics_events_event_id", "analytics_events", ["event_id"])
    op.create_index("ix_analytics_events_campus_created", "analytics_events", ["campus_key", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_analytics_events_campus_created", table_name="analytics_events")
    op.drop_constraint("uq_analytics_events_event_id", "analytics_events", type_="unique")
    op.drop_column("analytics_events", "reason")
    op.drop_column("analytics_events", "referral_sources")
    op.drop_column("analytics_events", "source")
    op.drop_column("analytics_events", "entry")
    op.drop_column("analytics_events", "event_id")
    # 舊版程式不認得這兩種事件；PostgreSQL 不能直接刪 enum 值，改重建型別。
    op.execute("DELETE FROM analytics_events WHERE event_type IN ('BOOKING_CTA_CLICKED', 'VISIT_CANCELLED')")
    op.execute("ALTER TYPE analytics_event_type RENAME TO analytics_event_type_old")
    op.execute(
        "CREATE TYPE analytics_event_type AS ENUM ('CTA_CLICK_LINE', 'CTA_CLICK_PHONE', "
        "'CTA_CLICK_EXTERNAL', 'REQUEST_CREATED', 'VISIT_CONFIRMED', 'VISIT_COMPLETED')"
    )
    op.execute(
        "ALTER TABLE analytics_events ALTER COLUMN event_type TYPE analytics_event_type "
        "USING event_type::text::analytics_event_type"
    )
    op.execute("DROP TYPE analytics_event_type_old")
