"""家長自選場次（2026-09-30 業主裁定）：退場「填表待聯絡」、全面送出即成立、案件記取消原因。

資料改寫：
- booking_configs：mode=INQUIRY 的分校，有每週規則或未來可預約場次 → SLOTS，否則 → PAUSED
  （沒有暫停說明時填預設文案）；所有列 slots_auto_confirm=true；有改動的列 version+1，
  讓還開著舊表單的家長送出時收到 BOOKING_CONFIG_CHANGED。每一校的模式切換寫一筆稽核。
- visit_requests.cancel_reason：從歷程回填（hold_expired → hold_expired；cancelled 依 source）。

downgrade 只移除 cancel_reason，不把模式改回 inquiry。
"""

from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from alembic import op

revision = "c7d2e9f4a1b8"
down_revision = "e9c3a7d5f214"
branch_labels = None
depends_on = None

PAUSED_MESSAGE = "線上預約即將開放，歡迎來電洽詢。"


def backfill_cancel_reasons(conn) -> None:
    conn.execute(
        sa.text(
            """
            UPDATE visit_requests AS vr
            SET cancel_reason = CASE
                WHEN e.event_type = 'hold_expired' THEN 'hold_expired'
                WHEN e.source = 'parent' THEN 'parent'
                WHEN e.source = 'staff' THEN 'staff'
                ELSE NULL
            END
            FROM (
                SELECT DISTINCT ON (visit_request_id) visit_request_id, event_type, source
                FROM visit_request_events
                WHERE event_type IN ('cancelled', 'hold_expired')
                ORDER BY visit_request_id, created_at DESC
            ) AS e
            WHERE vr.id = e.visit_request_id AND vr.status = 'cancelled'
            """
        )
    )


def migrate_booking_modes(conn) -> list[dict]:
    # booking_mode 是 native enum，存的是大寫名稱。
    rows = conn.execute(
        sa.text("SELECT campus_key, message FROM booking_configs WHERE mode = 'INQUIRY' ORDER BY campus_key")
    ).mappings().all()
    changes: list[dict] = []
    for row in rows:
        has_schedule = conn.execute(
            sa.text(
                """
                SELECT EXISTS (SELECT 1 FROM visit_rules WHERE campus_key = :key)
                    OR EXISTS (
                        SELECT 1 FROM visit_slots
                        WHERE campus_key = :key AND closed = false
                          AND slot_date >= (now() AT TIME ZONE 'Asia/Taipei')::date
                    )
                """
            ),
            {"key": row["campus_key"]},
        ).scalar()
        target = "slots" if has_schedule else "paused"
        message = row["message"]
        if target == "paused" and not (message or "").strip():
            message = PAUSED_MESSAGE
        conn.execute(
            sa.text(
                """
                UPDATE booking_configs
                SET mode = CAST(:mode AS booking_mode), message = :message, updated_at = now()
                WHERE campus_key = :key
                """
            ),
            {"mode": target.upper(), "message": message, "key": row["campus_key"]},
        )
        conn.execute(
            sa.text(
                """
                INSERT INTO audit_log_entries
                    (id, actor_user_id, action, target_type, target_id, campus_key, metadata_json, created_at)
                VALUES
                    (:id, NULL, 'booking_config.migrate_self_booking', 'booking_config', :key, :key,
                     CAST(:metadata AS JSON), now())
                """
            ),
            {
                "id": uuid.uuid4(),
                "key": row["campus_key"],
                "metadata": json.dumps({"before": {"mode": "inquiry"}, "after": {"mode": target}}),
            },
        )
        changes.append({"campus_key": row["campus_key"], "mode": target})
    conn.execute(
        sa.text(
            """
            UPDATE booking_configs
            SET slots_auto_confirm = true, version = version + 1, updated_at = now()
            WHERE slots_auto_confirm = false OR campus_key = ANY(CAST(:changed AS text[]))
            """
        ),
        {"changed": [c["campus_key"] for c in changes]},
    )
    return changes


def upgrade() -> None:
    op.add_column("visit_requests", sa.Column("cancel_reason", sa.String(16), nullable=True))
    op.create_check_constraint(
        "ck_visit_requests_cancel_reason",
        "visit_requests",
        "cancel_reason IS NULL OR cancel_reason IN ('parent', 'staff', 'hold_expired')",
    )
    bind = op.get_bind()
    backfill_cancel_reasons(bind)
    migrate_booking_modes(bind)


def downgrade() -> None:
    op.drop_constraint("ck_visit_requests_cancel_reason", "visit_requests", type_="check")
    op.drop_column("visit_requests", "cancel_reason")
