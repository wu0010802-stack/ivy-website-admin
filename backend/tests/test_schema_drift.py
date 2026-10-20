"""模型與 migration 不能各走各的（2026-10-20 效能整理）：測試庫是 `alembic upgrade head` 建的，
拿它跟 Base.metadata 做 autogenerate 比對，模型多了索引卻沒寫 migration（或反過來）都會在這裡紅。"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

import app.main  # noqa: F401  註冊所有模型
from app.booking.models import OutboxMessage, VisitRequestEvent
from app.db import Base

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "migrations" / "versions" / "111d9d36cda7_event_and_outbox_lookup_indexes.py"


@pytest.mark.asyncio
async def test_models_match_migrated_schema(app):
    async with app.state.engine.connect() as connection:
        diff = await connection.run_sync(
            lambda sync: compare_metadata(MigrationContext.configure(sync), Base.metadata)
        )
    assert diff == []


def test_lookup_indexes_are_declared_on_models():
    events = {i.name: [c.name for c in i.columns] for i in VisitRequestEvent.__table__.indexes}
    assert events["ix_visit_request_events_request_type_created"] == ["visit_request_id", "event_type", "created_at"]
    outbox = {i.name: [c.name for c in i.columns] for i in OutboxMessage.__table__.indexes}
    assert outbox["ix_outbox_messages_due"] == ["status", "next_attempt_at"]


def test_index_migration_only_adds_indexes():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("111d9d36cda7").down_revision == "76c4bf84b907"
    upgrade = MIGRATION.read_text(encoding="utf-8").split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "op.execute" not in upgrade and "drop_" not in upgrade and "CONCURRENTLY" not in upgrade
