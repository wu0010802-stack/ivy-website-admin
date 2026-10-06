"""參觀後追蹤的 migration 與約束（2026-10-04 規格 5.1、5.2）。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError

from app.admissions.models import RecruitmentContactLog, RecruitmentVisit

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "migrations" / "versions" / "b8e3f1a6c4d7_admissions_follow_up.py"
# 2026-10-05 聯絡方式加「再參觀」，CHECK 改由這支重建。
PAPER_FIELDS_MIGRATION = BACKEND / "migrations" / "versions" / "3fe1cfb2dbf7_admissions_paper_form_fields.py"


def _checks(model) -> dict[str, str]:
    return {c.name: str(c.sqltext) for c in model.__table__.constraints if isinstance(c, CheckConstraint)}


def test_migration_follows_password_reset_without_branching():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("b8e3f1a6c4d7").down_revision == "d2b7f4c9e1a3"
    assert len(script.get_heads()) == 1
    source = MIGRATION.read_text(encoding="utf-8")
    # 只加可空欄位、約束與新表，不改既有資料（deploy/CICD.md）。
    assert "op.execute" not in source and "UPDATE " not in source


def test_check_conditions_are_identical_in_model_and_migration():
    """每個 CHECK 的條件要和最後一支建立它的 migration 逐字相同。"""
    conditions = {
        "ck_recruitment_visits_follow_up_open": _checks(RecruitmentVisit)["ck_recruitment_visits_follow_up_open"],
        **_checks(RecruitmentContactLog),
    }
    assert set(conditions) == {"ck_recruitment_visits_follow_up_open", "ck_recruitment_contact_logs_channel"}
    latest = {
        "ck_recruitment_visits_follow_up_open": MIGRATION,
        "ck_recruitment_contact_logs_channel": PAPER_FIELDS_MIGRATION,
    }
    for name, condition in conditions.items():
        source = latest[name].read_text(encoding="utf-8")
        assert f'"{name}"' in source, name
        assert f'"{condition}"' in source, f"{name} 的條件與 migration 不一致：{condition}"


def test_paper_fields_migration_follows_legacy_pending_cleanup_and_keeps_data_on_upgrade():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("3fe1cfb2dbf7").down_revision == "1e5612e187ff"
    # 2026-10-06 之後接了 d65fa082ff87（收掉舊預約流程殘留資料）與 e870893fac95（拿掉舊欄位、
    # 加狀態約束），仍只有一個 head。
    assert script.get_revision("d65fa082ff87").down_revision == "3fe1cfb2dbf7"
    assert script.get_revision("e870893fac95").down_revision == "d65fa082ff87"
    assert script.get_heads() == ["e870893fac95"]
    upgrade = PAPER_FIELDS_MIGRATION.read_text(encoding="utf-8").split("def downgrade", 1)[0]
    # 升級只加可空欄位、放寬 CHECK，不改既有資料（deploy/CICD.md）；降級才把 revisit 改回 in_person。
    assert "op.execute" not in upgrade and "UPDATE " not in upgrade


@pytest.mark.asyncio
async def test_columns_constraints_and_partial_index_exist(app):
    async with app.state.engine.connect() as conn:
        columns = {
            (table, column): (kind, nullable)
            for table, column, kind, nullable in (
                await conn.execute(
                    text(
                        "SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns "
                        "WHERE table_name IN ('recruitment_visits', 'recruitment_contact_logs')"
                    )
                )
            ).all()
        }
        constraints = set(
            (
                await conn.execute(
                    text(
                        "SELECT conname FROM pg_constraint WHERE conrelid IN "
                        "('recruitment_visits'::regclass, 'recruitment_contact_logs'::regclass)"
                    )
                )
            ).scalars()
        )
        index = (
            await conn.execute(
                text("SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_recruitment_visits_campus_follow_up'")
            )
        ).scalar_one()
    for column in RecruitmentContactLog.__table__.columns:
        assert ("recruitment_contact_logs", column.name) in columns, column.name
    assert columns[("recruitment_visits", "follow_up_at")] == ("timestamp with time zone", "YES")
    assert columns[("recruitment_visits", "follow_up_owner_id")] == ("uuid", "YES")
    assert columns[("recruitment_visits", "last_contacted_at")] == ("timestamp with time zone", "YES")
    assert columns[("recruitment_contact_logs", "reached")] == ("boolean", "NO")
    assert columns[("recruitment_contact_logs", "note")] == ("text", "YES")
    assert {
        "ck_recruitment_visits_follow_up_open",
        "fk_recruitment_visits_follow_up_owner_id_users",
        "ck_recruitment_contact_logs_channel",
    } <= constraints
    assert "WHERE (anonymized_at IS NULL)" in index


def _visit(**overrides) -> RecruitmentVisit:
    now = datetime.now(timezone.utc)
    values = {
        "id": uuid.uuid4(),
        "campus_key": "yihua",
        "month": "115.09",
        "visit_date": date(2026, 9, 8),
        "child_name": "王小明",
        "created_at": now,
        "updated_at": now,
        "follow_up_at": now,
        **overrides,
    }
    return RecruitmentVisit(**values)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"enrolled": True, "enrolled_on": date(2026, 9, 10)},
        {"withdrawn_at": datetime(2026, 9, 10, tzinfo=timezone.utc), "withdrawn_from": "deposited"},
        {"anonymized_at": datetime(2026, 9, 10, tzinfo=timezone.utc)},
    ],
    ids=["enrolled", "withdrawn", "anonymized"],
)
async def test_closed_visits_cannot_have_follow_up(db_session, overrides):
    db_session.add(_visit(**overrides))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_open_visit_with_follow_up_and_contact_channel(db_session):
    visit = _visit(has_deposit=True)
    db_session.add(visit)
    await db_session.flush()
    now = datetime.now(timezone.utc)
    db_session.add(
        RecruitmentContactLog(
            id=uuid.uuid4(), recruitment_visit_id=visit.id, contacted_at=now, channel="sms",
            reached=True, note="x", created_at=now,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()
