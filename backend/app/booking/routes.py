from __future__ import annotations

import csv
import io
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, campus_scope, has_capability, require_scope, roles_with
from app.booking import (
    access_service,
    attention,
    consent,
    presenters,
    readiness,
    service,
    slot_service,
    status_groups,
    turnstile,
    workflow_service,
)
from app.booking.exceptions import slot_unavailable
from app.booking.history import Actor
from app.common import ratelimit
from app.common.timezones import local_day_bounds_utc, today_local
from app.operations import audit_service, retention_service
from app.booking.models import (
    BookingConfig,
    BookingMode,
    VisitContactNote,
    VisitRequest,
    VisitRequestSource,
    VisitRequestStatus,
    VisitSlot,
)
from app.booking.schemas import (
    VisitGroupCountsOut,
    BookingConfigOut,
    BookingConfigUpdateRequest,
    BookingConsentBriefOut,
    BookingImpactOut,
    BookingReadinessOut,
    BookingReadinessReason,
    CalendarSlotOut,
    CalendarVisitOut,
    PrivacyNoticeOut,
    PublicBookingConfigOut,
    PublicVisitSlotOut,
    VisitContactNoteCreateRequest,
    VisitContactNoteOut,
    VisitRequestAssignRequest,
    VisitRequestCancelRequest,
    VisitRequestConfirmRequest,
    VisitRequestCreate,
    VisitRequestDetailOut,
    VisitRequestFullOut,
    VisitRequestManualCreate,
    VisitRequestOut,
    VisitRequestRescheduleRequest,
    VisitSlotCreateRequest,
    VisitSlotOut,
    VisitSlotUpdateRequest,
    VisitStaffOut,
    has_control_chars,
)
from app.campuses.models import Campus

router = APIRouter(prefix="/api/website/v1", tags=["booking"])

logger = logging.getLogger("app.booking")

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
SUBMIT_LIMIT_BY_PHONE = ratelimit.Limit("visit_submit_phone", window_seconds=600, max_per_window=5)
SUBMIT_LIMIT_BY_CLIENT = ratelimit.Limit("visit_submit_client", window_seconds=600, max_per_window=60)
# 公開時段查詢：官網只在換校區時查一次，一分鐘 60 次對正常家長綽綽有餘。
PUBLIC_SLOTS_LIMIT = ratelimit.Limit("public_slots_client", window_seconds=60, max_per_window=60)

# 公開送單的濫用上限（稽核 slot-hoarding-no-bot-protection）。上限值來自設定
# （WEBSITE_BOOKING_*），bucket 固定：
# - 每個來源 24 小時內最多占幾個時段名額（slots 模式；inquiry 不占名額不算）。
# - 每校每小時最多收幾筆官網送單（全部模式），灌單時的斷路器。觸發時整校
#   的家長都會被擋（429 BOOKING_LIMIT），所以前面再加一道：
# - 同一來源對同一校每小時最多幾筆（全部模式）。沒有這道時，一個匿名 IP 在
#   inquiry 模式換手機號碼就能用光每校額度、讓整校停收（稽核
#   campus-cap-single-source-dos）；現在單一來源最多用掉預設每校額度（30）的 1/6。
SLOT_HOLD_BUCKET = "visit_slot_hold_source"
CAMPUS_SUBMIT_BUCKET = "visit_submit_campus"
SUBMIT_LIMIT_BY_SOURCE_CAMPUS = ratelimit.Limit("visit_submit_source_campus", window_seconds=3600, max_per_window=5)

# 公開端點不收的 Idempotency-Key 前綴：後台補登與匿名化後的案件用。
RESERVED_IDEMPOTENCY_PREFIXES = (service.MANUAL_IDEMPOTENCY_PREFIX, retention_service.ANONYMIZED_IDEMPOTENCY_PREFIX)


@router.get("/admin/booking-config/{campus_key}", response_model=BookingConfigOut)
async def get_booking_config(
    campus_key: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> BookingConfigOut:
    require_scope(current_user, "booking.read", campus_keys=[campus_key])
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
    if payload.mode == BookingMode.INQUIRY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "BOOKING_MODE_RETIRED",
                "message": "「填表後由園方聯絡」已停用，請改用自選場次，或暫停線上預約",
            },
        )
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
    if await db.get(Campus, campus_key) is None:
        raise ScopeDenied()
    config = await service.get_or_create_config(db, campus_key)
    published = await consent.current_consent(db)
    blockers = await readiness.data_blockers(db, campus_key, config)
    impact = await readiness.impact(db, campus_key, config)
    await db.commit()
    return BookingReadinessOut(
        campus_key=campus_key,
        current_mode=config.mode,
        consent=(
            BookingConsentBriefOut(
                revision_id=published.revision_id,
                version=published.version,
                has_privacy_notice=published.has_privacy_notice,
            )
            if published is not None
            else None
        ),
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

    config = await service.get_or_create_config(db, campus_key)
    published = await consent.current_consent(db)
    await db.commit()
    out = PublicBookingConfigOut.model_validate(config)
    settings = request.app.state.settings
    out = out.model_copy(update={"parent_email_enabled": bool(settings.smtp_host)})
    if settings.turnstile_enabled:
        out = out.model_copy(update={"turnstile_site_key": settings.turnstile_site_key})
    if published is not None:
        out = out.model_copy(update={
            "consent_revision_id": published.revision_id,
            "consent_text": published.text,
            "privacy_notice": (
                PrivacyNoticeOut.model_validate(
                    {"title": published.privacy_title, "sections": published.privacy_sections}
                )
                if published.has_privacy_notice
                else None
            ),
        })
    # 上線前的舊設定：填表待聯絡已退場，官網一律當成暫停。
    if out.mode == BookingMode.INQUIRY:
        out = out.model_copy(update={
            "mode": BookingMode.PAUSED,
            "message": out.message or "線上預約即將開放，歡迎來電洽詢。",
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
    elif published is None and config.mode in readiness.FORM_MODES:
        # 開放表單卻沒有發布中的同意文字（切換時會擋，這是更新前就開著表單的
        # 舊資料）：送單端點一定回 BOOKING_UNAVAILABLE，對官網先講暫停，免得
        # 家長填完整張表才被拒。總覽會列出這些校區。
        out = out.model_copy(update={
            "mode": BookingMode.PAUSED,
            "message": "線上預約表單暫時無法使用，請來電洽詢。",
            "line_url": None,
            "external_url": None,
        })
    return out


def _rate_limited(exc: ratelimit.RateLimited, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={"code": code, "message": message},
        headers={"Retry-After": str(exc.retry_after_seconds)},
    )


# 預檢與上鎖建立丟的例外相同，對應的回應也相同。
_SUBMIT_ERRORS = (
    service.IdempotencyConflict,
    service.BookingConfigVersionChanged,
    service.BookingUnavailable,
    service.PartySizeRequired,
    service.PhoneSubmissionLimit,
    consent.ConsentVersionChanged,
    workflow_service.SlotFull,
    slot_service.SlotNotBookable,
)


def _submit_error(exc: Exception) -> HTTPException:
    if isinstance(exc, service.IdempotencyConflict):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "IDEMPOTENCY_CONFLICT", "message": "同樣的識別碼已用不同內容送出過"},
        )
    if isinstance(exc, service.BookingConfigVersionChanged):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "BOOKING_CONFIG_CHANGED", "message": "預約設定已變更，請重新整理頁面"},
        )
    if isinstance(exc, service.BookingUnavailable):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "BOOKING_UNAVAILABLE", "message": "此校區目前不接受線上預約表單"},
        )
    if isinstance(exc, service.PhoneSubmissionLimit):
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "送出次數過多，請稍後再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        )
    if isinstance(exc, service.PartySizeRequired):
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[{"loc": ["body", "party_size"], "msg": "請選擇參觀人數", "type": "missing"}],
        )
    if isinstance(exc, consent.ConsentVersionChanged):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "CONSENT_VERSION_CHANGED", "message": "同意說明已更新，請重新閱讀並勾選後再送出"},
        )
    if isinstance(exc, workflow_service.SlotFull):
        return slot_unavailable(exc, suffix="，請選擇其他時段")
    if isinstance(exc, slot_service.SlotNotBookable):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_NOT_BOOKABLE", "message": exc.message},
        )
    raise TypeError(f"未對應的送單例外：{type(exc).__name__}")


