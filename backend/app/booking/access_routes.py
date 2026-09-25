from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import campus_scope, require_scope
from app.booking import access_service, history, presenters, slot_service, workflow_service
from app.booking.exceptions import slot_unavailable
from app.booking.history import PARENT, Actor
from app.operations import audit_service
from app.booking.access_models import RescheduleRequest
from app.booking.models import VisitRequest, VisitRequestStatus
from app.booking.parent_policy import change_deadline_hours, parent_change_open
from app.common import ratelimit
from app.booking.schemas import (
    ParentAccessLinkCreatedOut,
    ParentVisitRequestOut,
    RescheduleDecisionRequest,
    RescheduleRequestOut,
    VisitRequestDetailOut,
)

router = APIRouter(prefix="/api/website/v1", tags=["parent-access"])

PARENT_SESSION_COOKIE = "ivy_parent_session"
PARENT_REQUEST_LIMIT = ratelimit.Limit("parent_request", window_seconds=60, max_per_window=30)


async def require_parent_request(request: Request, parent_header: str | None = Header(default=None, alias="X-Ivy-Parent")) -> None:
    # 非 simple request header：跨來源網頁無法以表單偽造，也不能在沒有
    # CORS 授權下通過 preflight。此 API 不開放跨來源 CORS。
    origin = request.headers.get("origin")
    allowed_origin = request.app.state.settings.admin_origin
    if parent_header != "1" or request.headers.get("sec-fetch-site") == "cross-site" or (allowed_origin and origin and origin != allowed_origin):
        raise HTTPException(status_code=403, detail={"code": "PARENT_REQUEST_FORBIDDEN", "message": "請從官網管理頁操作"})
    try:
        await ratelimit.limiter(request).check(PARENT_REQUEST_LIMIT, ratelimit.client_key(request))
    except ratelimit.RateLimited as exc:
        raise HTTPException(status_code=429, detail={"code": "RATE_LIMITED", "message": "操作太頻繁，請稍後再試"}, headers={"Retry-After": str(exc.retry_after_seconds)}) from exc


async def require_change_window(db: AsyncSession, visit_request: VisitRequest) -> None:
    """期限依該校設定（規格 L238），與家長頁顯示的截止時間同一個算法。"""
    hours = await change_deadline_hours(db, visit_request.campus_key)
    if not parent_change_open(visit_request, hours):
        raise HTTPException(status_code=409, detail={"code": "CHANGE_DEADLINE_PASSED", "message": "已超過線上異動時間，請直接聯絡園所"})


class TokenExchangeRequest(BaseModel):
    token: str


class RescheduleRequestCreate(BaseModel):
    new_slot_id: uuid.UUID


async def _require_parent_session(
    db: AsyncSession,
    session_token: str | None,
) -> VisitRequest:
    if session_token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登入")
    visit_request = await access_service.get_visit_request_for_session(db, session_token)
    if visit_request is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="連結已過期，請重新取得")
    return visit_request


async def _parent_output(db: AsyncSession, visit_request: VisitRequest) -> ParentVisitRequestOut:
    output = ParentVisitRequestOut.from_visit_request(
        visit_request, deadline_hours=await change_deadline_hours(db, visit_request.campus_key)
    )
    if visit_request.status == "confirmed":
        pending_id = await db.scalar(select(RescheduleRequest.id).where(
            RescheduleRequest.visit_request_id == visit_request.id,
            RescheduleRequest.status == "pending",
        ).limit(1))
        output.reschedule_pending = pending_id is not None
    return output


