"""招生入學 API（規格 13；/api/website/v1/admin/admissions/*）。

service（records、funnel、intake、booking_link）只 flush、丟自訂例外；這裡檢查
權限、把例外轉成 HTTP 錯誤、寫稽核並 commit，失敗時先 rollback。稽核的
action、target_type 與 metadata 一律寫字面值（admin labelCoverage 測試會掃），
metadata 不放個資。

單筆端點先載入訪視、再用訪視上的 campus_key 檢查權限：查無與越權一律 404
（ScopeDenied），沒有 capability 是 403。"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic, booking_link, constants, follow_up, funnel, intake, records
from app.admissions import stats as stats_service
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.admissions.schemas import (
    AdmissionsCompareOut,
    AdmissionsOptionsOut,
    AdmissionsStaffOut,
    AdmissionsStatsOut,
    ContactLogCreate,
    ContactLogOut,
    ContactLogResultOut,
    FollowUpKind,
    FollowUpListOut,
    FollowUpUpdate,
    FunnelBoardOut,
    IntakePlanOut,
    IntakeTargetsRequest,
    NoDepositRecordsOut,
    RecruitmentEventOut,
    RecruitmentVisitCreate,
    RecruitmentVisitOut,
    RecruitmentVisitUpdate,
    SeatOut,
    SeatRequest,
    TransitionRequest,
)
from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, covers_campus, require_scope
from app.booking.models import VisitRequest, VisitRequestStatus
from app.campuses.models import CAMPUS_KEYS
from app.common.timezones import today_local
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["admissions"])


def _require_campus(user: User, capability: str, campus_key: str) -> None:
    """校區層級的端點：先檢查權限（沒有 capability 403、越權 404），總管理者帶
    不存在的校區也回 404，不要變成空清單或外鍵錯誤。"""
    require_scope(user, capability, campus_keys=[campus_key])
    if campus_key not in CAMPUS_KEYS:
        raise ScopeDenied()


async def _visit_for(db: AsyncSession, user: User, visit_id: uuid.UUID, capability: str) -> RecruitmentVisit:
    visit = await db.get(RecruitmentVisit, visit_id)
    if visit is None:
        raise ScopeDenied()
    require_scope(user, capability, campus_keys=[visit.campus_key])
    return visit


async def _locked_visit_for(db: AsyncSession, user: User, visit_id: uuid.UUID, capability: str) -> RecruitmentVisit:
    """寫入用：鎖住訪視列、讀最新值後再檢查權限（同 PATCH /admin/slots）。"""
    visit = await records.get_visit_for_update(db, visit_id)
    if visit is None:
        await db.rollback()
        raise ScopeDenied()
    require_scope(user, capability, campus_keys=[visit.campus_key])
    return visit


async def _writable_visit_for(db: AsyncSession, user: User, visit_id: uuid.UUID, capability: str) -> RecruitmentVisit:
    """編輯、狀態轉換、保留座位用：鎖列、檢查權限後，已依保存政策匿名化的訪視
    回 409（在版本比對之前：重新載入也改不了，直接告訴使用者原因）。刪除不擋。"""
    visit = await _locked_visit_for(db, user, visit_id, capability)
    if visit.anonymized_at is not None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "RECRUITMENT_VISIT_ANONYMIZED", "message": "這筆招生訪視已依保存政策匿名化，不能再修改"},
        )
    return visit


def _version_conflict(exc: records.VersionConflict) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "RECRUITMENT_VISIT_VERSION_CONFLICT",
            "message": "這筆招生訪視剛被其他人修改，請重新載入後再操作",
            "current_version": exc.current_version,
        },
    )


def _tour_guide_invalid() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "TOUR_GUIDE_INVALID", "message": "找不到這位帶參觀老師的帳號"},
    )


@router.get("/admin/admissions/options", response_model=AdmissionsOptionsOut)
async def get_admissions_options(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AdmissionsOptionsOut:
    _require_campus(current_user, "admissions.read", campus_key)
    return AdmissionsOptionsOut.model_validate(await records.options(db, campus_key))


@router.get("/admin/admissions/records", response_model=list[RecruitmentVisitOut])
async def list_recruitment_visits(
    filters: records.RecruitmentVisitFilters = Depends(),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[RecruitmentVisitOut]:
    """訪視明細：參觀日期新到舊（同日依建立時間、再依 id，分頁穩定）；回裸 list，
    筆數等於 page_size 代表可能還有下一頁。"""
    _require_campus(current_user, "admissions.read", filters.campus_key)
    stmt = filters.apply(select(RecruitmentVisit), current_user_id=current_user.id)
    stmt = stmt.order_by(
        RecruitmentVisit.visit_date.desc(), RecruitmentVisit.created_at.desc(), RecruitmentVisit.id.desc()
    )
    result = await db.execute(stmt.offset((page - 1) * page_size).limit(page_size))
    return [RecruitmentVisitOut.model_validate(visit) for visit in result.scalars()]


@router.post("/admin/admissions/records", response_model=RecruitmentVisitOut, status_code=status.HTTP_201_CREATED)
async def create_recruitment_visit(
    campus_key: str,
    payload: RecruitmentVisitCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecruitmentVisitOut:
    """手動新增（規格 6.1 第 3 點）：沒有預約的現場參觀。追蹤負責人預設是建立的人，
    不自動排下次聯絡（2026-10-04 規格 6.1）。"""
    _require_campus(current_user, "admissions.write", campus_key)
    tracking = await follow_up.initial_fields(
        db, campus_key=campus_key, booking_follow_up_at=None, owner_candidates=[current_user.id]
    )
    try:
        visit = await records.create_visit(
            db,
            campus_key=campus_key,
            fields=payload.model_dump(),
            actor_user_id=current_user.id,
            origin="manual",
            **tracking,
        )
    except records.TourGuideNotFound as exc:
        await db.rollback()
        raise _tour_guide_invalid() from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.create",
        target_type="recruitment_visit",
        target_id=str(visit.id),
        campus_key=campus_key,
        metadata={"origin": "manual"},
    )
    await db.commit()
    return RecruitmentVisitOut.model_validate(visit)


@router.get("/admin/admissions/records/{visit_id}", response_model=RecruitmentVisitOut)
async def get_recruitment_visit(
    visit_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecruitmentVisitOut:
    return RecruitmentVisitOut.model_validate(await _visit_for(db, current_user, visit_id, "admissions.read"))


@router.patch("/admin/admissions/records/{visit_id}", response_model=RecruitmentVisitOut)
async def update_recruitment_visit(
    visit_id: uuid.UUID,
    payload: RecruitmentVisitUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecruitmentVisitOut:
    """編輯表單欄位（規格 6.6）：狀態欄位不在 schema 裡，送了就 422；已匿名化 409。"""
    visit = await _writable_visit_for(db, current_user, visit_id, "admissions.write")
    changes = payload.model_dump(exclude_unset=True, exclude={"expected_version"})
    try:
        changed = await records.update_visit(db, visit, changes=changes, expected_version=payload.expected_version)
    except records.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    except records.TourGuideNotFound as exc:
        await db.rollback()
        raise _tour_guide_invalid() from exc
    if changed:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="recruitment_visit.update",
            target_type="recruitment_visit",
            target_id=str(visit.id),
            campus_key=visit.campus_key,
            metadata={"fields": changed},
        )
    await db.commit()
    return RecruitmentVisitOut.model_validate(visit)


@router.delete("/admin/admissions/records/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recruitment_visit(
    visit_id: uuid.UUID,
    expected_version: int = Query(ge=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """刪除訪視與歷程（規格 6.6）。稽核只記階段，不記姓名電話。由預約建立的
    訪視被刪掉後，可以從預約明細再補建（A6）。已匿名化的也可以刪。

    檢查順序同狀態轉換：鎖列並確認讀得到這筆（404／403）→ 版本（409）→ 已註冊、
    或從已註冊退出的訪視另要 admissions.convert（403）：刪掉等於撤銷註冊紀錄，
    與取消註冊、退註冊同一個權限。"""
    visit = await _locked_visit_for(db, current_user, visit_id, "admissions.write")
    if visit.version != expected_version:
        current = visit.version
        await db.rollback()
        raise _version_conflict(records.VersionConflict(current))
    stage = funnel.derive_stage(visit)
    campus_key = visit.campus_key
    if stage == "enrolled" or (stage == "withdrawn" and visit.withdrawn_from == "enrolled"):
        try:
            require_scope(current_user, "admissions.convert", campus_keys=[campus_key])
        except HTTPException:
            await db.rollback()
            raise
    try:
        await records.delete_visit(db, visit, expected_version=expected_version)
    except records.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.delete",
        target_type="recruitment_visit",
        target_id=str(visit_id),
        campus_key=campus_key,
        metadata={"stage": stage},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/admissions/records/{visit_id}/events", response_model=list[RecruitmentEventOut])
async def list_recruitment_events(
    visit_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[RecruitmentEventOut]:
    """招生歷程，舊到新（園務 timeline 同順序）。操作者名稱讀取時才 join，帳號改名
    後跟著更新，歷程裡不存姓名。"""
    await _visit_for(db, current_user, visit_id, "admissions.read")
    result = await db.execute(
        select(RecruitmentEventLog, User.display_name, User.email)
        .outerjoin(User, User.id == RecruitmentEventLog.actor_user_id)
        .where(RecruitmentEventLog.recruitment_visit_id == visit_id)
        .order_by(RecruitmentEventLog.created_at, RecruitmentEventLog.id)
    )
    return [
        RecruitmentEventOut(
            id=event.id,
            event_type=event.event_type,
            from_stage=event.from_stage,
            to_stage=event.to_stage,
            reason=event.reason,
            metadata_json=event.metadata_json,
            actor_user_id=event.actor_user_id,
            actor_name=display_name or email,
            created_at=event.created_at,
        )
        for event, display_name, email in result.all()
    ]


_FIELD_NAMES = {"reason": "原因", "grade": "年級", "target_school_year": "入學學年"}


@router.post("/admin/admissions/records/{visit_id}/transition", response_model=RecruitmentVisitOut)
async def transition_recruitment_visit(
    visit_id: uuid.UUID,
    payload: TransitionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecruitmentVisitOut:
    """狀態轉換（規格 6.3）。檢查順序：鎖列並確認讀得到這筆（404／403）→ 已匿名化
    （409）→ 版本（409）→ 這個轉換允不允許（422）→ 這個轉換要的 capability（403）。
    版本放在權限之前：別人剛把卡片拖到別欄，這次一律 409 重新載入，不會因為卡片
    已換欄而誤回 403（A 計畫調整第 10 條）。"""
    visit = await _writable_visit_for(db, current_user, visit_id, "admissions.read")
    if visit.version != payload.expected_version:
        current = visit.version
        await db.rollback()
        raise _version_conflict(records.VersionConflict(current))
    from_stage = funnel.derive_stage(visit)
    capability = funnel.transition_capability(from_stage, payload.to_stage)
    if capability is None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "TRANSITION_NOT_ALLOWED", "message": funnel.not_allowed_reason(from_stage, payload.to_stage)},
        )
    require_scope(current_user, capability, campus_keys=[visit.campus_key])
    try:
        await funnel.transition(
            db,
            visit,
            to_stage=payload.to_stage,
            expected_version=payload.expected_version,
            actor_user_id=current_user.id,
            reason=payload.reason,
            deposit_collector=payload.deposit_collector,
            enrolled_on=payload.enrolled_on,
            grade=payload.grade,
            target_school_year=payload.target_school_year,
            target_semester=payload.target_semester,
        )
    except records.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    except funnel.TransitionNotAllowed as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "TRANSITION_NOT_ALLOWED", "message": exc.message},
        ) from exc
    except funnel.TransitionFieldsMissing as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "TRANSITION_FIELDS_REQUIRED",
                "message": "請填寫：" + "、".join(_FIELD_NAMES.get(name, name) for name in exc.fields),
                "fields": exc.fields,
            },
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.transition",
        target_type="recruitment_visit",
        target_id=str(visit.id),
        campus_key=visit.campus_key,
        metadata={"from_stage": from_stage, "to_stage": payload.to_stage, "has_reason": payload.reason is not None},
    )
    await db.commit()
    return RecruitmentVisitOut.model_validate(visit)


@router.get("/admin/admissions/board", response_model=FunnelBoardOut)
async def get_funnel_board(
    campus_key: str,
    school_year: int | None = Query(
        default=None, ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX, description="入學學年；不帶＝目前學年"
    ),
    semester: int | None = Query(default=None, ge=1, le=2, description="入學學期；不帶＝整學年"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> FunnelBoardOut:
    _require_campus(current_user, "admissions.read", campus_key)
    year = school_year if school_year is not None else academic.current_term(today_local())[0]
    return FunnelBoardOut.model_validate(await funnel.board(db, campus_key, year, semester))


@router.post("/admin/admissions/records/{visit_id}/seat", response_model=SeatOut)
async def set_recruitment_seat(
    visit_id: uuid.UUID,
    payload: SeatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> SeatOut:
    """保留或釋放座位（規格 6.5）。超過計畫名額只警示，照樣保留；已匿名化 409。"""
    visit = await _writable_visit_for(db, current_user, visit_id, "admissions.write")
    try:
        warning = await intake.set_seat(
            db,
            visit,
            grade=payload.grade,
            target_school_year=payload.target_school_year,
            target_semester=payload.target_semester,
            expected_version=payload.expected_version,
            actor_user_id=current_user.id,
        )
    except records.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    except intake.SeatNotAllowed as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "SEAT_NOT_ALLOWED", "message": exc.message},
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.seat",
        target_type="recruitment_visit",
        target_id=str(visit.id),
        campus_key=visit.campus_key,
        metadata={"grade_set": payload.grade is not None, "capacity_warning": warning},
    )
    await db.commit()
    return SeatOut(
        visit=RecruitmentVisitOut.model_validate(visit),
        capacity_warning=warning,
        warning_code="SEAT_CAPACITY_WARNING" if warning else None,
    )


@router.get("/admin/admissions/intake-plan", response_model=IntakePlanOut)
async def get_intake_plan(
    campus_key: str,
    school_year: int = Query(ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX),
    semester: int = Query(default=1, ge=1, le=2),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> IntakePlanOut:
    _require_campus(current_user, "admissions.read", campus_key)
    return IntakePlanOut.model_validate(await intake.intake_plan(db, campus_key, school_year, semester))


@router.put("/admin/admissions/intake-targets", response_model=IntakePlanOut)
async def save_intake_targets(
    campus_key: str,
    payload: IntakeTargetsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> IntakePlanOut:
    """存計畫名額後回傳最新的名額規劃。沒有任何變動不寫稽核。"""
    _require_campus(current_user, "admissions.write", campus_key)
    changed = await intake.save_targets(
        db, campus_key, payload.school_year, payload.semester, dict(payload.targets), current_user.id
    )
    if changed:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="grade_intake_target.update",
            target_type="grade_intake_target",
            target_id=f"{campus_key}:{payload.school_year}:{payload.semester}",
            campus_key=campus_key,
            metadata={"school_year": payload.school_year, "semester": payload.semester, "grades": changed},
        )
    plan = await intake.intake_plan(db, campus_key, payload.school_year, payload.semester)
    await db.commit()
    return IntakePlanOut.model_validate(plan)


@router.post("/admin/admissions/from-visit-request/{visit_request_id}", response_model=RecruitmentVisitOut)
async def create_from_visit_request(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecruitmentVisitOut:
    """補建：已到場但沒有招生訪視的預約建立一筆；已有就回傳那一筆，可以重複呼叫
    （規格 6.1 第 2 點、6.6）。只接受已到場且未匿名化的預約（A 計畫調整第 13 條）。"""
    visit_request = await db.scalar(
        select(VisitRequest)
        .where(VisitRequest.id == visit_request_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if visit_request is None:
        await db.rollback()
        raise ScopeDenied()
    require_scope(current_user, "booking.read", campus_keys=[visit_request.campus_key])
    require_scope(current_user, "admissions.write", campus_keys=[visit_request.campus_key])
    if visit_request.anonymized_at is not None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "VISIT_REQUEST_ANONYMIZED", "message": "這筆預約已依保存政策匿名化，無法建立招生訪視"},
        )
    if visit_request.status != VisitRequestStatus.COMPLETED.value:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "VISIT_REQUEST_NOT_COMPLETED", "message": "只有已到場的預約可以建立招生訪視，請先標記已到場"},
        )
    visit, created = await booking_link.ensure_from_visit_request(db, visit_request, actor_user_id=current_user.id)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.create_from_booking",
        target_type="recruitment_visit",
        target_id=str(visit.id),
        campus_key=visit.campus_key,
        metadata={"created": created},
    )
    await db.commit()
    return RecruitmentVisitOut.model_validate(visit)


# ---- 參觀後追蹤（docs/specs/2026-10-04-admissions-follow-up-design.md 第 6、9 節）----


def _follow_up_error(exc: Exception) -> HTTPException:
    """follow_up 服務的例外 → 422（訊息給畫面直接顯示）。"""
    if isinstance(exc, follow_up.FollowUpInPast):
        code, message = "FOLLOW_UP_IN_PAST", "下次聯絡的時間要晚於現在"
    elif isinstance(exc, follow_up.FollowUpNotAllowed):
        code, message = "FOLLOW_UP_NOT_ALLOWED", "已註冊或已退出的訪視不需要排下次聯絡"
    elif isinstance(exc, follow_up.ContactedAtInFuture):
        code, message = "CONTACTED_AT_IN_FUTURE", "聯絡時間不能晚於現在"
    elif isinstance(exc, follow_up.OwnerInvalid):
        code, message = "FOLLOW_UP_OWNER_INVALID", exc.message
    else:  # pragma: no cover - 呼叫端只傳上面四種
        raise exc
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": code, "message": message})


_FOLLOW_UP_ERRORS = (
    follow_up.FollowUpInPast,
    follow_up.FollowUpNotAllowed,
    follow_up.ContactedAtInFuture,
    follow_up.OwnerInvalid,
)


@router.get("/admin/admissions/follow-ups", response_model=FollowUpListOut)
async def get_follow_ups(
    campus_key: str,
    scope: FollowUpKind = Query(default="due", description="due 已到期、upcoming 7 天內、unscheduled 未排定"),
    owner: str | None = Query(default=None, pattern=constants.OWNER_FILTER_PATTERN, description="me、none 或帳號 id"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=follow_up.FOLLOW_UP_LIST_PAGE_SIZE_MAX),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> FollowUpListOut:
    """待追蹤分頁（規格 7.1）。不吃入學學年學期：追蹤跟入學學期無關。"""
    _require_campus(current_user, "admissions.read", campus_key)
    result = await follow_up.follow_up_list(
        db,
        campus_key,
        kind=scope,
        owner=owner,
        current_user_id=current_user.id,
        page=page,
        page_size=page_size,
    )
    return FollowUpListOut.model_validate(result)


@router.get("/admin/admissions/staff", response_model=list[AdmissionsStaffOut])
async def list_admissions_staff(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[AdmissionsStaffOut]:
    """可以當這個校區追蹤負責人的帳號（規格 6.4、9）：啟用中、有 admissions.write、涵蓋該校區。"""
    _require_campus(current_user, "admissions.read", campus_key)
    users = await follow_up.eligible_staff(db, campus_key)
    return [AdmissionsStaffOut(id=user.id, display_name=user.display_name, email=user.email) for user in users]


@router.get("/admin/admissions/records/{visit_id}/contact-logs", response_model=list[ContactLogOut])
async def list_contact_logs(
    visit_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[ContactLogOut]:
    """參觀後的聯絡紀錄，新到舊（規格 9）。"""
    await _visit_for(db, current_user, visit_id, "admissions.read")
    return [
        ContactLogOut.model_validate(log).model_copy(update={"created_by_name": name})
        for log, name in await follow_up.list_contact_logs(db, visit_id)
    ]


@router.post(
    "/admin/admissions/records/{visit_id}/contact-logs",
    response_model=ContactLogResultOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_contact_log(
    visit_id: uuid.UUID,
    payload: ContactLogCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ContactLogResultOut:
    """記錄一次聯絡（規格 6.3）。檢查順序同狀態轉換：鎖列並確認讀得到這筆（404／403）→
    已匿名化（409）→ 版本（409）→ 時間與階段規則（422）。稽核不記內容。"""
    visit = await _writable_visit_for(db, current_user, visit_id, "admissions.write")
    try:
        log = await follow_up.add_contact_log(
            db,
            visit,
            expected_version=payload.expected_version,
            contacted_at=payload.contacted_at,
            channel=payload.channel,
            reached=payload.reached,
            note=payload.note,
            next_follow_up_at=payload.next_follow_up_at,
            update_parent_response=payload.update_parent_response,
            actor_user_id=current_user.id,
        )
    except records.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    except _FOLLOW_UP_ERRORS as exc:
        await db.rollback()
        raise _follow_up_error(exc) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="recruitment_visit.contact_logged",
        target_type="recruitment_visit",
        target_id=str(visit.id),
        campus_key=visit.campus_key,
        metadata={
            "log_id": str(log.id),
            "channel": log.channel,
            "reached": log.reached,
            "follow_up_set": payload.next_follow_up_at is not None,
            "follow_up_cleared": payload.next_follow_up_at is None,
            "parent_response_updated": payload.update_parent_response,
        },
    )
    await db.commit()
    return ContactLogResultOut(
        log=ContactLogOut.model_validate(log).model_copy(
            update={"created_by_name": current_user.display_name or current_user.email}
        ),
        visit=RecruitmentVisitOut.model_validate(visit),
    )


@router.patch("/admin/admissions/records/{visit_id}/follow-up", response_model=RecruitmentVisitOut)
async def update_follow_up(
    visit_id: uuid.UUID,
    payload: FollowUpUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RecruitmentVisitOut:
    """只改下次聯絡或負責人，不記聯絡（規格 6.4）。沒送＝不動，送 null＝清除。"""
    visit = await _writable_visit_for(db, current_user, visit_id, "admissions.write")
    changes = payload.model_dump(include=payload.model_fields_set - {"expected_version"})
    try:
        changed = await follow_up.update_follow_up(
            db, visit, changes=changes, expected_version=payload.expected_version
        )
    except records.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    except _FOLLOW_UP_ERRORS as exc:
        await db.rollback()
        raise _follow_up_error(exc) from exc
    if changed:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="recruitment_visit.follow_up_update",
            target_type="recruitment_visit",
            target_id=str(visit.id),
            campus_key=visit.campus_key,
            metadata={
                "follow_up_set": "follow_up_at" in changed and visit.follow_up_at is not None,
                "follow_up_cleared": "follow_up_at" in changed and visit.follow_up_at is None,
                "owner_changed": "follow_up_owner_id" in changed,
            },
        )
    await db.commit()
    return RecruitmentVisitOut.model_validate(visit)


@router.get("/admin/admissions/stats", response_model=AdmissionsStatsOut)
async def get_admissions_stats(
    campus_key: str,
    school_year: int | None = Query(
        default=None, ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX, description="入學學年；不帶＝不篩"
    ),
    semester: int | None = Query(default=None, ge=1, le=2),
    reference_month: str | None = Query(default=None, max_length=10, description="民國月份，例：115.09；不帶＝最新有資料的月份"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AdmissionsStatsOut:
    """統計分析（規格第 9 節）。只讀，不寫稽核。"""
    _require_campus(current_user, "admissions.read", campus_key)
    try:
        result = await stats_service.query_stats(
            db, campus_key, school_year=school_year, semester=semester, reference_month=reference_month
        )
    except stats_service.InvalidReferenceMonth as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_REFERENCE_MONTH", "message": str(exc)},
        ) from exc
    return AdmissionsStatsOut.model_validate(result)


@router.get("/admin/admissions/compare", response_model=AdmissionsCompareOut)
async def get_admissions_compare(
    school_year: int = Query(ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX),
    semester: int | None = Query(default=None, ge=1, le=2),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AdmissionsCompareOut:
    """五校比較：只列使用者授權範圍內的校區（super_admin 為五校）。只讀，不寫稽核。
    semester 沒帶＝件數算整學年；名額剩餘用上學期（回應 seat_semester 標明）。"""
    require_scope(current_user, "admissions.read")
    campus_keys = [key for key in CAMPUS_KEYS if covers_campus(current_user, key)]
    result = await stats_service.compare(db, campus_keys, school_year=school_year, semester=semester)
    return AdmissionsCompareOut.model_validate(result)


@router.get("/admin/admissions/no-deposit-records", response_model=NoDepositRecordsOut)
async def get_admissions_no_deposit_records(
    campus_key: str,
    school_year: int | None = Query(default=None, ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX),
    semester: int | None = Query(default=None, ge=1, le=2),
    reason: str | None = Query(default=None, max_length=60),
    grade: str | None = Query(default=None, max_length=20),
    priority: Literal["high", "medium", "low"] | None = Query(default=None),
    overdue_days: int | None = Query(default=None, ge=1, le=365),
    cold_only: bool | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> NoDepositRecordsOut:
    """未預繳明細（園務 /no-deposit-analysis）。含孩子姓名，權限同統計；只讀，不寫稽核。"""
    _require_campus(current_user, "admissions.read", campus_key)
    result = await stats_service.no_deposit_records(
        db,
        campus_key,
        school_year=school_year,
        semester=semester,
        reason=reason,
        grade=grade,
        priority=priority,
        overdue_days=overdue_days,
        cold_only=cold_only,
        page=page,
        page_size=page_size,
    )
    return NoDepositRecordsOut.model_validate(result)
