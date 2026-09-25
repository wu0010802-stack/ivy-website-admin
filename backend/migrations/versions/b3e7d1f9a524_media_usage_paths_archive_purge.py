"""素材庫：引用記錄版本與欄位路徑、封存、待清理、影片時長

Revision ID: b3e7d1f9a524
Revises: a6d2e8f4c135
Create Date: 2026-09-25

1. `media_assets.duration_seconds`：影片時長（ffprobe），既有資料為 NULL。
2. `media_assets.archived_at`：封存時間；`deleted_at`：刪除（標記待清理）時間，
   定期工作過了保留天數才真的刪檔。都是新的 nullable 欄位，既有素材維持原狀。
3. `media_usages.content_kind`／`revision_id`，`field_name` 改存欄位路徑
   （例如 `articles[2].image`）。舊資料的 `field_name` 存的其實是內容種類：
   先搬到 `content_kind`，再依各內容項最新一版的內容重建引用（欄位路徑、
   版本）。這裡的路徑規則是 2026-09-25 當下 registry 的複本，刻意不 import
   app 程式碼——之後 registry 改了也不會讓這個 migration 的結果跟著變。
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op

revision = "b3e7d1f9a524"
down_revision = "a6d2e8f4c135"
branch_labels = None
depends_on = None


def _uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError):
        return None


def _paths(kind: str, payload: dict) -> list[tuple[uuid.UUID, str]]:
    refs: list[tuple[uuid.UUID | None, str]] = []
    if kind == "campus_tour":
        for i, scene in enumerate(payload.get("scenes", []) or []):
            if isinstance(scene, dict):
                refs.append((_uuid(scene.get("image")), f"scenes[{i}].image"))
    elif kind in ("home_news", "campus_news"):
        for i, article in enumerate(payload.get("articles", []) or []):
            if not isinstance(article, dict):
                continue
            refs.append((_uuid(article.get("image")), f"articles[{i}].image"))
            for j, block in enumerate(article.get("body", []) or []):
                if isinstance(block, dict) and block.get("type") == "image":
                    refs.append((_uuid(block.get("image")), f"articles[{i}].body[{j}].image"))
    elif kind == "site_meta":
        refs.append((_uuid(payload.get("share_image")), "share_image"))
    return [(media_id, path) for media_id, path in refs if media_id is not None]


def upgrade() -> None:
    op.add_column("media_assets", sa.Column("duration_seconds", sa.Float(), nullable=True))
    op.add_column("media_assets", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("media_assets", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_media_assets_deleted_at", "media_assets", ["deleted_at"])

    op.add_column("media_usages", sa.Column("content_kind", sa.String(64), nullable=True))
    op.add_column("media_usages", sa.Column("revision_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_media_usages_revision_id",
        "media_usages",
        "content_revisions",
        ["revision_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_media_usages_revision_id", "media_usages", ["revision_id"])

    _backfill_usages(op.get_bind())


def _backfill_usages(bind: sa.engine.Connection) -> None:
    """舊的 field_name 存的是內容種類；依各內容項最新一版重建（測試直接呼叫）。"""
    bind.execute(sa.text("UPDATE media_usages SET content_kind = field_name WHERE content_kind IS NULL"))
    rows = bind.execute(
        sa.text(
            """
            SELECT i.id, i.kind, i.campus_key, r.id AS revision_id, r.payload
            FROM content_items i
            JOIN content_revisions r ON r.content_item_id = i.id AND r.version = i.latest_version
            WHERE i.id::text IN (SELECT DISTINCT content_item_id FROM media_usages)
            """
        )
    ).all()
    existing = set(bind.execute(sa.text("SELECT id FROM media_assets")).scalars().all())
    now = datetime.now(timezone.utc)
    for item_id, kind, campus_key, revision_id, payload in rows:
        if isinstance(payload, str):
            payload = json.loads(payload)
        refs = _paths(kind, payload if isinstance(payload, dict) else {})
        bind.execute(
            sa.text("DELETE FROM media_usages WHERE content_item_id = :item"), {"item": str(item_id)}
        )
        for media_id, path in refs:
            if media_id not in existing:
                continue
            bind.execute(
                sa.text(
                    """
                    INSERT INTO media_usages
                        (id, media_id, campus_key, content_item_id, content_kind, revision_id, field_name, created_at)
                    VALUES (:id, :media_id, :campus_key, :item, :kind, :revision_id, :path, :now)
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "media_id": media_id,
                    "campus_key": campus_key,
                    "item": str(item_id),
                    "kind": kind,
                    "revision_id": revision_id,
                    "path": path,
                    "now": now,
                },
            )


def downgrade() -> None:
    # 舊版程式以 field_name＝內容種類整批刪除重建，先改回種類再刪欄位。
    op.execute("UPDATE media_usages SET field_name = content_kind WHERE content_kind IS NOT NULL")
    op.drop_index("ix_media_usages_revision_id", table_name="media_usages")
    op.drop_constraint("fk_media_usages_revision_id", "media_usages", type_="foreignkey")
    op.drop_column("media_usages", "revision_id")
    op.drop_column("media_usages", "content_kind")
    op.drop_index("ix_media_assets_deleted_at", table_name="media_assets")
    op.drop_column("media_assets", "deleted_at")
    op.drop_column("media_assets", "archived_at")
    op.drop_column("media_assets", "duration_seconds")
