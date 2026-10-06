from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Cookie, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import campus_scope, require_scope
from app.booking import access_service, history, presenters, slot_service, workflow_service
from app.booking.access_models import RescheduleRequest
from app.booking.exceptions import slot_unavailable
from app.booking.history import PARENT, Actor
from app.booking.models import BookingConfig, BookingMode, VisitRequest, VisitRequestStatus
from app.booking.outbox import PARENT_VISIT_BOOKED, PARENT_VISIT_CHANGED, enqueue_parent_email
from app.booking.parent_policy import change_deadline_hours, parent_change_open
from app.booking.schemas import (
    ParentAccessLinkCreatedOut,
    ParentDetailsUpdate,
    ParentRescheduleRequest,
    ParentVisitRequestOut,
    RescheduleDecisionRequest,
    RescheduleRequestOut,
    ResendConfirmationOut,
    VisitRequestDetailOut,
)
from app.campuses.models import Campus
from app.common import ratelimit
from app.content import service as content_service
from app.operations import audit_service

logger = logging.getLogger("app.booking")

router = APIRouter(prefix="/api/website/v1", tags=["parent-access"])

PARENT_SESSION_COOKIE = "ivy_parent_session"
PARENT_REQUEST_LIMIT = ratelimit.Limit("parent_request", window_seconds=60, max_per_window=30)
# 每案每日上限：每次改期、改資料都會寄信給家長並通知園方，持有連結的人不能無限重送。
# 只有成功（commit 後）才記一次，失敗的嘗試不吃額度。
PARENT_RESCHEDULE_PER_CASE = ratelimit.Limit(
    "parent_reschedule_case", window_seconds=86400, max_per_window=access_service.PARENT_RESCHEDULES_PER_DAY
)
PARENT_EDIT_PER_CASE = ratelimit.Limit("parent_edit_case", window_seconds=86400, max_per_window=10)


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


async def require_case_quota(request: Request, limit: ratelimit.Limit, visit_request_id: uuid.UUID) -> None:
    """寫入前檢查這一案今天的次數（只看不記）。在案件上鎖之前呼叫：限流器用自己的
    連線池，不能握著案件列鎖等它。"""
    if await ratelimit.limiter(request).is_limited(limit, str(visit_request_id)):
        # is_limited 不回剩餘秒數，Retry-After 給整個窗口（保守上限），與公開送單的手機上限相同。
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "這筆預約今天已經修改很多次了，請明天再試，或直接聯絡園所"},
            headers={"Retry-After": str(limit.window_seconds)},
        )


async def count_case_change(request: Request, limit: ratelimit.Limit, visit_request_id: uuid.UUID) -> None:
    """操作成功並 commit 之後才記一次。"""
    try:
        await ratelimit.limiter(request).record(limit, str(visit_request_id))
    except SQLAlchemyError:
        # 已經改好了：記不到次數不該讓家長看到失敗、再送一次。
        logger.warning("家長異動的每案次數寫入失敗：bucket=%s", limit.bucket, exc_info=True)


def parent_email_enabled(request: Request) -> bool:
    """與公開預約設定的 parent_email_enabled 同一個判斷：沒設 SMTP 就不會真的寄給家長。"""
    return bool(request.app.state.settings.smtp_host)


class TokenExchangeRequest(BaseModel):
    token: str


class ParentCancelRequest(BaseModel):
    # 家長頁畫面上的案件；對不上目前 session 的案件就拒絕（_require_same_visit_request）。
    visit_request_id: uuid.UUID


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


def _require_same_visit_request(visit_request: VisitRequest, expected_id: uuid.UUID | None) -> None:
    """同一個瀏覽器的分頁共用一個 session cookie：另一個分頁開了別筆預約的連結後，
    這個分頁畫面上還是舊的那筆，按取消或改期卻會照 cookie 改到另一筆（2026-09-30
    E2E）。官網異動一律帶畫面上的案件 id，對不上就拒絕，兩筆都不動。

    沒帶（None）照舊依 session 處理：CD 先部署 API 再部署 web，部署前就開著的家長頁
    與 web 上線前的空窗都是舊版官網，取消不帶 body；發布版本需前後相容
    （deploy/CICD.md）。"""
    if expected_id is not None and visit_request.id != expected_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "PARENT_SESSION_CHANGED", "message": "這個瀏覽器已改為管理另一筆預約，請重新開啟這筆預約的管理連結"},
        )


