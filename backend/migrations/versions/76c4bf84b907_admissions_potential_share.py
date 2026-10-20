"""招生潛力與市佔率：歷年註冊、每年九月各里年齡、國小一年級人數三張新表，公開資料狀態多一種 elementary（2026-10-20 規格 §3）

規格：docs/specs/2026-10-20-admissions-potential-share-design.md。
新增 campus_term_enrollment（§3.1，園內彙總數字）、geo_village_ages_september（§3.2）、geo_elementary_grade1（§3.3）；
ck_geo_dataset_status_dataset 放寬成多收 'elementary'。只新增表與放寬約束，不改既有資料，不需要先備份正式庫。
上一版程式不讀新表、也不會寫 elementary 狀態列，先跑 migration 再換程式也相容。
約束條件字串與 app/admissions/geo/models.py、app/admissions/history/models.py 逐字相同
（tests/test_geo_schema.py、tests/test_potential_schema.py 檢查）。

降級先刪 elementary 狀態列（否則還原舊約束會失敗），再還原約束、刪三張表；已匯入的歷年註冊與公開資料一併消失。

Revision ID: 76c4bf84b907
Revises: b8e2d6a4f931
Create Date: 2026-10-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "76c4bf84b907"
down_revision = "b8e2d6a4f931"
branch_labels = None
depends_on = None

DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees', 'presale_buildcases', 'kindergarten_penalties', 'kindergarten_evaluations', 'elementary')"
)
PREVIOUS_DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees', 'presale_buildcases', 'kindergarten_penalties', 'kindergarten_evaluations')"
)
GRADE_CHECK = "grade IN ('大班', '中班', '小班', '幼幼班')"
SEMESTER_CHECK = "semester IN (1, 2)"


def upgrade() -> None:
    op.create_table(
        "campus_term_enrollment",
        sa.Column("campus_key", sa.String(16), primary_key=True),
        sa.Column("school_year", sa.Integer(), primary_key=True),
        sa.Column("semester", sa.Integer(), primary_key=True),
        sa.Column("grade", sa.String(4), primary_key=True),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("registered", sa.Integer(), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("target", sa.Integer(), nullable=True),
        sa.Column("returning_enrolled", sa.Integer(), nullable=True),
        sa.Column("returning_deposit", sa.Integer(), nullable=True),
        sa.Column("returning_registered", sa.Integer(), nullable=True),
        sa.Column("new_target", sa.Integer(), nullable=True),
        sa.Column("new_visits", sa.Integer(), nullable=True),
        sa.Column("new_deposits", sa.Integer(), nullable=True),
        sa.Column("new_registered", sa.Integer(), nullable=True),
        sa.Column("repeat_deposit", sa.Integer(), nullable=True),
        sa.Column("repeat_registered", sa.Integer(), nullable=True),
        sa.CheckConstraint(GRADE_CHECK, name="ck_campus_term_enrollment_grade"),
        sa.CheckConstraint(SEMESTER_CHECK, name="ck_campus_term_enrollment_semester"),
    )
    op.create_table(
        "geo_village_ages_september",
        sa.Column("year", sa.Integer(), primary_key=True),
        sa.Column("village_code", sa.String(11), primary_key=True),
        sa.Column("district", sa.String(8), nullable=False),
        sa.Column("village", sa.String(16), nullable=False),
        sa.Column("age_0", sa.Integer(), nullable=False),
        sa.Column("age_1", sa.Integer(), nullable=False),
        sa.Column("age_2", sa.Integer(), nullable=False),
        sa.Column("age_3", sa.Integer(), nullable=False),
        sa.Column("age_4", sa.Integer(), nullable=False),
        sa.Column("age_5", sa.Integer(), nullable=False),
        sa.Column("age_6", sa.Integer(), nullable=False),
        sa.Column("people_total", sa.Integer(), nullable=False),
    )
    op.create_table(
        "geo_elementary_grade1",
        sa.Column("school_year", sa.Integer(), primary_key=True),
        sa.Column("school_code", sa.String(6), primary_key=True),
        sa.Column("grade1", sa.Integer(), nullable=False),
        sa.Column("school_name", sa.String(32), nullable=False),
    )
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset = 'elementary'")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    op.drop_table("geo_elementary_grade1")
    op.drop_table("geo_village_ages_september")
    op.drop_table("campus_term_enrollment")