def _trusted_client_ip_header(request: Request) -> str | None:
    """代理（Nuxt server route）帶進來的訪客 IP header；沒設定或沒帶為 None。"""
    return ratelimit.trusted_client_ip(request)


async def _manage_path(db: AsyncSession, request: Request, visit_request_id: uuid.UUID) -> str | None:
    return await access_service.current_manage_path(
        db, visit_request_id, secret=request.app.state.settings.session_secret
    )


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
    """公開送單。順序（稽核 visit-submit-pool-starvation、slot-hoarding）：

    1. schema 驗證（含保留的 Idempotency-Key 前綴）→ 2. 來源限流 →
    3. 不上鎖的重播查詢（重送直接回原結果，不驗 Turnstile、不吃額度）→
    4. 不上鎖的預檢 → 5. Turnstile → 6. 手機桶預檢、占位、每來源每校與每校
    上限 → 7. 鎖住校區設定列、在鎖內（用請求自己的連線）核對同一支手機近 10
    分鐘建立的筆數後建立案件 → commit 後才記手機桶。

    限流器每次操作都另開連線。握著 booking_configs 列鎖（以及請求自己的
    連線）時再向連線池要連線，匿名併發就能讓鎖與連線池互等、卡死整個
    API；所以 3–6 做完先結束讀取交易、歸還連線，7 之後到 commit 前完全
    不碰限流器。"""
    response.headers["Cache-Control"] = "no-store"
    if idempotency_key.startswith(RESERVED_IDEMPOTENCY_PREFIXES):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[{
                "loc": ["header", "Idempotency-Key"],
                "msg": "Idempotency-Key 不可使用保留的前綴",
                "type": "value_error",
            }],
        )

    limiter = ratelimit.limiter(request)
    try:
        await limiter.check(SUBMIT_LIMIT_BY_CLIENT, ratelimit.client_key(request))
    except ratelimit.RateLimited as exc:
        raise _rate_limited(exc, "RATE_LIMITED", "送出次數過多，請稍後再試") from exc

    result = await db.execute(select(Campus).where(Campus.key == payload.campus_key))
    campus = result.scalar_one_or_none()
    if campus is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個校區")
    if not campus.active:
        # 與公開設定回報的 paused 一致：官網顯示暫停，而不是「找不到」。
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "BOOKING_UNAVAILABLE", "message": "此校區目前不接受線上預約表單"},
        )

    settings = request.app.state.settings
    hash_key = service.payload_hash_key(settings.session_secret)
    body = payload.model_dump(
        mode="json", exclude={"campus_key", "config_version", "consent_revision_id", "turnstile_token"}
    )

    async def _late_replay() -> VisitRequestOut | None:
        # 同一把 key 的併發重送：開頭不上鎖的重播查詢時，另一個請求還沒 commit；
        # 等走到預檢或下面的上限時那筆已經建立、名額與額度也占掉了。擋下前再查一次，
        # 已經建立就回原收據（200），家長不會看到「名額已滿」或「送出次數過多」。
        try:
            replay = await service.find_replay(
                db, campus_key=payload.campus_key, idempotency_key=idempotency_key, payload=body, hash_key=hash_key
            )
        except _SUBMIT_ERRORS as exc:
            await db.rollback()
            raise _submit_error(exc) from exc
        # rollback 會讓 ORM 物件過期，先取出回應要的欄位。
        out = None if replay is None else VisitRequestOut(
            receipt_id=replay.id,
            status=replay.status,
            created_at=replay.created_at,
            manage_path=await _manage_path(db, request, replay.id),
        )
        await db.rollback()
        if out is not None:
            response.status_code = status.HTTP_200_OK
        return out

    try:
        replay = await service.find_replay(
            db, campus_key=payload.campus_key, idempotency_key=idempotency_key, payload=body, hash_key=hash_key
        )
        if replay is not None:
            response.status_code = status.HTTP_200_OK
            return VisitRequestOut(
                receipt_id=replay.id,
                status=replay.status,
                created_at=replay.created_at,
                manage_path=await _manage_path(db, request, replay.id),
            )
        holds_slot = await service.precheck_submission(
            db,
            campus_key=payload.campus_key,
            payload=body,
            config_version=payload.config_version,
            consent_revision_id=payload.consent_revision_id,
        )
    except _SUBMIT_ERRORS as exc:
        await db.rollback()
        if not isinstance(exc, service.IdempotencyConflict) and (late := await _late_replay()) is not None:
            return late
        raise _submit_error(exc) from exc
    # 結束讀取交易、歸還連線；之後的 Turnstile（最長 5 秒）與限流都不佔用
    # 請求的連線。expunge 讓上鎖建立時重新讀到最新的設定、時段與同意說明，
    # 而不是沿用 identity map 裡這次預檢讀到的舊值。
    await db.rollback()
    db.expunge_all()

    trusted_ip_header = _trusted_client_ip_header(request)
    try:
        await turnstile.verify(
            settings,
            payload.turnstile_token,
            turnstile.visitor_ip(trusted_ip_header),
            transport=getattr(request.app.state, "turnstile_transport", None),
        )
    except turnstile.BotCheckFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "BOT_CHECK_FAILED", "message": "請完成機器人驗證後再送出"},
        ) from exc

    # 手機桶只對「真的新建了一筆」計數：這裡只看不記（早一點擋掉明顯超量的），
    # commit 之後才記。不能在這裡就原子地扣：同一個 Idempotency-Key 的併發重送
    # （使用者連點、前端逾時重送）都還查不到既有案件，會一起把額度扣光而收到
    # 429，而不是拿回同一張收據。併發時的上限由鎖內的筆數核對保證（見
    # service.submit_visit_request 的 phone_limit）。
    phone_key = f"{payload.campus_key}:{payload.phone}"
    if await limiter.is_limited(SUBMIT_LIMIT_BY_PHONE, phone_key):
        if (late := await _late_replay()) is not None:
            return late
        # is_limited 不回剩餘秒數，Retry-After 給整個窗口（保守上限）。
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "送出次數過多，請稍後再試"},
            headers={"Retry-After": str(SUBMIT_LIMIT_BY_PHONE.window_seconds)},
        )
    # 占位與每校上限用「檢查＋累加」一次完成（同時灌進來也不會一起越過上限）。
    # 預檢擋掉的送單不會走到這裡；預檢之後才在鎖內失敗的（剛好被搶走最後
    # 一個名額）仍算一次，可以接受。
    # 每來源的上限只在代理有帶訪客 IP 時套用：沒有這個 header 時 client_key
    # 退回代理的位址，全站會共用同一個桶，一天只能約 N 組家長。正式環境 API
    # 只經代理對外（deploy/README.md），header 一定在。
    if holds_slot and trusted_ip_header:
        hold_limit = ratelimit.Limit(SLOT_HOLD_BUCKET, 24 * 3600, settings.booking_slot_holds_per_source_per_day)
        try:
            await limiter.check(hold_limit, ratelimit.client_key(request))
        except ratelimit.RateLimited as exc:
            if (late := await _late_replay()) is not None:
                return late
            raise _rate_limited(
                exc, "BOOKING_LIMIT", "這個網路近 24 小時送出的時段預約已達上限，請稍後再試，或直接來電洽詢園所"
            ) from exc
    if trusted_ip_header:
        try:
            await limiter.check(
                SUBMIT_LIMIT_BY_SOURCE_CAMPUS, f"{ratelimit.client_key(request)}:{payload.campus_key}"
            )
        except ratelimit.RateLimited as exc:
            if (late := await _late_replay()) is not None:
                return late
            raise _rate_limited(
                exc, "BOOKING_LIMIT", "這個網路近一小時送出的預約次數過多，請稍後再試，或直接來電洽詢園所"
            ) from exc
    campus_limit = ratelimit.Limit(CAMPUS_SUBMIT_BUCKET, 3600, settings.booking_submissions_per_campus_per_hour)
    try:
        await limiter.check(campus_limit, payload.campus_key)
    except ratelimit.RateLimited as exc:
        if (late := await _late_replay()) is not None:
            return late
        logger.warning("校區 %s 官網送單達每小時上限，暫停收件 %s 秒", payload.campus_key, exc.retry_after_seconds)
        raise _rate_limited(
            exc, "BOOKING_LIMIT", "這個校區目前線上預約人數較多，請稍後再試，或直接來電洽詢園所"
        ) from exc

    # 從這裡到 commit 都握著校區設定列鎖：不得再呼叫限流器。
    try:
        visit_request, is_new = await service.submit_visit_request(
            db,
            campus_key=payload.campus_key,
            idempotency_key=idempotency_key,
            payload=body,
            config_version=payload.config_version,
            hash_key=hash_key,
            consent_revision_id=payload.consent_revision_id,
            phone_limit=(
                SUBMIT_LIMIT_BY_PHONE.max_per_window, timedelta(seconds=SUBMIT_LIMIT_BY_PHONE.window_seconds)
            ),
            access_secret=settings.session_secret,
        )
    except _SUBMIT_ERRORS as exc:
        await db.rollback()
        raise _submit_error(exc) from exc
    # commit 會讓 ORM 物件過期，先取出回應要的欄位；連結由 id 與密鑰重算，
    # 新建與重播回的是同一條。
    receipt_id = visit_request.id
    receipt_status = visit_request.status
    created_at = visit_request.created_at
    await db.commit()

    if is_new:
        try:
            await limiter.record(SUBMIT_LIMIT_BY_PHONE, phone_key)
        except SQLAlchemyError:
            # 案件已經建立：記不到限流次數不該讓家長看到失敗、再送一次。
            logger.warning("公開送單的手機限流計數寫入失敗", exc_info=True)
    response.status_code = status.HTTP_201_CREATED if is_new else status.HTTP_200_OK
    return VisitRequestOut(
        receipt_id=receipt_id,
        status=receipt_status,
        created_at=created_at,
        manage_path=await _manage_path(db, request, receipt_id),
    )


