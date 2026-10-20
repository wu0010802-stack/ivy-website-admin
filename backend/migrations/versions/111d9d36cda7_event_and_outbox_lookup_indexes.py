"""案件歷程與 outbox 的查詢索引（2026-10-20 效能整理）

1. `ix_visit_request_events_request_type_created`（visit_request_id, event_type, created_at）：
   案件列表的參觀日期（booking/admin_visit_routes.py `_visited_on_column`，最後一筆 completed 歷程）與
   即將參觀提醒（notifications/reminders.py `_last_rescheduled_at`，最後一筆 rescheduled 歷程）都是
   「某案件某種歷程的最大 created_at」相關子查詢，原本只有 visit_request_id 單欄索引，要逐列讀歷程再篩種類。
2. `ix_outbox_messages_due`（status, next_attempt_at）：worker 認領（workers/lease_service.py `claim_next`）
   以狀態與 next_attempt_at 篩選並依 next_attempt_at 排序，比照 media_jobs 的 `ix_media_jobs_due`。

只新增索引，不改資料、不動欄位，上一版程式照常可用。舊的單欄索引（ix_visit_request_events_visit_request_id、
ix_outbox_messages_status）是新索引的前導欄、功能上已被涵蓋，但保守起見這一版先留著，不在同一次部署裡刪。
兩張表都很小（官網預約量），一般 CREATE INDEX 的寫入鎖在 90 秒內遠遠跑得完，不需要 CONCURRENTLY
（那也不能放進 alembic 的單一交易，見 deploy/CICD.md）。降級刪掉兩個新索引即可。

Revision ID: 111d9d36cda7
Revises: 76c4bf84b907
Create Date: 2026-10-20
"""
from __future__ import annotations

from alembic import op

revision = "111d9d36cda7"
down_revision = "76c4bf84b907"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_visit_request_events_request_type_created",
        "visit_request_events",
        ["visit_request_id", "event_type", "created_at"],
    )
    op.create_index("ix_outbox_messages_due", "outbox_messages", ["status", "next_attempt_at"])


def downgrade() -> None:
    op.drop_index("ix_outbox_messages_due", table_name="outbox_messages")
    op.drop_index("ix_visit_request_events_request_type_created", table_name="visit_request_events")
