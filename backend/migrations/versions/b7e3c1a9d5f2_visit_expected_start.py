"""預約案件新增「預計入學時間」（2026-10-15 規格 docs/specs/2026-10-15-visit-expected-start-design.md）

visit_requests 加 expected_start（可空），CHECK 只收 asap、unsure 或「民國學年-學期」（例 115-2）。
不改既有資料，不需要先備份正式庫；上一版程式不讀這個欄位，先跑 migration 再換程式也相容。
約束字串與 app/booking/models.py 相同（tests/test_visit_expected_start_schema.py 檢查）。

降級直接刪約束與欄位（已填的預計入學時間一併消失）。

Revision ID: b7e3c1a9d5f2
Revises: 5c8e1f3a9d27
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b7e3c1a9d5f2"
down_revision = "5c8e1f3a9d27"
branch_labels = None
depends_on = None

EXPECTED_START_CHECK = "expected_start IS NULL OR expected_start IN ('asap', 'unsure') OR expected_start ~ '^1[0-9]{2}-[12]$'"


def upgrade() -> None:
    op.add_column("visit_requests", sa.Column("expected_start", sa.String(8), nullable=True))
    op.create_check_constraint("ck_visit_requests_expected_start", "visit_requests", EXPECTED_START_CHECK)


def downgrade() -> None:
    op.drop_constraint("ck_visit_requests_expected_start", "visit_requests", type_="check")
    op.drop_column("visit_requests", "expected_start")
