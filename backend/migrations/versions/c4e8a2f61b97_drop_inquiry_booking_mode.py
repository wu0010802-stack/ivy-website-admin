"""預約方式拿掉 inquiry（填表後由園方聯絡）

Revision ID: c4e8a2f61b97
Revises: a3c7e9d1f5b2
Create Date: 2026-10-06

inquiry 是自選場次之前的預約方式：家長填表不選時間，由園方聯絡後排入。2026-10-01
c7d2e9f4a1b8 已把用 inquiry 的校區全部切成 slots 或 paused，之後後台也設不進去
（BOOKING_MODE_RETIRED）；官網讀到殘留設定時當成暫停。2026-10-06 使用者裁定拿掉。

1. 保險起見再把殘留的 INQUIRY 列切成 PAUSED（沒有暫停說明時補預設文案，同
   官網原本的顯示），version 加一讓開著的舊表單重新讀設定。
2. PostgreSQL 的 enum 不能刪值：booking_mode 改名、建新型別、欄位轉過去、刪舊型別。
   booking_configs.mode 沒有 server default，也沒有其他欄位用這個型別。

上一版程式不會寫入 inquiry，讀到的值都還在新型別裡，所以與上一版相容。downgrade
把 INQUIRY 加回型別（排在原本的位置），被切成 PAUSED 的列不還原。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c4e8a2f61b97"
down_revision = "a3c7e9d1f5b2"
branch_labels = None
depends_on = None

_DEFAULT_PAUSED_MESSAGE = "線上預約即將開放，歡迎來電洽詢。"


def _rebuild(values: tuple[str, ...]) -> None:
    labels = ", ".join(f"'{value}'" for value in values)
    op.execute("ALTER TYPE booking_mode RENAME TO booking_mode_old")
    op.execute(f"CREATE TYPE booking_mode AS ENUM ({labels})")
    op.execute("ALTER TABLE booking_configs ALTER COLUMN mode TYPE booking_mode USING mode::text::booking_mode")
    op.execute("DROP TYPE booking_mode_old")


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE booking_configs
            SET mode = 'PAUSED', message = COALESCE(message, :message), version = version + 1, updated_at = now()
            WHERE mode = 'INQUIRY'
            """
        ).bindparams(message=_DEFAULT_PAUSED_MESSAGE)
    )
    _rebuild(("SLOTS", "LINE", "PHONE", "EXTERNAL", "PAUSED"))


def downgrade() -> None:
    _rebuild(("INQUIRY", "SLOTS", "LINE", "PHONE", "EXTERNAL", "PAUSED"))
