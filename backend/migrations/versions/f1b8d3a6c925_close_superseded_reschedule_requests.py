"""家長改期申請：園方已直接改期的待核准申請標成失效

Revision ID: f1b8d3a6c925
Revises: b5d9f1a3c742
Create Date: 2026-09-26

B02 審查意見：園方在案件頁直接改期時，家長先前還在等核准的線上申請沒有
跟著失效；之後有人按核准，會把案件搬回家長當初申請的時段，蓋掉園方電話裡
談好的時間。程式改版後，直接改期會在同一個交易把申請標成 closed，並記一筆
`reschedule_superseded` 歷程。

這支只做一次資料修補：正式庫裡「送出之後案件又被園方直接改期過」卻仍是
pending 的申請，標成 closed，resolved_at／resolved_by 記那一次改期的時間與
操作人，並補一筆同樣格式的歷程。核准申請會在同一個交易把它標成 approved，
所以 pending 申請之後出現的 rescheduled 事件只可能來自園方直接改期。

只動資料、不動結構，舊版程式讀到 closed 的申請與新的歷程類型也照常運作。
downgrade 不還原資料：分不出哪些是這支改的，改回 pending 又會讓已失效的
申請可以被核准。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f1b8d3a6c925"
down_revision = "b5d9f1a3c742"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # WITH 裡的 INSERT 不論主查詢有沒有讀它都會執行一次；兩個動作在同一個
    # 語句，看到的是同一批 pending 申請。時段格式與 history.slot_brief 一致。
    op.execute(
        sa.text(
            """
            WITH superseded AS (
                SELECT DISTINCT ON (rr.id)
                       rr.id, rr.visit_request_id, rr.requested_slot_id,
                       e.created_at AS superseded_at, e.actor_user_id, e.source
                FROM reschedule_requests rr
                JOIN visit_request_events e
                  ON e.visit_request_id = rr.visit_request_id
                 AND e.event_type = 'rescheduled'
                 AND e.created_at > rr.created_at
                WHERE rr.status = 'pending'
                ORDER BY rr.id, e.created_at
            ), history AS (
                INSERT INTO visit_request_events
                    (id, visit_request_id, event_type, created_at, actor_user_id, source, after)
                SELECT gen_random_uuid(), s.visit_request_id, 'reschedule_superseded',
                       s.superseded_at, s.actor_user_id, s.source,
                       json_build_object('requested_slot', json_build_object(
                           'id', vs.id::text,
                           'slot_date', to_char(vs.slot_date, 'YYYY-MM-DD'),
                           'start_time', vs.start_time::text,
                           'end_time', vs.end_time::text
                       ))
                FROM superseded s
                JOIN visit_slots vs ON vs.id = s.requested_slot_id
            )
            UPDATE reschedule_requests rr
            SET status = 'closed', resolved_at = s.superseded_at, resolved_by = s.actor_user_id
            FROM superseded s
            WHERE rr.id = s.id
            """
        )
    )


def downgrade() -> None:
    # 見檔頭：資料修補不還原。
    pass
