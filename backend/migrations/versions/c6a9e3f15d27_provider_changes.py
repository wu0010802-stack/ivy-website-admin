"""托嬰名單與園所異動：新增兩張表、兩個欄位，公開資料狀態多一種 babycare（2026-10-14 規格第 3 節）

規格：docs/specs/2026-10-14-provider-changes-design.md。
新增 geo_babycare、geo_provider_events，geo_kindergartens 加 registered_on（設立日），
geo_dataset_status 加 baseline_on（異動紀錄的基準日），並把 ck_geo_dataset_status_dataset 放寬成多收 'babycare'。
不改既有資料，不需要先備份正式庫。上一版程式不讀新表與新欄位、也不會寫 babycare 狀態列，
先跑 migration 再換程式也相容。約束條件字串與 app/admissions/geo/models.py 逐字相同
（tests/test_geo_schema.py 檢查）。

降級先刪 babycare 狀態列（否則還原舊約束會失敗），再還原約束、拿掉欄位、刪表；已記的異動一併消失。

Revision ID: c6a9e3f15d27
Revises: e4f1a8c6b203
Create Date: 2026-10-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c6a9e3f15d27"
down_revision = "e4f1a8c6b203"
branch_labels = None
depends_on = None

DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare')"
)
PREVIOUS_DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes')"
)
BABYCARE_KIND_CHECK = "kind IN ('center', 'home')"
PROVIDER_CHECK = "provider IN ('kindergarten', 'babycare')"
CHANGE_CHECK = "change IN ('opened', 'closed', 'kind_changed')"


def upgrade() -> None:
    op.create_table(
        "geo_babycare",
        sa.Column("source_id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("address", sa.String(200), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("approved_capacity", sa.Integer(), nullable=True),
        sa.Column("enrolled", sa.Integer(), nullable=True),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(BABYCARE_KIND_CHECK, name="ck_geo_babycare_kind"),
    )
    op.create_index("ix_geo_babycare_lat_lng", "geo_babycare", ["lat", "lng"])
    op.create_table(
        "geo_provider_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("source_id", sa.String(64), nullable=False),
        sa.Column("change", sa.String(16), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("old_value", sa.String(16), nullable=True),
        sa.Column("new_value", sa.String(16), nullable=True),
        sa.CheckConstraint(PROVIDER_CHECK, name="ck_geo_provider_events_provider"),
        sa.CheckConstraint(CHANGE_CHECK, name="ck_geo_provider_events_change"),
        sa.UniqueConstraint("provider", "source_id", "change", "occurred_on", name="uq_geo_provider_events_once"),
    )
    op.create_index("ix_geo_provider_events_occurred_on", "geo_provider_events", ["occurred_on"])
    op.add_column("geo_kindergartens", sa.Column("registered_on", sa.Date(), nullable=True))
    op.add_column("geo_dataset_status", sa.Column("baseline_on", sa.Date(), nullable=True))
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset = 'babycare'")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    op.drop_column("geo_dataset_status", "baseline_on")
    op.drop_column("geo_kindergartens", "registered_on")
    op.drop_index("ix_geo_provider_events_occurred_on", table_name="geo_provider_events")
    op.drop_table("geo_provider_events")
    op.drop_index("ix_geo_babycare_lat_lng", table_name="geo_babycare")
    op.drop_table("geo_babycare")
