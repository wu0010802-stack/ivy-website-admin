"""outbox：人工重新寄送的時間與提醒通知的去重鍵

Revision ID: f3a9c5d71e28
Revises: 31eb94190b1c
Create Date: 2026-09-25

1. `requeued_at`：後台或 CLI 把寄送失敗（達重試上限）的通知重新排入的時間。
   「超過 24 小時的通知只寫站內、不再推播寄信」改用 max(created_at,
   requeued_at) 判斷——人工決定重寄就是要寄出去，不能被這條擋掉。
2. `dedupe_key`：定期工作產生的提醒（即將參觀、逾期未處理）用它去重，同一
   案件同一種提醒只寫一次；即將參觀的鍵含時段 id，改期後依新時段重新判斷。
   一般案件通知沒有這個鍵（NULL，唯一索引不限制多筆 NULL）。

兩欄都是 nullable、不回填，可直接套在有資料的正式庫。狀態另外多了
`skipped`（提醒到寄送當下已不適用），status 欄本來就是字串、沒有 CHECK，
不需要改表。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f3a9c5d71e28"
down_revision = "31eb94190b1c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("outbox_messages", sa.Column("requeued_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("outbox_messages", sa.Column("dedupe_key", sa.String(length=160), nullable=True))
    op.create_index("uq_outbox_messages_dedupe_key", "outbox_messages", ["dedupe_key"], unique=True)
    # 後台「寄送失敗」清單與總覽都只查 failed，給狀態一個索引。
    op.create_index("ix_outbox_messages_status", "outbox_messages", ["status"])


def downgrade() -> None:
    # 退回舊版前把 skipped 改成 sent：舊程式不認得這個狀態，而這些提醒本來就
    # 不該再送。
    op.execute("UPDATE outbox_messages SET status = 'sent' WHERE status = 'skipped'")
    op.drop_index("ix_outbox_messages_status", table_name="outbox_messages")
    op.drop_index("uq_outbox_messages_dedupe_key", table_name="outbox_messages")
    op.drop_column("outbox_messages", "dedupe_key")
    op.drop_column("outbox_messages", "requeued_at")
