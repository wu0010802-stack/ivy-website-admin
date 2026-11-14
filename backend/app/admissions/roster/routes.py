"""編班與缺額 API（2026-11-15 計畫；/api/website/v1/admin/admissions/roster/*）。

讀取用 admissions.read、寫入用 admissions.write，都依校區 scope：沒權限 403、越權或
不存在 404（ScopeDenied）。稽核的 action 與 metadata 寫字面值，不放姓名、生日、
特教生、原住民、老師姓名（admin labelCoverage 測試會掃 action）。"""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.roster import service
from app.admissions.roster.errors import RosterError
from app.admissions.roster.models import RosterClass, RosterStudent
from app.admissions.schemas.roster import (
    ClassCreate,
    ClassOut,
    ClassUpdate,
    EnterRequest,
    LeaveRequest,
    RefundRequest,
    RestoreRequest,
    RosterOut,
    SnapshotOut,
    SnapshotRequest,
    StudentMove,
    StudentOut,
    StudentsCreate,
    StudentsCreated,
    StudentUpdate,
    TierOut,
    TierTargetsRequest,
)
from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, require_scope
from app.campuses.models import CAMPUS_KEYS
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1/admin/admissions/roster", tags=["admissions-roster"])


def _require_campus(user: User, capability: str, campus_key: str) -> None:
    """同招生入學的校區層級端點：沒有 capability 403、越權 404，不存在的校區也是 404。"""
    require_scope(user, capability, campus_keys=[campus_key])
    if campus_key not in CAMPUS_KEYS:
        raise ScopeDenied()


async def _locked_class(db: AsyncSession, user: User, class_id: uuid.UUID) -> RosterClass:
    """寫入用：鎖住班級列、讀最新值後再檢查權限。"""
    room = await service.get_class_for_update(db, class_id)
    if room is None:
        await db.rollback()
        raise ScopeDenied()
    require_scope(user, "admissions.write", campus_keys=[room.campus_key])
    return room


async def _fail(db: AsyncSession, exc: RosterError):
    await db.rollback()
    raise exc.to_http()


@router.post("/classes", response_model=ClassOut, status_code=status.HTTP_201_CREATED)
async def create_class(
    campus_key: str,
    payload: ClassCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ClassOut:
    _require_campus(current_user, "admissions.write", campus_key)
    try:
        room = await service.create_class(db, campus_key, payload, current_user.id)
    except RosterError as exc:
        await _fail(db, exc)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="roster_class.create",
        target_type="roster_class",
        target_id=str(room.id),
        campus_key=campus_key,
        metadata={"grade": room.grade, "class_code": room.class_code},
    )
    await db.commit()
    return ClassOut.model_validate(room)


@router.patch("/classes/{class_id}", response_model=ClassOut)
async def update_class(
    class_id: uuid.UUID,
    payload: ClassUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ClassOut:
    room = await _locked_class(db, current_user, class_id)
    try:
        changed = await service.update_class(db, room, payload, current_user.id)
    except RosterError as exc:
        await _fail(db, exc)
    if changed:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="roster_class.update",
            target_type="roster_class",
            target_id=str(room.id),
            campus_key=room.campus_key,
            metadata={"grade": room.grade, "class_code": room.class_code, "fields": changed},
        )
    await db.commit()
    return ClassOut.model_validate(room)