# ---------------------------------------------------------------------------
# Slots
# ---------------------------------------------------------------------------


def _slot_audit(slot: VisitSlot | None) -> dict | None:
    """稽核紀錄裡描述時段用：日期與起訖時間，查紀錄時不必再回頭對 id。"""
    if slot is None:
        return None
    return {
        "id": str(slot.id),
        "date": slot.slot_date.isoformat(),
        "start": slot.start_time.strftime("%H:%M"),
        "end": slot.end_time.strftime("%H:%M"),
    }


def _slot_out(slot: VisitSlot, booked: int) -> VisitSlotOut:
    return VisitSlotOut(
        id=slot.id,
        campus_key=slot.campus_key,
        slot_date=slot.slot_date,
        start_time=slot.start_time,
        end_time=slot.end_time,
        capacity=slot.capacity,
        closed=slot.closed,
        closed_source=slot.closed_source,
        booked_count=booked,
        version=slot.version,
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
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_slot.create",
        target_type="visit_slot",
        target_id=str(slot.id),
        campus_key=campus_key,
        metadata={"slot": _slot_audit(slot)},
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
    before = {"capacity": slot.capacity, "closed": slot.closed}
    try:
        slot = await slot_service.update_slot(
            db, slot, capacity=payload.capacity, closed=payload.closed, expected_version=payload.expected_version
        )
    except slot_service.SlotVersionConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "SLOT_VERSION_CONFLICT",
                "message": "這個時段剛被其他人修改（或因休假日關閉），請重新載入後再調整",
                "current_version": exc.current_version,
            },
        ) from exc
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
    after = {"capacity": slot.capacity, "closed": slot.closed}
    if after != before:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="visit_slot.update",
            target_type="visit_slot",
            target_id=str(slot.id),
            campus_key=slot.campus_key,
            metadata={"slot": _slot_audit(slot), "before": before, "after": after},
        )
    await db.commit()
    booked = await slot_service.count_booked(db, slot.id)
    return _slot_out(slot, booked)