async def _parent_output(db: AsyncSession, visit_request: VisitRequest) -> ParentVisitRequestOut:
    campus = await db.get(Campus, visit_request.campus_key)
    config = await db.get(BookingConfig, visit_request.campus_key)
    profile = await content_service.published_payload(db, "campus_profile", visit_request.campus_key) or {}
    output = ParentVisitRequestOut.from_visit_request(
        visit_request,
        deadline_hours=await change_deadline_hours(db, visit_request.campus_key),
        campus_name=str(profile.get("name") or "").strip() or (campus.name if campus is not None else ""),
        campus_active=campus is None or campus.active,
        campus_phone=str(profile.get("phone") or "").strip() or None,
        slots_open=config is not None and config.mode == BookingMode.SLOTS,
    )
    # 家長改資料用自己的版本（不是園方承辦人／下次聯絡的 version）。
    output.version = await workflow_service.details_version(db, visit_request.id)
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
    payload: ParentCancelRequest | None = Body(default=None),
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> ParentVisitRequestOut:
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    _require_same_visit_request(visit_request, payload.visit_request_id if payload else None)
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


@router.post("/public/visit-manage/reschedule-request", include_in_schema=False)
async def parent_request_reschedule_retired() -> None:
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail={"code": "ENDPOINT_RETIRED", "message": "改期已改成直接選新場次，請重新整理頁面"},
    )


def _conflict(code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": code, "message": message, **extra})


@router.post(
    "/public/visit-manage/reschedule",
    response_model=ParentVisitRequestOut,
    dependencies=[Depends(require_parent_request)],
)
async def parent_reschedule(
    payload: ParentRescheduleRequest,
    response: Response,
    request: Request,
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> ParentVisitRequestOut:
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    _require_same_visit_request(visit_request, payload.visit_request_id)
    await require_change_window(db, visit_request)
    visit_request_id = visit_request.id
    await require_case_quota(request, PARENT_RESCHEDULE_PER_CASE, visit_request_id)
    try:
        await access_service.validate_parent_reschedule(db, visit_request, payload.slot_id)
        await workflow_service.reschedule(db, visit_request, payload.slot_id, actor=PARENT)
    except access_service.RescheduleNotAllowed as exc:
        await db.rollback()
        if exc.code == "SLOT_NOT_FOUND":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail={"code": exc.code, "message": exc.message}
            ) from exc
        if exc.code == "RATE_LIMITED":
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"code": exc.code, "message": exc.message},
                headers={"Retry-After": str(PARENT_RESCHEDULE_PER_CASE.window_seconds)},
            ) from exc
        raise _conflict(exc.code, exc.message) from exc
    except workflow_service.SlotNotFound as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"code": "SLOT_NOT_FOUND", "message": "找不到這個時段"}
        ) from exc
    except workflow_service.SlotClosed as exc:
        await db.rollback()
        raise _conflict("SLOT_CLOSED", "這個場次已停止申請") from exc
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise _conflict("SLOT_FULL", "這個場次剛好額滿了，請選擇其他場次") from exc
    except slot_service.SlotNotBookable as exc:
        await db.rollback()
        raise _conflict("SLOT_NOT_BOOKABLE", "這個場次目前無法預約") from exc
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise _conflict("INVALID_TRANSITION", exc.message) from exc
    await db.commit()
    await count_case_change(request, PARENT_RESCHEDULE_PER_CASE, visit_request_id)
    await db.refresh(visit_request, attribute_names=["slot"])
    return await _parent_output(db, visit_request)


