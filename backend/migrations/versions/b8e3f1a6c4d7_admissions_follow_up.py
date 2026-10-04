"""參觀後追蹤：招生訪視加下次聯絡、追蹤負責人、最近聯絡時間，新增聯絡紀錄表
recruitment_contact_logs（docs/specs/2026-10-04-admissions-follow-up-design.md 第 5 節）。

只新增可空欄位、約束與新表，不改既有資料（既有訪視三欄都是 null，CHECK 一定成立）；
上一版程式不讀這些欄位，先跑 migration 再換程式也相容。CheckConstraint 的條件字串
與 app/admissions/models.py 逐字相同（tests/test_admissions_schema.py 檢查）。

Revision ID: b8e3f1a6c4d7
Revises: d2b7f4c9e1a3
Create Date: 2026-10-04
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b8e3f1a6c4d7"
down_revision = "d2b7f4c9e1a3"
branch_labels = None
depends_on = None

FOLLOW_UP_OPEN_CHECK = "follow_up_at IS NULL OR (enrolled = false AND withdrawn_at IS NULL AND anonymized_at IS NULL)"
CHANNEL_CHECK = "channel IN ('phone', 'line', 'in_person', 'other')"


def upgrade() -> None:
    op.add_column("recruitment_visits", sa.Column("follow_up_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("recruitment_visits", sa.Column("follow_up_owner_id", sa.Uuid(), nullable=True))
    op.add_column("recruitment_visits", sa.Column("last_contacted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_recruitment_visits_follow_up_owner_id_users",
        "recruitment_visits",
        "users",
        ["follow_up_owner_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint("ck_recruitment_visits_follow_up_open", "recruitment_visits", FOLLOW_UP_OPEN_CHECK)
    op.create_index(
        "ix_recruitment_visits_campus_follow_up",
        "recruitment_visits",
        ["campus_key", "follow_up_at"],
        postgresql_where=sa.text("anonymized_at IS NULL"),
    )

    op.create_table(
        "recruitment_contact_logs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "recruitment_visit_id",
            sa.Uuid(),
            sa.ForeignKey("recruitment_visits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("contacted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("reached", sa.Boolean(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("next_follow_up_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(CHANNEL_CHECK, name="ck_recruitment_contact_logs_channel"),
    )
    op.create_index(
        "ix_recruitment_contact_logs_visit_time",
        "recruitment_contact_logs",
        ["recruitment_visit_id", "contacted_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_recruitment_contact_logs_visit_time", table_name="recruitment_contact_logs")
    op.drop_table("recruitment_contact_logs")
    op.drop_index("ix_recruitment_visits_campus_follow_up", table_name="recruitment_visits")
    op.drop_constraint("ck_recruitment_visits_follow_up_open", "recruitment_visits", type_="check")
    op.drop_constraint("fk_recruitment_visits_follow_up_owner_id_users", "recruitment_visits", type_="foreignkey")
    op.drop_column("recruitment_visits", "last_contacted_at")
    op.drop_column("recruitment_visits", "follow_up_owner_id")
    op.drop_column("recruitment_visits", "follow_up_at")
