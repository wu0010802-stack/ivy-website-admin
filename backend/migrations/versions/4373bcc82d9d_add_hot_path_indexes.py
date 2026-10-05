"""補熱路徑索引：預約案件（建立時間、同校同手機）、時段（校＋日期）、稽核紀錄（時間排序）

Revision ID: 4373bcc82d9d
Revises: e5b9c3a7d214
Create Date: 2026-10-05

只建索引、不改資料，與上一版程式相容（回滾只要 downgrade 或留著不用）：

1. `visit_requests (created_at)`：後台列表與 CSV 匯出 ORDER BY created_at DESC。
2. `visit_requests (campus_key, phone, created_at)`：送單時在設定列鎖內計算同校
   同手機窗口內的筆數。
3. `visit_slots (campus_key, slot_date)`：公開時段、可預約數、後台時段頁都是
   某校加日期範圍。
4. `audit_log_entries (created_at DESC, id DESC)` 與
   `(campus_key, created_at DESC, id DESC)`：稽核頁 keyset 分頁。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "4373bcc82d9d"
down_revision = "e5b9c3a7d214"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_visit_requests_created_at", "visit_requests", ["created_at"])
    op.create_index(
        "ix_visit_requests_campus_phone_created_at", "visit_requests", ["campus_key", "phone", "created_at"]
    )
    op.create_index("ix_visit_slots_campus_slot_date", "visit_slots", ["campus_key", "slot_date"])
    op.create_index(
        "ix_audit_log_entries_created_at_id", "audit_log_entries", [sa.text("created_at DESC"), sa.text("id DESC")]
    )
    op.create_index(
        "ix_audit_log_entries_campus_created_at_id",
        "audit_log_entries",
        ["campus_key", sa.text("created_at DESC"), sa.text("id DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_log_entries_campus_created_at_id", table_name="audit_log_entries")
    op.drop_index("ix_audit_log_entries_created_at_id", table_name="audit_log_entries")
    op.drop_index("ix_visit_slots_campus_slot_date", table_name="visit_slots")
    op.drop_index("ix_visit_requests_campus_phone_created_at", table_name="visit_requests")
    op.drop_index("ix_visit_requests_created_at", table_name="visit_requests")
