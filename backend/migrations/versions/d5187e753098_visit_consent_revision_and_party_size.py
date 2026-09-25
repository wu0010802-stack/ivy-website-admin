"""案件記錄同意說明版本與接受時間、參觀人數

Revision ID: d5187e753098
Revises: 2d6fce2f73c9
Create Date: 2026-09-25

規格 L196：同意紀錄要保存 consent_revision_id（家長看到的是哪一版同意說明，
指向「預約文案」booking_content 的已發布 revision）、伺服器接受時間與同意
結果。原本只存 consent_given 布林值。

- consent_revision_id：nullable。舊案件當時沒有記錄版本，事後補不回來，
  維持 NULL；人工補登也沒有版本（人員向家長口頭說明後代勾）。外鍵用
  RESTRICT，同意紀錄引用的版本不能被刪。
- consent_accepted_at：nullable。舊案件的同意是在建立案件的同一個請求裡
  由伺服器驗證的，回填 created_at 就是當時的接受時間；consent_given 為
  false 的舊資料（理論上沒有）不回填。
- party_size：規格 L194 參觀人數 1–10，nullable（舊案件與沒問到人數的補登），
  CHECK 只限制有值時的範圍，舊資料全是 NULL 可以直接套用。

全部是新增的 nullable 欄位＋一次 UPDATE 回填，正式庫有資料時可以直接套用；
舊版程式讀寫不受多出來的欄位影響。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d5187e753098"
down_revision = "2d6fce2f73c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("visit_requests", sa.Column("consent_revision_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_visit_requests_consent_revision_id_content_revisions",
        "visit_requests",
        "content_revisions",
        ["consent_revision_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.add_column(
        "visit_requests", sa.Column("consent_accepted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.execute(
        sa.text(
            "UPDATE visit_requests SET consent_accepted_at = created_at "
            "WHERE consent_given AND consent_accepted_at IS NULL"
        )
    )
    op.add_column("visit_requests", sa.Column("party_size", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_visit_requests_party_size",
        "visit_requests",
        "party_size IS NULL OR party_size BETWEEN 1 AND 10",
    )


def downgrade() -> None:
    op.drop_constraint("ck_visit_requests_party_size", "visit_requests", type_="check")
    op.drop_column("visit_requests", "party_size")
    op.drop_column("visit_requests", "consent_accepted_at")
    op.drop_constraint(
        "fk_visit_requests_consent_revision_id_content_revisions", "visit_requests", type_="foreignkey"
    )
    op.drop_column("visit_requests", "consent_revision_id")