@router.post("/public/visit-manage/exchange", response_model=ParentVisitRequestOut, dependencies=[Depends(require_parent_request)])
async def exchange_parent_token(
    payload: TokenExchangeRequest,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> ParentVisitRequestOut:
    response.headers["Cache-Control"] = "private, no-store"
    try:
        raw_session_token, visit_request = await access_service.exchange_token(db, payload.token)
    except access_service.TokenInvalid as exc:
        await db.rollback()
        # 開啟另一條失效連結時，也清除這個瀏覽器上一筆案件的 cookie，
        # 避免重新整理後意外顯示上一筆預約。
        response.delete_cookie(
            PARENT_SESSION_COOKIE, path="/", httponly=True,
            secure=request.app.state.settings.environment == "production", samesite="lax",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_INVALID", "message": "連結已失效或過期"},
            headers={"Set-Cookie": response.headers["set-cookie"]},
        ) from exc
    await db.commit()
    response.set_cookie(
        key=PARENT_SESSION_COOKIE,
        value=raw_session_token,
        httponly=True,
        secure=request.app.state.settings.environment == "production",
        samesite="lax",
        max_age=int(access_service.SESSION_TTL.total_seconds()),
        path="/",
    )
    return await _parent_output(db, visit_request)


@router.get("/public/visit-manage/me", response_model=ParentVisitRequestOut)
async def get_own_visit_request(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> ParentVisitRequestOut:
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    return await _parent_output(db, visit_request)


@router.post("/public/visit-manage/cancel", response_model=ParentVisitRequestOut, dependencies=[Depends(require_parent_request)])
async def parent_cancel(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> ParentVisitRequestOut:
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    await require_change_window(db, visit_request)
    try:
        await workflow_service.cancel(db, visit_request, actor=PARENT)
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await db.commit()
    return await _parent_output(db, visit_request)


@router.post("/public/visit-manage/reschedule-request", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_parent_request)])
async def parent_request_reschedule(
    payload: RescheduleRequestCreate,
    response: Response,
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """只建立待核准紀錄，原時段維持不變，直到園方在 admin 端核准。"""
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    await require_change_window(db, visit_request)
    try:
        record = await access_service.create_reschedule_request(
            db, visit_request, payload.new_slot_id
        )
    except access_service.RescheduleNotAllowed as exc:
        await db.rollback()
        code = status.HTTP_404_NOT_FOUND if exc.code == "SLOT_NOT_FOUND" else status.HTTP_409_CONFLICT
        raise HTTPException(
            status_code=code, detail={"code": exc.code, "message": exc.message}
        ) from exc
    await db.commit()
    return {"id": str(record.id), "status": record.status}


# ---------------------------------------------------------------------------
# Admin：產生分享連結、審核改期申請
# ---------------------------------------------------------------------------


# 已結案的案件不再發連結：終態轉換時已經撤銷，家長也不能再取消或改期。
_CLOSED_STATUSES = {
    VisitRequestStatus.CANCELLED.value,
    VisitRequestStatus.COMPLETED.value,
    VisitRequestStatus.NO_SHOW.value,
}


@router.post("/admin/visit-requests/{visit_request_id}/access-link", response_model=ParentAccessLinkCreatedOut)
async def create_parent_access_link(
    visit_request_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ParentAccessLinkCreatedOut:
    """產生（或重新產生）家長管理連結（規格 6.4）。同一時間只有一條有效：
    重新產生會先撤銷舊連結與舊連結換到的 session，遺失或外流時直接換一條。

    完整網址用公開官網 origin（WEBSITE_ADMIN_ORIGIN），前端不寫死網域。
    原始 token 只在這個回應出現一次，資料庫、稽核與歷程都只記產生這件事。
    不會自動寄給家長——由園方自行轉交。"""
    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .where(VisitRequest.id == visit_request_id)
    )
    visit_request = result.scalar_one_or_none()
    if visit_request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    # 與取消、結案同一把案件列鎖，鎖住後重讀狀態：同時按兩次「重新產生」時
    # 後到的一方才看得到前一方剛建的連結並撤銷它；取消先提交時，這裡讀到
    # 的是已取消，不會替結案的案件留下一條可兌換的連結。
    await workflow_service.lock_status(db, visit_request)
    if visit_request.status in _CLOSED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": "案件已結案，不需要家長管理連結"},
        )

    replaced = await access_service.active_access_token(db, visit_request_id) is not None
    await access_service.revoke_access_for_visit_request(db, visit_request_id)
    raw_token, expires_at = await access_service.create_access_token(db, visit_request_id)
    fragment = f"/visit/manage#token={raw_token}"
    origin = request.app.state.settings.admin_origin
    history.record_event(
        db,
        visit_request.id,
        "access_link_created",
        actor=Actor.staff(current_user.id),
        after={"expires_at": expires_at.isoformat(), "replaced_previous": replaced},
    )
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.create_access_link",
        target_type="visit_request",
        target_id=str(visit_request_id),
        campus_key=visit_request.campus_key,
        metadata={"expires_at": expires_at.isoformat(), "replaced_previous": replaced},
    )
    await db.commit()
    return ParentAccessLinkCreatedOut(
        manage_url=f"{origin.rstrip('/')}{fragment}" if origin else None,
        manage_url_fragment=fragment,
        expires_at=expires_at,
        replaced_previous=replaced,
    )


@router.post("/admin/visit-requests/{visit_request_id}/revoke-access", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_parent_access_link(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """規格 6.4 要求 token「可撤銷」。家長回報連結外流時，園方要有辦法
    讓它立刻失效——在此之前 repo 裡沒有任何撤銷路徑。"""
    result = await db.execute(select(VisitRequest).where(VisitRequest.id == visit_request_id))
    visit_request = result.scalar_one_or_none()
    if visit_request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])

    had_link = await access_service.active_access_token(db, visit_request_id) is not None
    await access_service.revoke_access_for_visit_request(db, visit_request_id)
    if had_link:
        history.record_event(db, visit_request.id, "access_link_revoked", actor=Actor.staff(current_user.id))
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.revoke_access",
        target_type="visit_request",
        target_id=str(visit_request_id),
        campus_key=visit_request.campus_key,
    )
    await db.commit()


