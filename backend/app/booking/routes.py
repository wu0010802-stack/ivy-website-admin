from __future__ import annotations

import csv
import io
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, campus_scope, has_capability, require_scope, roles_with
from app.booking import attention, consent, presenters, readiness, service, slot_service, workflow_service
from app.booking.history import Actor
from app.common import ratelimit
from app.common.timezones import local_day_bounds_utc
from app.operations import audit_service
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
SUBMIT_LIMIT_BY_PHONE = ratelimit.Limit("visit_submit_phone", window_seconds=600, max_per_window=5)
SUBMIT_LIMIT_BY_CLIENT = ratelimit.Limit("visit_submit_client", window_seconds=600, max_per_window=60)


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
            slots_auto_confirm=payload.slots_auto_confirm,
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
    return BookingConfigOut.model_validate(config)


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
    db: AsyncSession = Depends(get_db_session),
) -> PublicBookingConfigOut:
    result = await db.execute(select(Campus).where(Campus.key == campus_key))
    campus = result.scalar_one_or_none()
    if campus is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個校區")

    config = await service.get_or_create_config(db, campus_key)
    published = await consent.current_consent(db)
    await db.commit()
    out = PublicBookingConfigOut.model_validate(config)
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
        await ratelimit.limiter(request).check(SUBMIT_LIMIT_BY_CLIENT, ratelimit.client_key(request))
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "送出次數過多，請稍後再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

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

    body = payload.model_dump(mode="json", exclude={"campus_key", "config_version", "consent_revision_id"})

    try:
        visit_request, is_new = await service.submit_visit_request(
            db,
            campus_key=payload.campus_key,
            idempotency_key=idempotency_key,
            payload=body,
            config_version=payload.config_version,
            consent_revision_id=payload.consent_revision_id,
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
    except service.PartySizeRequired as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[{"loc": ["body", "party_size"], "msg": "請選擇參觀人數", "type": "missing"}],
        ) from exc
    except consent.ConsentVersionChanged as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "CONSENT_VERSION_CHANGED", "message": "同意說明已更新，請重新閱讀並勾選後再送出"},
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
            await ratelimit.limiter(request).check(SUBMIT_LIMIT_BY_PHONE, f"{payload.campus_key}:{payload.phone}")
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
        closed_source=slot.closed_source,
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
    date_from: date = Query(...),
    date_to: date = Query(...),
    db: AsyncSession = Depends(get_db_session),
) -> list[PublicVisitSlotOut]:
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
    result = []
    for slot in slots:
        # 與送單共用同一份判斷（closed／已過去／未達最短提前時間／
        # 超過最遠開放天數），避免公開頁列出根本訂不了的時段。
        if not slot_service.is_publicly_bookable(slot, **window):
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


# 匯出欄位。每個欄位只出現一次：同名欄位在試算表樞紐分析或匯入其他系統時會
# 混淆或直接報錯（原本 source 重複兩次）。
EXPORT_COLUMNS = (
    "campus_key", "status", "source", "parent_name", "phone", "created_at",
    "child_name", "child_birthdate", "email", "referral_sources", "party_size",
    "slot_date", "start_time", "end_time",
)


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
    return Response(content=buffer.getvalue(), media_type="text/csv")


@router.post(
    "/admin/visit-requests",
    response_model=VisitRequestDetailOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_manual_visit_request(
    payload: VisitRequestManualCreate,
    response: Response,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """人工補登。可選擇當場排入時段（等同建立後立刻確認）與寫第一筆聯絡
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
        if payload.slot_id is not None:
            try:
                await workflow_service.confirm_with_slot(
                    db, visit_request, payload.slot_id, current_user.id
                )
            except workflow_service.SlotFull as exc:
                await db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"code": "SLOT_FULL", "message": "這個時段名額已滿或已關閉，案件尚未建立"},
                ) from exc
            except slot_service.SlotNotBookable as exc:
                await db.rollback()
                raise _slot_not_bookable(exc, suffix="，案件尚未建立") from exc
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
        select(VisitContactNote, User.email)
        .outerjoin(User, User.id == VisitContactNote.created_by)
        .where(VisitContactNote.visit_request_id == visit_request_id)
        .order_by(VisitContactNote.created_at.desc())
    )
    return [
        VisitContactNoteOut.model_validate(note).model_copy(update={"created_by_email": email})
        for note, email in result.all()
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
    note = await workflow_service.add_contact_note(
        db,
        visit_request,
        note=payload.note,
        follow_up_at=payload.follow_up_at,
        created_by=current_user.id,
    )
    await db.commit()
    return VisitContactNoteOut.model_validate(note).model_copy(update={"created_by_email": current_user.email})


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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
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
    except slot_service.SlotNotBookable as exc:
        await db.rollback()
        raise _slot_not_bookable(exc) from exc
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
    payload: VisitRequestCancelRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """本文可省略；有填原因就記在案件歷程。"""
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    try:
        await workflow_service.cancel(
            db, visit_request, actor=Actor.staff(current_user.id), reason=payload.reason if payload else None
        )
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
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    try:
        await workflow_service.mark_no_show(db, visit_request, actor=Actor.staff(current_user.id))
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
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
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    try:
        await workflow_service.mark_completed(db, visit_request, actor=Actor.staff(current_user.id))
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
    """已確認的案件換時段（規格 L209、L211）：案件 id 不變、歷程記前後
    時段與原因，新時段額滿／關閉／已開始時整筆回滾、原預約不動。"""
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    try:
        await workflow_service.reschedule(
            db, visit_request, payload.new_slot_id, actor=Actor.staff(current_user.id), reason=payload.reason
        )
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_FULL", "message": "新時段名額已滿或已關閉，原時段維持不變"},
        ) from exc
    except slot_service.SlotNotBookable as exc:
        await db.rollback()
        raise _slot_not_bookable(exc, suffix="，原時段維持不變") from exc
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


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


@router.post("/admin/visit-requests/{visit_request_id}/contacting", response_model=VisitRequestDetailOut)
async def mark_contacting(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    try:
        await workflow_service.mark_contacting(db, visit_request, actor=Actor.staff(current_user.id))
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise _invalid_transition(exc) from exc
    await db.commit()
    await db.refresh(visit_request, attribute_names=["slot"])
    return VisitRequestDetailOut.model_validate(visit_request)
