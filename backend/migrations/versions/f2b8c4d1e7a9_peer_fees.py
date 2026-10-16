"""附近同業比較：幼兒園收費新表、園所與托嬰加欄位，公開資料狀態多一種 kindergarten_fees（2026-10-15 規格第 3 節）

規格：docs/specs/2026-10-15-peer-comparison-design.md。
新增 geo_kindergarten_fees；geo_kindergartens 加 indoor_m2、outdoor_m2、has_shuttle、after_school_capacity；
geo_babycare 加 monthly_fee、fee_note、evaluation_grade、evaluation_year、quasi_public；
ck_geo_dataset_status_dataset 放寬成多收 'kindergarten_fees'。不改既有資料，不需要先備份正式庫。
上一版程式不讀新表與新欄位、也不會寫 kindergarten_fees 狀態列，先跑 migration 再換程式也相容。
約束條件字串與 app/admissions/geo/models.py 逐字相同（tests/test_geo_schema.py 檢查）。

降級先刪 kindergarten_fees 狀態列（否則還原舊約束會失敗），再還原約束、拿掉欄位、刪表。

Revision ID: f2b8c4d1e7a9
Revises: f2a7c1e9d4b3
Create Date: 2026-10-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f2b8c4d1e7a9"
down_revision = "f2a7c1e9d4b3"
branch_labels = None
depends_on = None

DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees')"
)
PREVIOUS_DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare')"
)
FEE_AGE_CHECK = "age BETWEEN 2 AND 5"


def upgrade() -> None:
    op.create_table(
        "geo_kindergarten_fees",
        sa.Column("source_id", sa.String(64), primary_key=True),
        sa.Column("age", sa.SmallInteger(), primary_key=True),
        sa.Column("school_year", sa.SmallInteger(), nullable=False),
        sa.Column("months", sa.Numeric(3, 1), nullable=True),
        sa.Column("tuition", sa.Integer(), nullable=True),
        sa.Column("misc_fee", sa.Integer(), nullable=True),
        sa.Column("materials", sa.Integer(), nullable=True),
        sa.Column("activities", sa.Integer(), nullable=True),
        sa.Column("lunch", sa.Integer(), nullable=True),
        sa.Column("snack", sa.Integer(), nullable=True),
        sa.Column("semester_total", sa.Integer(), nullable=False),
        sa.Column("after_care_monthly", sa.Integer(), nullable=True),
        sa.Column("transport_note", sa.String(40), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(FEE_AGE_CHECK, name="ck_geo_kindergarten_fees_age"),
    )
    op.add_column("geo_kindergartens", sa.Column("indoor_m2", sa.Float(), nullable=True))
    op.add_column("geo_kindergartens", sa.Column("outdoor_m2", sa.Float(), nullable=True))
    op.add_column("geo_kindergartens", sa.Column("has_shuttle", sa.Boolean(), nullable=True))
    op.add_column("geo_kindergartens", sa.Column("after_school_capacity", sa.Integer(), nullable=True))
    op.add_column("geo_babycare", sa.Column("monthly_fee", sa.Integer(), nullable=True))
    op.add_column("geo_babycare", sa.Column("fee_note", sa.String(200), nullable=True))
    op.add_column("geo_babycare", sa.Column("evaluation_grade", sa.String(8), nullable=True))
    op.add_column("geo_babycare", sa.Column("evaluation_year", sa.SmallInteger(), nullable=True))
    op.add_column("geo_babycare", sa.Column("quasi_public", sa.Boolean(), nullable=True))
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset = 'kindergarten_fees'")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    for column in ("quasi_public", "evaluation_year", "evaluation_grade", "fee_note", "monthly_fee"):
        op.drop_column("geo_babycare", column)
    for column in ("after_school_capacity", "has_shuttle", "outdoor_m2", "indoor_m2"):
        op.drop_column("geo_kindergartens", column)
    op.drop_table("geo_kindergarten_fees")