# 月曆上顯示的案件：有排時段、還沒取消的都列（含已結案的完成／未到場，
# 回頭查某天來了誰也要看得到）。
_CALENDAR_STATUSES = (
    VisitRequestStatus.PENDING_CONFIRMATION.value,
    VisitRequestStatus.CONFIRMED.value,
    VisitRequestStatus.COMPLETED.value,
    VisitRequestStatus.NO_SHOW.value,
)


@router.get("/admin/visit-calendar", response_model=list[CalendarSlotOut])
async def get_visit_calendar(
    date_from: date = Query(...),
    date_to: date = Query(...),
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[CalendarSlotOut]:
    """接待月曆（規格 6.2：日曆與清單讀同一份資料）。時段與案件都直接
    讀 visit_slots／visit_requests，名額用與送單相同的占位條件計算。"""
    require_scope(current_user, "booking.read")
    if date_to < date_from or (date_to - date_from).days > slot_service.MAX_QUERY_RANGE_DAYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "QUERY_RANGE_TOO_WIDE", "message": "查詢區間過長，請縮小範圍"},
        )
    stmt = select(VisitSlot).where(VisitSlot.slot_date >= date_from, VisitSlot.slot_date <= date_to)
    if campus_key:
        require_scope(current_user, "booking.read", campus_keys=[campus_key])
        stmt = stmt.where(VisitSlot.campus_key == campus_key)
    elif (scope := campus_scope(current_user)) is not None:
        stmt = stmt.where(VisitSlot.campus_key.in_(scope))
    slots = list(
        (await db.execute(stmt.order_by(VisitSlot.slot_date, VisitSlot.start_time, VisitSlot.campus_key))).scalars()
    )
    if not slots:
        return []

    booked_rows = await db.execute(
        select(VisitRequest.slot_id, func.count())
        .where(VisitRequest.slot_id.in_([s.id for s in slots]), slot_service.occupying_condition())
        .group_by(VisitRequest.slot_id)
    )
    booked = dict(booked_rows.all())
    visit_rows = await db.execute(
        select(VisitRequest)
        .where(
            VisitRequest.slot_id.in_([s.id for s in slots]),
            VisitRequest.status.in_(_CALENDAR_STATUSES),
        )
        .order_by(VisitRequest.created_at)
    )
    visits_by_slot: dict[uuid.UUID, list[CalendarVisitOut]] = {}
    for visit in visit_rows.scalars():
        visits_by_slot.setdefault(visit.slot_id, []).append(CalendarVisitOut.model_validate(visit, from_attributes=True))
    return [
        CalendarSlotOut(
            id=slot.id,
            campus_key=slot.campus_key,
            slot_date=slot.slot_date,
            start_time=slot.start_time,
            end_time=slot.end_time,
            capacity=slot.capacity,
            closed=slot.closed,
            booked_count=booked.get(slot.id, 0),
            visits=visits_by_slot.get(slot.id, []),
        )
        for slot in slots
    ]


@router.get("/public/slots", response_model=list[PublicVisitSlotOut])
async def list_public_slots(
    campus_key: str,
    request: Request,
    date_from: date = Query(...),
    date_to: date = Query(...),
    db: AsyncSession = Depends(get_db_session),
) -> list[PublicVisitSlotOut]:
    # 匿名可呼叫、每次最多讀 62 天的時段：每個來源限流（在碰請求連線之前）。
    try:
        await ratelimit.limiter(request).check(PUBLIC_SLOTS_LIMIT, ratelimit.client_key(request))
    except ratelimit.RateLimited as exc:
        raise _rate_limited(exc, "RATE_LIMITED", "查詢太頻繁，請稍後再試") from exc
    # 含控制字元的 key 不可能是校區（PostgreSQL 拒收 NUL 會變成 500），與查無校區一樣回空清單。
    if has_control_chars(campus_key):
        return []
    # 停用的分校不開放公開預約（規格 3.2）：公開設定回 paused，這裡也不列時段。
    campus = await db.get(Campus, campus_key)
    if campus is not None and not campus.active:
        return []
    try:
        slots = await slot_service.list_slots(db, campus_key, date_from, date_to)
    except slot_service.SlotQueryRangeTooWide as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "QUERY_RANGE_TOO_WIDE", "message": "查詢區間過長，請縮小範圍"},
        ) from exc
    config = await db.get(BookingConfig, campus_key)
    window = slot_service.window_for(config)
    # 與送單共用同一份判斷（closed／已過去／未達最短提前時間／
    # 超過最遠開放天數），避免公開頁列出根本訂不了的時段。
    bookable = [slot for slot in slots if slot_service.is_publicly_bookable(slot, **window)]
    # 已占名額一次查完（原本每個時段各查一次）。
    booked_by_slot = await slot_service.count_booked_by_slot(db, [slot.id for slot in bookable])
    result = []
    for slot in bookable:
        remaining = max(slot.capacity - booked_by_slot.get(slot.id, 0), 0)
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


