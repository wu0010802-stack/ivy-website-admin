from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.booking import service
from app.booking.models import BookingConfig
from app.booking.schemas import (
    BookingConfigOut,
    BookingConfigUpdateRequest,
    PublicBookingConfigOut,
    VisitRequestCreate,
    VisitRequestOut,
)
from app.campuses.models import Campus

router = APIRouter(prefix="/api/website/v1", tags=["booking"])


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
    config = await service.get_or_create_config(db, campus_key)

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
    idempotency_key: str = Header(alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestOut:
    result = await db.execute(
        select(Campus).where(Campus.key == payload.campus_key, Campus.active.is_(True))
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個校區")

    body = payload.model_dump(exclude={"campus_key", "config_version"})

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

    await db.commit()
    response.status_code = status.HTTP_201_CREATED if is_new else status.HTTP_200_OK
    return VisitRequestOut(
        receipt_id=visit_request.id, status=visit_request.status, created_at=visit_request.created_at
    )
