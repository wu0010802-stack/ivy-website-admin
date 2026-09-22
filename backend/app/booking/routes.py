from __future__ import annotations

import csv
import io
import uuid
from datetime import date

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, require_scope
from app.booking import service, slot_service, workflow_service
from app.common import ratelimit
from app.operations import audit_service
from app.booking.models import BookingConfig, VisitContactNote, VisitRequest, VisitSlot
from app.booking.schemas import (
    BookingConfigOut,
    BookingConfigUpdateRequest,
    PublicBookingConfigOut,
    PublicVisitSlotOut,
    VisitContactNoteCreateRequest,
    VisitContactNoteOut,
    VisitRequestConfirmRequest,
    VisitRequestCreate,
    VisitRequestDetailOut,
    VisitRequestOut,
    VisitRequestRescheduleRequest,
    VisitSlotCreateRequest,
    VisitSlotOut,
    VisitSlotUpdateRequest,
)
from app.campuses.models import Campus

router = APIRouter(prefix="/api/website/v1", tags=["booking"])

# 規格 199：公開提交要有限流，超過回 429。沒有限流的話，任何人都能無限
# 灌入含家長姓名與手機的案件，同時對每一筆觸發園方通知。
#
# 刻意用兩個桶。只綁來源 IP 是不夠可靠的：公開 API 全部經 Nuxt server
# route 代理進來，除非部署端確實帶上 trusted_client_ip_header，否則所有
# 家長會共用同一個桶，真正的家長會被彼此擋住。所以：
# - 手機號碼桶是主要防線，不依賴任何代理設定（同一個家庭本來就不該在
#   十分鐘內連送五次）。
# - 來源桶的上限放寬，只用來擋「單一來源換號碼狂灌」，即使退化成整站
#   共用一個桶也不會誤傷正常流量。
_SUBMIT_LIMITER_BY_PHONE = ratelimit.SlidingWindowLimiter(window_seconds=600, max_per_window=5)
_SUBMIT_LIMITER_BY_CLIENT = ratelimit.SlidingWindowLimiter(window_seconds=600, max_per_window=60)


@router.get("/admin/booking-config/{campus_key}", response_model=BookingConfigOut)
async def get_booking_config(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> BookingConfigOut:
    require_scope(current_user, "booking.read", campus_keys=[campus_key])
    config = await service.get_or_create_config(db, campus_key)
    await db.commit()
    return BookingConfigOut.model_validate(config)


@router.patch("/admin/booking-config/{campus_key}", response_model=BookingConfigOut)
async def update_booking_config(
    campus_key: str,
    payload: BookingConfigUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> BookingConfigOut:
    require_scope(current_user, "booking.manage", campus_keys=[campus_key])
    config = await service.get_or_create_config(db, campus_key, for_update=True)

    try:
        await service.update_config(
            db,
            config,
            mode=payload.mode,
            line_url=payload.line_url,
            phone=payload.phone,
            external_url=payload.external_url,
            message=payload.message,
            expected_version=payload.expected_version,
            updated_by=current_user.id,
            slots_auto_confirm=payload.slots_auto_confirm,
        )
    except service.ConfigVersionConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "BOOKING_CONFIG_VERSION_CONFLICT", "message": "設定已被其他人更新，請重新載入"},
        ) from exc
    except service.ModeFieldMissing as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "BOOKING_MODE_FIELD_MISSING", "message": exc.message},
        ) from exc

    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="booking_config.update",
        target_type="booking_config",
        target_id=campus_key,
        campus_key=campus_key,
        metadata={"mode": payload.mode.value, "version": config.version},
    )
    await db.commit()
    return BookingConfigOut.model_validate(config)


@router.get("/public/booking-config/{campus_key}", response_model=PublicBookingConfigOut)
async def get_public_booking_config(
    campus_key: str,
    db: AsyncSession = Depends(get_db_session),
) -> PublicBookingConfigOut:
    result = await db.execute(select(Campus).where(Campus.key == campus_key, Campus.active.is_(True)))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個校區")

    config = await service.get_or_create_config(db, campus_key)
    await db.commit()
    return PublicBookingConfigOut.model_validate(config)