@router.get("/admin/reschedule-requests", response_model=list[RescheduleRequestOut])
async def list_reschedule_requests(
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[RescheduleRequestOut]:
    """待核准的家長改期申請，最早送出的在前。帶家長稱呼、原時段、申請的
    新時段與新時段剩餘名額，園方不必點進案件就能判斷。

    沒指定校區時列出你負責的所有校區，與側欄徽章、總覽的待核准數同一個
    範圍：點進站內通知就看得到那幾件，不必一校一校切。"""
    require_scope(current_user, "booking.read")
    stmt = (
        select(RescheduleRequest, VisitRequest)
        .join(VisitRequest, RescheduleRequest.visit_request_id == VisitRequest.id)
        .where(
            RescheduleRequest.status == "pending",
            VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
        )
        .order_by(RescheduleRequest.created_at)
    )
    if campus_key:
        require_scope(current_user, "booking.read", campus_keys=[campus_key])
        stmt = stmt.where(VisitRequest.campus_key == campus_key)
    else:
        scope = campus_scope(current_user)
        if scope is not None:
            stmt = stmt.where(VisitRequest.campus_key.in_(scope))
    result = await db.execute(stmt)
    return await presenters.reschedule_request_outs(db, list(result.tuples().all()))


async def _load_pending_decision(
    db: AsyncSession, current_user: User, request_id: uuid.UUID
) -> tuple[RescheduleRequest, VisitRequest]:
    """取出申請與案件並依序上鎖：先案件列、再申請列，跟取消／結案（先鎖
    案件、再把待核准申請標成 closed）同一個順序，避免互相等待。已處理或
    已失效的申請回 409，不是 404——園方看到的清單可能已經過期。"""
    record = await db.get(RescheduleRequest, request_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")
    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .where(VisitRequest.id == record.visit_request_id)
    )
    visit_request = result.scalar_one()
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    await workflow_service.lock_status(db, visit_request)
    await db.refresh(record, attribute_names=["status"], with_for_update=True)
    if record.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": "這筆改期申請已經處理過或已失效，請重新整理"},
        )
    return record, visit_request


@router.post("/admin/reschedule-requests/{request_id}/approve", response_model=VisitRequestDetailOut)
async def approve_reschedule_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    record, visit_request = await _load_pending_decision(db, current_user, request_id)
    old_slot = visit_request.slot
    try:
        await workflow_service.reschedule(
            db,
            visit_request,
            record.requested_slot_id,
            actor=Actor.staff(current_user.id),
            reason="核准家長線上申請的改期",
            approving_request_id=record.id,
        )
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise slot_unavailable(exc, subject="新時段") from exc
    except slot_service.SlotNotBookable as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_NOT_BOOKABLE", "message": exc.message},
        ) from exc
    except workflow_service.InvalidTransition as exc:
        # 家長送出申請之後案件才被取消／標記完成，核准時就會走到這裡。
        # 沒接的話整支端點回 500。
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc

    record.status = "approved"
    record.resolved_at = datetime.now(timezone.utc)
    record.resolved_by = current_user.id
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.approve_reschedule",
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={
            "reschedule_request_id": str(record.id),
            "from_slot_id": str(old_slot.id) if old_slot else None,
            "to_slot_id": str(record.requested_slot_id),
        },
    )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/reschedule-requests/{request_id}/reject", response_model=dict)
async def reject_reschedule_request(
    request_id: uuid.UUID,
    payload: RescheduleDecisionRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """退回：家長維持原時段。原因選填，記在申請與案件歷程。"""
    record, visit_request = await _load_pending_decision(db, current_user, request_id)
    reason = (payload.reason or "").strip() if payload else ""
    record.status = "rejected"
    record.resolved_at = datetime.now(timezone.utc)
    record.resolved_by = current_user.id
    record.reject_reason = reason or None
    history.record_event(
        db,
        visit_request.id,
        "reschedule_rejected",
        actor=Actor.staff(current_user.id),
        after={"requested_slot": history.slot_brief(await history.load_slot(db, record.requested_slot_id))},
        reason=reason or None,
    )
    # 退回原因是自由文字，只記有沒有填。
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.reject_reschedule",
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={
            "reschedule_request_id": str(record.id),
            "requested_slot_id": str(record.requested_slot_id),
            "has_reason": bool(reason),
        },
    )
    await db.commit()
    return {"id": str(record.id), "status": record.status}
