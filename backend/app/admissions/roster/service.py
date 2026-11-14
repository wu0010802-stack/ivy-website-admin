"""編班表的寫入與讀取（2026-11-15 計畫）。只 flush、丟 RosterError；
權限、稽核與 commit 在 routes。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.models import GradeIntakeTarget
from app.admissions.roster import calc, sync
from app.admissions.roster.errors import RosterError, version_conflict
from app.admissions.roster.models import RosterClass, RosterSnapshot, RosterStudent, RosterTierTarget
from app.admissions.schemas.roster import (
    ClassCreate,
    ClassOut,
    ClassUpdate,
    ClassWithStudentsOut,
    EnterRequest,
    GapBlockOut,
    GradeTotalOut,
    LeaveRequest,
    RefundRequest,
    RestoreRequest,
    RosterOut,
    SnapshotOut,
    SnapshotRequest,
    StudentMove,
    StudentOut,
    StudentsCreate,
    StudentUpdate,
    TierOut,
    TierTargetsRequest,
)
from app.booking.schemas import has_control_chars
from app.common.timezones import today_local


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


# ---- 幼生 -------------------------------------------------------------------


NAME_MAX = 50


def facts_of(student: RosterStudent, class_grade: str | None) -> calc.Facts:
    """算統計用的事實：排進班級的看班級的年級，沒編班的看幼生自己的年級。"""
    return calc.Facts(
        grade=class_grade or student.grade,
        status=student.status,
        enrollment_date=student.enrollment_date,
        deposit_date=student.deposit_date,
        left_date=student.left_date,
        refunded_date=student.refunded_date,
        target_school_year=student.target_school_year,
        target_semester=student.target_semester,
        birthday=student.birthday,
        underage_manual=student.underage_manual,
        is_new_manual=student.is_new_manual,
        next_year=student.next_year,
    )


def student_out(
    student: RosterStudent,
    class_grade: str | None,
    *,
    ctx_year: int | None = None,
    board_notice: str | None = None,
) -> StudentOut:
    """ctx_year＝正在看哪一學年的編班表（預設幼生自己的學年）；不足齡只對那一學年內的幼幼班有值。"""
    year = ctx_year if ctx_year is not None else student.school_year
    facts = facts_of(student, class_grade)
    in_year = student.status == "enrolled" or (
        student.status == "pending" and (student.target_school_year, student.target_semester) in ((year, 1), (year, 2))
    )
    underage = calc.is_underage(facts, year) if in_year and facts.grade == "幼幼班" else None
    return StudentOut(
        id=student.id,
        campus_key=student.campus_key,
        school_year=student.school_year,
        class_id=student.class_id,
        position=student.position,
        grade=facts.grade,
        child_name=student.child_name,
        birthday=student.birthday,
        note=student.note,
        status=student.status,
        enrollment_date=student.enrollment_date,
        planned_entry_date=student.planned_entry_date,
        deposit_date=student.deposit_date,
        left_date=student.left_date,
        refunded_date=student.refunded_date,
        target_school_year=student.target_school_year,
        target_semester=student.target_semester,
        is_special_education=student.is_special_education,
        is_indigenous=student.is_indigenous,
        is_new_manual=student.is_new_manual,
        underage_manual=student.underage_manual,
        next_year=student.next_year,
        from_funnel=student.from_funnel,
        version=student.version,
        is_new=calc.is_new(facts, year),
        is_underage=underage,
        board_notice=board_notice,  # type: ignore[arg-type]
    )


async def student_outs(db: AsyncSession, students: list[RosterStudent]) -> list[StudentOut]:
    ids = {s.class_id for s in students if s.class_id is not None}
    grades: dict[uuid.UUID, str] = {}
    if ids:
        grades = dict((await db.execute(select(RosterClass.id, RosterClass.grade).where(RosterClass.id.in_(ids)))).all())
    notices = await sync.board_notices(db, students)
    return [student_out(s, grades.get(s.class_id), board_notice=notices.get(s.id)) for s in students]


def _class_not_found() -> RosterError:
    return RosterError(404, "ROSTER_CLASS_NOT_FOUND", "找不到這個班級，可能剛被刪除，請重新載入")


def _year_mismatch() -> RosterError:
    return RosterError(422, "ROSTER_CLASS_YEAR_MISMATCH", "班級的學年要和幼生的所屬學年相同")


def _status_invalid(message: str = "這位幼生目前的狀態不能做這個動作") -> RosterError:
    return RosterError(409, "ROSTER_STATUS_INVALID", message)


async def lock_classes(db: AsyncSession, class_ids: set[uuid.UUID]) -> dict[uuid.UUID, RosterClass]:
    """一次鎖多個班級列，依 id 排序避免死結；所有會改變班內成員或順序的動作都要先鎖班級、再鎖幼生。"""
    if not class_ids:
        return {}
    rows = await db.scalars(
        select(RosterClass)
        .where(RosterClass.id.in_(class_ids))
        .order_by(RosterClass.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return {room.id: room for room in rows}


async def peek_student(db: AsyncSession, student_id: uuid.UUID) -> tuple[uuid.UUID | None, str] | None:
    """不加鎖先讀出幼生所在班級與校區（路由用來檢查權限、決定要先鎖哪些班級）。"""
    row = (
        await db.execute(select(RosterStudent.class_id, RosterStudent.campus_key).where(RosterStudent.id == student_id))
    ).first()
    return None if row is None else (row[0], row[1])


async def lock_student(
    db: AsyncSession, student_id: uuid.UUID, class_ids: set[uuid.UUID], expected_class_id: uuid.UUID | None
) -> tuple[RosterStudent | None, dict[uuid.UUID, RosterClass]]:
    """先鎖班級、再鎖幼生（固定順序）。鎖到時幼生已不在原本的班級＝剛被別人搬走。"""
    classes = await lock_classes(db, class_ids)
    student = await db.scalar(
        select(RosterStudent)
        .where(RosterStudent.id == student_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if student is not None and student.class_id != expected_class_id:
        raise version_conflict(student.version, "位幼生")
    return student, classes


async def members_of(db: AsyncSession, class_id: uuid.UUID, *, exclude: uuid.UUID | None = None) -> list[RosterStudent]:
    query = select(RosterStudent).where(RosterStudent.class_id == class_id)
    if exclude is not None:
        query = query.where(RosterStudent.id != exclude)
    rows = await db.scalars(
        query.order_by(RosterStudent.position, RosterStudent.id).execution_options(populate_existing=True)
    )
    return list(rows)


def densify(members: list[RosterStudent]) -> None:
    """班內順序重新編成 0..n-1（只改位置有變的列；位置變動不算改了幼生資料，不加版本號）。"""
    for index, member in enumerate(members):
        if member.position != index:
            member.position = index


async def close_gap(db: AsyncSession, class_id: uuid.UUID, *, exclude: uuid.UUID) -> None:
    densify(await members_of(db, class_id, exclude=exclude))


def clean_names(raw: list[str]) -> list[str]:
    names: list[str] = []
    for line, value in enumerate(raw, start=1):
        name = value.strip()
        if not name:
            continue
        if len(name) > NAME_MAX:
            raise RosterError(422, "ROSTER_NAME_TOO_LONG", f"第 {line} 行的姓名超過 {NAME_MAX} 個字", line=line)
        if has_control_chars(name):
            raise RosterError(422, "ROSTER_NAME_INVALID", f"第 {line} 行的姓名含有不允許的字元", line=line)
        names.append(name)
    if not names:
        raise RosterError(422, "ROSTER_NAMES_EMPTY", "請至少填一位幼生的姓名")
    return names


async def create_students(
    db: AsyncSession, campus_key: str, data: StudentsCreate, user_id: uuid.UUID
) -> tuple[list[RosterStudent], list[str]]:
    names = clean_names(data.names)
    pending = data.pending
    if data.class_id is None and pending is None:
        raise RosterError(422, "ROSTER_TARGET_REQUIRED", "請指定要排進的班級，或補登預繳資料")
    school_year = data.school_year
    deposit_date = planned = target_year = target_semester = None
    if pending is not None:
        if pending.birthday is not None and len(names) > 1:
            raise RosterError(422, "ROSTER_BIRTHDAY_SINGLE_ONLY", "一次貼上多位時不能填生日，請之後逐位補")
        target_year, target_semester = pending.target_school_year, pending.target_semester
        planned = pending.planned_entry_date
        if planned is not None:
            target_year, target_semester = calc.term_for_date(planned)
        if target_year not in (data.school_year, data.school_year + 1) or (
            target_year == data.school_year + 1 and target_semester != 1
        ):
            raise RosterError(422, "ROSTER_TARGET_TERM_INVALID", "入學學期只能是這學年的上學期、下學期，或下學年的上學期")
        school_year = target_year
        deposit_date = pending.deposit_date
    room = None
    if data.class_id is not None:
        room = (await lock_classes(db, {data.class_id})).get(data.class_id)
        if room is None or room.campus_key != campus_key:
            raise _class_not_found()
        if room.school_year != school_year:
            raise _year_mismatch()

    existing = set(
        await db.scalars(
            select(RosterStudent.child_name).where(
                RosterStudent.campus_key == campus_key,
                RosterStudent.school_year == school_year,
                RosterStudent.status.in_(("pending", "enrolled")),
                RosterStudent.child_name.in_(names),
            )
        )
    )
    duplicates: list[str] = []
    seen = set(existing)
    for name in names:
        if name in seen and name not in duplicates:
            duplicates.append(name)
        seen.add(name)

    next_position = 0
    if room is not None:
        last = await db.scalar(select(func.max(RosterStudent.position)).where(RosterStudent.class_id == room.id))
        next_position = 0 if last is None else last + 1
    now = _now()
    created: list[RosterStudent] = []
    for name in names:
        student = RosterStudent(
            id=uuid.uuid4(),
            campus_key=campus_key,
            school_year=school_year,
            class_id=room.id if room else None,
            position=None,
            grade=room.grade if room else pending.grade,  # type: ignore[union-attr]
            child_name=name,
            birthday=pending.birthday if pending else None,
            status="pending" if pending else "enrolled",
            planned_entry_date=planned,
            deposit_date=deposit_date,
            target_school_year=target_year,
            target_semester=target_semester,
            is_special_education=False,
            is_indigenous=False,
            is_new_manual=False,
            underage_manual=False,
            next_year="continue",
            from_funnel=False,
            version=1,
            created_at=now,
            updated_at=now,
            updated_by=user_id,
        )
        if room is not None:
            student.position = next_position
            next_position += 1
        db.add(student)
        created.append(student)
    await db.flush()
    return created, duplicates


async def update_student(db: AsyncSession, student: RosterStudent, data: StudentUpdate, user_id: uuid.UUID) -> list[str]:
    """回傳實際改了哪些欄位名（稽核只記欄位名，不記值）。"""
    if student.version != data.expected_version:
        raise version_conflict(student.version, "位幼生")
    fields = set(data.model_fields_set) - {"expected_version"}
    values = {name: getattr(data, name) for name in fields}
    room = await db.get(RosterClass, student.class_id) if student.class_id else None
    pending = student.status == "pending"

    def refuse(message: str) -> RosterError:
        return RosterError(422, "ROSTER_FIELD_NOT_EDITABLE", message)

    if "grade" in fields and student.class_id is not None:
        raise refuse("已編班的幼生年級跟著班級走，要改請先移到別班")
    if "enrollment_date" in fields and student.status != "enrolled":
        raise refuse("只有在籍的幼生有入園日")
    for name in ("planned_entry_date", "deposit_date", "target_school_year", "target_semester"):
        if name in fields and not pending:
            raise refuse("只有預繳未入園的幼生能改預繳日期、預定入園日與入學學期")
    if values.get("planned_entry_date") is not None:
        values["target_school_year"], values["target_semester"] = calc.term_for_date(values["planned_entry_date"])
        fields |= {"target_school_year", "target_semester"}
    new_year = values.get("target_school_year")
    if pending and new_year is not None:
        new_semester = values.get("target_semester", student.target_semester)
        planned_day = values.get("planned_entry_date")
        deposited = values.get("deposit_date", student.deposit_date)
        if (
            not student.school_year - 1 <= new_year <= student.school_year + 1
            or (new_year == student.school_year + 1 and new_semester != 1)
            or (planned_day is not None and deposited is not None and planned_day < deposited)
        ):
            raise RosterError(422, "ROSTER_TARGET_TERM_INVALID", "入學學期或預定入園日不合理：只能是這學年的上、下學期，或下學年的上學期，而且不能早於預繳日期")
    if new_year is not None and new_year != student.school_year:
        if room is not None and room.school_year != new_year:
            raise _year_mismatch()
        values["school_year"] = new_year
        fields.add("school_year")
    if "next_year" in fields:
        grade = room.grade if room else values.get("grade", student.grade)
        if values["next_year"] == "repeat" and grade != "大班":
            raise refuse("只有大班可以標重讀")
        if values["next_year"] == "leave" and grade == "大班":
            raise refuse("大班下學年畢業，不能標不讀")
    if values.get("birthday") is not None:
        values["underage_manual"] = False
        fields.add("underage_manual")

    changed = [name for name in sorted(fields) if getattr(student, name) != values[name]]
    for name in changed:
        setattr(student, name, values[name])
    if changed:
        student.version += 1
        student.updated_at = _now()
        student.updated_by = user_id
    await db.flush()
    return [name for name in changed if name != "school_year"]


async def move_student(
    db: AsyncSession,
    student_id: uuid.UUID,
    peeked_class_id: uuid.UUID | None,
    payload: StudentMove,
    user_id: uuid.UUID,
) -> RosterStudent:
    ids = {c for c in (peeked_class_id, payload.class_id) if c is not None}
    student, classes = await lock_student(db, student_id, ids, peeked_class_id)
    if student is None:
        raise _class_not_found()  # 路由已確認過存在；這裡只會是剛被刪
    if student.version != payload.expected_version:
        raise version_conflict(student.version, "位幼生")
    if student.status not in ("pending", "enrolled"):
        raise _status_invalid("已離園或已退預繳的幼生不能移動，請先恢復")
    target = None
    if payload.class_id is None:
        if student.status == "enrolled":
            raise RosterError(409, "ROSTER_ENROLLED_NEEDS_CLASS", "在籍幼生不能放回還沒編班，要離園請點姓名")
    else:
        target = classes.get(payload.class_id)
        if target is None or target.campus_key != student.campus_key:
            raise _class_not_found()
        if target.school_year != student.school_year:
            raise _year_mismatch()

    old_class_id = student.class_id
    old_grade = student.grade
    if old_class_id is not None and old_class_id != payload.class_id:
        await close_gap(db, old_class_id, exclude=student.id)
    if target is None:
        student.class_id = None
        student.position = None
    else:
        others = await members_of(db, target.id, exclude=student.id)
        index = min(payload.position, len(others))
        student.class_id = target.id
        student.grade = target.grade
        student.position = index
        others.insert(index, student)
        densify(others)
        if old_grade != target.grade:
            student.next_year = "continue"
            if old_grade == "幼幼班":
                student.underage_manual = False
    student.version += 1
    student.updated_at = _now()
    student.updated_by = user_id
    await db.flush()
    return student


# ---- 狀態動作：已入園、離園、退預繳、恢復 --------------------------------------


def _action_date(value: date | None) -> date:
    """動作日期預設台北今天，不能晚於今天。"""
    today = today_local()
    if value is None:
        return today
    if value > today:
        raise RosterError(422, "ROSTER_DATE_IN_FUTURE", "日期不能晚於今天")
    return value


async def _locked_for_action(
    db: AsyncSession,
    student_id: uuid.UUID,
    peeked_class_id: uuid.UUID | None,
    expected_version: int,
    *,
    extra_class_ids: set[uuid.UUID] | None = None,
) -> tuple[RosterStudent, dict[uuid.UUID, RosterClass]]:
    ids = ({peeked_class_id} if peeked_class_id else set()) | (extra_class_ids or set())
    student, classes = await lock_student(db, student_id, ids, peeked_class_id)
    if student is None:
        raise _class_not_found()
    if student.version != expected_version:
        raise version_conflict(student.version, "位幼生")
    return student, classes


def _touch(student: RosterStudent, user_id: uuid.UUID) -> None:
    student.version += 1
    student.updated_at = _now()
    student.updated_by = user_id


async def enter_student(
    db: AsyncSession, student_id: uuid.UUID, peeked_class_id: uuid.UUID | None, data: EnterRequest, user_id: uuid.UUID
) -> RosterStudent:
    student, _ = await _locked_for_action(db, student_id, peeked_class_id, data.expected_version)
    if student.status != "pending":
        raise _status_invalid("只有預繳未入園的幼生能標已入園")
    if student.class_id is None:
        raise RosterError(409, "ROSTER_NEEDS_CLASS", "請先把這位幼生排進班級，再標已入園")
    student.enrollment_date = _action_date(data.enrollment_date)
    student.status = "enrolled"
    _touch(student, user_id)
    await db.flush()
    return student


async def _leave_class(db: AsyncSession, student: RosterStudent) -> None:
    """離園、退預繳：清掉班級與班內順序（年級已經存在幼生上），原班其餘幼生補位。"""
    old_class_id = student.class_id
    student.class_id = None
    student.position = None
    if old_class_id is not None:
        await close_gap(db, old_class_id, exclude=student.id)


async def leave_student(
    db: AsyncSession, student_id: uuid.UUID, peeked_class_id: uuid.UUID | None, data: LeaveRequest, user_id: uuid.UUID
) -> RosterStudent:
    student, _ = await _locked_for_action(db, student_id, peeked_class_id, data.expected_version)
    if student.status != "enrolled":
        raise _status_invalid("只有在籍的幼生能離園")
    student.left_date = _action_date(data.left_date)
    student.status = "left"
    await _leave_class(db, student)
    _touch(student, user_id)
    await db.flush()
    return student


async def refund_student(
    db: AsyncSession, student_id: uuid.UUID, peeked_class_id: uuid.UUID | None, data: RefundRequest, user_id: uuid.UUID
) -> RosterStudent:
    student, _ = await _locked_for_action(db, student_id, peeked_class_id, data.expected_version)
    if student.status != "pending":
        raise _status_invalid("只有預繳未入園的幼生能退預繳")
    student.refunded_date = _action_date(data.refunded_date)
    student.status = "refunded"
    await _leave_class(db, student)
    _touch(student, user_id)
    await db.flush()
    return student


async def restore_student(
    db: AsyncSession, student_id: uuid.UUID, peeked_class_id: uuid.UUID | None, data: RestoreRequest, user_id: uuid.UUID
) -> RosterStudent:
    student, classes = await _locked_for_action(
        db, student_id, peeked_class_id, data.expected_version,
        extra_class_ids={data.class_id} if data.class_id else None,
    )
    if student.status in ("refunded", "left") and student.recruitment_visit_id is not None:
        # 看板在這位被退掉之後又重新建了一位（部分唯一索引：一筆看板紀錄最多一位預繳未入園或在籍）。
        active = await db.scalar(
            select(RosterStudent.id)
            .where(
                RosterStudent.recruitment_visit_id == student.recruitment_visit_id,
                RosterStudent.id != student.id,
                RosterStudent.status.in_(("pending", "enrolled")),
            )
            .limit(1)
        )
        if active is not None:
            raise RosterError(409, "ROSTER_VISIT_ALREADY_ACTIVE", "看板已經為這筆訪視重新建了一位預繳生，不能再恢復這一位")
    if student.status == "refunded":
        student.status = "pending"
        student.refunded_date = None
    elif student.status == "left":
        if data.class_id is None:
            raise RosterError(422, "ROSTER_CLASS_REQUIRED", "已離園的幼生恢復時要選一個班級")
        room = classes.get(data.class_id)
        if room is None or room.campus_key != student.campus_key:
            raise _class_not_found()
        if room.school_year != student.school_year:
            raise _year_mismatch()
        last = await db.scalar(select(func.max(RosterStudent.position)).where(RosterStudent.class_id == room.id))
        student.status = "enrolled"
        student.left_date = None
        student.class_id = room.id
        student.grade = room.grade
        student.position = 0 if last is None else last + 1
    else:
        raise _status_invalid("只有已離園或已退預繳的幼生能恢復")
    _touch(student, user_id)
    try:
        await db.flush()
    except IntegrityError as exc:  # 兩邊同時動作：部分唯一索引擋下
        await db.rollback()
        raise RosterError(409, "ROSTER_VISIT_ALREADY_ACTIVE", "看板已經為這筆訪視重新建了一位預繳生，不能再恢復這一位") from exc
    return student


# ---- 讀取整張編班表、三段目標、結算紀錄 ------------------------------------------

def as_of_window(school_year: int) -> tuple[date, date]:
    """可選的統計日期：學年開學（8/1）到今天，但不超過學年最後一天（隔年 7/31）。
    還沒開學的學年只能選開學那天（先看、先建班用）。"""
    start = date(school_year + 1911, 8, 1)
    end = date(school_year + 1912, 7, 31)
    return start, max(min(today_local(), end), start)


def check_as_of(school_year: int, as_of: date) -> None:
    start, latest = as_of_window(school_year)
    if not start <= as_of <= latest:
        raise RosterError(422, "ROSTER_AS_OF_OUT_OF_RANGE", "統計日期要在這個學年開學（8/1）到今天之間")


def _with_total(values: dict[str, int]) -> dict[str, int]:
    return {**values, "total": sum(values.values())}


def _tier(row: RosterTierTarget | None, total: int) -> TierOut:
    base, boost, top = (row.base, row.boost, row.top) if row else (None, None, None)
    status = calc.tier_status(total, base, boost, top)
    return TierOut(base=base, boost=boost, top=top, reached=status.reached, next=status.next, short=status.short)


def _block(
    rows: dict[str, dict[str, int]], targets: dict[str, int | None], estimate_key: str, tier_row: RosterTierTarget | None
) -> GapBlockOut:
    estimate = rows[estimate_key]
    defined = [value for value in targets.values() if value is not None]
    all_four = len(defined) == len(calc.GRADE_ORDER)
    targets = {**targets, "total": sum(defined) if defined else None}
    achievement = {g: calc.achievement(estimate[g], targets[g]) for g in calc.GRADE_ORDER}
    gap = {g: calc.signed_gap(estimate[g], targets[g]) for g in calc.GRADE_ORDER}
    achievement["total"] = calc.achievement(estimate["total"], targets["total"]) if all_four else None
    gap["total"] = calc.signed_gap(estimate["total"], targets["total"]) if all_four else None
    return GapBlockOut(
        rows=rows, targets=targets, achievement=achievement, gap=gap, tier=_tier(tier_row, estimate["total"])
    )


async def _tier_row(db: AsyncSession, campus_key: str, school_year: int, semester: int) -> RosterTierTarget | None:
    return await db.get(RosterTierTarget, (campus_key, school_year, semester))


def _snapshot_out(snapshot: RosterSnapshot) -> SnapshotOut:
    payload = snapshot.payload
    return SnapshotOut(
        id=snapshot.id,
        as_of=snapshot.as_of,
        enrolled=payload["enrolled"],
        total_enrolled=sum(payload["enrolled"].values()),
        estimate_total=payload["estimate_total"],
        created_at=snapshot.created_at,
    )


async def _load_for_year(
    db: AsyncSession, campus_key: str, school_year: int
) -> tuple[list[RosterClass], list[RosterStudent]]:
    rooms = list(
        await db.scalars(
            select(RosterClass).where(RosterClass.campus_key == campus_key, RosterClass.school_year == school_year)
        )
    )
    order = {grade: index for index, grade in enumerate(calc.GRADE_ORDER)}
    rooms.sort(key=lambda r: (order[r.grade], r.sort_order, r.class_code))
    students = list(
        await db.scalars(
            select(RosterStudent).where(
                RosterStudent.campus_key == campus_key, RosterStudent.school_year.in_((school_year, school_year + 1))
            )
        )
    )
    return rooms, students


def _gap_for(students: list[RosterStudent], school_year: int, as_of: date) -> calc.Gap:
    # 只算這一學年的幼生，加上入學 (Y+1, 上) 的預繳生；下一學年自己的在籍不能算進來（同一人不算兩次）。
    counted = (
        s for s in students
        if s.school_year == school_year
        or (s.status == "pending" and (s.target_school_year, s.target_semester) == (school_year + 1, 1))
    )
    return calc.compute_gap((facts_of(s, None) for s in counted), school_year=school_year, as_of=as_of)


async def build_roster(db: AsyncSession, campus_key: str, school_year: int, as_of: date | None) -> RosterOut:
    today = today_local()
    as_of = as_of or as_of_window(school_year)[1]
    check_as_of(school_year, as_of)
    rooms, students = await _load_for_year(db, campus_key, school_year)
    gap = _gap_for(students, school_year, as_of)
    year_class_ids = {r.id for r in rooms}

    in_class: dict[uuid.UUID, list[RosterStudent]] = {r.id: [] for r in rooms}
    unassigned: list[RosterStudent] = []
    next_year: list[RosterStudent] = []
    gone: list[RosterStudent] = []
    for student in students:
        if student.status == "pending" and (student.target_school_year, student.target_semester) == (school_year + 1, 1):
            next_year.append(student)
        elif student.status == "refunded" and (student.target_school_year, student.target_semester) == (school_year + 1, 1):
            gone.append(student)  # 在這一頁把下學年 8 月入園的預繳生退掉：要在這裡才救得回來
        elif student.school_year != school_year:
            continue
        elif student.status in ("left", "refunded"):
            gone.append(student)
        elif student.class_id in year_class_ids:
            in_class[student.class_id].append(student)
        elif student.status == "pending" and student.class_id is None:
            unassigned.append(student)
    for members in in_class.values():
        members.sort(key=lambda m: (m.position if m.position is not None else 0, str(m.id)))
    gone.sort(key=lambda m: m.left_date or m.refunded_date or date.min, reverse=True)

    shown = [*unassigned, *next_year, *(m for members in in_class.values() for m in members)]
    notices = await sync.board_notices(db, shown)

    def out(student: RosterStudent) -> StudentOut:
        return student_out(student, None, ctx_year=school_year, board_notice=notices.get(student.id))

    class_outs: list[ClassWithStudentsOut] = []
    grade_totals = {g: {"count": 0, "returning": 0, "new": 0, "pending": 0} for g in calc.GRADE_ORDER}
    class_targets: dict[str, int | None] = {g: None for g in calc.GRADE_ORDER}
    for room in rooms:
        members = in_class[room.id]
        class_outs.append(
            ClassWithStudentsOut(
                **ClassOut.model_validate(room).model_dump(),
                students=[out(m) for m in members],
                count=len(members),
                gap=None if room.target_seats is None else len(members) - room.target_seats,
            )
        )
        if room.target_seats is not None:
            class_targets[room.grade] = (class_targets[room.grade] or 0) + room.target_seats
        totals = grade_totals[room.grade]
        for member in members:
            totals["count"] += 1
            totals["pending"] += member.status == "pending"
            totals["new" if calc.is_new(facts_of(member, room.grade), school_year) else "returning"] += 1

    intake = {
        row.grade: row.target_seats
        for row in await db.scalars(
            select(GradeIntakeTarget).where(
                GradeIntakeTarget.campus_key == campus_key,
                GradeIntakeTarget.school_year == school_year + 1,
                GradeIntakeTarget.semester == 1,
            )
        )
    }
    current_rows = {
        "enrolled": _with_total(gap.enrolled),
        "pending_s1": _with_total(gap.pending_s1),
        "pending_s2": _with_total(gap.pending_s2),
        "estimate": _with_total(gap.estimate),
    }
    next_rows = {
        "promoted": _with_total(gap.promoted),
        "leaving": _with_total(gap.leaving),
        "repeating": _with_total(gap.repeating),
        "pending_next": _with_total(gap.pending_next),
        "estimate_next": _with_total(gap.estimate_next),
    }
    snapshots = await db.scalars(
        select(RosterSnapshot)
        .where(RosterSnapshot.campus_key == campus_key, RosterSnapshot.school_year == school_year)
        .order_by(RosterSnapshot.as_of.desc())
    )
    return RosterOut(
        campus_key=campus_key,
        school_year=school_year,
        today=today,
        as_of=as_of,
        classes=class_outs,
        unassigned=[out(s) for s in unassigned],
        next_year=[out(s) for s in next_year],
        gone=[out(s) for s in gone],
        grade_totals={g: GradeTotalOut(**v) for g, v in grade_totals.items()},
        current=_block(current_rows, class_targets, "estimate", await _tier_row(db, campus_key, school_year, 2)),
        next=_block(
            next_rows,
            {g: intake.get(g) for g in calc.GRADE_ORDER},
            "estimate_next",
            await _tier_row(db, campus_key, school_year + 1, 1),
        ),
        underage_enrolled=gap.underage_enrolled,
        underage_pending=gap.underage_pending,
        missing_birthday=gap.missing_birthday,
        incomplete=gap.incomplete,
        snapshots=[_snapshot_out(s) for s in snapshots],
    )


async def save_tier_targets(
    db: AsyncSession, campus_key: str, data: TierTargetsRequest, user_id: uuid.UUID
) -> TierOut:
    row = await _tier_row(db, campus_key, data.school_year, data.semester)
    if row is None:
        row = RosterTierTarget(campus_key=campus_key, school_year=data.school_year, semester=data.semester)
        db.add(row)
    row.base, row.boost, row.top = data.base, data.boost, data.top
    row.updated_at = _now()
    row.updated_by = user_id
    await db.flush()
    # 達成狀況比的是對應區塊現在的預估：(Y,2) 比這學期預估，(Y,1) 比上一學年的下學年預估。
    today = today_local()
    roster_year = data.school_year if data.semester == 2 else data.school_year - 1
    _, students = await _load_for_year(db, campus_key, roster_year)
    gap = _gap_for(students, roster_year, today)
    total = sum((gap.estimate if data.semester == 2 else gap.estimate_next).values())
    return _tier(row, total)


async def create_snapshot(
    db: AsyncSession, campus_key: str, data: SnapshotRequest, user_id: uuid.UUID
) -> RosterSnapshot:
    check_as_of(data.school_year, data.as_of)
    _, students = await _load_for_year(db, campus_key, data.school_year)
    gap = _gap_for(students, data.school_year, data.as_of)
    payload = {
        "enrolled": gap.enrolled,
        "pending_s1": gap.pending_s1,
        "pending_s2": gap.pending_s2,
        "estimate_total": sum(gap.estimate.values()),
    }
    existing = await db.scalar(
        select(RosterSnapshot)
        .where(
            RosterSnapshot.campus_key == campus_key,
            RosterSnapshot.school_year == data.school_year,
            RosterSnapshot.as_of == data.as_of,
        )
        .with_for_update()
    )
    exists_error = RosterError(409, "ROSTER_SNAPSHOT_EXISTS", "這一天已經有結算紀錄")
    if existing is not None:
        if not data.overwrite:
            raise exists_error
        await db.delete(existing)
        await db.flush()
    snapshot = RosterSnapshot(
        id=uuid.uuid4(),
        campus_key=campus_key,
        school_year=data.school_year,
        as_of=data.as_of,
        payload=payload,
        created_at=_now(),
        created_by=user_id,
    )
    db.add(snapshot)
    try:
        await db.flush()
    except IntegrityError as exc:  # 兩人同時存同一天
        await db.rollback()
        raise exists_error from exc
    return snapshot


def snapshot_out(snapshot: RosterSnapshot) -> SnapshotOut:
    return _snapshot_out(snapshot)
