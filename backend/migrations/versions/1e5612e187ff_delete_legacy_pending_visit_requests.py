"""刪除自選場次上線前留下的「待處理」舊案

Revision ID: 1e5612e187ff
Revises: 4373bcc82d9d
Create Date: 2026-10-05

2026-10-01 起官網只剩家長自選場次、送出即預約成功，補登也在同一個交易排進
場次，不會再產生 new／contacting／pending_confirmation 的案件。後台列表的
「待處理」分組只剩上線前的舊案，2026-10-05 使用者裁定拿掉這個分組，舊案
直接刪除（不移到已取消）。

連帶刪除：聯絡紀錄、歷程、outbox、家長存取連結與 session、改期申請都是
ON DELETE CASCADE；其他案件的 related_request_id 與招生訪視的
visit_request_id 是 SET NULL。站內通知的 payload 只存案件 id（receipt_id），
沒有外鍵，這裡一併刪掉，免得點進去找不到案件。成效統計的 analytics_events
不帶案件 id，保留當時的事件；稽核紀錄照留。

只動資料、不動結構。downgrade 不還原資料：刪掉的列回不來，要還原只能從
部署前的備份。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "1e5612e187ff"
down_revision = "4373bcc82d9d"
branch_labels = None
depends_on = None

LEGACY_STATUSES = "('new', 'contacting', 'pending_confirmation')"


def delete_legacy_requests(conn) -> int:
    """回傳刪掉的案件數。"""
    conn.execute(
        sa.text(
            f"""
            DELETE FROM notification_inbox_items
            WHERE payload->>'receipt_id' IN (
                SELECT id::text FROM visit_requests WHERE status IN {LEGACY_STATUSES}
            )
            """
        )
    )
    return conn.execute(sa.text(f"DELETE FROM visit_requests WHERE status IN {LEGACY_STATUSES}")).rowcount


def upgrade() -> None:
    delete_legacy_requests(op.get_bind())


def downgrade() -> None:
    # 見檔頭：刪除不還原。
    pass
