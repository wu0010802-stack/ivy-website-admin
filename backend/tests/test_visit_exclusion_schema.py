"""預約案件排除標記的 migration 與約束（docs/specs/2026-10-15-visit-exclusion-design.md §3.1）。"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.booking.models import VisitRequest
from tests.conftest import legacy_request

BACKEND = Path(__file__).resolve().parents[1]
REVISION = "d4a8f2c6e913"
# 排除接在預計入學時間（b7e3c1a9d5f2）之後；合併前別的 migration 先進 main，就改這裡和 migration 的 down_revision。
DOWN_REVISION = "b7e3c1a9d5f2"
MIGRATION = BACKEND / "migrations" / "versions" / f"{REVISION}_visit_exclusion.py"
REASON_CHECK = "ck_visit_requests_exclude_reason"
PAIR_CHECK = "ck_visit_requests_excluded_pair"


def _check_sql(name: str) -> str:
    [check] = [c for c in VisitRequest.__table__.constraints if isinstance(c, CheckConstraint) and c.name == name]
    return str(check.sqltext)


def test_migration_follows_expected_start_without_branching_and_keeps_data():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision(REVISION).down_revision == DOWN_REVISION
    # head 不寫死：之後接在這支後面的 migration（或合併前先進 main 的）不能讓這條轉紅，只要求沒有分叉。
    assert len(script.get_heads()) == 1
    source = MIGRATION.read_text(encoding="utf-8")
    # 只加可空欄位與約束，不改既有資料：與上一版程式相容（deploy/CICD.md）。
    assert "op.execute" not in source and "UPDATE " not in source


@pytest.mark.parametrize("name", [REASON_CHECK, PAIR_CHECK])
def test_check_condition_is_identical_in_model_and_migration(name):
    source = MIGRATION.read_text(encoding="utf-8")
    assert f'"{name}"' in source
    assert f'"{_check_sql(name)}"' in source, f"{name} 的條件與 migration 不一致：{_check_sql(name)}"


@pytest.mark.asyncio
async def test_columns_constraints_and_foreign_key_exist(db_session):
    names = set(
        (await db_session.execute(text("SELECT conname FROM pg_constraint WHERE conrelid = 'visit_requests'::regclass"))).scalars()
    )
    assert {REASON_CHECK, PAIR_CHECK, "fk_visit_requests_excluded_by_users"} <= names
    columns = (
        await db_session.execute(
            text(
                "SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns "
                "WHERE table_name = 'visit_requests' AND column_name IN "
                "('excluded_at', 'excluded_by', 'exclude_reason', 'exclude_note') ORDER BY column_name"
            )
        )
    ).all()
    assert [tuple(c) for c in columns] == [
        ("exclude_note", "character varying", 200, "YES"),
        ("exclude_reason", "character varying", 16, "YES"),
        ("excluded_at", "timestamp with time zone", None, "YES"),
        ("excluded_by", "uuid", None, "YES"),
    ]
    # 帳號刪除時案件留著、只清掉「誰排除的」（ON DELETE SET NULL）。
    delete_rule = (
        await db_session.execute(
            text("SELECT confdeltype::text FROM pg_constraint WHERE conname = 'fk_visit_requests_excluded_by_users'")
        )
    ).scalar_one()
    assert delete_rule == "n"


@pytest.mark.asyncio
async def test_database_accepts_the_three_reasons_and_the_not_excluded_state(db_session):
    # 正向對照：三種原因（excluded_at 同時有值）與「沒排除」都寫得進去，下面被擋的才是約束的問題。
    case_id = await legacy_request(db_session, status="cancelled")
    for reason in ("test", "duplicate", "other"):
        updated = await db_session.execute(
            text("UPDATE visit_requests SET excluded_at = now(), exclude_reason = :reason WHERE id = :id"),
            {"reason": reason, "id": case_id},
        )
        assert updated.rowcount == 1, reason
    cleared = await db_session.execute(
        text("UPDATE visit_requests SET excluded_at = NULL, exclude_reason = NULL, exclude_note = NULL WHERE id = :id"),
        {"id": case_id},
    )
    assert cleared.rowcount == 1
    await db_session.rollback()


@pytest.mark.asyncio
async def test_database_rejects_an_unknown_reason(db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    with pytest.raises(IntegrityError, match=REASON_CHECK):
        await db_session.execute(
            text("UPDATE visit_requests SET excluded_at = now(), exclude_reason = 'spam' WHERE id = :id"), {"id": case_id}
        )
    await db_session.rollback()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "assignment",
    [
        "excluded_at = now()",  # 有時間、沒原因
        "exclude_reason = 'test'",  # 有原因、沒時間
    ],
)
async def test_database_requires_excluded_at_and_reason_together(db_session, assignment):
    case_id = await legacy_request(db_session, status="cancelled")
    with pytest.raises(IntegrityError, match=PAIR_CHECK):
        await db_session.execute(text(f"UPDATE visit_requests SET {assignment} WHERE id = :id"), {"id": case_id})
    await db_session.rollback()


@pytest.mark.asyncio
async def test_database_limits_the_note_to_200_characters(db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    statement = text(
        "UPDATE visit_requests SET excluded_at = now(), exclude_reason = 'other', exclude_note = :note WHERE id = :id"
    )
    assert (await db_session.execute(statement, {"note": "字" * 200, "id": case_id})).rowcount == 1
    with pytest.raises(DBAPIError, match="value too long"):
        await db_session.execute(statement, {"note": "字" * 201, "id": case_id})
    await db_session.rollback()
