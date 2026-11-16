"""家長 LINE 通知：各校用哪個官方帳號、預約綁定的 LINE、一次性綁定代碼；轉換回傳加 LINE

Revision ID: b3e8d1c4f9a7
Revises: a9c4e7b2d815
Create Date: 2026-11-16

docs/specs/2026-11-16-line-integrations-design.md §4、§5、§8。新增三張表，並放寬 ad_conversion_jobs 的
platform 檢查加入 'line'。不改既有資料，與上一版程式相容（上一版不讀這些表、不寫 line）。沒有列＝沒開，
部署後行為不變，不需要先備份。
downgrade 刪掉三張表（家長的 LINE 綁定會消失，之後要家長重新綁定），刪掉 platform='line' 的轉換工作再收回檢查。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b3e8d1c4f9a7"
down_revision = "a9c4e7b2d815"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_ad_conversion_jobs_platform", "ad_conversion_jobs", type_="check")
    op.create_check_constraint(
        "ck_ad_conversion_jobs_platform", "ad_conversion_jobs", "platform IN ('ga4', 'meta', 'openai', 'line')"
    )
    op.create_table(
        "line_parent_campus_accounts",
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="CASCADE"), primary_key=True),
        sa.Column("account_key", sa.String(20), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_table(
        "line_parent_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "visit_request_id",
            sa.Uuid(),
            sa.ForeignKey("visit_requests.id", ondelete="CASCADE", name="fk_line_parent_links_visit_request_id"),
            nullable=False,
        ),
        sa.Column("account_key", sa.String(20), nullable=False),
        sa.Column("line_user_id", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("unfollowed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("visit_request_id", name="uq_line_parent_links_visit_request_id"),
    )
    op.create_index("ix_line_parent_links_account_user", "line_parent_links", ["account_key", "line_user_id"])
    op.create_table(
        "line_parent_link_codes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "visit_request_id",
            sa.Uuid(),
            sa.ForeignKey("visit_requests.id", ondelete="CASCADE", name="fk_line_parent_link_codes_visit_request_id"),
            nullable=False,
        ),
        sa.Column("account_key", sa.String(20), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("code_hash", name="uq_line_parent_link_codes_code_hash"),
    )
    op.create_index(
        "ix_line_parent_link_codes_visit_request_id", "line_parent_link_codes", ["visit_request_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_line_parent_link_codes_visit_request_id", table_name="line_parent_link_codes")
    op.drop_table("line_parent_link_codes")
    op.drop_index("ix_line_parent_links_account_user", table_name="line_parent_links")
    op.drop_table("line_parent_links")
    op.drop_table("line_parent_campus_accounts")
    op.execute("DELETE FROM ad_conversion_jobs WHERE platform = 'line'")
    op.drop_constraint("ck_ad_conversion_jobs_platform", "ad_conversion_jobs", type_="check")
    op.create_check_constraint(
        "ck_ad_conversion_jobs_platform", "ad_conversion_jobs", "platform IN ('ga4', 'meta', 'openai')"
    )