async def _lock_for_transition(db: AsyncSession, user: User, visit_request_id: uuid.UUID) -> VisitRequest:
    """狀態轉換用：確認可處理案件後鎖住案件列，重讀狀態與時段。

    稽核的「轉換前」狀態／時段要在鎖內讀。取消、開始聯絡、改期是冪等的：
    家長剛好自行取消、逾期占位被定期工作取消，或另一位同事剛把案件改到
    同一個時段時，這次什麼都沒改；拿鎖列之前讀到的舊值比對，會把別人做
    的事記在這位同事名下。workflow_service 內會再鎖一次，同一個交易重複
    鎖同一列不會等待。"""
    visit_request = await _get_owned_visit_request(db, user, visit_request_id)
    require_scope(user, "booking.handle", campus_keys=[visit_request.campus_key])
    await workflow_service.lock_status(db, visit_request)
    loaded_slot_id = visit_request.slot.id if visit_request.slot is not None else None
    if loaded_slot_id != visit_request.slot_id:
        # 重讀只更新 slot_id；時段物件也換成鎖內讀到的那一場，稽核的舊時段
        # 與回應顯示的參觀時間才不會停在別人改期之前。
        await db.refresh(visit_request, attribute_names=["slot"])
    return visit_request


class VisitRequestFilters:
    """案件清單與 CSV 匯出共用的篩選條件。畫面上篩好什麼，匯出的就是那一批；
    原本匯出只看校區，篩好「本週已確認」再匯出會拿到整校案件，多帶出不必要
    的家長個資。"""

    def __init__(
        self,
        campus_key: str | None = None,
        status_filter: str | None = Query(default=None, alias="status"),
        q: str | None = Query(default=None, max_length=100, description="家長或寶貝姓名、電話或 Email 片段"),
        follow_up_due: bool = Query(default=False, description="只列已到預定聯絡時間、尚未結案的案件"),
        assignee: str | None = Query(
            default=None, description="承辦人：me＝我承辦的、none＝尚未指派，或承辦人的使用者 id"
        ),
        source: str | None = Query(default=None, description="案件來源：web／phone／line／walk_in／external"),
        created_from: date | None = Query(default=None, description="送出日期起（含），台灣日期"),
        created_to: date | None = Query(default=None, description="送出日期迄（含），台灣日期"),
        needs_attention: bool = Query(
            default=False,
            description="只列待人工處理：時段已關閉（含休假日）但家長仍要來，或分校已停用但尚未結案",
        ),
        group: str | None = Query(
            default=None,
            pattern="^(pending|upcoming|past|cancelled)$",
            description="案件分組：pending 待處理／upcoming 預約正常／past 時間已過／cancelled 已取消",
        ),
    ) -> None:
        self.campus_key = campus_key
        self.status = status_filter
        self.q = q.strip() if q and q.strip() else None
        self.follow_up_due = follow_up_due
        self.assignee = assignee
        self.source = source
        self.created_from = created_from
        self.created_to = created_to
        self.needs_attention = needs_attention
        self.group = group

    def apply(self, stmt, user: User, capability: str):
        if self.follow_up_due:
            # 與 dashboard_service 的「到期待追蹤」同一個定義，總覽的數字點進來
            # 才會是同一批案件。
            stmt = stmt.where(
                VisitRequest.follow_up_at.is_not(None),
                VisitRequest.follow_up_at <= datetime.now(timezone.utc),
                VisitRequest.status.not_in([VisitRequestStatus.CANCELLED.value, VisitRequestStatus.COMPLETED.value]),
            )
        if self.needs_attention:
            stmt = stmt.where(attention.needs_attention_condition())
        if self.campus_key:
            require_scope(user, capability, campus_keys=[self.campus_key])
            stmt = stmt.where(VisitRequest.campus_key == self.campus_key)
        elif (scope := campus_scope(user)) is not None:
            stmt = stmt.where(VisitRequest.campus_key.in_(scope))
        if self.status:
            stmt = stmt.where(VisitRequest.status == self.status)
        if self.group:
            stmt = stmt.where(status_groups.group_condition(self.group))
        if self.assignee == "me":
            stmt = stmt.where(VisitRequest.assigned_staff_id == user.id)
        elif self.assignee == "none":
            stmt = stmt.where(VisitRequest.assigned_staff_id.is_(None))
        elif self.assignee:
            try:
                assignee_id = uuid.UUID(self.assignee)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="承辦人篩選格式錯誤"
                ) from exc
            stmt = stmt.where(VisitRequest.assigned_staff_id == assignee_id)
        if self.source:
            stmt = stmt.where(VisitRequest.source == self.source)
        if self.created_from is not None:
            stmt = stmt.where(VisitRequest.created_at >= local_day_bounds_utc(self.created_from)[0])
        if self.created_to is not None:
            stmt = stmt.where(VisitRequest.created_at < local_day_bounds_utc(self.created_to)[1])
        if self.q:
            # 櫃台接電話時用姓名或號碼找人。使用者打的 % 與 _ 是字面值，
            # 不跳脫的話一個 % 就會把整個校區的案件全撈出來。
            needle = self.q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{needle}%"
            stmt = stmt.where(
                or_(
                    VisitRequest.parent_name.ilike(pattern, escape="\\"),
                    VisitRequest.child_name.ilike(pattern, escape="\\"),
                    VisitRequest.email.ilike(pattern, escape="\\"),
                    VisitRequest.phone.like(pattern, escape="\\"),
                )
            )
        return stmt

    def audit_metadata(self) -> dict:
        """稽核只記套用了哪些條件。搜尋字常常就是家長姓名或手機，只記「有
        搜尋」，不記內容，稽核紀錄不能變成另一份個資。"""
        applied = {
            "status": self.status,
            "group": self.group,
            "source": self.source,
            "assignee": self.assignee,
            "created_from": self.created_from.isoformat() if self.created_from else None,
            "created_to": self.created_to.isoformat() if self.created_to else None,
            "follow_up_due": self.follow_up_due or None,
            "needs_attention": self.needs_attention or None,
            "has_search": True if self.q else None,
        }
        return {key: value for key, value in applied.items() if value is not None}


