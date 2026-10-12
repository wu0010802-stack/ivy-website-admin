"""刪除 site_settings 資料表

Revision ID: 304dd12e96bc
Revises: c4e8a2f61b97
Create Date: 2026-10-08

2026-10-08 site_settings 自 09 月起已無程式讀寫，連同 API 刪除。

舊的「全站設定」單列只被已棄用的 GET／PATCH /admin/site-settings 讀寫，官網與
後端其他地方都不讀它（描述、分享圖與是否允許收錄以 site_meta 內容為唯一來源，
家長同意的版本記在案件的 consent_revision_id），後台也早就沒有畫面呼叫。這次
兩支端點、SiteSettings model 與 `site_settings.manage` 權限一併拿掉，表也跟著刪。

與上一版程式相容：上一版程式只有那兩支沒人呼叫的端點碰這張表，正式環境沒有
其他讀寫它的地方。舊操作紀錄裡的 `site_settings.update` 稽核紀錄是 audit_log_entries
的字串，不受影響，後台標籤保留。

downgrade 重建同結構的空表（欄位、型別、約束照建表 migration ce3082c9bf69，
再加 a8c3e5f7b219 補的 version 欄）；刪除前的單列資料不還原，程式也不會再讀它。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "304dd12e96bc"
down_revision = "c4e8a2f61b97"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("site_settings")


def downgrade() -> None:
    op.create_table(
        "site_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("share_image", sa.String(length=255), nullable=True),
        sa.Column("noindex", sa.Boolean(), nullable=False),
        sa.Column("privacy_policy_version", sa.String(length=32), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.PrimaryKeyConstraint("id"),
    )
