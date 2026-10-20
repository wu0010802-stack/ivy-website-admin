"""招生潛力與市佔率的三張新表（2026-10-20 規格 §3.1–3.3）：欄位與主鍵、約束字串與 migration 逐字相同、
CHECK 擋得住壞資料、dataset 多收 elementary、降級再升級來回。"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, inspect, text
from sqlalchemy.exc import IntegrityError

from app.admissions.geo.models import DATASETS, GeoDatasetStatus, GeoElementaryGrade1, GeoVillageAgesSeptember
from app.admissions.history.models import CampusTermEnrollment

BACKEND = Path(__file__).resolve().parents[1]
REVISION = "76c4bf84b907"
MIGRATION = BACKEND / "migrations" / "versions" / f"{REVISION}_admissions_potential_share.py"
TABLES = ("campus_term_enrollment", "geo_village_ages_september", "geo_elementary_grade1")
NULLABLE_COUNTS = (
    "target", "returning_enrolled", "returning_deposit", "returning_registered",
    "new_target", "new_visits", "new_deposits", "new_registered", "repeat_deposit", "repeat_registered",
)
AGE_COLUMNS = tuple(f"age_{n}" for n in range(7))


def _enrollment(**changes) -> CampusTermEnrollment:
    values = dict(
        campus_key="yihua", school_year=115, semester=1, grade="大班", as_of=date(2026, 9, 1), registered=60,
        imported_at=datetime.now(timezone.utc),
    )
    values.update(changes)
    return CampusTermEnrollment(**values)


async def _expect_rejected(db, instance) -> None:
    db.add(instance)
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


def _reflect(sync_conn) -> dict[str, tuple[list[str], dict[str, bool]]]:
    inspector = inspect(sync_conn)
    found = {}
    for table in TABLES:
        pk = inspector.get_pk_constraint(table)["constrained_columns"]
        nullable = {column["name"]: column["nullable"] for column in inspector.get_columns(table)}
        found[table] = (pk, nullable)
    return found


async def test_tables_exist(app):
    async with app.state.engine.connect() as conn:
        found = await conn.run_sync(_reflect)

    pk, nullable = found["campus_term_enrollment"]
    assert pk == ["campus_key", "school_year", "semester", "grade"]
    assert set(nullable) == {
        "campus_key", "school_year", "semester", "grade", "as_of", "registered", "imported_at", *NULLABLE_COUNTS,
    }
    for column in ("as_of", "registered", "imported_at"):
        assert nullable[column] is False
    for column in NULLABLE_COUNTS:
        assert nullable[column] is True

    pk, nullable = found["geo_village_ages_september"]
    assert pk == ["year", "village_code"]
    assert set(nullable) == {"year", "village_code", "district", "village", *AGE_COLUMNS, "people_total"}
    assert not any(nullable.values())

    pk, nullable = found["geo_elementary_grade1"]
    assert pk == ["school_year", "school_code"]
    assert set(nullable) == {"school_year", "school_code", "grade1", "school_name"}
    assert not any(nullable.values())


async def test_column_types_follow_the_brief(app):
    async with app.state.engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT table_name, column_name, data_type, character_maximum_length FROM information_schema.columns "
                    "WHERE table_name IN ('campus_term_enrollment', 'geo_village_ages_september', 'geo_elementary_grade1') "
                    "AND data_type IN ('character varying', 'date', 'timestamp with time zone')"
                )
            )
        ).all()
    assert {(r.table_name, r.column_name): (r.data_type, r.character_maximum_length) for r in rows} == {
        ("campus_term_enrollment", "campus_key"): ("character varying", 16),
        ("campus_term_enrollment", "grade"): ("character varying", 4),
        ("campus_term_enrollment", "as_of"): ("date", None),
        ("campus_term_enrollment", "imported_at"): ("timestamp with time zone", None),
        ("geo_village_ages_september", "village_code"): ("character varying", 11),
        ("geo_village_ages_september", "district"): ("character varying", 8),
        ("geo_village_ages_september", "village"): ("character varying", 16),
        ("geo_elementary_grade1", "school_code"): ("character varying", 6),
        ("geo_elementary_grade1", "school_name"): ("character varying", 32),
    }


def test_check_conditions_match_the_migration_verbatim():
    source = MIGRATION.read_text(encoding="utf-8").replace('"\n    "', "")
    checks = [c for c in CampusTermEnrollment.__table__.constraints if isinstance(c, CheckConstraint)]
    assert {c.name for c in checks} == {"ck_campus_term_enrollment_grade", "ck_campus_term_enrollment_semester"}
    for constraint in checks:
        assert str(constraint.sqltext) in source, constraint.name
        assert f'"{constraint.name}"' in source, constraint.name
    # elementary 加進 dataset 約束：migration 的新字串就是 models 現在的條件。
    [dataset_check] = [c for c in GeoDatasetStatus.__table__.constraints if isinstance(c, CheckConstraint)]
    assert str(dataset_check.sqltext) in source


def test_migration_follows_previous_head_without_branching_and_only_adds():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision(REVISION).down_revision == "a6c2e9f4b8d1"
    # 之後還會有新 migration，head 不寫死，只斷言唯一。
    assert len(script.get_heads()) == 1
    upgrade = MIGRATION.read_text(encoding="utf-8").split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    # 升級只建表與放寬約束，不改既有資料：與上一版程式相容（deploy/CICD.md）。
    assert "op.execute" not in upgrade and "UPDATE " not in upgrade and "DELETE " not in upgrade


@pytest.mark.parametrize("grade", ["大班", "中班", "小班", "幼幼班"])
async def test_grade_check_accepts_the_four_grades(db_session, grade):
    db_session.add(_enrollment(grade=grade))
    await db_session.commit()


@pytest.mark.parametrize("grade", ["其他", "小一", "", "總人數"])
async def test_grade_check_rejects_other(db_session, grade):
    await _expect_rejected(db_session, _enrollment(grade=grade))


@pytest.mark.parametrize("semester", [0, 3])
async def test_semester_check_rejects_other(db_session, semester):
    await _expect_rejected(db_session, _enrollment(semester=semester))


async def test_enrollment_primary_key_is_unique_and_optional_counts_may_be_null(db_session):
    db_session.add(_enrollment())
    await db_session.commit()
    row = await db_session.get(CampusTermEnrollment, ("yihua", 115, 1, "大班"))
    assert row is not None and all(getattr(row, name) is None for name in NULLABLE_COUNTS)
    db_session.expunge(row)
    await _expect_rejected(db_session, _enrollment(registered=61))


async def test_enrollment_requires_the_cutoff_date_and_registered(db_session):
    await _expect_rejected(db_session, _enrollment(as_of=None))
    await _expect_rejected(db_session, _enrollment(registered=None))


async def test_elementary_dataset_allowed(db_session):
    assert "elementary" in DATASETS
    db_session.add(GeoDatasetStatus(dataset="elementary", label="114"))
    await db_session.commit()
    stored = (await db_session.execute(text("SELECT label FROM geo_dataset_status WHERE dataset = 'elementary'"))).scalar_one()
    assert stored == "114"
    await _expect_rejected(db_session, GeoDatasetStatus(dataset="elementary_school"))


async def test_september_ages_and_elementary_rows_round_trip(db_session):
    db_session.add_all(
        [
            GeoVillageAgesSeptember(
                year=115, village_code="64000010001", district="三民區", village="本揚里",
                age_0=1, age_1=2, age_2=3, age_3=4, age_4=5, age_5=6, age_6=7, people_total=900,
            ),
            GeoElementaryGrade1(school_year=114, school_code="553610", grade1=120, school_name="光武國小"),
        ]
    )
    await db_session.commit()
    ages = await db_session.get(GeoVillageAgesSeptember, (115, "64000010001"))
    assert ages is not None and (ages.age_6, ages.people_total) == (7, 900)
    grade1 = await db_session.get(GeoElementaryGrade1, (114, "553610"))
    assert grade1 is not None and grade1.grade1 == 120


def _alembic(app, *args: str) -> subprocess.CompletedProcess:
    """另開一個程序跑 alembic：env.py 內部 asyncio.run，不能在測試的 event loop 裡呼叫；
    環境變數一律指到測試庫，絕不讀到開發或正式的連線設定。"""
    url = app.state.settings.active_database_url()
    assert "test" in url.lower()
    env = {key: value for key, value in os.environ.items() if not key.startswith("WEBSITE_")}
    env.update(
        WEBSITE_ENVIRONMENT="test",
        WEBSITE_TEST_DATABASE_URL=url,
        WEBSITE_DATABASE_URL=url,
        WEBSITE_SESSION_SECRET="test-secret-test-secret-test-secret-00",
    )
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, capture_output=True, text=True, check=False,
    )


async def _existing_tables(app) -> set[str]:
    async with app.state.engine.connect() as conn:
        names = (
            await conn.execute(
                text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(:names)"),
                {"names": list(TABLES)},
            )
        ).scalars().all()
    return set(names)


async def test_downgrade_roundtrip(app):
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    previous = ScriptDirectory.from_config(config).get_revision(REVISION).down_revision
    assert isinstance(previous, str)
    assert await _existing_tables(app) == set(TABLES)

    try:
        # 降級到這支 migration 之前（之後若有新 migration 接在上面，一併降掉再升回來）。
        down = await asyncio.to_thread(_alembic, app, "downgrade", previous)
        assert down.returncode == 0, down.stderr
        assert await _existing_tables(app) == set()
        async with app.state.engine.connect() as conn:
            check = (
                await conn.execute(
                    text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_geo_dataset_status_dataset'")
                )
            ).scalar_one()
        assert "elementary" not in check
    finally:
        up = await asyncio.to_thread(_alembic, app, "upgrade", "head")
        assert up.returncode == 0, up.stderr
    assert await _existing_tables(app) == set(TABLES)