@router.get("/admin/visit-requests", response_model=list[VisitRequestDetailOut])
async def list_visit_requests(
    filters: VisitRequestFilters = Depends(),
    order: str = Query(default="newest", pattern="^(newest|oldest)$", description="送出時間排序"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[VisitRequestDetailOut]:
    require_scope(current_user, "booking.read")
    stmt = filters.apply(select(VisitRequest).options(selectinload(VisitRequest.slot)), current_user, "booking.read")
    ordering = VisitRequest.created_at.asc() if order == "oldest" else VisitRequest.created_at.desc()
    stmt = stmt.order_by(ordering).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    return [VisitRequestDetailOut.model_validate(r) for r in result.scalars()]


@router.get("/admin/visit-requests/group-counts", response_model=VisitGroupCountsOut)
async def visit_request_group_counts(
    filters: VisitRequestFilters = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitGroupCountsOut:
    """分頁上的數字：套用同一組篩選（狀態與分組除外）後各組幾筆。"""
    require_scope(current_user, "booking.read")
    filters.status = None
    filters.group = None
    base = filters.apply(select(func.count()).select_from(VisitRequest), current_user, "booking.read")
    counts = {}
    for group in status_groups.GROUPS:
        counts[group] = (await db.execute(base.where(status_groups.group_condition(group)))).scalar_one()
    return VisitGroupCountsOut(**counts)


# 匯出欄位。每個欄位只出現一次：同名欄位在試算表樞紐分析或匯入其他系統時會
# 混淆或直接報錯（原本 source 重複兩次）。
EXPORT_COLUMNS = (
    "campus_key", "status", "source", "parent_name", "phone", "created_at",
    "child_name", "child_birthdate", "email", "referral_sources", "party_size",
    "slot_date", "start_time", "end_time",
)


_SAFE_FILENAME_PART = re.compile(r"[a-z0-9_-]{1,32}")


@router.get("/admin/visit-requests/export")
async def export_visit_requests(
    filters: VisitRequestFilters = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """依畫面上目前的篩選條件匯出（不分頁）。"""
    require_scope(current_user, "booking.export")
    stmt = filters.apply(select(VisitRequest).options(selectinload(VisitRequest.slot)), current_user, "booking.export")
    stmt = stmt.order_by(VisitRequest.created_at.desc())
    result = await db.execute(stmt)

    def _safe_cell(value: str | None) -> str:
        """CSV 公式注入防護：儲存格開頭若是 = + - @ 這些會被試算表當成
        公式執行的字元，前面補一個單引號讓它變成純文字。"""
        text = "" if value is None else str(value)
        # 試算表會略過開頭的空白與控制字元（TAB、CR、LF…）再判斷是不是
        # 公式，所以要看去掉這些字元後的第一個字，不能只看 text[0]。
        # 控制字元本身開頭也一併視為危險，一律補單引號。
        if text and (
            text[0].isspace()
            or not text[0].isprintable()
            or text.lstrip()[:1] in ("=", "+", "-", "@")
        ):
            return "'" + text
        return text

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EXPORT_COLUMNS)
    exported = 0
    for r in result.scalars():
        writer.writerow(
            [
                _safe_cell(r.campus_key),
                _safe_cell(r.status),
                _safe_cell(r.source),
                _safe_cell(r.parent_name),
                _safe_cell(r.phone),
                r.created_at.isoformat(),
                _safe_cell(r.child_name),
                r.child_birthdate.isoformat() if r.child_birthdate else "",
                _safe_cell(r.email),
                _safe_cell(";".join(r.referral_sources)),
                # 舊案件沒有人數，留空。
                str(r.party_size) if r.party_size is not None else "",
                r.slot.slot_date.isoformat() if r.slot else "",
                r.slot.start_time.isoformat() if r.slot else "",
                r.slot.end_time.isoformat() if r.slot else "",
            ]
        )
        exported += 1

    # 個資批次外流一定要留痕：誰、什麼時候、用什麼條件匯出了哪個校區的幾筆。
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.export",
        target_type="visit_request",
        target_id=filters.campus_key or "all",
        campus_key=filters.campus_key,
        metadata={"row_count": exported, **filters.audit_metadata()},
    )
    await db.commit()
    # 一律當附件下載，且不進瀏覽器快取：共用櫃台電腦上，含全校家長姓名與
    # 手機的 CSV 不能留在磁碟快取或上一頁紀錄裡（稽核 admin-booking-api-no-store-missing）。
    # 檔名只放安全字元，篩選值不直接進 header。
    campus_part = filters.campus_key if filters.campus_key and _SAFE_FILENAME_PART.fullmatch(filters.campus_key) else "all"
    filename = f"visit-requests-{campus_part}-{today_local():%Y%m%d}.csv"
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )


@router.post(
    "/admin/visit-requests",
    response_model=VisitRequestDetailOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_manual_visit_request(
    payload: VisitRequestManualCreate,
    response: Response,
    request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """人工補登。一律當場排入場次（等同建立後立刻確認），可再寫第一筆聯絡
    紀錄；三件事在同一個交易，任何一步失敗（例如時段剛好額滿）整筆不建立，
    人員改完再送一次即可。"""
    require_scope(current_user, "booking.handle", campus_keys=[payload.campus_key])
    result = await db.execute(select(Campus).where(Campus.key == payload.campus_key))
    campus = result.scalar_one_or_none()
    if campus is None or not campus.active:
        raise ScopeDenied()
    related = None
    if payload.related_request_id is not None:
        related = await _get_owned_visit_request(db, current_user, payload.related_request_id)
        if related.campus_key != payload.campus_key and not has_capability(current_user, "booking.cross_campus"):
            # 規格 6.2：不默默把案件搬到另一校；跨校關聯須總管理者權限。
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="跨校關聯舊案需要總管理者權限",
            )

    body = payload.model_dump(mode="json", exclude={"campus_key"})
    try:
        visit_request, is_new = await service.create_manual_visit_request(
            db,
            campus_key=payload.campus_key,
            idempotency_key=idempotency_key,
            payload=body,
            source=VisitRequestSource(payload.source),
            created_by=current_user.id,
            hash_key=service.payload_hash_key(request.app.state.settings.session_secret),
        )
    except service.IdempotencyConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "IDEMPOTENCY_CONFLICT", "message": "這張表單已經送出過不同的內容，請重新開啟補登"},
        ) from exc

    if is_new:
        if related is not None:
            # 結案後重新預約：新案指回舊案，兩邊歷程都留痕。
            visit_request.related_request_id = related.id
            actor = Actor.staff(current_user.id)
            workflow_service.record_event(
                db, visit_request.id, "linked_from_previous", actor=actor,
                after={"related_request_id": str(related.id)},
            )
            workflow_service.record_event(
                db, related.id, "rebooked_as_new", actor=actor,
                after={"related_request_id": str(visit_request.id)},
            )
        try:
            await workflow_service.confirm_with_slot(
                db, visit_request, payload.slot_id, current_user.id
            )
        except workflow_service.SlotFull as exc:
            await db.rollback()
            raise slot_unavailable(exc, suffix="，案件尚未建立") from exc
        except slot_service.SlotNotBookable as exc:
            await db.rollback()
            raise _slot_not_bookable(exc, suffix="，案件尚未建立") from exc
        await access_service.ensure_access_token(
            db, visit_request.id, secret=request.app.state.settings.session_secret, slot=visit_request.slot
        )
        if payload.note and payload.note.strip():
            await workflow_service.add_contact_note(
                db,
                visit_request,
                note=payload.note.strip(),
                follow_up_at=None,
                created_by=current_user.id,
            )
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="visit_request.manual_create",
            target_type="visit_request",
            target_id=str(visit_request.id),
            campus_key=payload.campus_key,
            metadata={
                "source": payload.source,
                "with_slot": payload.slot_id is not None,
                "related_request_id": str(related.id) if related is not None else None,
            },
        )
    await db.commit()
    response.status_code = status.HTTP_201_CREATED if is_new else status.HTTP_200_OK
    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .where(VisitRequest.id == visit_request.id)
        .execution_options(populate_existing=True)
    )
    return VisitRequestDetailOut.model_validate(result.scalar_one())


