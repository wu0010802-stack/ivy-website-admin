"""預約設定（後台讀寫、上線檢查）與官網讀的公開預約設定。

掛在 booking/routes.py 的 router 底下（prefix 與 tag 由那裡帶），註冊順序照拆分前（2026-10-20）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.booking import consent, readiness, service
from app.operations import audit_service
from app.booking.models import BookingMode
from app.booking.schemas import (
    BookingConfigOut,
    BookingConfigUpdateRequest,
    BookingImpactOut,
    BookingReadinessOut,
    BookingReadinessReason,
    PrivacyNoticeOut,
    PublicBookingConfigOut,
    has_control_chars,
)
from app.campuses.models import Campus
from app.booking.route_common import _campus_or_404


router = APIRouter()


@router.get("/admin/booking-config/{campus_key}", response_model=BookingConfigOut)
async def get_booking_config(
    campus_key: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> BookingConfigOut:
    require_scope(current_user, "booking.read", campus_keys=[campus_key])
    await _campus_or_404(db, campus_key)
    config = await service.get_or_create_config(db, campus_key)
    await db.commit()
    return BookingConfigOut.model_validate(config).model_copy(
        update={"parent_email_enabled": bool(request.app.state.settings.smtp_host)}
    )


@router.patch("/admin/booking-config/{campus_key}", response_model=BookingConfigOut)
async def update_booking_config(
    campus_key: str,
    payload: BookingConfigUpdateRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> BookingConfigOut:
    require_scope(current_user, "booking.manage", campus_keys=[campus_key])
    await _campus_or_404(db, campus_key)
    config = await service.get_or_create_config(db, campus_key, for_update=True)
    before = service.config_snapshot(config)

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
            parent_change_deadline_hours=payload.parent_change_deadline_hours,
        )
    except service.ConfigVersionConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "BOOKING_CONFIG_VERSION_CONFLICT", "message": "設定已被其他人更新，請重新載入"},
        ) from exc
    except readiness.ModeNotReady as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "BOOKING_MODE_NOT_READY",
                "message": exc.message,
                "reasons": [reason.as_dict() for reason in exc.reasons],
            },
        ) from exc

    after = service.config_snapshot(config)
    # 規格 L181：修改前後的完整設定都留下來，事後查得到改之前是什麼。
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="booking_config.update",
        target_type="booking_config",
        target_id=campus_key,
        campus_key=campus_key,
        metadata={
            "mode": payload.mode.value,
            "version": config.version,
            "parent_change_deadline_hours": config.parent_change_deadline_hours,
            "changed": [field for field in service.CONFIG_AUDIT_FIELDS if before[field] != after[field]],
            "before": before,
            "after": after,
        },
    )
    await db.commit()
    return BookingConfigOut.model_validate(config).model_copy(
        update={"parent_email_enabled": bool(request.app.state.settings.smtp_host)}
    )


@router.get("/admin/booking-config/{campus_key}/readiness", response_model=BookingReadinessOut)
async def get_booking_readiness(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> BookingReadinessOut:
    """各預約方式還缺什麼（要讀資料才知道的條件）與切換前的影響範圍。
    後台在切換前顯示「不可啟用原因」與確認框用。"""
    require_scope(current_user, "booking.read", campus_keys=[campus_key])
    await _campus_or_404(db, campus_key)
    config = await service.get_or_create_config(db, campus_key)
    blockers = await readiness.data_blockers(db, campus_key, config)
    impact = await readiness.impact(db, campus_key, config)
    await db.commit()
    return BookingReadinessOut(
        campus_key=campus_key,
        current_mode=config.mode,
        blockers={
            mode: [BookingReadinessReason(**reason.as_dict()) for reason in reasons]
            for mode, reasons in blockers.items()
        },
        impact=BookingImpactOut(**impact),
    )


@router.get("/public/booking-config/{campus_key}", response_model=PublicBookingConfigOut)
async def get_public_booking_config(
    campus_key: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> PublicBookingConfigOut:
    # 含控制字元（例如 %00）的 key 不可能是校區；不擋的話 PostgreSQL 拒收 NUL，變成 500。
    if has_control_chars(campus_key):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個校區")
    result = await db.execute(select(Campus).where(Campus.key == campus_key))
    campus = result.scalar_one_or_none()
    if campus is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個校區")

    # 公開讀取不寫庫：還沒有設定列的校區回「剛建立的預設設定」（暫停、版本 0），
    # 設定列由後台第一次讀／存、排時段與補登案件時建立（get_or_create_config）。
    # 送單端點沒有設定列時回「目前不開放預約」，與預設的暫停設定結果相同。
    config = await service.get_config(db, campus_key)
    privacy = await consent.published_privacy_notice(db)
    if config is None:
        out = PublicBookingConfigOut(
            campus_key=campus_key, mode=BookingMode.PAUSED, version=0,
            line_url=None, phone=None, external_url=None, message=None,
        )
    else:
        out = PublicBookingConfigOut.model_validate(config)
    settings = request.app.state.settings
    out = out.model_copy(update={"parent_email_enabled": bool(settings.smtp_host)})
    if settings.turnstile_enabled:
        out = out.model_copy(update={"turnstile_site_key": settings.turnstile_site_key})
    if privacy is not None:
        out = out.model_copy(update={
            "privacy_notice": PrivacyNoticeOut.model_validate({"title": privacy.title, "sections": privacy.sections}),
        })
    if not campus.active:
        # 規格 3.2：停用分校同時停止公開預約。對官網講「暫停」而不是 404，
        # 家長看到的是暫停說明與電話，不是讀取失敗；送單端點另外擋。
        out = out.model_copy(update={
            "mode": BookingMode.PAUSED,
            "message": "本校目前暫停受理線上參觀預約，請來電洽詢。",
            "line_url": None,
            "external_url": None,
        })
    return out
