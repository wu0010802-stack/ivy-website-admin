"""招生訪視照園方紙本「幼兒基本資料」補欄位：英文名字、父親職業、母親職業（官網延伸，
園務沒有）；聯絡紀錄的方式加「再參觀」（revisit）。

升級只新增可空欄位、放寬 CHECK，不改既有資料（既有聯絡紀錄都在舊的四種方式內）；
上一版程式不讀新欄位、也不會寫 revisit，先跑 migration 再換程式也相容。
CHANNEL_CHECK 與 app/admissions/models.py 逐字相同（tests/test_admissions_follow_up_schema.py 檢查）。

降級把 revisit 改回最接近的「當面」（in_person）才能恢復舊的 CHECK；新欄位直接刪掉。

Revision ID: 3fe1cfb2dbf7
Revises: 1e5612e187ff
Create Date: 2026-10-05
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "3fe1cfb2dbf7"
down_revision = "1e5612e187ff"
branch_labels = None
depends_on = None

CHANNEL_CHECK = "channel IN ('phone', 'line', 'in_person', 'revisit', 'other')"
OLD_CHANNEL_CHECK = "channel IN ('phone', 'line', 'in_person', 'other')"


def upgrade() -> None:
    op.add_column("recruitment_visits", sa.Column("english_name", sa.String(50), nullable=True))
    op.add_column("recruitment_visits", sa.Column("father_occupation", sa.String(50), nullable=True))
    op.add_column("recruitment_visits", sa.Column("mother_occupation", sa.String(50), nullable=True))
    op.drop_constraint("ck_recruitment_contact_logs_channel", "recruitment_contact_logs", type_="check")
    op.create_check_constraint("ck_recruitment_contact_logs_channel", "recruitment_contact_logs", CHANNEL_CHECK)


def downgrade() -> None:
    op.execute("UPDATE recruitment_contact_logs SET channel = 'in_person' WHERE channel = 'revisit'")
    op.drop_constraint("ck_recruitment_contact_logs_channel", "recruitment_contact_logs", type_="check")
    op.create_check_constraint("ck_recruitment_contact_logs_channel", "recruitment_contact_logs", OLD_CHANNEL_CHECK)
    op.drop_column("recruitment_visits", "mother_occupation")
    op.drop_column("recruitment_visits", "father_occupation")
    op.drop_column("recruitment_visits", "english_name")
