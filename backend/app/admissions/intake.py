"""保留座位、名額計算與計畫名額（規格 6.5、8；園務 services/recruitment_intake_plan.py
compute_intake_plan、set_provisional_seat、seat_capacity_warning）。

只 flush、丟自訂例外；權限、稽核與 commit 在 routes.py。官網沒有班級，所以
「已註冊」只有園務的「未編班」路徑：年級取 COALESCE(provisional_grade, grade)、
學年學期取訪視的 target_*。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import constants, records
from app.admissions.funnel import derive_stage
from app.admissions.models import GradeIntakeTarget, RecruitmentVisit


class SeatNotAllowed(Exception):
    """這筆訪視現在不能保留或釋放座位（message 用園務原文，路由回 422）。"""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


async def set_seat(
    db: AsyncSession,
    visit: RecruitmentVisit,
    *,
    grade: str | None,
    target_school_year: int | None,
    target_semester: int | None,
    expected_version: int,
    actor_user_id: uuid.UUID | None,
) -> bool:
    """grade 有值＝保留座位，None＝釋放保留。回傳是否超過計畫名額（只警示）。
    呼叫前已用 records.get_visit_for_update 鎖列。

    - 只有已預繳（未註冊、未退出）的訪視可以保留；要指定目標學年，學期預設上學期。
    - 已註冊的訪視不能改、也不能清除保留：要改年級或學期先取消註冊。
    - 釋放只清 provisional_grade、保留 target_*（園務 recruitment_intake_plan.py:220-226）。"""
    if visit.version != expected_version:
        raise records.VersionConflict(visit.version)
    stage = derive_stage(visit)
    if grade is None:
        if stage == "enrolled":
            raise SeatNotAllowed("已註冊的訪視不可清除保留，要改年級或學期請先取消註冊")
        if visit.provisional_grade is None:
            raise SeatNotAllowed("這筆訪視目前沒有保留座位")
        metadata = {"grade": visit.provisional_grade, "school_year": visit.target_school_year, "semester": visit.target_semester}
        visit.provisional_grade = None
        event_type = "seat_released"
    else:
        if stage == "enrolled":
            raise SeatNotAllowed("已註冊的訪視不能改保留座位，要改年級或學期請先取消註冊")
        if stage != "deposited":
            raise SeatNotAllowed("未預繳的訪視不可保留座位")
        if target_school_year is None:
            raise SeatNotAllowed("保留座位需指定目標學年")
        visit.provisional_grade = grade
        visit.target_school_year = target_school_year
        visit.target_semester = target_semester or 1
        metadata = {"grade": grade, "school_year": visit.target_school_year, "semester": visit.target_semester}
        event_type = "seat_reserved"
    now = datetime.now(timezone.utc)
    records.write_event(
        db, visit, event_type=event_type, from_stage=stage, to_stage=stage,
        actor_user_id=actor_user_id, metadata=metadata, created_at=now,
    )
    visit.version += 1
    visit.updated_at = now
    await db.flush()
    if grade is None:
        return False
    plan = await intake_plan(db, visit.campus_key, visit.target_school_year, visit.target_semester)
    return next(row["over_capacity"] for row in plan["rows"] if row["grade"] == grade)


async def intake_plan(db: AsyncSession, campus_key: str, school_year: int, semester: int) -> dict:
    """規格 8：每個年級一列（四個年級固定順序）。

    - 已保留：has_deposit、未註冊、provisional_grade 是該年級、目標學年學期相符。
      退出時 has_deposit 已清成 false，所以不會被算進來。
    - 已註冊：enrolled、COALESCE(provisional_grade, grade) 是該年級、目標學年學期相符。
    - 剩餘＝計畫−已保留−已註冊，可以是負數；沒有計畫列（未設定）時是 None。
    - 超額：有計畫名額且已保留＋已註冊 > 計畫名額，只警示。
    - 合計：計畫名額與剩餘只加總有設定的年級，一個都沒設定時是 None。
    轉其他學期（transfer_term）不影響名額，同園務 compute_intake_plan。"""
    term = (
        RecruitmentVisit.campus_key == campus_key,
        RecruitmentVisit.target_school_year == school_year,
        RecruitmentVisit.target_semester == semester,
    )
    reserved_rows = await db.execute(
        select(RecruitmentVisit.provisional_grade, func.count())
        .where(
            *term,
            RecruitmentVisit.has_deposit.is_(True),
            RecruitmentVisit.enrolled.is_(False),
            RecruitmentVisit.provisional_grade.is_not(None),
        )
        .group_by(RecruitmentVisit.provisional_grade)
    )
    enrolled_grade = func.coalesce(RecruitmentVisit.provisional_grade, RecruitmentVisit.grade)
    enrolled_rows = await db.execute(
        select(enrolled_grade, func.count()).where(*term, RecruitmentVisit.enrolled.is_(True)).group_by(enrolled_grade)
    )
    target_rows = await db.execute(
        select(GradeIntakeTarget.grade, GradeIntakeTarget.target_seats).where(
            GradeIntakeTarget.campus_key == campus_key,
            GradeIntakeTarget.school_year == school_year,
            GradeIntakeTarget.semester == semester,
        )
    )
    reserved = {grade: int(count) for grade, count in reserved_rows.all()}
    enrolled = {grade: int(count) for grade, count in enrolled_rows.all()}
    targets = {grade: seats for grade, seats in target_rows.all()}
    rows = []
    for grade in constants.GRADES:
        target = targets.get(grade)
        held, joined = reserved.get(grade, 0), enrolled.get(grade, 0)
        rows.append(
            {
                "grade": grade,
                "target_seats": target,
                "reserved": held,
                "enrolled": joined,
                "remaining": None if target is None else target - held - joined,
                "over_capacity": target is not None and held + joined > target,
            }
        )
    planned = [row for row in rows if row["target_seats"] is not None]
    totals = {
        "target_seats": sum(row["target_seats"] for row in planned) if planned else None,
        "reserved": sum(row["reserved"] for row in rows),
        "enrolled": sum(row["enrolled"] for row in rows),
        "remaining": sum(row["remaining"] for row in planned) if planned else None,
    }
    return {"school_year": school_year, "semester": semester, "rows": rows, "totals": totals}


async def save_targets(
    db: AsyncSession,
    campus_key: str,
    school_year: int,
    semester: int,
    targets: dict[str, int | None],
    actor_user_id: uuid.UUID | None,
) -> list[str]:
    """存同校同學期的計畫名額。值是 None 代表刪掉該年級的計畫列（回到「未設定」）；
    沒出現在 targets 的年級不動。回傳有變動的年級（GRADES 順序）。同一組
    （校、學年、學期）先排隊，兩人同時第一次設定不會撞唯一鍵。"""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"grade_intake_targets:{campus_key}:{school_year}:{semester}"},
    )
    result = await db.execute(
        select(GradeIntakeTarget).where(
            GradeIntakeTarget.campus_key == campus_key,
            GradeIntakeTarget.school_year == school_year,
            GradeIntakeTarget.semester == semester,
        )
    )
    existing = {row.grade: row for row in result.scalars()}
    now = datetime.now(timezone.utc)
    changed: list[str] = []
    for grade in constants.GRADES:
        if grade not in targets:
            continue
        seats = targets[grade]
        row = existing.get(grade)
        if seats is None:
            if row is not None:
                await db.delete(row)
                changed.append(grade)
        elif row is None:
            db.add(
                GradeIntakeTarget(
                    id=uuid.uuid4(),
                    campus_key=campus_key,
                    grade=grade,
                    school_year=school_year,
                    semester=semester,
                    target_seats=seats,
                    created_at=now,
                    updated_at=now,
                    updated_by=actor_user_id,
                )
            )
            changed.append(grade)
        elif row.target_seats != seats:
            row.target_seats = seats
            row.updated_at = now
            row.updated_by = actor_user_id
            changed.append(grade)
    await db.flush()
    return changed
