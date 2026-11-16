"""廣告成效：預約案件記廣告平台、手填花費表、各里結婚對數

2026-11-16，docs/specs/2026-11-16-ad-roi-design.md。只新增欄位、表與放寬 dataset 約束，不改既有資料，
不需要事先備份正式庫。

Revision ID: c4d2e8a1f6b3
Revises: b3e8d1c4f9a7
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c4d2e8a1f6b3"
down_revision = "b3e8d1c4f9a7"
branch_labels = None
depends_on = None

PLATFORMS = "('google', 'openai', 'meta', 'line', 'other')"
DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees', 'presale_buildcases', 'kindergarten_penalties', 'kindergarten_evaluations',"
    " 'elementary', 'marriages')"
)
PREVIOUS_DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees', 'presale_buildcases', 'kindergarten_penalties', 'kindergarten_evaluations',"
    " 'elementary')"
)


def upgrade() -> None:
    for prefix in ("first_touch", "last_touch"):
        op.add_column("visit_requests", sa.Column(f"{prefix}_ad_platform", sa.String(8), nullable=True))
        op.create_check_constraint(
            f"ck_visit_requests_{prefix}_ad_platform",
            "visit_requests",
            f"{prefix}_ad_platform IS NULL OR {prefix}_ad_platform IN {PLATFORMS}",
        )
        op.create_check_constraint(
            f"ck_visit_requests_{prefix}_ad_platform_ads",
            "visit_requests",
            f"{prefix}_ad_platform IS NULL OR {prefix}_source = 'ads'",
        )
    op.create_table(
        "ad_spend_entries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("platform", sa.String(8), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(100), nullable=True),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("month", "platform", name="uq_ad_spend_entries_month_platform"),
        sa.CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_ad_spend_entries_month_first_day"),
        sa.CheckConstraint(
            "platform IN ('openai', 'meta', 'line', 'other', 'offline')", name="ck_ad_spend_entries_platform"
        ),
        sa.CheckConstraint("amount BETWEEN 0 AND 10000000", name="ck_ad_spend_entries_amount"),
    )
    op.create_table(
        "geo_village_marriages",
        sa.Column("month", sa.String(6), primary_key=True),
        sa.Column("village_code", sa.String(11), primary_key=True),
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("village", sa.String(16), nullable=False),
        sa.Column("marriages", sa.Integer(), nullable=False),
    )
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset = 'marriages'")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    op.drop_table("geo_village_marriages")
    op.drop_table("ad_spend_entries")
    for prefix in ("first_touch", "last_touch"):
        op.drop_constraint(f"ck_visit_requests_{prefix}_ad_platform_ads", "visit_requests", type_="check")
        op.drop_constraint(f"ck_visit_requests_{prefix}_ad_platform", "visit_requests", type_="check")
        op.drop_column("visit_requests", f"{prefix}_ad_platform")