@router.delete("/classes/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_class(
    class_id: uuid.UUID,
    expected_version: int = Query(ge=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    room = await _locked_class(db, current_user, class_id)
    grade, class_code, campus_key = room.grade, room.class_code, room.campus_key
    try:
        await service.delete_class(db, room, expected_version)
    except RosterError as exc:
        await _fail(db, exc)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="roster_class.delete",
        target_type="roster_class",
        target_id=str(class_id),
        campus_key=campus_key,
        metadata={"grade": grade, "class_code": class_code},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _scoped_student(db: AsyncSession, user: User, student_id: uuid.UUID) -> uuid.UUID | None:
    """不加鎖先確認幼生存在、有寫入權限，回傳它目前的班級（要先鎖班級再鎖幼生）。"""
    peeked = await service.peek_student(db, student_id)
    if peeked is None:
        raise ScopeDenied()
    class_id, campus_key = peeked
    require_scope(user, "admissions.write", campus_keys=[campus_key])
    return class_id


async def _locked_student(db: AsyncSession, user: User, student_id: uuid.UUID) -> RosterStudent:
    """不重排班內順序的寫入用：鎖幼生列後再檢查權限。"""
    class_id = await _scoped_student(db, user, student_id)
    try:
        student, _ = await service.lock_student(db, student_id, set(), class_id)
    except RosterError as exc:
        await _fail(db, exc)
    if student is None:
        await db.rollback()
        raise ScopeDenied()
    return student


@router.post("/students", response_model=StudentsCreated, status_code=status.HTTP_201_CREATED)
async def create_students(
    campus_key: str,
    payload: StudentsCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> StudentsCreated:
    _require_campus(current_user, "admissions.write", campus_key)
    try:
        created, duplicates = await service.create_students(db, campus_key, payload, current_user.id)
    except RosterError as exc:
        await _fail(db, exc)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="roster_student.create",
        target_type="roster_student",
        target_id=str(created[0].id),
        campus_key=campus_key,
        metadata={"count": len(created), "status": created[0].status},
    )
    outs = await service.student_outs(db, created)
    await db.commit()
    return StudentsCreated(students=outs, duplicates=duplicates)


@router.patch("/students/{student_id}", response_model=StudentOut)
async def update_student(
    student_id: uuid.UUID,
    payload: StudentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> StudentOut:
    student = await _locked_student(db, current_user, student_id)
    try:
        changed = await service.update_student(db, student, payload, current_user.id)
    except RosterError as exc:
        await _fail(db, exc)
    if changed:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="roster_student.update",
            target_type="roster_student",
            target_id=str(student.id),
            campus_key=student.campus_key,
            metadata={"fields": changed},
        )
    [out] = await service.student_outs(db, [student])
    await db.commit()
    return out


@router.post("/students/{student_id}/move", response_model=StudentOut)
async def move_student(
    student_id: uuid.UUID,
    payload: StudentMove,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> StudentOut:
    class_id = await _scoped_student(db, current_user, student_id)
    try:
        student = await service.move_student(db, student_id, class_id, payload, current_user.id)
    except RosterError as exc:
        await _fail(db, exc)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="roster_student.move",
        target_type="roster_student",
        target_id=str(student.id),
        campus_key=student.campus_key,
        metadata={"class_changed": class_id != student.class_id},
    )
    [out] = await service.student_outs(db, [student])
    await db.commit()
    return out


async def _run_action(
    db: AsyncSession, user: User, student_id: uuid.UUID, action: str, handler, payload
) -> StudentOut:
    class_id = await _scoped_student(db, user, student_id)
    try:
        student = await handler(db, student_id, class_id, payload, user.id)
    except RosterError as exc:
        await _fail(db, exc)
    await audit_service.log_action(
        db,
        actor_user_id=user.id,
        action=action,
        target_type="roster_student",
        target_id=str(student.id),
        campus_key=student.campus_key,
        metadata={"status": student.status},
    )
    [out] = await service.student_outs(db, [student])
    await db.commit()
    return out


@router.post("/students/{student_id}/enter", response_model=StudentOut)
async def enter_student(
    student_id: uuid.UUID,
    payload: EnterRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> StudentOut:
    return await _run_action(db, current_user, student_id, "roster_student.enter", service.enter_student, payload)


@router.post("/students/{student_id}/leave", response_model=StudentOut)
async def leave_student(
    student_id: uuid.UUID,
    payload: LeaveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> StudentOut:
    return await _run_action(db, current_user, student_id, "roster_student.leave", service.leave_student, payload)


@router.post("/students/{student_id}/refund", response_model=StudentOut)
async def refund_student(
    student_id: uuid.UUID,
    payload: RefundRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> StudentOut:
    return await _run_action(db, current_user, student_id, "roster_student.refund", service.refund_student, payload)


@router.post("/students/{student_id}/restore", response_model=StudentOut)
async def restore_student(
    student_id: uuid.UUID,
    payload: RestoreRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> StudentOut:
    return await _run_action(db, current_user, student_id, "roster_student.restore", service.restore_student, payload)


@router.get("", response_model=RosterOut)
async def get_roster(
    campus_key: str,
    school_year: int = Query(ge=1, le=999),
    as_of: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RosterOut:
    """整張編班表、預繳名單與缺額統計。名單永遠是現在的狀態；統計數字跟著 as_of 回算。"""
    _require_campus(current_user, "admissions.read", campus_key)
    try:
        return await service.build_roster(db, campus_key, school_year, as_of)
    except RosterError as exc:
        raise exc.to_http() from exc


@router.put("/tier-targets", response_model=TierOut)
async def save_tier_targets(
    campus_key: str,
    payload: TierTargetsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> TierOut:
    _require_campus(current_user, "admissions.write", campus_key)
    out = await service.save_tier_targets(db, campus_key, payload, current_user.id)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="roster_tier.update",
        target_type="roster_tier",
        target_id=f"{campus_key}:{payload.school_year}:{payload.semester}",
        campus_key=campus_key,
        metadata={"school_year": payload.school_year, "semester": payload.semester},
    )
    await db.commit()
    return out


@router.post("/snapshots", response_model=SnapshotOut, status_code=status.HTTP_201_CREATED)
async def create_snapshot(
    campus_key: str,
    payload: SnapshotRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> SnapshotOut:
    _require_campus(current_user, "admissions.write", campus_key)
    try:
        snapshot = await service.create_snapshot(db, campus_key, payload, current_user.id)
    except RosterError as exc:
        await _fail(db, exc)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="roster_snapshot.create",
        target_type="roster_snapshot",
        target_id=str(snapshot.id),
        campus_key=campus_key,
        metadata={"school_year": payload.school_year, "as_of": payload.as_of.isoformat()},
    )
    out = service.snapshot_out(snapshot)
    await db.commit()
    return out
