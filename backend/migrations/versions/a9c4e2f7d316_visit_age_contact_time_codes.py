"""參觀案件的孩子年齡、方便聯絡時段改存固定代碼（規格 190）。

既有案件存的是官網表單的中文標籤，逐一換成代碼；認不得的值保留原樣
（後台照原字顯示），不猜。

Revision ID: a9c4e2f7d316
Revises: f2b8d6a1c953
Create Date: 2026-09-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a9c4e2f7d316"
down_revision = "f2b8d6a1c953"
branch_labels = None
depends_on = None

AGE = {
    "尚未確定": "unknown",
    "2 歲以下": "under_2",
    "2–3 歲": "2-3",
    "3–4 歲": "3-4",
    "4–5 歲": "4-5",
    "5–6 歲": "5-6",
}
CONTACT_TIME = {
    "時間彈性": "flexible",
    "平日上午": "weekday_morning",
    "平日下午": "weekday_afternoon",
    "其他，另行確認": "other",
}


def _convert(column: str, mapping: dict[str, str]) -> None:
    table = sa.table("visit_requests", sa.column(column, sa.String))
    for label, code in mapping.items():
        op.execute(table.update().where(table.c[column] == label).values({column: code}))


def _revert(column: str, mapping: dict[str, str]) -> None:
    table = sa.table("visit_requests", sa.column(column, sa.String))
    for label, code in mapping.items():
        op.execute(table.update().where(table.c[column] == code).values({column: label}))


def upgrade() -> None:
    _convert("age", AGE)
    _convert("preferred_time", CONTACT_TIME)


def downgrade() -> None:
    _revert("age", AGE)
    _revert("preferred_time", CONTACT_TIME)