@router.get("/admin/visit-staff", response_model=list[VisitStaffOut])
async def list_visit_staff(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[VisitStaffOut]:
    """可以承辦案件的人（booking.handle：總管理者、分校管理者、接待人員）。
    非總管理者只看得到總管理者與跟自己有共同校區的同事，不藉這個清單看出
    其他校的人員配置。"""
    require_scope(current_user, "booking.read")
    result = await db.execute(
        select(User)
        .options(selectinload(User.campus_scopes))
        .where(User.role.in_(roles_with("booking.handle")))
        .order_by(User.email)
    )
    own = campus_scope(current_user)
    staff = []
    for user in result.scalars():
        keys = sorted(s.campus_key for s in user.campus_scopes)
        if campus_scope(user) is None:
            keys = []
        elif own is not None and not own.intersection(keys):
            continue
        elif own is not None:
            keys = sorted(own.intersection(keys))
        staff.append(
            VisitStaffOut(
                id=user.id,
                email=user.email,
                display_name=user.display_name,
                role=user.role.value,
                campus_keys=keys,
                is_active=user.is_active,
            )
        )
    return staff


@router.get("/admin/visit-requests/{visit_request_id}", response_model=VisitRequestFullOut)
async def get_visit_request(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestFullOut:
    """案件明細：案件本身＋歷程（誰、何時、異動前後、原因）、待核准的家長
    改期申請、家長管理連結是否有效（規格 L299）。"""
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    return await presenters.full_detail(db, visit_request)


@router.get("/admin/visit-requests/{visit_request_id}/contact-notes", response_model=list[VisitContactNoteOut])
async def list_contact_notes(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[VisitContactNoteOut]:
    await _get_owned_visit_request(db, current_user, visit_request_id)
    result = await db.execute(
        select(VisitContactNote, User.email, User.display_name)
        .outerjoin(User, User.id == VisitContactNote.created_by)
        .where(VisitContactNote.visit_request_id == visit_request_id)
        .order_by(VisitContactNote.created_at.desc())
    )
    return [
        VisitContactNoteOut.model_validate(note).model_copy(
            update={"created_by_email": email, "created_by_display_name": display_name}
        )
        for note, email, display_name in result.all()
    ]


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
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    try:
        await workflow_service.lock_editable(
            db, visit_request, payload.expected_version if payload.changes_follow_up else None
        )
    except workflow_service.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    note = await workflow_service.add_contact_note(
        db,
        visit_request,
        note=payload.note,
        follow_up_at=payload.follow_up_at,
        clear_follow_up=payload.clears_follow_up,
        created_by=current_user.id,
    )
    # 聯絡內容是自由文字、常含家長個資，稽核只記「誰在何時記了一筆」與
    # 有沒有改下次聯絡時間。
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.add_contact_note",
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={
            "note_id": str(note.id),
            "follow_up_set": payload.follow_up_at is not None,
            **({"follow_up_cleared": True} if payload.clears_follow_up else {}),
        },
    )
    await db.commit()
    return VisitContactNoteOut.model_validate(note).model_copy(
        update={"created_by_email": current_user.email, "created_by_display_name": current_user.display_name}
    )


@router.patch("/admin/visit-requests/{visit_request_id}/assignee", response_model=VisitRequestDetailOut)
async def assign_visit_request(
    visit_request_id: uuid.UUID,
    payload: VisitRequestAssignRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])
    assignee = None
    if payload.assigned_staff_id is not None:
        result = await db.execute(
            select(User)
            .options(selectinload(User.campus_scopes))
            .where(User.id == payload.assigned_staff_id)
        )
        assignee = result.scalar_one_or_none()
        if assignee is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "ASSIGNEE_INVALID", "message": "找不到這個人員"},
            )
    try:
        await workflow_service.lock_editable(db, visit_request, payload.expected_version)
    except workflow_service.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    previous = visit_request.assigned_staff_id
    try:
        await workflow_service.assign(db, visit_request, assignee, actor=Actor.staff(current_user.id))
    except workflow_service.AssigneeInvalid as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "ASSIGNEE_INVALID", "message": exc.message},
        ) from exc
    if previous != visit_request.assigned_staff_id:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="visit_request.assign",
            target_type="visit_request",
            target_id=str(visit_request.id),
            campus_key=visit_request.campus_key,
            metadata={
                "from": str(previous) if previous else None,
                "to": str(visit_request.assigned_staff_id) if visit_request.assigned_staff_id else None,
            },
        )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/confirm", response_model=VisitRequestDetailOut)
