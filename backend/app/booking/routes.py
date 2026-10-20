"""預約 API 的 router（prefix `/api/website/v1`、tag booking）與官網送單。

其他端點依主題分在 config_routes.py（預約設定）、slot_routes.py（時段）、
admin_visit_routes.py（後台案件），在這裡依原本的順序掛進來。"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_db_session
from app.booking import (
    access_service,
    service,
    slot_service,
    turnstile,
    workflow_service,
)
from app.booking.exceptions import slot_unavailable
from app.common import ratelimit
from app.operations import retention_service
from app.booking.schemas import VisitRequestCreate, VisitRequestOut
from app.campuses.models import Campus
from app.booking import admin_visit_routes, config_routes, slot_routes
from app.booking.route_common import _rate_limited


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

# 公開送單的濫用上限（稽核 slot-hoarding-no-bot-protection）。上限值來自設定
# （WEBSITE_BOOKING_*），bucket 固定：
# - 每個來源 24 小時內最多占幾個時段名額。
# - 每校每小時最多收幾筆官網送單，灌單時的斷路器。觸發時整校
#   的家長都會被擋（429 BOOKING_LIMIT），所以前面再加一道：
# - 同一來源對同一校每小時最多幾筆。沒有這道時，一個匿名 IP
#   換手機號碼就能用光每校額度、讓整校停收（稽核
#   campus-cap-single-source-dos）；現在單一來源最多用掉預設每校額度（30）的 1/6。
SLOT_HOLD_BUCKET = "visit_slot_hold_source"
CAMPUS_SUBMIT_BUCKET = "visit_submit_campus"
SUBMIT_LIMIT_BY_SOURCE_CAMPUS = ratelimit.Limit("visit_submit_source_campus", window_seconds=3600, max_per_window=5)

# 公開端點不收的 Idempotency-Key 前綴：後台補登與匿名化後的案件用。
RESERVED_IDEMPOTENCY_PREFIXES = (service.MANUAL_IDEMPOTENCY_PREFIX, retention_service.ANONYMIZED_IDEMPOTENCY_PREFIX)

# 拆分（2026-10-20）：各組路由在自己的模組，這裡依拆分前的順序掛進同一個 router，
# 路徑比對順序（例如 /admin/visit-requests/export 要在 /{visit_request_id} 之前）與 OpenAPI 都不變。
router.include_router(config_routes.router)


# 預檢與上鎖建立丟的例外相同，對應的回應也相同。
_SUBMIT_ERRORS = (
    service.IdempotencyConflict,
    service.BookingConfigVersionChanged,
    service.BookingUnavailable,
    service.PhoneSubmissionLimit,
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


async def _submit_manage_path(db: AsyncSession, request: Request, visit_request_id: uuid.UUID) -> str | None:
    return await access_service.original_manage_path(
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
            manage_path=await _submit_manage_path(db, request, replay.id),
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
                manage_path=await _submit_manage_path(db, request, replay.id),
            )
        holds_slot = await service.precheck_submission(
            db,
            campus_key=payload.campus_key,
            payload=body,
            config_version=payload.config_version,
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
        # 新建時只有剛發的這一條；併發重播落到這裡時也一樣只回原始那條。
        manage_path=await _submit_manage_path(db, request, receipt_id),
    )


router.include_router(slot_routes.router)
router.include_router(admin_visit_routes.router)
