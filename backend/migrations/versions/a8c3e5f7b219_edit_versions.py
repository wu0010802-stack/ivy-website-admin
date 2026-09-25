"""可同時編輯的資料加 version（樂觀鎖）

Revision ID: a8c3e5f7b219
Revises: e7a3c9d1f482
Create Date: 2026-09-25

計畫 L122：可同時編輯的 command 都要帶 expected_version，不得後寫蓋前寫。
內容與預約設定原本就有；這裡補上：

- `visit_slots.version`：改容量、開關時段（休假日自動關閉／重開也會加一）。
- `visit_requests.version`：承辦人、下次聯絡時間這類可編輯欄位。狀態轉換
  另有列鎖＋狀態機，不靠這個欄位。
- `booking_configs.schedule_version`：每週開放規則與時間窗（PUT
  visit-schedule 整批替換）。跟預約設定的 `version` 分開，兩個畫面互不干擾。
- `site_settings.version`：舊的全站設定（後台已不使用，端點仍保留）。
- `media_assets.version`：素材說明、標籤、焦點等 metadata。

全部是 NOT NULL DEFAULT 1：PostgreSQL 11 起加有常數預設值的欄位不重寫整張表，
既有資料直接視為第 1 版，套在有資料的正式庫也安全。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a8c3e5f7b219"
down_revision = "e7a3c9d1f482"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("visit_slots", "version"),
    ("visit_requests", "version"),
    ("booking_configs", "schedule_version"),
    ("site_settings", "version"),
    ("media_assets", "version"),
)


def upgrade() -> None:
    for table, column in _COLUMNS:
        op.add_column(table, sa.Column(column, sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    for table, column in reversed(_COLUMNS):
        op.drop_column(table, column)
