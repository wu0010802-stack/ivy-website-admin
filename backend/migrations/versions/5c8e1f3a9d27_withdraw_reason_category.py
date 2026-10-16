"""招生訪視加「退出原因分類」（2026-10-15 規格 docs/specs/2026-10-15-withdraw-reason-category-design.md §3.1）

recruitment_visits 加可空欄位 withdraw_reason_category（八項分類）與兩個 CHECK：值要在清單內、
有分類就一定已退出。只加欄位與約束，不改既有資料（舊的退出者分類是 NULL，畫面歸「未分類」），
不需要先備份正式庫；上一版程式不讀也不寫這個欄位，先跑 migration 再換程式也相容。
約束條件字串與 app/admissions/models.py 逐字相同（tests/test_withdraw_reason_category_schema.py 檢查）。

降級直接刪約束與欄位（已填的分類一併消失）。

Revision ID: 5c8e1f3a9d27
Revises: f2a7c1e9d4b3
Create Date: 2026-10-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "5c8e1f3a9d27"
down_revision = "f2a7c1e9d4b3"
branch_labels = None
depends_on = None

CATEGORY_CHECK = "withdraw_reason_category IS NULL OR withdraw_reason_category IN ('抽中公幼／非營利', '改讀其他私立幼兒園', '搬家／距離因素', '費用考量', '家庭照顧安排改變', '孩子健康／適應因素', '課程／環境有疑慮', '未註明／聯絡不上')"
WITHDRAWN_CHECK = "withdraw_reason_category IS NULL OR withdrawn_at IS NOT NULL"


def upgrade() -> None:
    op.add_column("recruitment_visits", sa.Column("withdraw_reason_category", sa.String(40), nullable=True))
    op.create_check_constraint("ck_recruitment_visits_withdraw_reason_category", "recruitment_visits", CATEGORY_CHECK)
    op.create_check_constraint("ck_recruitment_visits_withdraw_category_withdrawn", "recruitment_visits", WITHDRAWN_CHECK)


def downgrade() -> None:
    op.drop_constraint("ck_recruitment_visits_withdraw_category_withdrawn", "recruitment_visits", type_="check")
    op.drop_constraint("ck_recruitment_visits_withdraw_reason_category", "recruitment_visits", type_="check")
    op.drop_column("recruitment_visits", "withdraw_reason_category")
