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
from app.auth.permissions import require_scope
from app.booking import access_service, workflow_service
from app.operations import audit_service
from app.booking.access_models import RescheduleRequest
from app.booking.models import VisitRequest
from app.booking.parent_policy import parent_change_open
from app.common import ratelimit
from app.booking.schemas import ParentVisitRequestOut, VisitRequestDetailOut

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


def require_change_window(visit_request: VisitRequest) -> None:
    if not parent_change_open(visit_request):
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
    output = ParentVisitRequestOut.from_visit_request(visit_request)
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
    require_change_window(visit_request)
    try:
        await workflow_service.cancel(db, visit_request)
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await db.commit()
    return ParentVisitRequestOut.from_visit_request(visit_request)


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
    require_change_window(visit_request)
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


@router.post("/admin/visit-requests/{visit_request_id}/access-link")
async def create_parent_access_link(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .where(VisitRequest.id == visit_request_id)
    )
    visit_request = result.scalar_one_or_none()
    if visit_request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])

    raw_token = await access_service.create_access_token(db, visit_request_id)
    await db.commit()
    # 原始 token 只在這裡回傳一次；資料庫只存 hash。
    return {"manage_url_fragment": f"/visit/manage#token={raw_token}"}


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

    await access_service.revoke_access_for_visit_request(db, visit_request_id)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.revoke_access",
        target_type="visit_request",
        target_id=str(visit_request_id),
        campus_key=visit_request.campus_key,
    )
    await db.commit()


@router.get("/admin/reschedule-requests", response_model=list[dict])
async def list_reschedule_requests(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    require_scope(current_user, "booking.read", campus_keys=[campus_key])
    result = await db.execute(
        select(RescheduleRequest, VisitRequest)
        .join(VisitRequest, RescheduleRequest.visit_request_id == VisitRequest.id)
        .where(VisitRequest.campus_key == campus_key, RescheduleRequest.status == "pending")
    )
    return [
        {
            "id": str(req.id),
            "visit_request_id": str(req.visit_request_id),
            "requested_slot_id": str(req.requested_slot_id),
            "created_at": req.created_at.isoformat(),
        }
        for req, _vr in result.all()
    ]


@router.post("/admin/reschedule-requests/{request_id}/approve", response_model=VisitRequestDetailOut)
async def approve_reschedule_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    result = await db.execute(select(RescheduleRequest).where(RescheduleRequest.id == request_id))
    record = result.scalar_one_or_none()
    if record is None or record.status != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")

    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .where(VisitRequest.id == record.visit_request_id)
    )
    visit_request = result.scalar_one()
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])

    try:
        await workflow_service.reschedule(db, visit_request, record.requested_slot_id)
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_FULL", "message": "新時段名額已滿"},
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
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/reschedule-requests/{request_id}/reject", response_model=dict)
async def reject_reschedule_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:

    result = await db.execute(select(RescheduleRequest).where(RescheduleRequest.id == request_id))
    record = result.scalar_one_or_none()
    if record is None or record.status != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")

    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .where(VisitRequest.id == record.visit_request_id)
    )
    visit_request = result.scalar_one()
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])

    record.status = "rejected"
    record.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return {"id": str(record.id), "status": record.status}
