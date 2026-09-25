"""把仍在發布中的原型示範同意文字換成官網實際顯示的正式文字

Revision ID: 31eb94190b1c
Revises: d5187e753098
Create Date: 2026-09-25

「預約文案」（booking_content）是從原型 fixture 匯入的，同意條款文字是
示範用的「我了解這是操作示範，資料不會傳送給學校，不代表預約成立。」。
官網一直在前端（web/app/utils/public-copy.ts）把這句換成正式文字顯示，
所以家長看到的文字不等於任何已發布的版本。

案件改成記錄同意說明版本（consent_revision_id）之後，家長看到的必須就是
已發布版本的文字，前端的替換拿掉。這支 migration 只在「目前發布中的版本
仍是那句示範文字」時，以官網一直顯示的正式文字建立新版本並發布（新的
site release，其他內容沿用原本的發布版本），家長看到的文字完全不變。
同意文字已經改過、或還沒有發布過預約文案時什麼都不做。

若當時另有比發布版更新的草稿（含送審中的），原本那一版完全不動（送審、排程
照舊，示範文字的版本本來就發布不了）；另外把它複製成最新一版草稿接在新發布
的版本後面，示範同意文字一併換成正式文字，編輯頁打開仍是園方改到一半的內容
（稽核紀錄的 metadata 記 carried_draft_version 與 draft_version）。

downgrade 不回復：新發布的這一版就是舊版官網前端替換後顯示的同一段文字，
退回舊版程式時家長看到的也一樣；發布回示範文字反而可能讓「資料不會傳送給
學校」出現在正式站。
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "31eb94190b1c"
down_revision = "d5187e753098"
branch_labels = None
depends_on = None

DEMO_CONSENT_TEXT = "我了解這是操作示範，資料不會傳送給學校，不代表預約成立。"
FORMAL_CONSENT_TEXT = "我同意園方使用本次填寫的資料聯絡與安排參觀；送出需求後，仍須由園方確認參觀時間。"


def upgrade() -> None:
    conn = op.get_bind()
    state = conn.execute(
        sa.text("SELECT current_release_id FROM site_state WHERE id = 1 FOR UPDATE")
    ).first()
    if state is None or state.current_release_id is None:
        return
    row = conn.execute(
        sa.text(
            """
            SELECT ci.id AS item_id, ci.latest_version, cr.id AS revision_id, cr.version,
                   cr.payload::text AS payload
            FROM content_items ci
            JOIN content_revisions cr ON cr.id = ci.current_published_revision_id
            WHERE ci.kind = 'booking_content' AND ci.campus_key IS NULL
            FOR UPDATE OF ci
            """
        )
    ).mappings().first()
    if row is None:
        return
    payload = json.loads(row["payload"])
    if payload.get("consent_text") != DEMO_CONSENT_TEXT:
        return

    now = datetime.now(timezone.utc)
    new_version = row["latest_version"] + 1
    new_revision_id = uuid.uuid4()
    new_release_id = uuid.uuid4()
    published_payload = {**payload, "consent_text": FORMAL_CONSENT_TEXT}
    _insert_draft(conn, row["item_id"], new_revision_id, new_version, published_payload, now)

    # 比發布版更新的草稿：複製一份接在後面（見檔頭），原本那一版不動。
    carried = None
    if row["latest_version"] != row["version"]:
        draft = conn.execute(
            sa.text(
                "SELECT payload::text AS payload FROM content_revisions "
                "WHERE content_item_id = :item_id AND version = :version"
            ),
            {"item_id": row["item_id"], "version": row["latest_version"]},
        ).mappings().first()
        if draft is not None:
            draft_payload = json.loads(draft["payload"])
            if draft_payload.get("consent_text") == DEMO_CONSENT_TEXT:
                draft_payload["consent_text"] = FORMAL_CONSENT_TEXT
            if draft_payload != published_payload:
                carried = new_version + 1
                _insert_draft(conn, row["item_id"], uuid.uuid4(), carried, draft_payload, now)

    conn.execute(
        sa.text(
            "UPDATE content_items SET latest_version = :version, current_published_revision_id = :rev "
            "WHERE id = :item_id"
        ),
        {"version": carried or new_version, "rev": new_revision_id, "item_id": row["item_id"]},
    )
    conn.execute(
        sa.text("INSERT INTO site_releases (id, created_by, created_at) VALUES (:id, NULL, :now)"),
        {"id": new_release_id, "now": now},
    )
    conn.execute(
        sa.text(
            """
            INSERT INTO site_release_entries (release_id, content_item_id, revision_id)
            SELECT :new_release, content_item_id, revision_id
            FROM site_release_entries
            WHERE release_id = :old_release AND content_item_id <> :item_id
            """
        ),
        {"new_release": new_release_id, "old_release": state.current_release_id, "item_id": row["item_id"]},
    )
    conn.execute(
        sa.text(
            "INSERT INTO site_release_entries (release_id, content_item_id, revision_id) "
            "VALUES (:release, :item_id, :rev)"
        ),
        {"release": new_release_id, "item_id": row["item_id"], "rev": new_revision_id},
    )
    conn.execute(
        sa.text("UPDATE site_state SET current_release_id = :release WHERE id = 1"),
        {"release": new_release_id},
    )
    metadata = {
        "kind": "booking_content",
        "revision_version": new_version,
        "reason": "formal_consent_migration",
    }
    if carried is not None:
        metadata["carried_draft_version"] = row["latest_version"]
        metadata["draft_version"] = carried
    conn.execute(
        sa.text(
            """
            INSERT INTO audit_log_entries (id, actor_user_id, action, target_type, target_id, campus_key, metadata_json, created_at)
            VALUES (:id, NULL, 'content.publish', 'content_item', :target, NULL, CAST(:meta AS json), :now)
            """
        ),
        {"id": uuid.uuid4(), "target": str(row["item_id"]), "meta": json.dumps(metadata), "now": now},
    )


def _insert_draft(conn, item_id, revision_id: uuid.UUID, version: int, payload: dict, now: datetime) -> None:
    # 一般發布（立即發布）也不改 review_status，維持 draft；建立者是系統（NULL）。
    conn.execute(
        sa.text(
            """
            INSERT INTO content_revisions (id, content_item_id, version, payload, created_by, created_at, review_status)
            VALUES (:id, :item_id, :version, CAST(:payload AS json), NULL, :now, 'draft')
            """
        ),
        {
            "id": revision_id,
            "item_id": item_id,
            "version": version,
            "payload": json.dumps(payload, ensure_ascii=False),
            "now": now,
        },
    )


def downgrade() -> None:
    # 見檔頭說明：不把示範文字發布回去。
    pass
