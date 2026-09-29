"""LINE 群組驗證：群組要在群組裡貼上後台產生的一次性驗證碼才能被選為推播目標

Revision ID: e4c1a7f3b862
Revises: de61f57ec77d
Create Date: 2026-09-29

2026-09-29 白箱稽核（line-group-registration-unverified）：任何人把官方帳號拉進
自己取名的群組，就會出現在後台的推播群組清單。新增：

- line_groups.verified_at：可為 NULL。既有群組不回填、既有校區綁定不動，照常推播；
  只有「改選另一個群組」時才要求已驗證。
- line_group_verification_codes：後台產生的一次性驗證碼（只存 HMAC 雜湊）。

只加欄位與新表、不改寫資料，與上一版程式相容（上一版不讀這些欄位）。
downgrade 刪掉新表與欄位（驗證紀錄會消失，群組與綁定不受影響）。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e4c1a7f3b862"
down_revision = "de61f57ec77d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("line_groups", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "line_group_verification_codes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_target_id", sa.String(64), nullable=True),
        sa.UniqueConstraint("code_hash", name="uq_line_group_verification_codes_code_hash"),
    )
    op.create_index(
        "ix_line_group_verification_codes_created_by", "line_group_verification_codes", ["created_by"]
    )


def downgrade() -> None:
    op.drop_index("ix_line_group_verification_codes_created_by", table_name="line_group_verification_codes")
    op.drop_table("line_group_verification_codes")
    op.drop_column("line_groups", "verified_at")
