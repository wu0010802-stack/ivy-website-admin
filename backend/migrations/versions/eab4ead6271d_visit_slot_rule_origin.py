"""時段記錄是否依每週規則產生；關閉來源加上「規則已變更」

Revision ID: eab4ead6271d
Revises: f1b8d3a6c925
Create Date: 2026-09-26

B03 審查意見：定期工作把時段預先補到最遠開放天數之後，改每週規則（每場
長度、拿掉某個星期幾、每場名額）時，舊規則產生、還沒人預約的時段在接下來
幾十天照常公開，新規則的場次還會跟它們重疊。改規則時要找出「依規則產生、
還沒被使用」的時段對齊新規則（規格 L227），所以時段要記是不是規則產生的；
園方在時段頁手動新增的場次不受改規則影響。

from_rule 回填：
- created_by 為 NULL：只有定期工作（extend_from_rules）會建沒有建立人的
  時段（後台帳號只停用、不刪除，外鍵的 SET NULL 不會發生）。
- 同一校、同一建立人、created_at 完全相同且不只一筆：「依規則產生時段」與
  取消休假補場次都是一次交易、同一個時間戳建一批；後台「新增時段」一次只
  建一筆，時間戳到微秒不會撞在一起。
- 其餘一律當成園方手動新增（false），改規則時不動。只產生一場的那次
  「依規則產生」分不出來，保守當手動。

closed_source 加上 'rule'：舊規則時段若還有歷史案件（已取消）或改期申請
指著，刪不掉，改規則時改成關閉並記 'rule'，跟園方手動關閉分開。

新增欄位有 server_default，正式庫有資料可以直接套；舊版程式不讀這個欄位，
它新建的時段 from_rule 為 false（視同手動，不會被改規則動到）。
downgrade：'rule' 關閉的時段改記 'manual'（維持關閉），再還原檢查條件、
刪欄位。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "eab4ead6271d"
down_revision = "f1b8d3a6c925"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "visit_slots",
        sa.Column("from_rule", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        sa.text(
            """
            UPDATE visit_slots AS vs
            SET from_rule = true
            WHERE vs.created_by IS NULL
               OR EXISTS (
                   SELECT 1
                   FROM visit_slots AS other
                   WHERE other.id <> vs.id
                     AND other.campus_key = vs.campus_key
                     AND other.created_by = vs.created_by
                     AND other.created_at = vs.created_at
               )
            """
        )
    )
    op.drop_constraint("ck_visit_slots_closed_source", "visit_slots", type_="check")
    op.create_check_constraint(
        "ck_visit_slots_closed_source",
        "visit_slots",
        "closed_source IS NULL OR closed_source IN ('manual', 'exception', 'rule')",
    )


def downgrade() -> None:
    op.execute(sa.text("UPDATE visit_slots SET closed_source = 'manual' WHERE closed_source = 'rule'"))
    op.drop_constraint("ck_visit_slots_closed_source", "visit_slots", type_="check")
    op.create_check_constraint(
        "ck_visit_slots_closed_source",
        "visit_slots",
        "closed_source IS NULL OR closed_source IN ('manual', 'exception')",
    )
    op.drop_column("visit_slots", "from_rule")
