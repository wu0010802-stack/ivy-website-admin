from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.booking import access_service, workflow_service
from app.booking.access_models import RescheduleRequest
from app.booking.models import VisitRequest
from app.booking.schemas import VisitRequestDetailOut

router = APIRouter(prefix="/api/website/v1", tags=["parent-access"])

PARENT_SESSION_COOKIE = "ivy_parent_session"


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


@router.post("/public/visit-manage/exchange", response_model=VisitRequestDetailOut)
async def exchange_parent_token(
    payload: TokenExchangeRequest,
    response: Response,
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    response.headers["Cache-Control"] = "private, no-store"
    try:
        raw_session_token, visit_request = await access_service.exchange_token(db, payload.token)
    except access_service.TokenInvalid as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_INVALID", "message": "連結已失效或過期"},
        ) from exc
    await db.commit()
    response.set_cookie(
        key=PARENT_SESSION_COOKIE,
        value=raw_session_token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=int(access_service.SESSION_TTL.total_seconds()),
        path="/",
    )
    return VisitRequestDetailOut.model_validate(visit_request)


@router.get("/public/visit-manage/me", response_model=VisitRequestDetailOut)
async def get_own_visit_request(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/public/visit-manage/cancel", response_model=VisitRequestDetailOut)
async def parent_cancel(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    try:
        await workflow_service.cancel(db, visit_request)
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/public/visit-manage/reschedule-request", status_code=status.HTTP_201_CREATED)
async def parent_request_reschedule(
    payload: RescheduleRequestCreate,
    response: Response,
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """只建立待核准紀錄，原時段維持不變，直到園方在 admin 端核准。"""
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    record = await access_service.create_reschedule_request(
        db, visit_request.id, payload.new_slot_id
    )
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
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])

    raw_token = await access_service.create_access_token(db, visit_request_id)
    await db.commit()
    # 原始 token 只在這裡回傳一次；資料庫只存 hash。
    return {"manage_url_fragment": f"/visit/manage#token={raw_token}"}


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
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])

    try:
        await workflow_service.reschedule(db, visit_request, record.requested_slot_id)
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_FULL", "message": "新時段名額已滿"},
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
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])

    record.status = "rejected"
    record.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return {"id": str(record.id), "status": record.status}
