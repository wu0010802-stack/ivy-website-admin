"""招生機會：各里學齡前人口表，公開資料狀態多一種 population（2026-10-13 招生機會規格第 3 節）

規格：docs/specs/2026-10-13-admissions-opportunity-design.md。
只新增 geo_village_population，並把 ck_geo_dataset_status_dataset 放寬成多收 'population'；
不改既有資料，不需要先備份正式庫。上一版程式不讀新表，也不會寫 population 狀態列，
先跑 migration 再換程式也相容。約束條件字串與 app/admissions/geo/models.py 逐字相同
（tests/test_geo_schema.py 檢查）。

降級先刪 population 狀態列（否則還原舊約束會失敗），再還原約束、刪表。

Revision ID: f3c8a2d47b19
Revises: ad783510900a
Create Date: 2026-10-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f3c8a2d47b19"
down_revision = "ad783510900a"
branch_labels = None
depends_on = None

DATASET_CHECK = "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population')"
PREVIOUS_DATASET_CHECK = "dataset IN ('doorplates', 'kindergartens', 'campuses')"
AGE_COLUMNS = ("age_0", "age_1", "age_2", "age_3", "age_4", "age_5", "age_6")


def upgrade() -> None:
    op.create_table(
        "geo_village_population",
        sa.Column("village_code", sa.String(11), primary_key=True),
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("village", sa.String(16), nullable=False),
        *(sa.Column(name, sa.Integer(), nullable=False) for name in AGE_COLUMNS),
        sa.Column("people_total", sa.Integer(), nullable=False),
    )
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset = 'population'")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    op.drop_table("geo_village_population")
