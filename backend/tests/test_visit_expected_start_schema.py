"""預計入學時間的 migration 與約束（docs/specs/2026-10-15-visit-expected-start-design.md X6）。"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError

from app.booking.models import VisitRequest
from tests.conftest import legacy_request

BACKEND = Path(__file__).resolve().parents[1]
REVISION = "b7e3c1a9d5f2"
# 實作當下 origin/main 的 head；合併前別的 migration 先進 main，就改這裡和 migration 的 down_revision。
DOWN_REVISION = "5c8e1f3a9d27"
MIGRATION = BACKEND / "migrations" / "versions" / f"{REVISION}_visit_expected_start.py"
CHECK = "ck_visit_requests_expected_start"


def _check_sql() -> str:
    [check] = [
        c for c in VisitRequest.__table__.constraints if isinstance(c, CheckConstraint) and c.name == CHECK
    ]
    return str(check.sqltext)


def test_migration_follows_head_without_branching_and_keeps_data():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision(REVISION).down_revision == DOWN_REVISION
    assert script.get_heads() == [REVISION]
    source = MIGRATION.read_text(encoding="utf-8")
    # 只加可空欄位與約束，不改既有資料：與上一版程式相容（deploy/CICD.md）。
    assert "op.execute" not in source and "UPDATE " not in source


def test_check_condition_is_identical_in_model_and_migration():
    source = MIGRATION.read_text(encoding="utf-8")
    assert f'"{CHECK}"' in source
    assert f'"{_check_sql()}"' in source, f"{CHECK} 的條件與 migration 不一致：{_check_sql()}"


@pytest.mark.asyncio
async def test_column_and_constraint_exist(db_session):
    names = set(
        (await db_session.execute(text("SELECT conname FROM pg_constraint WHERE conrelid = 'visit_requests'::regclass"))).scalars()
    )
    assert CHECK in names
    column = (
        await db_session.execute(
            text(
                "SELECT data_type, character_maximum_length, is_nullable FROM information_schema.columns "
                "WHERE table_name = 'visit_requests' AND column_name = 'expected_start'"
            )
        )
    ).one()
    assert tuple(column) == ("character varying", 8, "YES")


@pytest.mark.asyncio
async def test_database_accepts_the_three_kinds_of_value_and_null(db_session):
    # 正向對照：asap、unsure、民國學年-學期（100–199）與空值都寫得進去，下面被擋的才是格式的問題。
    receipt_id = await legacy_request(db_session, status="cancelled")
    for value in ("asap", "unsure", "115-2", "100-1", "199-2", None):
        updated = await db_session.execute(
            text("UPDATE visit_requests SET expected_start = :value WHERE id = :id"), {"value": value, "id": receipt_id}
        )
        assert updated.rowcount == 1, value
    await db_session.rollback()


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["115-3", "115-0", "99-1", "200-1", "soon", "115-2\n", "１１５-2", ""])
async def test_database_rejects_malformed_values(db_session, value):
    receipt_id = await legacy_request(db_session, status="cancelled")
    with pytest.raises(IntegrityError) as blocked:
        await db_session.execute(
            text("UPDATE visit_requests SET expected_start = :value WHERE id = :id"), {"value": value, "id": receipt_id}
        )
    await db_session.rollback()
    assert CHECK in str(blocked.value.orig)
