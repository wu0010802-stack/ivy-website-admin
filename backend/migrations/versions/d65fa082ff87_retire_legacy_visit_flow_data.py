"""收掉舊預約流程的殘留資料（拿掉舊狀態程式的第一版）

Revision ID: d65fa082ff87
Revises: 3fe1cfb2dbf7
Create Date: 2026-10-06

2026-10-06 使用者要求把剩下處理舊狀態（new／contacting／pending_confirmation）的
程式一起清掉：官網送單與後台補登都在同一個交易排進場次，案件一建立就是
confirmed。這一版的程式不再讀寫 hold_expires_at、slots_auto_confirm，也不再產生
占位逾期、逾期未處理提醒；欄位與狀態約束在下一版 migration 才動（CICD.md：先停用、
再移除，和上一版程式相容）。

這支只清資料，上一版程式讀到清完的資料也照常運作：

1. 再刪一次舊狀態的案件（1e5612e187ff 之後理應沒有），以及「已確認卻沒有場次」
   的舊流程資料；站內通知 payload 指到它們的一併刪。連帶 CASCADE 與 SET NULL 同
   1e5612e187ff。使用者確認正式庫預約資料都是測試資料、可以刪。
2. 舊流程的通知（占位逾期、逾期未處理、待園方確認）還沒寄出或寄送失敗的標成
   skipped：這一版不再判斷它們是否仍適用，留著會被當成一般通知寄出。

downgrade 不還原資料。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d65fa082ff87"
down_revision = "3fe1cfb2dbf7"
branch_labels = None
depends_on = None

LEGACY_CONDITION = "status IN ('new', 'contacting', 'pending_confirmation') OR (status = 'confirmed' AND slot_id IS NULL)"
LEGACY_KINDS = "('visit_request_overdue', 'visit_request_hold_expired', 'visit_request_pending_confirmation')"


def retire_legacy_data(conn) -> dict:
    """回傳刪掉的案件數與標成 skipped 的通知數。"""
    conn.execute(
        sa.text(
            f"""
            DELETE FROM notification_inbox_items
            WHERE payload->>'receipt_id' IN (SELECT id::text FROM visit_requests WHERE {LEGACY_CONDITION})
            """
        )
    )
    deleted = conn.execute(sa.text(f"DELETE FROM visit_requests WHERE {LEGACY_CONDITION}")).rowcount
    skipped = conn.execute(
        sa.text(
            f"""
            UPDATE outbox_messages SET status = 'skipped'
            WHERE kind IN {LEGACY_KINDS} AND status IN ('pending', 'failed')
            """
        )
    ).rowcount
    return {"deleted": deleted, "skipped": skipped}


def upgrade() -> None:
    retire_legacy_data(op.get_bind())


def downgrade() -> None:
    # 見檔頭：資料清理不還原。
    pass
