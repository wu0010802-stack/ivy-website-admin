"""個資匯出改為逐人授權：替目前啟用中的分校管理者補授 booking.export

Revision ID: e5b1c7a9d402
Revises: 9b2b0ebc14ae
Create Date: 2026-09-25

2026-09-25 業主裁定：個資匯出（booking.export）是總管理者逐人授予的
capability（規格 7），不再依角色自動給每一位分校管理者。程式改版後，沒有
明確授權的分校管理者按「匯出 CSV」會被擋。

為了不讓現有分校管理者在部署當下突然失去匯出，這支 migration 只做一次
資料回填：對「目前啟用中的 campus_admin」在 users.capabilities 補上
"booking.export"。已停用的帳號不補——之後重新啟用要由總管理者手動開。
部署之後新建立或改成分校管理者的帳號一律預設沒有，要總管理者在「使用者」
頁逐人打開。

只動資料、不動結構，舊版程式讀到多出來的授權也不受影響（舊版的匯出仍依
角色判斷）。downgrade 把所有人的 booking.export 授權移除，回到依角色判斷。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e5b1c7a9d402"
down_revision = "9b2b0ebc14ae"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 取聯集後排序，與 API 寫入時 sorted(set(...)) 的格式一致；已經有的不重複。
    op.execute(
        sa.text(
            """
            UPDATE users
            SET capabilities = (
                SELECT json_agg(cap ORDER BY cap)
                FROM (
                    SELECT value AS cap FROM json_array_elements_text(users.capabilities)
                    UNION
                    SELECT 'booking.export'
                ) AS caps
            )
            WHERE role = 'CAMPUS_ADMIN'
              AND is_active
              AND json_typeof(capabilities) = 'array'
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE users
            SET capabilities = COALESCE(
                (
                    SELECT json_agg(value ORDER BY value)
                    FROM json_array_elements_text(users.capabilities)
                    WHERE value <> 'booking.export'
                ),
                '[]'::json
            )
            WHERE json_typeof(capabilities) = 'array'
              AND capabilities::jsonb @> '["booking.export"]'::jsonb
            """
        )
    )
