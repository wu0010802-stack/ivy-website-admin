"""招生區域分析：公開地理資料三張表與訪視比對結果表（2026-10-08 區域分析規格第 5 節）

規格：docs/specs/2026-10-08-admissions-area-design.md。
只新增表，不改既有資料，也不動 recruitment_visits 的結構（district 欄位原本就有）；
上一版程式不讀這些表，先跑 migration 再換程式也相容。CheckConstraint 的條件字串與
app/admissions/geo/models.py 逐字相同（tests/test_geo_schema.py 檢查）。

Revision ID: e7a1c4d9b2f6
Revises: c4e8a2f61b97
Create Date: 2026-10-08
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e7a1c4d9b2f6"
down_revision = "c4e8a2f61b97"
branch_labels = None
depends_on = None

STREET_KIND_CHECK = "street_kind IN ('road', 'area')"
KIND_CHECK = "kind IN ('public', 'nonprofit', 'quasi_public', 'private')"
DATASET_CHECK = "dataset IN ('doorplates', 'kindergartens', 'campuses')"
MATCH_LEVEL_CHECK = "match_level IN ('exact', 'nearby', 'street', 'district', 'unlocated', 'pending')"
REASON_CHECK = (
    "unlocated_reason IS NULL OR unlocated_reason IN "
    "('no_address', 'outside_kaohsiung', 'no_doorplate', 'ambiguous_village', 'anonymized')"
)


def upgrade() -> None:
    op.create_table(
        "geo_doorplates",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("dataset_version", sa.String(16), nullable=False),
        sa.Column("town_code", sa.String(8), nullable=False),
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("village", sa.String(16), nullable=False),
        sa.Column("street", sa.String(40), nullable=False),
        sa.Column("street_kind", sa.String(8), nullable=False),
        sa.Column("lane", sa.String(16), nullable=False),
        sa.Column("alley", sa.String(16), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("number_sub", sa.Integer(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.CheckConstraint(STREET_KIND_CHECK, name="ck_geo_doorplates_street_kind"),
    )
    op.create_index(
        "ix_geo_doorplates_lookup",
        "geo_doorplates",
        ["dataset_version", "town_code", "street", "lane", "alley", "number", "number_sub"],
    )
    op.create_table(
        "geo_kindergartens",
        sa.Column("source_id", sa.String(64), primary_key=True),
        sa.Column("reg_no", sa.String(80), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("pre_public_period", sa.String(16), nullable=True),
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("address", sa.String(200), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("approved_capacity", sa.Integer(), nullable=True),
        sa.Column("monthly_fee_estimate", sa.Integer(), nullable=True),
        sa.Column("has_penalty", sa.Boolean(), nullable=False),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(KIND_CHECK, name="ck_geo_kindergartens_kind"),
    )
    op.create_index("ix_geo_kindergartens_lat_lng", "geo_kindergartens", ["lat", "lng"])
    op.create_table(
        "geo_dataset_status",
        sa.Column("dataset", sa.String(20), primary_key=True),
        sa.Column("active_version", sa.String(64), nullable=True),
        sa.Column("label", sa.String(16), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(300), nullable=True),
        sa.CheckConstraint(DATASET_CHECK, name="ck_geo_dataset_status_dataset"),
    )
    op.create_table(
        "recruitment_visit_geo",
        sa.Column(
            "visit_id",
            sa.Uuid(),
            sa.ForeignKey("recruitment_visits.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("village", sa.String(16), nullable=True),
        sa.Column("match_level", sa.String(16), nullable=False),
        sa.Column("unlocated_reason", sa.String(24), nullable=True),
        sa.Column("distance_m", sa.Integer(), nullable=True),
        sa.Column("doorplate_version", sa.String(16), nullable=True),
        sa.Column("matched_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(MATCH_LEVEL_CHECK, name="ck_recruitment_visit_geo_match_level"),
        sa.CheckConstraint(REASON_CHECK, name="ck_recruitment_visit_geo_reason"),
    )


def downgrade() -> None:
    op.drop_table("recruitment_visit_geo")
    op.drop_table("geo_dataset_status")
    op.drop_index("ix_geo_kindergartens_lat_lng", table_name="geo_kindergartens")
    op.drop_table("geo_kindergartens")
    op.drop_index("ix_geo_doorplates_lookup", table_name="geo_doorplates")
    op.drop_table("geo_doorplates")
