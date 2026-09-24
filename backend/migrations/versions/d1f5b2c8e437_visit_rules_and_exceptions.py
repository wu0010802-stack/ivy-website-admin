"""參觀時段的每週規則、休假日例外，與各校最短提前／最遠開放天數。

Revision ID: d1f5b2c8e437
Revises: c4e8a1d3f210
Create Date: 2026-09-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d1f5b2c8e437"
down_revision = "c4e8a1d3f210"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 規格 225：初始建議提前 24 小時、最遠 60 天；既有各校沿用這組值。
    op.add_column(
        "booking_configs",
        sa.Column("min_lead_hours", sa.Integer(), nullable=False, server_default="24"),
    )
    op.add_column(
        "booking_configs",
        sa.Column("max_advance_days", sa.Integer(), nullable=False, server_default="60"),
    )
    op.create_table(
        "visit_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("slot_minutes", sa.Integer(), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_visit_rules_weekday"),
        sa.CheckConstraint("end_time > start_time", name="ck_visit_rules_time_order"),
        sa.CheckConstraint("slot_minutes > 0 AND capacity > 0", name="ck_visit_rules_positive"),
    )
    op.create_table(
        "visit_exceptions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("exception_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.String(200), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("campus_key", "exception_date", name="uq_visit_exception_day"),
    )


def downgrade() -> None:
    op.drop_table("visit_exceptions")
    op.drop_table("visit_rules")
    op.drop_column("booking_configs", "max_advance_days")
    op.drop_column("booking_configs", "min_lead_hours")
