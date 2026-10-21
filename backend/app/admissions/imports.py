"""後台資料匯入的共用查詢與鎖（2026-10-21 規格 §5、§7）：每校目前匯入了哪一份在籍清冊、歷年註冊，
以及同一校同一種匯入的排隊。只 flush／讀取，呼叫端 commit。"""
from __future__ import annotations

from typing import Literal

from sqlalchemy import desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.enrolled.models import EnrolledRoster, EnrolledStudentPoint
from app.admissions.geo import matcher
from app.admissions.history.models import CampusTermEnrollment

ImportKind = Literal["enrolled_roster", "enrollment_history"]


async def lock_campus_import(db: AsyncSession, kind: ImportKind, campus_key: str) -> None:
    """同一校同一種匯入（或清除）排隊，交易結束才放；不同校、不同種互不等待。"""
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"{kind}:{campus_key}"})


async def _enrolled_status(db: AsyncSession, campus_key: str) -> dict | None:
    # 清冊列和點數在同一個查詢裡讀，匯入換版的瞬間不會拿到新清冊配舊人數。
    row = (
        await db.execute(
            select(EnrolledRoster, func.count(EnrolledStudentPoint.lat))
            .outerjoin(EnrolledStudentPoint, EnrolledStudentPoint.campus_key == EnrolledRoster.campus_key)
            .where(EnrolledRoster.campus_key == campus_key)
            .group_by(EnrolledRoster.campus_key)
        )
    ).first()
    if row is None:
        return None
    roster, placed = row
    return {
        "roster_date": roster.roster_date,
        "school_year": roster.school_year,
        "doorplate_version": roster.doorplate_version,
        "total": roster.total,
        "placed": placed,
        "imported_at": roster.imported_at,
    }


async def _history_status(db: AsyncSession, campus_key: str) -> dict | None:
    rows, imported_at = (
        await db.execute(
            select(func.count(), func.max(CampusTermEnrollment.imported_at)).where(CampusTermEnrollment.campus_key == campus_key)
        )
    ).one()
    if not rows:
        return None
    terms = (CampusTermEnrollment.school_year, CampusTermEnrollment.semester)
    scope = select(*terms).where(CampusTermEnrollment.campus_key == campus_key).limit(1)
    first = (await db.execute(scope.order_by(*terms))).one()
    last = (await db.execute(scope.order_by(*(desc(term) for term in terms)))).one()
    return {
        "rows": rows,
        "first_school_year": first.school_year,
        "first_semester": first.semester,
        "last_school_year": last.school_year,
        "last_semester": last.semester,
        "imported_at": imported_at,
    }


async def import_status(db: AsyncSession, campus_key: str) -> dict:
    """該校目前匯入的在籍清冊與歷年註冊（沒匯入過是 None），加上使用中的門牌資料月份（「115-10」），
    讓頁面比對清冊用的門牌版本是不是已經換版。"""
    return {
        "active_doorplate_version": await matcher.doorplate_label(db),
        "enrolled": await _enrolled_status(db, campus_key),
        "history": await _history_status(db, campus_key),
    }
