"""招生入學三張表的 migration、約束與權限（規格 5、7）。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError

from app.admissions.models import GradeIntakeTarget, RecruitmentEventLog, RecruitmentVisit
from app.auth.models import Role, User
from app.auth.permissions import effective_capabilities, has_capability, roles_with
from app.operations.models import RetentionPolicy

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "migrations" / "versions" / "4a7e2c9d1b63_admissions.py"
TABLES = ("recruitment_visits", "recruitment_event_log", "grade_intake_targets")
CHECKS = {
    "ck_recruitment_visits_grade",
    "ck_recruitment_visits_provisional_grade",
    "ck_recruitment_visits_source_category",
    "ck_recruitment_visits_no_deposit_reason",
    "ck_recruitment_visits_withdrawn_from",
    "ck_recruitment_visits_target_semester",
    "ck_recruitment_visits_enrolled_on",
    "ck_grade_intake_targets_grade",
    "ck_grade_intake_targets_semester",
    "ck_grade_intake_targets_seats",
    "ck_retention_policies_admissions_days",
}
UNIQUES = {"uq_recruitment_visits_visit_request", "uq_recruitment_visits_seq", "uq_grade_intake_target"}


def _checks(model) -> dict[str, str]:
    return {c.name: str(c.sqltext) for c in model.__table__.constraints if isinstance(c, CheckConstraint)}


def test_migration_follows_parent_self_booking_without_branching():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("4a7e2c9d1b63").down_revision == "c7d2e9f4a1b8"
    assert len(script.get_heads()) == 1
    source = MIGRATION.read_text(encoding="utf-8")
    # 只建表、加可空欄位，不改既有資料：與上一版程式相容（deploy/CICD.md）。
    assert "op.execute" not in source and "UPDATE " not in source


# 參觀後追蹤（2026-10-04）另一個 migration 加的約束，在 test_admissions_follow_up_schema.py 檢查。
FOLLOW_UP_CHECKS = {"ck_recruitment_visits_follow_up_open"}


def test_check_conditions_are_identical_in_model_and_migration():
    source = MIGRATION.read_text(encoding="utf-8")
    visit_checks = {name: sql for name, sql in _checks(RecruitmentVisit).items() if name not in FOLLOW_UP_CHECKS}
    conditions = {
        **visit_checks,
        **_checks(GradeIntakeTarget),
        "ck_retention_policies_admissions_days": _checks(RetentionPolicy)["ck_retention_policies_admissions_days"],
    }
    assert set(conditions) == CHECKS
    for name, condition in conditions.items():
        assert f'"{name}"' in source, name
        assert f'"{condition}"' in source, f"{name} 的條件與 migration 不一致：{condition}"


@pytest.mark.asyncio
async def test_tables_columns_and_constraints_exist(app):
    async with app.state.engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT table_name, column_name, data_type, character_maximum_length, is_nullable "
                    "FROM information_schema.columns WHERE table_name IN "
                    "('recruitment_visits', 'recruitment_event_log', 'grade_intake_targets', 'retention_policies')"
                )
            )
        ).all()
        names = set(
            (
                await conn.execute(
                    text(
                        "SELECT conname FROM pg_constraint WHERE conrelid IN ("
                        "'recruitment_visits'::regclass, 'recruitment_event_log'::regclass, "
                        "'grade_intake_targets'::regclass, 'retention_policies'::regclass)"
                    )
                )
            ).scalars()
        )
    columns = {(table, column): (kind, length, nullable) for table, column, kind, length, nullable in rows}
    for model in (RecruitmentVisit, RecruitmentEventLog, GradeIntakeTarget):
        for column in model.__table__.columns:
            assert (model.__tablename__, column.name) in columns, f"{model.__tablename__}.{column.name}"
    assert columns[("recruitment_visits", "child_name")] == ("character varying", 50, "NO")
    assert columns[("recruitment_visits", "visit_date")] == ("date", None, "NO")
    assert columns[("recruitment_visits", "phone")] == ("character varying", 100, "YES")
    assert columns[("recruitment_visits", "address")] == ("character varying", 200, "YES")
    assert columns[("recruitment_visits", "no_deposit_reason")] == ("character varying", 60, "YES")
    assert columns[("recruitment_visits", "notes")] == ("text", None, "YES")
    assert columns[("recruitment_visits", "has_deposit")] == ("boolean", None, "NO")
    assert columns[("recruitment_visits", "created_at")] == ("timestamp with time zone", None, "NO")
    assert columns[("recruitment_event_log", "metadata_json")] == ("json", None, "YES")
    assert columns[("recruitment_event_log", "to_stage")] == ("character varying", 20, "NO")
    assert columns[("grade_intake_targets", "target_seats")] == ("integer", None, "NO")
    assert columns[("retention_policies", "admissions_days")] == ("integer", None, "YES")
    assert CHECKS | UNIQUES <= names


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
        **overrides,
    }
    return RecruitmentVisit(**values)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"grade": "小一"},
        {"provisional_grade": "K1"},
        {"source_category": "tiktok"},
        {"no_deposit_reason": "其他"},
        {"withdrawn_from": "visited"},
        {"target_semester": 3},
        {"enrolled": True},  # 已註冊一定要有註冊日期
    ],
    ids=["grade", "provisional_grade", "source_category", "no_deposit_reason", "withdrawn_from", "semester", "enrolled_on"],
)
async def test_database_rejects_values_outside_ivy_enums(db_session, overrides):
    db_session.add(_visit(**overrides))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_seq_no_is_unique_per_campus_and_month(db_session):
    db_session.add(_visit(seq_no="1"))
    db_session.add(_visit(seq_no="1", campus_key="minghua"))
    db_session.add(_visit(seq_no="1", month="115.10"))
    await db_session.flush()
    db_session.add(_visit(seq_no="1"))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


def test_admissions_capabilities():
    staff = {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.RECEPTION}
    assert roles_with("admissions.read") == staff
    assert roles_with("admissions.write") == staff
    assert roles_with("admissions.convert") == {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN}
    desk = User(role=Role.RECEPTION, capabilities=[])
    assert {"admissions.read", "admissions.write"} <= set(effective_capabilities(desk))
    assert not has_capability(desk, "admissions.convert")
    for role in (Role.EDITOR, Role.READONLY):
        caps = set(effective_capabilities(User(role=role, capabilities=[])))
        assert not caps & {"admissions.read", "admissions.write", "admissions.convert"}
