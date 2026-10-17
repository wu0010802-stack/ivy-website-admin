"""預約案件的「排除」標記（2026-10-15 規格 docs/specs/2026-10-15-visit-exclusion-design.md §3.1）

visit_requests 加 excluded_at、excluded_by（→ users，SET NULL）、exclude_reason（test／duplicate／other）、
exclude_note（≤200 字），兩條 CHECK：原因值、excluded_at 與原因同有同無。不加索引（排除筆數極少）。
不改既有資料，不需要先備份正式庫；上一版程式不讀這些欄位，先跑 migration 再換程式也相容。
約束字串與 app/booking/models.py 相同（tests/test_visit_exclusion_schema.py 檢查）。

降級直接刪約束與欄位（已排除的標記與說明一併消失）。

Revision ID: d4a8f2c6e913
Revises: b7e3c1a9d5f2
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d4a8f2c6e913"
down_revision = "b7e3c1a9d5f2"
branch_labels = None
depends_on = None

REASON_CHECK = "exclude_reason IS NULL OR exclude_reason IN ('test', 'duplicate', 'other')"
PAIR_CHECK = "(excluded_at IS NULL) = (exclude_reason IS NULL)"


def upgrade() -> None:
    op.add_column("visit_requests", sa.Column("excluded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "visit_requests",
        sa.Column(
            "excluded_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_visit_requests_excluded_by_users"),
            nullable=True,
        ),
    )
    op.add_column("visit_requests", sa.Column("exclude_reason", sa.String(16), nullable=True))
    op.add_column("visit_requests", sa.Column("exclude_note", sa.String(200), nullable=True))
    op.create_check_constraint("ck_visit_requests_exclude_reason", "visit_requests", REASON_CHECK)
    op.create_check_constraint("ck_visit_requests_excluded_pair", "visit_requests", PAIR_CHECK)


def downgrade() -> None:
    op.drop_constraint("ck_visit_requests_excluded_pair", "visit_requests", type_="check")
    op.drop_constraint("ck_visit_requests_exclude_reason", "visit_requests", type_="check")
    op.drop_column("visit_requests", "exclude_note")
    op.drop_column("visit_requests", "exclude_reason")
    op.drop_column("visit_requests", "excluded_by")
    op.drop_column("visit_requests", "excluded_at")
