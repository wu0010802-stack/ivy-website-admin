"""內容發布流程：欄位規則版本、審核狀態約束、發布來源、個人站內通知

Revision ID: a6d2e8f4c135
Revises: f3a9c5d71e28
Create Date: 2026-09-25

1. `content_revisions.schema_version`：存檔當下的欄位規則版本。既有版本一律
   記為 1（NOT NULL＋server_default，套在有資料的表上不必另外回填）。
2. 審核狀態多一個 `superseded`（送審後又存了新版、或已發布較新的版本）。先把
   已經過時的待審版改掉——不是最新版的改成 superseded、就是官網上那一版的改成
   approved——再加 CHECK 約束。加約束前先確認沒有不認得的值，有的話停下來。
3. `content_items.published_at`：官網版本最近一次換掉的時間，從發布紀錄回填
   （官網上那一版第一次出現在 release 的時間）。
4. `site_releases.source`／`restored_from_release_id`：這次發布怎麼來的，舊資料
   為 NULL；`created_at` 加索引給發布紀錄分頁。
5. `user_notifications`：給特定一個人的站內通知（內容送審、核准或退回、排程
   沒有執行）。新表，不動既有的校區通知。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a6d2e8f4c135"
down_revision = "f3a9c5d71e28"
branch_labels = None
depends_on = None

_REVIEW_STATUSES = ("draft", "pending_review", "approved", "rejected", "superseded")


def upgrade() -> None:
    op.add_column(
        "content_revisions",
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
    )

    bind = op.get_bind()
    allowed = ", ".join(f"'{value}'" for value in _REVIEW_STATUSES)
    unknown = bind.execute(
        sa.text(f"SELECT DISTINCT review_status FROM content_revisions WHERE review_status NOT IN ({allowed})")
    ).scalars().all()
    if unknown:
        raise RuntimeError(
            f"content_revisions.review_status 有無法辨識的值 {unknown}，請先人工確認後再套用這個 migration"
        )
    # 直接發布了正在待審的那一版：等於已核准。
    op.execute(
        """
        UPDATE content_revisions r SET review_status = 'approved'
        FROM content_items i
        WHERE r.content_item_id = i.id AND r.review_status = 'pending_review'
          AND i.current_published_revision_id = r.id
        """
    )
    # 送審之後又存了新版、或官網已經是更新的版本：舊的待審版不會再被審。
    op.execute(
        """
        UPDATE content_revisions r SET review_status = 'superseded'
        FROM content_items i
        LEFT JOIN content_revisions live ON live.id = i.current_published_revision_id
        WHERE r.content_item_id = i.id AND r.review_status = 'pending_review'
          AND (r.version < i.latest_version OR r.version < COALESCE(live.version, 0))
        """
    )
    op.create_check_constraint(
        "ck_content_revisions_review_status", "content_revisions", f"review_status IN ({allowed})"
    )

    op.add_column("content_items", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        """
        UPDATE content_items i SET published_at = (
          SELECT min(s.created_at) FROM site_release_entries e
          JOIN site_releases s ON s.id = e.release_id
          WHERE e.content_item_id = i.id AND e.revision_id = i.current_published_revision_id
        )
        WHERE i.current_published_revision_id IS NOT NULL
        """
    )

    op.add_column("site_releases", sa.Column("source", sa.String(length=24), nullable=True))
    op.add_column(
        "site_releases",
        sa.Column(
            "restored_from_release_id",
            sa.Uuid(),
            sa.ForeignKey("site_releases.id", ondelete="SET NULL", name="fk_site_releases_restored_from"),
            nullable=True,
        ),
    )
    op.create_index("ix_site_releases_created_at", "site_releases", ["created_at"])

    op.create_table(
        "user_notifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "recipient_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column(
            "content_item_id", sa.Uuid(), sa.ForeignKey("content_items.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="CASCADE"), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_user_notifications_recipient_user_id", "user_notifications", ["recipient_user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_notifications_recipient_user_id", table_name="user_notifications")
    op.drop_table("user_notifications")
    op.drop_index("ix_site_releases_created_at", table_name="site_releases")
    op.drop_constraint("fk_site_releases_restored_from", "site_releases", type_="foreignkey")
    op.drop_column("site_releases", "restored_from_release_id")
    op.drop_column("site_releases", "source")
    op.drop_column("content_items", "published_at")
    op.drop_constraint("ck_content_revisions_review_status", "content_revisions", type_="check")
    # 舊程式不認得 superseded；已被取代的待審版本來就不該再審，退回成草稿。
    op.execute("UPDATE content_revisions SET review_status = 'draft' WHERE review_status = 'superseded'")
    # 舊程式沒有 skipped：到期略過的排程當成失敗顯示（原因文字仍在）。
    op.execute("UPDATE publish_jobs SET status = 'failed' WHERE status = 'skipped'")
    op.drop_column("content_revisions", "schema_version")
