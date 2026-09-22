"""bugfix：email 不分大小寫唯一、共用內容唯一索引、slots 人工確認占位、通知去重

Revision ID: a1c4f7e92b30
Revises: ce3082c9bf69
Create Date: 2026-09-22

這支 migration 對應一次缺陷修復，涵蓋四件事：

1. `users`：加上 lower(email) 的唯一索引。原本只有大小寫敏感的唯一索引，
   `Wang@ivy.tw` 與 `wang@ivy.tw` 可以同時存在，但登入查詢是 lower() 比對，
   兩列同時命中會讓整支登入端點拋 MultipleResultsFound。建索引之前先把
   既有的重複資料停權（保留最早建立的那一筆），否則建索引會直接失敗。
2. `content_items`：Postgres 的 UNIQUE 視每個 NULL 為互異值，所以
   (kind, NULL) 的共用內容完全沒有被原本的唯一約束保護。改成兩個 partial
   unique index。
3. `booking_configs.slots_auto_confirm` 與 `visit_requests.hold_expires_at`：
   規格 197／222 的「人工待確認 + 占位 24 小時」需要的欄位。
4. `notification_deliveries`：outbox 重試時的逐收件人去重。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a1c4f7e92b30"
down_revision = "ce3082c9bf69"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- 1. users: lower(email) 唯一 -------------------------------------
    # 先處理既有的大小寫重複：保留最早建立的那一筆，其餘停權並把 email
    # 改成不會再衝突的封存值，讓唯一索引建得起來。不直接刪除帳號——那會
    # 連帶影響 audit_log_entries 等外鍵引用，也不是 migration 該做的決定。
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id,
                       email,
                       ROW_NUMBER() OVER (
                           PARTITION BY lower(email) ORDER BY created_at, id
                       ) AS rn
                FROM users
            )
            UPDATE users u
            SET email = u.email || '.dup' || ranked.rn::text || '.disabled',
                is_active = false
            FROM ranked
            WHERE u.id = ranked.id AND ranked.rn > 1
            """
        )
    )
    op.create_index(
        "uq_users_email_lower", "users", [sa.text("lower(email)")], unique=True
    )

    # --- 2. content_items: NULL 也要去重 ---------------------------------
    op.drop_constraint("uq_content_item_kind_campus", "content_items", type_="unique")
    op.create_index(
        "uq_content_item_kind_shared",
        "content_items",
        ["kind"],
        unique=True,
        postgresql_where=sa.text("campus_key IS NULL"),
    )
    op.create_index(
        "uq_content_item_kind_campus",
        "content_items",
        ["kind", "campus_key"],
        unique=True,
        postgresql_where=sa.text("campus_key IS NOT NULL"),
    )

    # --- 3. slots 人工確認與占位期限 -------------------------------------
    op.add_column(
        "booking_configs",
        sa.Column(
            "slots_auto_confirm",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "visit_requests",
        sa.Column("hold_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_visit_requests_hold_expires_at"),
        "visit_requests",
        ["hold_expires_at"],
        unique=False,
    )

    # --- 4. 通知去重 ------------------------------------------------------
    op.create_table(
        "notification_deliveries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("outbox_message_id", sa.Uuid(), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("recipient_key", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["outbox_message_id"], ["outbox_messages.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "outbox_message_id", "channel", "recipient_key", name="uq_notification_delivery"
        ),
    )
    op.create_index(
        op.f("ix_notification_deliveries_outbox_message_id"),
        "notification_deliveries",
        ["outbox_message_id"],
        unique=False,
    )


def downgrade() -> None:
    # 注意：upgrade 對重複 email 的資料修改無法自動還原（原始 email 已被
    # 改寫），這一支 downgrade 只還原 schema。
    op.drop_index(
        op.f("ix_notification_deliveries_outbox_message_id"),
        table_name="notification_deliveries",
    )
    op.drop_table("notification_deliveries")

    op.drop_index(op.f("ix_visit_requests_hold_expires_at"), table_name="visit_requests")
    op.drop_column("visit_requests", "hold_expires_at")
    op.drop_column("booking_configs", "slots_auto_confirm")

    op.drop_index("uq_content_item_kind_campus", table_name="content_items")
    op.drop_index("uq_content_item_kind_shared", table_name="content_items")
    op.create_unique_constraint(
        "uq_content_item_kind_campus", "content_items", ["kind", "campus_key"]
    )

    op.drop_index("uq_users_email_lower", table_name="users")