async def confirm_visit_request(
    visit_request_id: uuid.UUID,
    payload: VisitRequestConfirmRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    visit_request = await _lock_for_transition(db, current_user, visit_request_id)
    before_status = visit_request.status
    try:
        await workflow_service.confirm_with_slot(
            db, visit_request, payload.slot_id, current_user.id
        )
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise slot_unavailable(exc) from exc
    except slot_service.SlotNotBookable as exc:
        await db.rollback()
        raise _slot_not_bookable(exc) from exc
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await access_service.ensure_access_token(
        db, visit_request.id, secret=request.app.state.settings.session_secret, slot=visit_request.slot
    )
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.confirm",
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={"from_status": before_status, "slot": _slot_audit(visit_request.slot)},
    )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/cancel", response_model=VisitRequestDetailOut)
async def cancel_visit_request(
    visit_request_id: uuid.UUID,
    payload: VisitRequestCancelRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """本文可省略；有填原因就記在案件歷程。"""
    visit_request = await _lock_for_transition(db, current_user, visit_request_id)
    before_status = visit_request.status
    reason = payload.reason if payload else None
    try:
        await workflow_service.cancel(db, visit_request, actor=Actor.staff(current_user.id), reason=reason)
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await _audit_transition(
        db,
        current_user,
        visit_request,
        before_status,
        action="visit_request.cancel",
        has_reason=bool(reason and reason.strip()),
    )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/no-show", response_model=VisitRequestDetailOut)
async def mark_no_show(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    visit_request = await _lock_for_transition(db, current_user, visit_request_id)
    before_status = visit_request.status
    try:
        await workflow_service.mark_no_show(db, visit_request, actor=Actor.staff(current_user.id))
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await _audit_transition(db, current_user, visit_request, before_status, action="visit_request.no_show")
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/complete", response_model=VisitRequestDetailOut)
async def mark_completed(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """家長依約來參觀了。狀態機早就有 completed（規格 6.2），只是一直
    沒有路由，已確認的案件只能停在「已確認」或被標成未到場。"""
    visit_request = await _lock_for_transition(db, current_user, visit_request_id)
    before_status = visit_request.status
    try:
        await workflow_service.mark_completed(db, visit_request, actor=Actor.staff(current_user.id))
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await _audit_transition(db, current_user, visit_request, before_status, action="visit_request.complete")
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/reschedule", response_model=VisitRequestDetailOut)
async def reschedule_visit_request(
    visit_request_id: uuid.UUID,
    payload: VisitRequestRescheduleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """已確認的案件換時段（規格 L209、L211）：案件 id 不變、歷程記前後
    時段與原因，新時段額滿／關閉／已開始時整筆回滾、原預約不動。"""
    visit_request = await _lock_for_transition(db, current_user, visit_request_id)
    # 鎖內讀到的時段；別人剛改到同一場時 reschedule 什麼都不改，這裡也不記。
    old_slot = visit_request.slot
    try:
        await workflow_service.reschedule(
            db, visit_request, payload.new_slot_id, actor=Actor.staff(current_user.id), reason=payload.reason
        )
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise slot_unavailable(exc, subject="新時段", suffix="，原時段維持不變") from exc
    except slot_service.SlotNotBookable as exc:
        await db.rollback()
        raise _slot_not_bookable(exc, suffix="，原時段維持不變") from exc
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    if old_slot is None or visit_request.slot_id != old_slot.id:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="visit_request.reschedule",
            target_type="visit_request",
            target_id=str(visit_request.id),
            campus_key=visit_request.campus_key,
            metadata={
                "from_slot": _slot_audit(old_slot),
                "to_slot": _slot_audit(visit_request.slot),
                "has_reason": bool(payload.reason and payload.reason.strip()),
            },
        )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


def _version_conflict(exc: workflow_service.VersionConflict) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "VISIT_REQUEST_VERSION_CONFLICT",
            "message": "這筆案件的承辦人或下次聯絡時間剛被其他人修改，請重新載入後再操作",
            "current_version": exc.current_version,
        },
    )


async def _audit_transition(
    db: AsyncSession, user: User, visit_request: VisitRequest, before_status: str, *, action: str, **extra
) -> None:
    """狀態轉換的稽核。取消、開始聯絡是冪等的（已是該狀態直接回傳），狀態
    沒變就不記。before_status 要取自 _lock_for_transition 鎖內重讀的狀態。
    action 一律在呼叫端寫字面值（labelCoverage 測試會掃）。"""
    if visit_request.status == before_status:
        return
    await audit_service.log_action(
        db,
        actor_user_id=user.id,
        action=action,
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={"from_status": before_status, "to_status": visit_request.status, **extra},
    )


def _slot_not_bookable(exc: slot_service.SlotNotBookable, *, suffix: str = "") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "SLOT_NOT_BOOKABLE", "message": f"{exc.message}{suffix}"},
    )


def _invalid_transition(exc: workflow_service.InvalidTransition) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "INVALID_TRANSITION", "message": exc.message},
    )


@router.post("/admin/visit-requests/{visit_request_id}/contacting", include_in_schema=False)
async def mark_contacting_retired(visit_request_id: uuid.UUID) -> None:
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail={"code": "ENDPOINT_RETIRED", "message": "「聯絡中」已停用，請直接排入場次或取消"},
    )
