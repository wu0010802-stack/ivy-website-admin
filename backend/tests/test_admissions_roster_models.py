"""編班表四張表的資料庫約束（2026-11-15 計畫 Task 1）。姓名一律虛構。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.admissions.roster.models import RosterClass, RosterStudent


def _now() -> datetime:
    return datetime.now(timezone.utc)


def make_class(**overrides) -> RosterClass:
    values = {
        "id": uuid.uuid4(),
        "campus_key": "yihua",
        "school_year": 115,
        "grade": "大班",
        "name": "大一班",
        "class_code": "大1",
        "sort_order": 0,
        "version": 1,
        "created_at": _now(),
        "updated_at": _now(),
    }
    values.update(overrides)
    return RosterClass(**values)


def make_student(**overrides) -> RosterStudent:
    values = {
        "id": uuid.uuid4(),
        "campus_key": "yihua",
        "school_year": 115,
        "child_name": "測試甲",
        "status": "pending",
        "grade": "大班",
        "is_special_education": False,
        "is_indigenous": False,
        "is_new_manual": False,
        "underage_manual": False,
        "next_year": "continue",
        "from_funnel": False,
        "version": 1,
        "created_at": _now(),
        "updated_at": _now(),
    }
    values.update(overrides)
    return RosterStudent(**values)


async def _recruitment_visit_id(db_session) -> uuid.UUID:
    from app.admissions.models import RecruitmentVisit

    visit = RecruitmentVisit(
        id=uuid.uuid4(),
        campus_key="yihua",
        month="115.09",
        visit_date=date(2026, 9, 8),
        child_name="測試乙",
        created_at=_now(),
        updated_at=_now(),
    )
    db_session.add(visit)
    await db_session.commit()
    return visit.id


async def test_enrolled_student_requires_class(db_session):
    db_session.add(make_student(status="enrolled", class_id=None))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_left_student_cannot_keep_class(db_session):
    room = make_class()
    db_session.add(room)
    await db_session.commit()
    db_session.add(make_student(status="left", class_id=room.id, position=0, left_date=date(2026, 10, 3)))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_one_active_student_per_visit(db_session):
    visit_id = await _recruitment_visit_id(db_session)
    db_session.add(make_student(recruitment_visit_id=visit_id))
    await db_session.commit()
    db_session.add(make_student(recruitment_visit_id=visit_id, child_name="測試丙"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
    # 一筆退預繳＋一筆預繳未入園可以並存。
    db_session.add(make_student(recruitment_visit_id=visit_id, child_name="測試丁", status="refunded"))
    await db_session.commit()


async def test_class_code_unique_per_campus_year(db_session):
    db_session.add(make_class())
    await db_session.commit()
    db_session.add(make_class(name="另一班"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
    db_session.add(make_class(school_year=116))
    await db_session.commit()


async def test_class_with_students_cannot_be_deleted(db_session):
    room = make_class()
    db_session.add(room)
    await db_session.commit()
    db_session.add(make_student(status="enrolled", class_id=room.id, position=0))
    await db_session.commit()
    await db_session.delete(room)
    with pytest.raises(IntegrityError):
        await db_session.commit()
