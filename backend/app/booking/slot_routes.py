"""時段：後台場次管理、參觀月曆、場次使用情況與官網的公開時段查詢。

掛在 booking/routes.py 的 router 底下（prefix 與 tag 由那裡帶），註冊順序照拆分前（2026-10-20）。"""

from __future__ import annotations

import contextlib
import logging
import uuid
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, campus_scope, require_scope
from app.booking import (
    service,
    slot_lookup,
    slot_service,
    slot_usage,
)
from app.common import ratelimit
from app.common.timezones import today_local
from app.operations import audit_service
from app.booking.models import (
    BookingConfig,
    BookingMode,
    VisitRequest,
    VisitRequestStatus,
    VisitSlot,
)
from app.booking.schemas import (
    CalendarSlotOut,
    CalendarVisitOut,
    PublicVisitSlotOut,
    SlotUsageOut,
    VisitSlotCreateRequest,
    VisitSlotOut,
    VisitSlotUpdateRequest,
    has_control_chars,
)
from app.campuses.models import Campus
from app.booking.route_common import _campus_or_404, _rate_limited


router = APIRouter()

logger = logging.getLogger("app.booking")

# 公開時段查詢：官網只在換校區時查一次，一分鐘 60 次對正常家長綽綽有餘。
PUBLIC_SLOTS_LIMIT = ratelimit.Limit("public_slots_client", window_seconds=60, max_per_window=60)


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
    # 網址上的 %00 之類一路送到 PostgreSQL 會被拒收成 500；權限過了才擋（同 visit-calendar），沒權限的人照舊拿 404。
    if has_control_chars(campus_key):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="篩選條件含有不允許的控制字元")
    # 補登與改期一次讀到該校開放範圍的最後一天（最遠開放可以超過 62 天，2026-10-20 稽核）。
    max_days = slot_service.advance_days(await db.get(BookingConfig, campus_key))
    date_to = slot_service.query_range_end(date_from, date_to, today=today_local(), max_advance_days=max_days)
    try:
        slots = await slot_service.list_slots(
            db, campus_key, date_from, date_to, max_range_days=slot_service.query_range_limit(max_days)
        )
    except slot_service.SlotQueryRangeTooWide as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "QUERY_RANGE_TOO_WIDE", "message": "查詢區間過長，請縮小範圍"},
        ) from exc
    booked = await slot_service.count_booked_by_slot(db, [slot.id for slot in slots])
    return [_slot_out(slot, booked.get(slot.id, 0)) for slot in slots]


@router.post("/admin/slots", response_model=VisitSlotOut, status_code=status.HTTP_201_CREATED)
async def create_admin_slot(
    campus_key: str,
    payload: VisitSlotCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitSlotOut:
    require_scope(current_user, "booking.manage", campus_keys=[campus_key])
    await _campus_or_404(db, campus_key)
    # 同校同一天同一個開始時間只能有一場（連點「加開」曾建出兩場一樣的，官網名額
    # 變兩倍）。鎖住預約設定列再查，兩個同時送出的請求只有一個會建立。
    await service.get_or_create_config(db, campus_key, for_update=True)
    if await slot_service.slot_exists(db, campus_key, payload.slot_date, payload.start_time):
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_DUPLICATE", "message": "這個時間已經有一場了；停止申請中的場次請按「恢復開放」"},
        )
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
        # 網址上的 %00 之類一路送到 PostgreSQL 會被拒收成 500；權限過了才擋（同 visit-slot-usage），沒權限的人照舊拿 404。
        if has_control_chars(campus_key):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="篩選條件含有不允許的控制字元")
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
            version=slot.version,
            closed_source=slot.closed_source,
            booked_count=booked.get(slot.id, 0),
            visits=visits_by_slot.get(slot.id, []),
        )
        for slot in slots
    ]


@router.get("/admin/visit-slot-usage", response_model=SlotUsageOut)
async def get_visit_slot_usage(
    campus_key: str,
    weeks: int = Query(default=12),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> SlotUsageOut:
    """場次使用情況（2026-10-13 規格 §4）：新預約表單近 4 週的「最早能約哪天」＋各時段過去坐了幾成。
    權限同接待月曆；只回數字，沒有個資，不寫操作紀錄。"""
    require_scope(current_user, "booking.read", campus_keys=[campus_key])
    # 網址上的 %00 之類一路送到 PostgreSQL 會被拒收成 500；權限過了才擋，沒權限的人照舊拿 404／403。
    if has_control_chars(campus_key):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="篩選條件含有不允許的控制字元")
    if weeks not in slot_usage.WEEK_CHOICES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_WEEKS", "message": "weeks 只能是 4、12 或 26"},
        )
    today = today_local()
    config = await db.get(BookingConfig, campus_key)
    return SlotUsageOut(
        campus_key=campus_key,
        booking_mode=config.mode.value if config is not None else None,
        today=today,
        lookups=await slot_lookup.lookup_summary(db, campus_key, today),
        slots=await slot_usage.slot_rows(db, campus_key, weeks, today),
    )


@router.get("/public/slots", response_model=list[PublicVisitSlotOut])
async def list_public_slots(
    campus_key: str,
    request: Request,
    date_from: date = Query(...),
    date_to: date = Query(...),
    purpose: Literal["new_booking"] | None = Query(default=None),
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
    config = await db.get(BookingConfig, campus_key)
    today = today_local()
    # 最遠開放可以超過 62 天（2026-10-20 稽核）：官網查到該校開放範圍的最後一天為止，
    # 更遠的本來就訂不了（is_publicly_bookable），截掉不影響回傳。
    max_days = slot_service.advance_days(config)
    query_to = slot_service.query_range_end(date_from, date_to, today=today, max_advance_days=max_days)
    try:
        slots = await slot_service.list_slots(
            db, campus_key, date_from, query_to, max_range_days=slot_service.query_range_limit(max_days)
        )
    except slot_service.SlotQueryRangeTooWide as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "QUERY_RANGE_TOO_WIDE", "message": "查詢區間過長，請縮小範圍"},
        ) from exc
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
    # 場次使用情況（2026-10-13）：新預約表單讀場次時記一次「最早能約哪天」。只有校區存在且 active（停用的
    # 上面已回空清單）、預約方式是自選場次才記；失敗只記 log，不能讓家長讀不到場次。
    # 2026-10-20 稽核：區間由呼叫端決定，給一段沒有場次的區間就能讓每次都記成「整段沒有場次」；
    # 所以只記從台北今天查到該校開放範圍最後一天的查詢（官網表單就是這樣查），再過全站與每來源上限。
    if (
        purpose == "new_booking"
        and campus is not None
        and config is not None
        and config.mode == BookingMode.SLOTS
        and date_from == today
        and query_to >= today + timedelta(days=max_days)
        and await slot_lookup.admit(request)
    ):
        earliest = min((s.slot_date for s in result), default=None)
        try:
            await slot_lookup.record_lookup(db, campus_key=campus_key, earliest=earliest, today=today)
            await db.commit()
        except SQLAlchemyError:
            # 連線斷了的話 rollback 自己也會丟錯；記錄是附帶的，這裡不能讓它變成家長的 500。
            with contextlib.suppress(SQLAlchemyError):
                await db.rollback()
            logger.warning("record slot lookup failed", exc_info=True)
    return result
