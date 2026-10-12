"""刪除 reschedule_requests 資料表

Revision ID: e48a3ccedcd8
Revises: 304dd12e96bc
Create Date: 2026-10-08

2026-10-08 家長改期申請自 09-30 起停用、沒有程式再建立申請，連同後台核准／
退回刪除；尚未處理的舊申請隨表刪除。

09-30 起家長在修改頁直接選新場次改期，「送出改期申請、等園方核准」的舊流程停用：
公開的 POST /public/visit-manage/reschedule-request 一律回 410，整個後端也沒有任何
地方建立 RescheduleRequest。這次把後台的待核准清單、核准、退回三支端點、model、
儀表板的待核准件數與結案時讓申請失效的程式一併刪掉，表也跟著刪。沒有其他表的
外鍵指向 reschedule_requests。

上一版程式還會在家長管理頁、案件明細、儀表板與結案時讀寫這張表，所以這支
不能和舊映像併存：API 部署是先停舊容器、由新容器啟動時套 migration（見
deploy/CICD.md），舊程式不會對著已刪的表跑；回退時舊映像不認得這個 revision，
只能往前修。這是刪表 migration，合併前先手動備份正式 DB。舊的站內通知、歷程
事件（reschedule_requested／reschedule_rejected／reschedule_superseded）與稽核
紀錄（approve_reschedule／reject_reschedule）是別張表的字串，不受影響，後台標籤
保留給舊紀錄。

downgrade 重建同結構的空表（欄位、型別、外鍵、索引照建表 migration f5583e921dd6，
再加 c8f2d4a6b913 補的 resolved_by 與 reject_reason）；刪除前的申請資料不還原，
程式也不會再讀它。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e48a3ccedcd8"
down_revision = "304dd12e96bc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 索引隨表一起刪；沒有專屬的 enum type（status 是 String(16)）。
    op.drop_table("reschedule_requests")


def downgrade() -> None:
    op.create_table(
        "reschedule_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("visit_request_id", sa.Uuid(), nullable=False),
        sa.Column("requested_slot_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        sa.Column("reject_reason", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(["requested_slot_id"], ["visit_slots.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["visit_request_id"], ["visit_requests.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["resolved_by"], ["users.id"], name="fk_reschedule_requests_resolved_by_users", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_reschedule_requests_visit_request_id"), "reschedule_requests", ["visit_request_id"], unique=False
    )