@router.post("/public/visit-requests", response_model=VisitRequestOut)
async def create_visit_request(
    payload: VisitRequestCreate,
    response: Response,
    request: Request,
    # 長度上限對齊 models.py 的 String(128)：沒有上限時超長的 key 會一路
    # 打到 DB 才炸成 500，而不是乾淨的 422。
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=128),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestOut:
    try:
        _SUBMIT_LIMITER_BY_CLIENT.check(ratelimit.client_key(request))
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "送出次數過多，請稍後再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

    result = await db.execute(
        select(Campus).where(Campus.key == payload.campus_key, Campus.active.is_(True))
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個校區")

    body = payload.model_dump(mode="json", exclude={"campus_key", "config_version"})

    try:
        visit_request, is_new = await service.submit_visit_request(
            db,
            campus_key=payload.campus_key,
            idempotency_key=idempotency_key,
            payload=body,
            config_version=payload.config_version,
        )
    except service.IdempotencyConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "IDEMPOTENCY_CONFLICT", "message": "同樣的識別碼已用不同內容送出過"},
        ) from exc
    except service.BookingConfigVersionChanged as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "BOOKING_CONFIG_CHANGED", "message": "預約設定已變更，請重新整理頁面"},
        ) from exc
    except service.BookingUnavailable as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "BOOKING_UNAVAILABLE", "message": "此校區目前不接受線上預約表單"},
        ) from exc
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_FULL", "message": "這個時段名額已滿，請選擇其他時段"},
        ) from exc
    except slot_service.SlotNotBookable as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_NOT_BOOKABLE", "message": exc.message},
        ) from exc

    # 手機桶只對「真的新建了一筆」計數。冪等重播（前端逾時重送、使用者
    # 連點）本來就不會多建案件，把它算進限流會讓正常的重試被擋成 429。
    if is_new:
        try:
            _SUBMIT_LIMITER_BY_PHONE.check(f"{payload.campus_key}:{payload.phone}")
        except ratelimit.RateLimited as exc:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"code": "RATE_LIMITED", "message": "送出次數過多，請稍後再試"},
                headers={"Retry-After": str(exc.retry_after_seconds)},
            ) from exc

    await db.commit()
    response.status_code = status.HTTP_201_CREATED if is_new else status.HTTP_200_OK
    return VisitRequestOut(
        receipt_id=visit_request.id, status=visit_request.status, created_at=visit_request.created_at
    )


# ---------------------------------------------------------------------------
# Slots
# ---------------------------------------------------------------------------


def _slot_out(slot: VisitSlot, booked: int) -> VisitSlotOut:
    return VisitSlotOut(
        id=slot.id,
        campus_key=slot.campus_key,
        slot_date=slot.slot_date,
        start_time=slot.start_time,
        end_time=slot.end_time,
        capacity=slot.capacity,
        closed=slot.closed,
        booked_count=booked,
    )


@router.get("/admin/slots", response_model=list[VisitSlotOut])
async def list_admin_slots(
    campus_key: str,
    date_from: date = Query(...),
    date_to: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[VisitSlotOut]:
    require_scope(current_user, "booking.read", campus_keys=[campus_key])
    try:
        slots = await slot_service.list_slots(db, campus_key, date_from, date_to)
    except slot_service.SlotQueryRangeTooWide as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "QUERY_RANGE_TOO_WIDE", "message": "查詢區間過長，請縮小範圍"},
        ) from exc
    result = []
    for slot in slots:
        booked = await slot_service.count_booked(db, slot.id)
        result.append(_slot_out(slot, booked))
    return result


