"""總部 LINE 群組的週報、月報（2026-11-26，docs/specs/2026-11-26-line-group-reports-design.md）

- 新表 line_report_runs：某群組某一期的週報／月報已經推過。
- 現有的總部群組直接打開 weekly_report、monthly_report 兩種通知（使用者指定要這兩份報表；
  之後新設的總部群組預設不開，在後台 LINE 通知頁自己開）。

只新增一張表、替總部群組的 kinds 多加兩個值，不需要事先備份正式庫。

Revision ID: c7a2d9e4b615
Revises: e84b4724bb8d
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c7a2d9e4b615"
down_revision = "e84b4724bb8d"
branch_labels = None
depends_on = None

_KINDS = ("weekly_report", "monthly_report")


def upgrade() -> None:
    op.create_table(
        "line_report_runs",
        sa.Column(
            "target_id", sa.String(64), sa.ForeignKey("line_groups.target_id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("target_id", "kind", "period_start"),
    )
    for kind in _KINDS:
        op.execute(
            sa.text(
                "UPDATE line_group_settings SET kinds = kinds || CAST(:added AS jsonb) "
                "WHERE is_hq AND NOT kinds @> CAST(:added AS jsonb)"
            ).bindparams(added=f'["{kind}"]')
        )


def downgrade() -> None:
    for kind in _KINDS:
        op.execute(
            sa.text(
                "UPDATE line_group_settings SET kinds = kinds - CAST(:kind AS text) "
                "WHERE kinds @> CAST(:added AS jsonb)"
            ).bindparams(kind=kind, added=f'["{kind}"]')
        )
    op.drop_table("line_report_runs")
