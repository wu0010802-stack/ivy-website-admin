"""招生區域分析四張表的 migration 與約束（2026-10-08 規格 §5）。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, delete, func, select, text
from sqlalchemy.exc import IntegrityError

from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, GeoKindergarten, RecruitmentVisitGeo
from app.admissions.models import RecruitmentVisit
from tests.geo_helpers import add_visit

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "migrations" / "versions" / "e7a1c4d9b2f6_admissions_area_geo.py"
MODELS = (GeoDoorplate, GeoKindergarten, GeoDatasetStatus, RecruitmentVisitGeo)


def test_migration_follows_previous_head_without_branching():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("e7a1c4d9b2f6").down_revision == "c4e8a2f61b97"
    assert len(script.get_heads()) == 1
    source = MIGRATION.read_text(encoding="utf-8")
    # 只建表，不改既有資料：與上一版程式相容（deploy/CICD.md）。
    assert "op.execute" not in source and "UPDATE " not in source and "add_column" not in source


def test_check_conditions_are_identical_in_models_and_migration():
    source = MIGRATION.read_text(encoding="utf-8").replace('"\n    "', "")
    for model in MODELS:
        for constraint in model.__table__.constraints:
            if isinstance(constraint, CheckConstraint):
                assert str(constraint.sqltext) in source, constraint.name


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


async def test_visit_geo_follows_visit_and_rejects_unknown_values(db_session):
    visit = await add_visit(db_session, address="高雄市三民區義華路68號")
    db_session.add(RecruitmentVisitGeo(visit_id=visit.id, match_level="exact", matched_at=datetime.now(timezone.utc)))
    await db_session.commit()

    await db_session.execute(delete(RecruitmentVisit).where(RecruitmentVisit.id == visit.id))
    await db_session.commit()
    count = await db_session.scalar(select(func.count()).select_from(RecruitmentVisitGeo))
    assert count == 0

    other = await add_visit(db_session, address=None)
    db_session.add(RecruitmentVisitGeo(visit_id=other.id, match_level="guess", matched_at=datetime.now(timezone.utc)))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()

    db_session.add(GeoDatasetStatus(dataset="unknown"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
