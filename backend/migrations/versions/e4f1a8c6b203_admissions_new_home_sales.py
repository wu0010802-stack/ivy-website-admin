"""里的變化 B 段：新成屋交屋表，公開資料狀態多 new_homes（2026-10-14 里的變化規格 §3.2）

規格：docs/specs/2026-10-14-admissions-village-trends-design.md。
只新增 geo_new_home_sales 一張表（含 match_level 約束與 season 索引），並把 ck_geo_dataset_status_dataset 放寬成
多收 'new_homes'；不改既有資料，不需要先備份正式庫。上一版程式不讀新表，也不會寫新的狀態列，先跑 migration 再換
程式也相容。約束條件字串與 app/admissions/geo/models.py 逐字相同（tests/test_geo_schema.py 檢查）。

降級先刪 new_homes 狀態列（否則還原舊約束會失敗），再還原約束、刪表。

Revision ID: e4f1a8c6b203
Revises: d8b3f6a2c914
Create Date: 2026-10-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e4f1a8c6b203"
down_revision = "d8b3f6a2c914"
branch_labels = None
depends_on = None

DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes')"
)
PREVIOUS_DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income')"
)
MATCH_LEVEL_CHECK = "match_level IN ('exact', 'nearby', 'street', 'district', 'unlocated', 'pending')"


def upgrade() -> None:
    op.create_table(
        "geo_new_home_sales",
        sa.Column("serial", sa.String(40), primary_key=True),
        sa.Column("season", sa.String(5), nullable=False),
        sa.Column("completed_on", sa.Date(), nullable=False),
        sa.Column("presale", sa.Boolean(), nullable=False),
        sa.Column("building_type", sa.String(16), nullable=False),
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("street", sa.String(40), nullable=False),
        sa.Column("lane", sa.String(16), nullable=False),
        sa.Column("alley", sa.String(16), nullable=False),
        sa.Column("number", sa.Integer(), nullable=True),
        sa.Column("number_sub", sa.Integer(), nullable=False),
        sa.Column("village", sa.String(16), nullable=True),
        sa.Column("match_level", sa.String(16), nullable=False),
        sa.Column("doorplate_version", sa.String(16), nullable=True),
        sa.CheckConstraint(MATCH_LEVEL_CHECK, name="ck_geo_new_home_sales_match_level"),
    )
    op.create_index("ix_geo_new_home_sales_season", "geo_new_home_sales", ["season"])
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset = 'new_homes'")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    op.drop_index("ix_geo_new_home_sales_season", table_name="geo_new_home_sales")
    op.drop_table("geo_new_home_sales")