@router.post("/admin/slots", response_model=VisitSlotOut, status_code=status.HTTP_201_CREATED)
async def create_admin_slot(
    campus_key: str,
    payload: VisitSlotCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitSlotOut:
    require_scope(current_user, "booking.manage", campus_keys=[campus_key])
    slot = await slot_service.create_slot(
        db,
        campus_key=campus_key,
        slot_date=payload.slot_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        capacity=payload.capacity,
        created_by=current_user.id,
    )
    await db.commit()
    return _slot_out(slot, 0)


@router.patch("/admin/slots/{slot_id}", response_model=VisitSlotOut)
async def update_admin_slot(
    slot_id: uuid.UUID,
    payload: VisitSlotUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitSlotOut:
    slot = await slot_service.get_slot_for_update(db, slot_id)
    if slot is None:
        raise ScopeDenied()
    require_scope(current_user, "booking.manage", campus_keys=[slot.campus_key])
    try:
        slot = await slot_service.update_slot(
            db, slot, capacity=payload.capacity, closed=payload.closed
        )
    except slot_service.SlotCapacityBelowBooked as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "CAPACITY_BELOW_BOOKED",
                "message": exc.args[0],
                "booked_count": exc.booked_count,
            },
        ) from exc
    await db.commit()
    booked = await slot_service.count_booked(db, slot.id)
    return _slot_out(slot, booked)


@router.get("/public/slots", response_model=list[PublicVisitSlotOut])
async def list_public_slots(
    campus_key: str,
    date_from: date = Query(...),
    date_to: date = Query(...),
    db: AsyncSession = Depends(get_db_session),
) -> list[PublicVisitSlotOut]:
    try:
        slots = await slot_service.list_slots(db, campus_key, date_from, date_to)
    except slot_service.SlotQueryRangeTooWide as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "QUERY_RANGE_TOO_WIDE", "message": "查詢區間過長，請縮小範圍"},
        ) from exc
    result = []
    for slot in slots:
        # 與送單共用同一份判斷（closed／已過去／未達最短提前時間／
        # 超過最遠開放天數），避免公開頁列出根本訂不了的時段。
        if not slot_service.is_publicly_bookable(slot):
            continue
        booked = await slot_service.count_booked(db, slot.id)
        remaining = max(slot.capacity - booked, 0)
        if remaining <= 0:
            continue
        result.append(
            PublicVisitSlotOut(
                id=slot.id,
                slot_date=slot.slot_date,
                start_time=slot.start_time,
                end_time=slot.end_time,
                remaining=remaining,
            )
        )
    return result


# ---------------------------------------------------------------------------
# Visit request workflow / reception workbench
# ---------------------------------------------------------------------------


async def _get_owned_visit_request(db: AsyncSession, user: User, visit_request_id: uuid.UUID) -> VisitRequest:
    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .where(VisitRequest.id == visit_request_id)
    )
    visit_request = result.scalar_one_or_none()
    if visit_request is None:
        raise ScopeDenied()
    require_scope(user, "booking.read", campus_keys=[visit_request.campus_key])
    return visit_request


