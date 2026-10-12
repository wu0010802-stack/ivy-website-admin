"""聯絡片語：新增 contact_phrase_sets 並插入預設 6 句（2026-10-12 規格 4.2）

規格：docs/specs/2026-10-12-admin-batch-design.md 第 4.2 節。
只新增一張表、插入 key='default' 一列，不改既有資料，不需要先備份正式庫；上一版程式不讀
這張表，先跑 migration 再換程式也相容。預設片語的字面值寫死在本檔（不 import 應用程式碼，
日後改 app/contact_phrases/service.py 的常數不會悄悄改到已經跑過的 migration），
tests/test_contact_phrases.py 比對兩邊文字一致。

Revision ID: ad783510900a
Revises: e7a1c4d9b2f6
Create Date: 2026-10-12
"""
from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "ad783510900a"
down_revision = "e7a1c4d9b2f6"
branch_labels = None
depends_on = None

DEFAULT_PHRASES = [
    "已致電，家長沒接",
    "已致電，轉語音信箱",
    "已加 LINE，等家長回覆",
    "家長考慮中，約好再聯絡",
    "家長已決定就讀",
    "家長暫不考慮",
]


def _seed_default(connection) -> None:
    # ON CONFLICT：重跑或程式已先建立這一列時不報錯、不覆蓋人改過的內容。
    connection.execute(
        sa.text(
            "INSERT INTO contact_phrase_sets (key, phrases, version) "
            "VALUES ('default', CAST(:phrases AS json), 1) ON CONFLICT (key) DO NOTHING"
        ),
        {"phrases": json.dumps(DEFAULT_PHRASES, ensure_ascii=False)},
    )


def upgrade() -> None:
    op.create_table(
        "contact_phrase_sets",
        sa.Column("key", sa.String(length=16), primary_key=True),
        sa.Column("phrases", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    _seed_default(op.get_bind())


def downgrade() -> None:
    op.drop_table("contact_phrase_sets")
