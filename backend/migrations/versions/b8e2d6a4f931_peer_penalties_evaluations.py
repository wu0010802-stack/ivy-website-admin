"""招生區域：幼兒園裁罰明細與評鑑結果兩張表，公開資料狀態多 kindergarten_penalties、kindergarten_evaluations（2026-10-20 規格 §3）

規格：docs/specs/2026-10-20-peer-penalties-evaluations-design.md。
只新增 geo_kindergarten_penalties（含處分種類與對象類別約束、唯一鍵與園所索引）、geo_kindergarten_evaluations（唯一鍵與園所索引）
兩張表，並把 ck_geo_dataset_status_dataset 放寬成多收 'kindergarten_penalties'、'kindergarten_evaluations'；兩個新名稱超過
geo_dataset_status.dataset 原本的 20 字，所以同一支 migration 把這欄放寬到 32 字（PostgreSQL 放寬 varchar 長度不重寫資料表）。
不改既有資料，不需要先備份正式庫。上一版程式不讀新表，也不會寫新的狀態列，先跑 migration 再換程式也相容。
約束條件字串與 app/admissions/geo/models.py 逐字相同（tests/test_geo_schema.py 檢查）。

降級先刪兩個新狀態列（否則還原舊約束與欄寬會失敗），再還原約束與欄寬、刪表。

Revision ID: b8e2d6a4f931
Revises: a3d7f1c9b5e2
Create Date: 2026-10-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b8e2d6a4f931"
down_revision = "a3d7f1c9b5e2"
branch_labels = None
depends_on = None

DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees', 'presale_buildcases', 'kindergarten_penalties', 'kindergarten_evaluations')"
)
PREVIOUS_DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees', 'presale_buildcases')"
)
KIND_CHECK = "kind IN ('fine', 'stop_enrollment', 'reduce_enrollment', 'closure', 'other')"
SUBJECT_CHECK = "subject IS NULL OR subject IN ('operator', 'staff')"


def upgrade() -> None:
    op.create_table(
        "geo_kindergarten_penalties",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("source_id", sa.String(64), nullable=True),
        sa.Column("school_name", sa.String(120), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("doc_no", sa.String(80), nullable=False),
        sa.Column("law", sa.String(160), nullable=False),
        sa.Column("content", sa.String(300), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=True),
        sa.Column("period_start", sa.Date(), nullable=True),
        sa.Column("period_end", sa.Date(), nullable=True),
        sa.Column("punishment_text", sa.String(120), nullable=True),
        sa.Column("subject", sa.String(8), nullable=True),
        sa.Column("punishment_hash", sa.String(16), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(KIND_CHECK, name="ck_geo_kindergarten_penalties_kind"),
        sa.CheckConstraint(SUBJECT_CHECK, name="ck_geo_kindergarten_penalties_subject"),
        sa.UniqueConstraint(
            "school_name", "occurred_on", "doc_no", "law", "punishment_hash", name="uq_geo_kindergarten_penalties_record"
        ),
    )
    op.create_index("ix_geo_kindergarten_penalties_source", "geo_kindergarten_penalties", ["source_id"])
    op.create_table(
        "geo_kindergarten_evaluations",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("source_id", sa.String(64), nullable=False),
        sa.Column("school_name", sa.String(120), nullable=False),
        sa.Column("school_year", sa.SmallInteger(), nullable=False),
        sa.Column("completed_on", sa.Date(), nullable=True),
        sa.Column("result", sa.String(100), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("school_name", "school_year", "result", name="uq_geo_kindergarten_evaluations_record"),
    )
    op.create_index("ix_geo_kindergarten_evaluations_source", "geo_kindergarten_evaluations", ["source_id"])
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.alter_column(
        "geo_dataset_status", "dataset", existing_type=sa.String(20), type_=sa.String(32), existing_nullable=False
    )
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset IN ('kindergarten_penalties', 'kindergarten_evaluations')")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.alter_column(
        "geo_dataset_status", "dataset", existing_type=sa.String(32), type_=sa.String(20), existing_nullable=False
    )
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    op.drop_index("ix_geo_kindergarten_evaluations_source", table_name="geo_kindergarten_evaluations")
    op.drop_table("geo_kindergarten_evaluations")
    op.drop_index("ix_geo_kindergarten_penalties_source", table_name="geo_kindergarten_penalties")
    op.drop_table("geo_kindergarten_penalties")
