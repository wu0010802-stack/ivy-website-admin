"""招生區域分析四張表的 migration 與約束（2026-10-08 規格 §5）。"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, delete, func, select, text
from sqlalchemy.exc import IntegrityError

from app.admissions.geo.models import (
    DATASETS,
    KINDERGARTEN_KINDS,
    MATCH_LEVELS,
    STREET_KINDS,
    UNLOCATED_REASONS,
    GeoDatasetStatus,
    GeoDoorplate,
    GeoKindergarten,
    RecruitmentVisitGeo,
)
from app.admissions.models import RecruitmentVisit
from tests.geo_helpers import add_visit

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "migrations" / "versions" / "e7a1c4d9b2f6_admissions_area_geo.py"
MODELS = (GeoDoorplate, GeoKindergarten, GeoDatasetStatus, RecruitmentVisitGeo)
# 加減約束要改這裡，同時改 models.py 與 migration。
CHECK_NAMES = {
    "ck_geo_doorplates_street_kind",
    "ck_geo_kindergartens_kind",
    "ck_geo_dataset_status_dataset",
    "ck_recruitment_visit_geo_match_level",
    "ck_recruitment_visit_geo_reason",
}


def _model_checks() -> list[CheckConstraint]:
    return [c for model in MODELS for c in model.__table__.constraints if isinstance(c, CheckConstraint)]


def test_migration_follows_previous_head_without_branching():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("e7a1c4d9b2f6").down_revision == "a9e11038c869"
    assert len(script.get_heads()) == 1


def test_migration_only_creates_tables():
    source = MIGRATION.read_text(encoding="utf-8")
    # 只建表，不改既有資料：與上一版程式相容（deploy/CICD.md）。
    assert "op.execute" not in source and "UPDATE " not in source and "add_column" not in source


def test_check_constraint_names_in_models_are_the_locked_set():
    assert {c.name for c in _model_checks()} == CHECK_NAMES


async def test_check_constraint_names_in_database_are_the_locked_set(db_session):
    """資料庫是 alembic 升上來的，名稱要和 models 一致（少一個、多一個、改名都會紅）。"""
    names = (
        await db_session.execute(
            text(
                "SELECT conname FROM pg_constraint WHERE contype = 'c' AND conrelid IN "
                "('geo_doorplates'::regclass, 'geo_kindergartens'::regclass, "
                "'geo_dataset_status'::regclass, 'recruitment_visit_geo'::regclass)"
            )
        )
    ).scalars().all()
    assert set(names) == CHECK_NAMES and len(names) == len(CHECK_NAMES)


def test_check_conditions_are_identical_in_models_and_migration():
    source = MIGRATION.read_text(encoding="utf-8").replace('"\n    "', "")
    for constraint in _model_checks():
        assert str(constraint.sqltext) in source, constraint.name
        assert f'name="{constraint.name}"' in source, constraint.name


async def test_tables_exist(db_session):
    names = (
        await db_session.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND (table_name LIKE 'geo\\_%' OR table_name = 'recruitment_visit_geo')"
            )
        )
    ).scalars().all()
    assert set(names) == {"geo_doorplates", "geo_kindergartens", "geo_dataset_status", "recruitment_visit_geo"}


async def _expect_rejected(db_session, instance) -> None:
    db_session.add(instance)
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_visit_geo_follows_its_visit_on_delete(db_session):
    visit = await add_visit(db_session, address="高雄市三民區義華路68號")
    db_session.add(RecruitmentVisitGeo(visit_id=visit.id, match_level="exact", matched_at=datetime.now(timezone.utc)))
    await db_session.commit()

    await db_session.execute(delete(RecruitmentVisit).where(RecruitmentVisit.id == visit.id))
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(RecruitmentVisitGeo)) == 0


async def test_visit_geo_match_level_accepts_declared_values_and_rejects_others(db_session):
    for level in MATCH_LEVELS:
        visit = await add_visit(db_session, address=None)
        db_session.add(RecruitmentVisitGeo(visit_id=visit.id, match_level=level, matched_at=datetime.now(timezone.utc)))
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(RecruitmentVisitGeo)) == len(MATCH_LEVELS)

    other = await add_visit(db_session, address=None)
    await _expect_rejected(
        db_session, RecruitmentVisitGeo(visit_id=other.id, match_level="guess", matched_at=datetime.now(timezone.utc))
    )


async def test_visit_geo_unlocated_reason_accepts_declared_values_and_null_and_rejects_others(db_session):
    """unlocated_reason 的條件是「NULL 或在清單內」：每個宣告的值與 NULL 都收，其他值擋下。"""
    for reason in (*UNLOCATED_REASONS, None):
        visit = await add_visit(db_session, address=None)
        db_session.add(
            RecruitmentVisitGeo(
                visit_id=visit.id, match_level="unlocated", unlocated_reason=reason, matched_at=datetime.now(timezone.utc)
            )
        )
    await db_session.commit()
    stored = (await db_session.execute(select(RecruitmentVisitGeo.unlocated_reason))).scalars().all()
    assert sorted(r or "" for r in stored) == sorted([*UNLOCATED_REASONS, ""])

    other = await add_visit(db_session, address=None)
    for bad in ("guess", "", "NO_ADDRESS"):
        await _expect_rejected(
            db_session,
            RecruitmentVisitGeo(
                visit_id=other.id, match_level="unlocated", unlocated_reason=bad, matched_at=datetime.now(timezone.utc)
            ),
        )


async def test_dataset_status_accepts_declared_datasets_and_rejects_others(db_session):
    for dataset in DATASETS:
        db_session.add(GeoDatasetStatus(dataset=dataset))
    await db_session.commit()
    await _expect_rejected(db_session, GeoDatasetStatus(dataset="unknown"))


async def test_doorplate_street_kind_accepts_declared_values_and_rejects_others(db_session):
    def doorplate(kind: str) -> GeoDoorplate:
        return GeoDoorplate(
            dataset_version="115-10#check0", town_code="6400500", district="三民區", village="本揚里", street="義華路",
            street_kind=kind, lane="", alley="", number=1, number_sub=0, lat=22.6, lng=120.3,
        )

    for kind in STREET_KINDS:
        db_session.add(doorplate(kind))
    await db_session.commit()
    await _expect_rejected(db_session, doorplate("avenue"))


async def test_kindergarten_kind_accepts_declared_values_and_rejects_others(db_session):
    def kindergarten(source_id: str, kind: str) -> GeoKindergarten:
        return GeoKindergarten(
            source_id=source_id, name="測試", kind=kind, district="三民區", address="某路1號", lat=22.6, lng=120.3,
            synced_at=datetime.now(timezone.utc),
        )

    for index, kind in enumerate(KINDERGARTEN_KINDS):
        db_session.add(kindergarten(f"k{index}", kind))
    await db_session.commit()
    await _expect_rejected(db_session, kindergarten("bad", "charter"))