@router.get("/admin/visit-requests", response_model=list[VisitRequestDetailOut])
async def list_visit_requests(
    campus_key: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=100, description="家長或寶貝姓名、電話或 Email 片段"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[VisitRequestDetailOut]:
    require_scope(current_user, "booking.read")
    stmt = select(VisitRequest).options(selectinload(VisitRequest.slot))
    if campus_key:
        require_scope(current_user, "booking.read", campus_keys=[campus_key])
        stmt = stmt.where(VisitRequest.campus_key == campus_key)
    elif current_user.role.value != "super_admin":
        owned = [s.campus_key for s in current_user.campus_scopes]
        stmt = stmt.where(VisitRequest.campus_key.in_(owned))
    if status_filter:
        stmt = stmt.where(VisitRequest.status == status_filter)
    if q and q.strip():
        # 櫃台接電話時用姓名或號碼找人。使用者打的 % 與 _ 是字面值，
        # 不跳脫的話一個 % 就會把整個校區的案件全撈出來。
        needle = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{needle}%"
        stmt = stmt.where(
            or_(
                VisitRequest.parent_name.ilike(pattern, escape="\\"),
                VisitRequest.child_name.ilike(pattern, escape="\\"),
                VisitRequest.email.ilike(pattern, escape="\\"),
                VisitRequest.phone.like(pattern, escape="\\"),
            )
        )
    stmt = stmt.order_by(VisitRequest.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    return [VisitRequestDetailOut.model_validate(r) for r in result.scalars()]


@router.get("/admin/visit-requests/export")
async def export_visit_requests(
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    require_scope(current_user, "booking.export")
    stmt = select(VisitRequest).options(selectinload(VisitRequest.slot))
    if campus_key:
        require_scope(current_user, "booking.export", campus_keys=[campus_key])
        stmt = stmt.where(VisitRequest.campus_key == campus_key)
    elif current_user.role.value != "super_admin":
        owned = [s.campus_key for s in current_user.campus_scopes]
        stmt = stmt.where(VisitRequest.campus_key.in_(owned))
    stmt = stmt.order_by(VisitRequest.created_at.desc())
    result = await db.execute(stmt)

    def _safe_cell(value: str | None) -> str:
        """CSV 公式注入防護：儲存格開頭若是 = + - @ 這些會被試算表當成
        公式執行的字元，前面補一個單引號讓它變成純文字。"""
        text = "" if value is None else str(value)
        if text and text[0] in ("=", "+", "-", "@"):
            return "'" + text
        return text

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "campus_key", "status", "parent_name", "phone", "created_at",
        "child_name", "child_birthdate", "email", "referral_sources",
        "slot_date", "start_time", "end_time",
    ])
    exported = 0
    for r in result.scalars():
        writer.writerow(
            [
                _safe_cell(r.campus_key),
                _safe_cell(r.status),
                _safe_cell(r.parent_name),
                _safe_cell(r.phone),
                r.created_at.isoformat(),
                _safe_cell(r.child_name),
                r.child_birthdate.isoformat() if r.child_birthdate else "",
                _safe_cell(r.email),
                _safe_cell(";".join(r.referral_sources)),
                r.slot.slot_date.isoformat() if r.slot else "",
                r.slot.start_time.isoformat() if r.slot else "",
                r.slot.end_time.isoformat() if r.slot else "",
            ]
        )
        exported += 1

    # 個資批次外流一定要留痕：誰、什麼時候、匯出了哪個校區的幾筆。
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.export",
        target_type="visit_request",
        target_id=campus_key or "all",
        campus_key=campus_key,
        metadata={"row_count": exported},
    )
    await db.commit()
    return Response(content=buffer.getvalue(), media_type="text/csv")


@router.get("/admin/visit-requests/{visit_request_id}", response_model=VisitRequestDetailOut)
async def get_visit_request(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    return VisitRequestDetailOut.model_validate(visit_request)


@router.get("/admin/visit-requests/{visit_request_id}/contact-notes", response_model=list[VisitContactNoteOut])
async def list_contact_notes(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[VisitContactNoteOut]:
    await _get_owned_visit_request(db, current_user, visit_request_id)
    result = await db.execute(
        select(VisitContactNote)
        .where(VisitContactNote.visit_request_id == visit_request_id)
        .order_by(VisitContactNote.created_at.desc())
    )
    return [VisitContactNoteOut.model_validate(n) for n in result.scalars()]


@router.post(
    "/admin/visit-requests/{visit_request_id}/contact-notes",
    response_model=VisitContactNoteOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_contact_note(
    visit_request_id: uuid.UUID,
    payload: VisitContactNoteCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitContactNoteOut:
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])
    note = await workflow_service.add_contact_note(
        db,
        visit_request,
        note=payload.note,
        follow_up_at=payload.follow_up_at,
        created_by=current_user.id,
    )
    await db.commit()
    return VisitContactNoteOut.model_validate(note)


@router.post("/admin/visit-requests/{visit_request_id}/confirm", response_model=VisitRequestDetailOut)
async def confirm_visit_request(
    visit_request_id: uuid.UUID,
    payload: VisitRequestConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])
    try:
        await workflow_service.confirm_with_slot(
            db, visit_request, payload.slot_id, current_user.id
        )
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_FULL", "message": "這個時段名額已滿"},
        ) from exc
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/cancel", response_model=VisitRequestDetailOut)
async def cancel_visit_request(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])
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


@router.post("/admin/visit-requests/{visit_request_id}/no-show", response_model=VisitRequestDetailOut)
async def mark_no_show(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])
    try:
        await workflow_service.mark_no_show(db, visit_request)
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/reschedule", response_model=VisitRequestDetailOut)
async def reschedule_visit_request(
    visit_request_id: uuid.UUID,
    payload: VisitRequestRescheduleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])
    try:
        await workflow_service.reschedule(db, visit_request, payload.new_slot_id)
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_FULL", "message": "新時段名額已滿，原時段維持不變"},
        ) from exc
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)
