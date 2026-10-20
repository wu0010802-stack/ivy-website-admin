"""招生區域：預售建案與地號座標兩張表，公開資料狀態多 presale_buildcases（2026-10-20 預售建案規格 §5、P8）

規格：docs/specs/2026-10-20-admissions-presale-design.md。
只新增 geo_presale_buildcases（含 match_level 約束與里索引）、geo_parcel_points 兩張表，並把
ck_geo_dataset_status_dataset 放寬成多收 'presale_buildcases'；不改既有資料，不需要先備份正式庫。上一版程式不讀新表，
也不會寫新的狀態列，先跑 migration 再換程式也相容。約束條件字串與 app/admissions/geo/models.py 逐字相同
（tests/test_geo_schema.py 檢查）。

降級先刪 presale_buildcases 狀態列（否則還原舊約束會失敗），再還原約束、刪表。

Revision ID: a3d7f1c9b5e2
Revises: d4a8f2c6e913
Create Date: 2026-10-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a3d7f1c9b5e2"
down_revision = "d4a8f2c6e913"
branch_labels = None
depends_on = None

DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees', 'presale_buildcases')"
)
PREVIOUS_DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees')"
)
MATCH_LEVEL_CHECK = "match_level IN ('parcel', 'exact', 'nearby', 'street', 'district', 'pending')"


def upgrade() -> None:
    op.create_table(
        "geo_presale_buildcases",
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("street", sa.String(80), nullable=False),
        sa.Column("households", sa.Integer(), nullable=False),
        sa.Column("main_use", sa.String(60), nullable=False),
        sa.Column("residential", sa.Boolean(), nullable=False),
        sa.Column("declared_on", sa.Date(), nullable=True),
        sa.Column("permit_on", sa.Date(), nullable=True),
        sa.Column("first_registered_on", sa.Date(), nullable=True),
        sa.Column("parcel_section", sa.String(40), nullable=True),
        sa.Column("parcel_no", sa.String(16), nullable=True),
        sa.Column("village_code", sa.String(11), nullable=True),
        sa.Column("village", sa.String(16), nullable=True),
        sa.Column("match_level", sa.String(16), nullable=False),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("doorplate_version", sa.String(16), nullable=True),
        sa.Column("source_version", sa.String(16), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("district", "name"),
        sa.CheckConstraint(MATCH_LEVEL_CHECK, name="ck_geo_presale_buildcases_match_level"),
    )
    op.create_index("ix_geo_presale_buildcases_village", "geo_presale_buildcases", ["village_code"])
    op.create_table(
        "geo_parcel_points",
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("section_name", sa.String(40), nullable=False),
        sa.Column("landno", sa.String(16), nullable=False),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("fetched_on", sa.Date(), nullable=False),
        sa.PrimaryKeyConstraint("district", "section_name", "landno"),
    )
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset = 'presale_buildcases'")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    op.drop_table("geo_parcel_points")
    op.drop_index("ix_geo_presale_buildcases_village", table_name="geo_presale_buildcases")
    op.drop_table("geo_presale_buildcases")
