"""編班表的寫入與讀取（2026-11-15 計畫）。只 flush、丟 RosterError；
權限、稽核與 commit 在 routes。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.roster.errors import RosterError, version_conflict
from app.admissions.roster.models import RosterClass, RosterStudent
from app.admissions.schemas.roster import ClassCreate, ClassUpdate


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---- 班級 -------------------------------------------------------------------


async def get_class_for_update(db: AsyncSession, class_id: uuid.UUID) -> RosterClass | None:
    return await db.scalar(
        select(RosterClass).where(RosterClass.id == class_id).with_for_update().execution_options(populate_existing=True)
    )


def _code_taken() -> RosterError:
    return RosterError(409, "ROSTER_CLASS_CODE_TAKEN", "這個學年已經有相同的班序")


async def _code_exists(
    db: AsyncSession, campus_key: str, school_year: int, class_code: str, *, exclude: uuid.UUID | None = None
) -> bool:
    query = select(RosterClass.id).where(
        RosterClass.campus_key == campus_key,
        RosterClass.school_year == school_year,
        RosterClass.class_code == class_code,
    )
    if exclude is not None:
        query = query.where(RosterClass.id != exclude)
    return await db.scalar(query.limit(1)) is not None


async def create_class(db: AsyncSession, campus_key: str, data: ClassCreate, user_id: uuid.UUID) -> RosterClass:
    if await _code_exists(db, campus_key, data.school_year, data.class_code):
        raise _code_taken()
    last = await db.scalar(
        select(func.max(RosterClass.sort_order)).where(
            RosterClass.campus_key == campus_key,
            RosterClass.school_year == data.school_year,
            RosterClass.grade == data.grade,
        )
    )
    now = _now()
    room = RosterClass(
        id=uuid.uuid4(),
        campus_key=campus_key,
        school_year=data.school_year,
        grade=data.grade,
        name=data.name,
        class_code=data.class_code,
        english_name=data.english_name,
        head_teacher=data.head_teacher,
        assistant_teacher=data.assistant_teacher,
        english_teacher=data.english_teacher,
        target_seats=data.target_seats,
        sort_order=0 if last is None else last + 1,
        version=1,
        created_at=now,
        updated_at=now,
        updated_by=user_id,
    )
    db.add(room)
    try:
        await db.flush()
    except IntegrityError as exc:  # 兩人同時建同一個班序：先查過仍可能撞唯一鍵
        await db.rollback()
        raise _code_taken() from exc
    return room


async def update_class(
    db: AsyncSession, room: RosterClass, data: ClassUpdate, user_id: uuid.UUID
) -> list[str]:
    """回傳實際改了哪些欄位名（稽核只記欄位名）。"""
    if room.version != data.expected_version:
        raise version_conflict(room.version, "個班級")
    fields = data.model_fields_set - {"expected_version"}
    if "class_code" in fields and data.class_code != room.class_code:
        if await _code_exists(db, room.campus_key, room.school_year, data.class_code, exclude=room.id):
            raise _code_taken()
    changed = [name for name in sorted(fields) if getattr(room, name) != getattr(data, name)]
    for name in changed:
        setattr(room, name, getattr(data, name))
    if changed:
        room.version += 1
        room.updated_at = _now()
        room.updated_by = user_id
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise _code_taken() from exc
    return changed


async def delete_class(db: AsyncSession, room: RosterClass, expected_version: int) -> None:
    if room.version != expected_version:
        raise version_conflict(room.version, "個班級")
    occupied = await db.scalar(select(RosterStudent.id).where(RosterStudent.class_id == room.id).limit(1))
    if occupied is not None:
        raise RosterError(409, "ROSTER_CLASS_NOT_EMPTY", "班上還有幼生，請先移走再刪除班級")
    await db.delete(room)
    await db.flush()