@router.patch(
    "/public/visit-manage/me",
    response_model=ParentVisitRequestOut,
    dependencies=[Depends(require_parent_request)],
)
async def parent_update_details(
    payload: ParentDetailsUpdate,
    response: Response,
    request: Request,
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> ParentVisitRequestOut:
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    _require_same_visit_request(visit_request, payload.visit_request_id)
    await require_change_window(db, visit_request)
    # 與 can_edit 同一個條件：停用的分校不接受線上異動（取消照常）。
    campus = await db.get(Campus, visit_request.campus_key)
    if campus is not None and not campus.active:
        raise _conflict("BOOKING_UNAVAILABLE", "本校目前暫停受理線上參觀預約，要修改資料請來電洽詢")
    visit_request_id = visit_request.id
    await require_case_quota(request, PARENT_EDIT_PER_CASE, visit_request_id)
    try:
        changed = await workflow_service.update_details_by_parent(
            db, visit_request, payload.changes(), expected_version=payload.expected_version
        )
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise _conflict("INVALID_TRANSITION", exc.message) from exc
    except workflow_service.VersionConflict as exc:
        await db.rollback()
        raise _conflict(
            "VISIT_REQUEST_VERSION_CONFLICT",
            "這筆預約剛被修改過，請重新載入後再改",
            current_version=exc.current_version,
        ) from exc
    await db.commit()
    if changed:
        # 沒有實際變更時什麼都沒寫、也不寄信，不吃額度。
        await count_case_change(request, PARENT_EDIT_PER_CASE, visit_request_id)
    return await _parent_output(db, visit_request)


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
    """重新產生家長管理連結並寄出（規格 3.6）。同一時間只有一條有效：重新產生會先
    撤銷舊連結與舊連結換到的 session，遺失或外流時直接換一條。

    完整網址用公開官網 origin（WEBSITE_ADMIN_ORIGIN），前端不寫死網域。原始 token
    不存資料庫（只存雜湊），由密鑰與 token 列 id 重算；稽核與歷程都只記產生這件事。

    有 Email 時排一封「預約已變更」給家長（信在寄件當下重算連結）。emailed 只有在
    真的會寄出（另外還要有設定 SMTP）時為 True，否則園方要自行把連結交給家長。"""
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
    raw_token, expires_at = await access_service.issue_access_token(
        db, visit_request_id, secret=request.app.state.settings.session_secret, slot=visit_request.slot
    )
    mail_parent = bool(visit_request.email)
    if mail_parent:
        # 沒設 SMTP 也照排：之後設好，24 小時內仍會寄出。
        await enqueue_parent_email(db, visit_request, PARENT_VISIT_CHANGED)
    emailed = mail_parent and parent_email_enabled(request)
    fragment = access_service.manage_path(raw_token)
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
        emailed=emailed,
    )


@router.post(
    "/admin/visit-requests/{visit_request_id}/resend-confirmation",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ResendConfirmationOut,
)
async def resend_parent_confirmation(
    visit_request_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ResendConfirmationOut:
    """重寄預約成功信給家長。連結沿用目前有效的那條（寄件時重算），沒有就補發。
    沒設 SMTP 時回 409 PARENT_EMAIL_DISABLED：不排信、不記稽核，園方改把連結直接交給家長。"""
    result = await db.execute(
        select(VisitRequest).options(selectinload(VisitRequest.slot)).where(VisitRequest.id == visit_request_id)
    )
    visit_request = result.scalar_one_or_none()
    if visit_request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    await workflow_service.lock_status(db, visit_request)
    if visit_request.status != VisitRequestStatus.CONFIRMED.value or not visit_request.email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "RESEND_NOT_AVAILABLE", "message": "只有已排入場次、有 Email 的預約可以重寄確認信"},
        )
    if not parent_email_enabled(request):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "PARENT_EMAIL_DISABLED", "message": "尚未設定寄信，無法寄出確認信；請把修改連結直接交給家長"},
        )
    await access_service.ensure_access_token(
        db,
        visit_request.id,
        secret=request.app.state.settings.session_secret,
        slot=visit_request.slot,
        actor=Actor.staff(current_user.id),
    )
    await enqueue_parent_email(db, visit_request, PARENT_VISIT_BOOKED)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.resend_confirmation",
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={},
    )
    await db.commit()
    return ResendConfirmationOut(queued=True)


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
