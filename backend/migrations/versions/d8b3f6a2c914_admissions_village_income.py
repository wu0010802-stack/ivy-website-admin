"""里的變化 C 段：各里綜合所得表，公開資料狀態多 income（2026-10-14 里的變化規格 §3.3）

規格：docs/specs/2026-10-14-admissions-village-trends-design.md。
只新增 geo_village_income 一張表，並把 ck_geo_dataset_status_dataset 放寬成多收 'income'；不改既有資料，
不需要先備份正式庫。上一版程式不讀新表，也不會寫新的狀態列，先跑 migration 再換程式也相容。約束條件字串與
app/admissions/geo/models.py 逐字相同（tests/test_geo_schema.py 檢查）。

降級先刪 income 狀態列（否則還原舊約束會失敗），再還原約束、刪表。

Revision ID: d8b3f6a2c914
Revises: c5e9a1f3b7d2
Create Date: 2026-10-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d8b3f6a2c914"
down_revision = "c5e9a1f3b7d2"
branch_labels = None
depends_on = None

DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income')"
)
PREVIOUS_DATASET_CHECK = "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration')"
AMOUNT_COLUMNS = ("year", "taxpayers", "median", "q1", "q3", "mean")


def upgrade() -> None:
    op.create_table(
        "geo_village_income",
        sa.Column("village_code", sa.String(11), primary_key=True),
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("village", sa.String(16), nullable=False),
        *(sa.Column(name, sa.Integer(), nullable=False) for name in AMOUNT_COLUMNS),
    )
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset = 'income'")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    op.drop_table("geo_village_income")
