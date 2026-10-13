"""場次使用情況：slot_lookup_daily 的 migration 與約束（2026-10-13 規格 §2.1）。"""

from __future__ import annotations

import uuid
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError

from app.booking.models import LOOKUP_BUCKETS, SlotLookupDaily

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "migrations" / "versions" / "b4d7e1a92c58_slot_lookup_daily.py"


def test_migration_follows_population_head_and_only_adds_a_table():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("b4d7e1a92c58").down_revision == "f3c8a2d47b19"
    assert len(script.get_heads()) == 1
    upgrade = MIGRATION.read_text(encoding="utf-8").split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "op.execute" not in upgrade and "UPDATE " not in upgrade and "add_column" not in upgrade


def test_bucket_check_constraint_matches_model_and_migration():
    checks = {c.name: str(c.sqltext) for c in SlotLookupDaily.__table__.constraints if isinstance(c, CheckConstraint)}
    assert set(checks) == {"ck_slot_lookup_daily_bucket"}
    condition = checks["ck_slot_lookup_daily_bucket"]
    assert all(f"'{bucket}'" in condition for bucket in LOOKUP_BUCKETS)
    assert condition in MIGRATION.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_unique_bucket_and_check_are_enforced(db_session):
    def row(bucket: str, lookups: int = 1) -> SlotLookupDaily:
        return SlotLookupDaily(id=uuid.uuid4(), day=date(2026, 10, 13), campus_key="yihua", bucket=bucket, lookups=lookups)

    db_session.add(row("within_1"))
    await db_session.commit()
    db_session.add(row("within_1"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
    db_session.add(row("tomorrow"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
    assert await db_session.scalar(text("SELECT count(*) FROM slot_lookup_daily")) == 1
