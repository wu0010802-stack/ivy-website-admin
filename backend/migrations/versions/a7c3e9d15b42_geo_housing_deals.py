"""區域分析：各里房價與租金交易表，公開資料狀態多 housing

2026-11-20，docs/specs/2026-11-20-area-point-overlay-housing-design.md §7.1。只新增 geo_housing_deals 一張表
（含 kind、match_level 約束與兩個索引），並把 ck_geo_dataset_status_dataset 放寬成多收 'housing'；不改既有資料，
不需要先備份正式庫。上一版程式不讀新表，也不會寫新的狀態列，先跑 migration 再換程式也相容。約束條件字串與
app/admissions/geo/models.py 逐字相同（tests/test_geo_schema.py 檢查）。

降級先刪 housing 狀態列（否則還原舊約束會失敗），再還原約束、刪表。

Revision ID: a7c3e9d15b42
Revises: d8b1a9e5c274
Create Date: 2026-11-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7c3e9d15b42"
down_revision = "d8b1a9e5c274"
branch_labels = None
depends_on = None

DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees', 'presale_buildcases', 'kindergarten_penalties', 'kindergarten_evaluations',"
    " 'elementary', 'marriages', 'housing')"
)
PREVIOUS_DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees', 'presale_buildcases', 'kindergarten_penalties', 'kindergarten_evaluations',"
    " 'elementary', 'marriages')"
)
KIND_CHECK = "kind IN ('sale', 'rent')"
MATCH_LEVEL_CHECK = "match_level IN ('exact', 'nearby', 'street', 'district', 'unlocated', 'pending')"


def upgrade() -> None:
    op.create_table(
        "geo_housing_deals",
        sa.Column("kind", sa.String(4), primary_key=True),
        sa.Column("serial", sa.String(40), primary_key=True),
        sa.Column("season", sa.String(5), nullable=False),
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
        sa.Column("unit_price", sa.Integer(), nullable=True),
        sa.Column("monthly_rent", sa.Integer(), nullable=True),
        sa.CheckConstraint(KIND_CHECK, name="ck_geo_housing_deals_kind"),
        sa.CheckConstraint(MATCH_LEVEL_CHECK, name="ck_geo_housing_deals_match_level"),
    )
    op.create_index("ix_geo_housing_deals_season", "geo_housing_deals", ["season"])
    op.create_index("ix_geo_housing_deals_village", "geo_housing_deals", ["district", "village"])
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset = 'housing'")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    op.drop_index("ix_geo_housing_deals_village", table_name="geo_housing_deals")
    op.drop_index("ix_geo_housing_deals_season", table_name="geo_housing_deals")
    op.drop_table("geo_housing_deals")
