"""在籍學生兩張表（2026-10-15 規格 §4）：約束字串與 migration 逐字相同，CHECK 擋得住壞資料。"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.admissions.enrolled.models import EnrolledRoster, EnrolledStudentPoint

MIGRATION = Path(__file__).parents[1] / "migrations" / "versions" / "f2a7c1e9d4b3_enrolled_points.py"


def _point(**changes) -> EnrolledStudentPoint:
    values = dict(
        campus_key="yihua", grade="小班", district="三民區", village="本揚里", match_level="exact",
        unlocated_reason=None, lat=Decimal("22.642"), lng=Decimal("120.344"),
    )
    values.update(changes)
    return EnrolledStudentPoint(**values)


async def _roster(db) -> None:
    db.add(EnrolledRoster(campus_key="yihua", roster_date=date(2026, 10, 15), school_year=115, doorplate_version="115-10", total=3))
    await db.commit()


async def _expect_rejected(db, instance) -> None:
    db.add(instance)
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


def test_check_conditions_match_the_migration_verbatim():
    source = MIGRATION.read_text(encoding="utf-8")
    checks = [c for c in EnrolledStudentPoint.__table__.constraints if (c.name or "").startswith("ck_")]
    assert len(checks) == 5
    for constraint in checks:
        assert str(constraint.sqltext) in source, constraint.name


async def test_points_accept_valid_rows(db_session):
    await _roster(db_session)
    db_session.add_all([
        _point(),
        _point(match_level="street", lat=None, lng=None),
        _point(match_level="unlocated", unlocated_reason="outside_kaohsiung", district=None, village=None, lat=None, lng=None),
        _point(grade="其他"),
    ])
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(EnrolledStudentPoint)) == 4


@pytest.mark.parametrize(
    "changes",
    [
        {"grade": "小一"},
        {"match_level": "pending"},
        {"lat": None},
        {"match_level": "street"},
        {"unlocated_reason": "anonymized"},
    ],
)
async def test_points_reject_bad_rows(db_session, changes):
    await _roster(db_session)
    await _expect_rejected(db_session, _point(**changes))


async def test_deleting_the_roster_removes_its_points(db_session):
    await _roster(db_session)
    db_session.add(_point())
    await db_session.commit()
    await db_session.delete(await db_session.get(EnrolledRoster, "yihua"))
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(EnrolledStudentPoint)) == 0
