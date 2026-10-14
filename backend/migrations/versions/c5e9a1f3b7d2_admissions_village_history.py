"""里的變化：各里出生、遷入遷出、年齡的月份歷史表，公開資料狀態多 births、migration（2026-10-14 里的變化規格 §3.1）

規格：docs/specs/2026-10-14-admissions-village-trends-design.md。
只新增 geo_village_births、geo_village_migration、geo_village_ages 三張表，並把
ck_geo_dataset_status_dataset 放寬成多收 'births'、'migration'；不改既有資料，不需要先備份正式庫。
上一版程式不讀新表，也不會寫新的狀態列，先跑 migration 再換程式也相容。約束條件字串與
app/admissions/geo/models.py 逐字相同（tests/test_geo_schema.py 檢查）。

降級先刪 births、migration 狀態列（否則還原舊約束會失敗），再還原約束、刪表。

Revision ID: c5e9a1f3b7d2
Revises: b4d7e1a92c58
Create Date: 2026-10-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c5e9a1f3b7d2"
down_revision = "b4d7e1a92c58"
branch_labels = None
depends_on = None

DATASET_CHECK = "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration')"
PREVIOUS_DATASET_CHECK = "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population')"
MIGRATION_COLUMNS = ("moved_in", "moved_out", "address_in", "address_out", "boundary_in", "boundary_out")
AGE_COLUMNS = ("age_0", "age_1", "age_2", "age_3", "age_4", "age_5", "age_6", "people_total")


def _village_month_columns() -> list[sa.Column]:
    return [
        sa.Column("month", sa.String(6), primary_key=True),
        sa.Column("village_code", sa.String(11), primary_key=True),
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("village", sa.String(16), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "geo_village_births",
        *_village_month_columns(),
        sa.Column("births", sa.Integer(), nullable=False),
    )
    op.create_table(
        "geo_village_migration",
        *_village_month_columns(),
        *(sa.Column(name, sa.Integer(), nullable=False) for name in MIGRATION_COLUMNS),
    )
    op.create_table(
        "geo_village_ages",
        *_village_month_columns(),
        *(sa.Column(name, sa.Integer(), nullable=False) for name in AGE_COLUMNS),
    )
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset IN ('births', 'migration')")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    op.drop_table("geo_village_ages")
    op.drop_table("geo_village_migration")
    op.drop_table("geo_village_births")
