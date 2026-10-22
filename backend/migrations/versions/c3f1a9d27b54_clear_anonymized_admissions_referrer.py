"""清掉已匿名化招生訪視留著的「家長介紹」（2026-10-22 資安稽核）

家長介紹（recruitment_visits.referrer）原本列在匿名化要保留的統計欄位，但表單請人員填
「哪位家長介紹來的，例如：王小美媽媽」，是第三人的姓名，統計也沒用到。這一版起匿名化會清它
（admissions/retention.py）；之前已匿名化的列在這裡一次補清，不依賴保存政策有沒有設天數、
部署有沒有開放真正清理。version 加一：開著舊畫面的人存檔會收到 409，不會把它寫回去。

只改資料、不動欄位。清掉的是已依保存政策匿名化的個資，降級不還原（也無從還原）。

Revision ID: c3f1a9d27b54
Revises: 111d9d36cda7
Create Date: 2026-10-22
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c3f1a9d27b54"
down_revision = "111d9d36cda7"
branch_labels = None
depends_on = None


def _clear_referrers(connection) -> int:
    result = connection.execute(
        sa.text(
            "UPDATE recruitment_visits SET referrer = NULL, version = version + 1 "
            "WHERE anonymized_at IS NOT NULL AND referrer IS NOT NULL"
        )
    )
    return result.rowcount


def upgrade() -> None:
    _clear_referrers(op.get_bind())


def downgrade() -> None:
    pass
