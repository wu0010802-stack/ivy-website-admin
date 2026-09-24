"""案件歷程記操作人、異動前後與原因；改期申請記處理人與退回原因

Revision ID: c8f2d4a6b913
Revises: e5b1c7a9d402
Create Date: 2026-09-25

規格 L211／L299：改期要增加歷程，VisitHistory 要有操作、異動前後、操作者、
原因。原本 visit_request_events 只有 event_type 與時間，家長問「是誰取消了
我的預約、原本約哪天」時後台查不到。

全部新增為 nullable 欄位、不回填：舊歷程本來就沒有這些資訊，猜不出來的
不假造（畫面上舊紀錄只顯示動作與時間）。正式庫有資料時可以直接套用，
舊版程式讀寫都不受多出來的欄位影響。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c8f2d4a6b913"
down_revision = "e5b1c7a9d402"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "visit_request_events",
        sa.Column(
            "actor_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_visit_request_events_actor_user_id_users"),
            nullable=True,
        ),
    )
    # staff＝後台人員、parent＝家長（官網送單或管理連結）、system＝定期工作。
    op.add_column("visit_request_events", sa.Column("source", sa.String(16), nullable=True))
    op.add_column("visit_request_events", sa.Column("before", sa.JSON(), nullable=True))
    op.add_column("visit_request_events", sa.Column("after", sa.JSON(), nullable=True))
    op.add_column("visit_request_events", sa.Column("reason", sa.String(500), nullable=True))

    op.add_column(
        "reschedule_requests",
        sa.Column(
            "resolved_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_reschedule_requests_resolved_by_users"),
            nullable=True,
        ),
    )
    op.add_column("reschedule_requests", sa.Column("reject_reason", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("reschedule_requests", "reject_reason")
    op.drop_column("reschedule_requests", "resolved_by")
    op.drop_column("visit_request_events", "reason")
    op.drop_column("visit_request_events", "after")
    op.drop_column("visit_request_events", "before")
    op.drop_column("visit_request_events", "source")
    op.drop_column("visit_request_events", "actor_user_id")
