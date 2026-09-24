from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from app.auth.models import Role, User
from app.auth.permissions import has_capability
from app.booking import access_service, slot_service
from app.booking.exceptions import InvalidTransition, SlotFull
from app.booking.models import VisitContactNote, VisitRequest, VisitRequestEvent, VisitRequestStatus
from app.booking.outbox import enqueue_outbox
from app.common.timezones import now_utc
from app.operations import analytics_service
from app.operations.models import AnalyticsEventType

__all__ = ["InvalidTransition", "SlotFull"]


def record_event(db: AsyncSession, visit_request_id: uuid.UUID, event_type: str) -> None:
    """給路由層記錄歷程（例如人工補登關聯舊案）。"""
    _add_event(db, visit_request_id, event_type)


def _add_event(db: AsyncSession, visit_request_id: uuid.UUID, event_type: str) -> None:
    db.add(
        VisitRequestEvent(
            id=uuid.uuid4(),
            visit_request_id=visit_request_id,
            event_type=event_type,
            created_at=datetime.now(timezone.utc),
        )
    )


async def confirm_with_slot(
    db: AsyncSession, visit_request: VisitRequest, slot_id: uuid.UUID, staff_id: uuid.UUID
) -> VisitRequest:
    """人工把一筆 inquiry 案件確認進某個時段；confirmed 必須有 slot，
    這裡是唯一能把狀態變成 confirmed 的路徑（slots 模式直接送出時，
    submit_visit_request 走的是同一份容量檢查邏輯）。"""
    # 與 expire_holds 鎖同一列後重讀：不能用請求最初讀到的 pending
    # 狀態，覆蓋等待期間已被 worker 取消的案件。
    await db.refresh(
        visit_request,
        attribute_names=["status", "slot_id", "hold_expires_at"],
        with_for_update=True,
    )
    if visit_request.status not in (
        VisitRequestStatus.NEW.value,
        VisitRequestStatus.CONTACTING.value,
        VisitRequestStatus.PENDING_CONFIRMATION.value,
    ):
        raise InvalidTransition(f"狀態 {visit_request.status} 不能確認")

    slot = await slot_service.get_slot_for_update(db, slot_id)
    if slot is None or slot.campus_key != visit_request.campus_key or slot.closed:
        raise SlotFull()
    now = now_utc()
    is_pending = visit_request.status == VisitRequestStatus.PENDING_CONFIRMATION.value
    if is_pending and visit_request.hold_expires_at is not None and visit_request.hold_expires_at <= now:
        # 排程清理尚未執行也不能把到期占位確認成立；在取得時段鎖後判斷，
        # 避免等待鎖的時間跨過到期點。
        raise InvalidTransition("此時段保留已到期，請重新安排參觀")
    booked = await slot_service.count_booked(db, slot.id)
    if is_pending and visit_request.slot_id == slot.id:
        # pending 原本已占用自己的名額，轉 confirmed 不會多占一位；
        # 改到另一個時段則仍須按該時段完整的 booked 數檢查容量。
        booked -= 1
    if booked >= slot.capacity:
        raise SlotFull()

    # 指派 relationship 而不是只寫 FK：回應要立刻序列化出參觀時間，
    # 已載入的物件才不會在 async 下觸發 lazy load。
    visit_request.slot = slot
    visit_request.status = VisitRequestStatus.CONFIRMED.value
    # 已經指派過承辦人就保留，確認的人不一定是負責後續聯絡的人。
    if visit_request.assigned_staff_id is None:
        visit_request.assigned_staff_id = staff_id
    visit_request.confirmed_at = now
    # 確認之後就不再是「占位」，清掉到期時間，免得背景工作稍後又把
    # 一筆已確認的案件當成過期占位取消掉。
    visit_request.hold_expires_at = None
    _add_event(db, visit_request.id, "confirmed")
    enqueue_outbox(
        db,
        visit_request.id,
        "visit_request_confirmed",
        {"campus_key": visit_request.campus_key, "receipt_id": str(visit_request.id)},
    )
    await analytics_service.record_internal_event(
        db, event_type=AnalyticsEventType.VISIT_CONFIRMED, campus_key=visit_request.campus_key
    )
    await db.flush()
    return visit_request


async def _lock_status(db: AsyncSession, visit_request: VisitRequest) -> None:
    """鎖住案件列後重讀狀態。家長取消與園方結案可能同時發生；只用請求
    最初讀到的狀態判斷，較晚提交的一方會覆寫另一方已寫入的終態。"""
    await db.refresh(
        visit_request,
        attribute_names=["status", "slot_id", "hold_expires_at"],
        with_for_update=True,
    )


async def cancel(db: AsyncSession, visit_request: VisitRequest) -> VisitRequest:
    """取消是冪等的：已經是 cancelled 就直接回傳，不重複寫事件、
    不會因為重試而「重複釋放」名額（名額本來就是即時算出來的，
    不是可變計數器）。"""
    await _lock_status(db, visit_request)
    if visit_request.status == VisitRequestStatus.CANCELLED.value:
        return visit_request
    if visit_request.status in (VisitRequestStatus.NO_SHOW.value, VisitRequestStatus.COMPLETED.value):
        raise InvalidTransition(f"狀態 {visit_request.status} 不能取消")

    visit_request.status = VisitRequestStatus.CANCELLED.value
    visit_request.cancelled_at = datetime.now(timezone.utc)
    visit_request.hold_expires_at = None
    await access_service.revoke_access_for_visit_request(db, visit_request.id)
    _add_event(db, visit_request.id, "cancelled")
    enqueue_outbox(
        db,
        visit_request.id,
        "visit_request_cancelled",
        {"campus_key": visit_request.campus_key, "receipt_id": str(visit_request.id)},
    )
    await db.flush()
    return visit_request


async def mark_contacting(db: AsyncSession, visit_request: VisitRequest) -> VisitRequest:
    """規格 6.2：new → contacting（園方開始聯絡）；pending_confirmation 退回
    contacting 時釋放占位並清掉 slot_id／hold_expires_at。已是 contacting 直接
    回傳，重送不重複寫歷程。"""
    await _lock_status(db, visit_request)
    if visit_request.status == VisitRequestStatus.CONTACTING.value:
        return visit_request
    if visit_request.status == VisitRequestStatus.NEW.value:
        visit_request.status = VisitRequestStatus.CONTACTING.value
        _add_event(db, visit_request.id, "contacting")
    elif visit_request.status == VisitRequestStatus.PENDING_CONFIRMATION.value:
        visit_request.status = VisitRequestStatus.CONTACTING.value
        # 名額是依狀態即時算的，轉成 contacting 就等於釋放，不會重複釋放。
        visit_request.slot = None
        visit_request.hold_expires_at = None
        _add_event(db, visit_request.id, "returned_to_contacting")
    else:
        raise InvalidTransition(f"狀態 {visit_request.status} 不能改成聯絡中")
    await db.flush()
    return visit_request


async def mark_no_show(db: AsyncSession, visit_request: VisitRequest) -> VisitRequest:
    await _lock_status(db, visit_request)
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        raise InvalidTransition("只有已確認的案件可以標記未到場")
    visit_request.status = VisitRequestStatus.NO_SHOW.value
    await access_service.revoke_access_for_visit_request(db, visit_request.id)
    _add_event(db, visit_request.id, "no_show")
    await db.flush()
    return visit_request


async def mark_completed(db: AsyncSession, visit_request: VisitRequest) -> VisitRequest:
    await _lock_status(db, visit_request)
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        raise InvalidTransition("只有已確認的案件可以標記完成")
    visit_request.status = VisitRequestStatus.COMPLETED.value
    await access_service.revoke_access_for_visit_request(db, visit_request.id)
    _add_event(db, visit_request.id, "completed")
    await analytics_service.record_internal_event(
        db, event_type=AnalyticsEventType.VISIT_COMPLETED, campus_key=visit_request.campus_key
    )
    await db.flush()
    return visit_request


async def reschedule(
    db: AsyncSession, visit_request: VisitRequest, new_slot_id: uuid.UUID
) -> VisitRequest:
    """固定次序鎖住新舊時段避免 deadlock：一律先鎖 id 字串較小的那個。
    新時段名額不足時整筆回滾，舊時段的占用完全不受影響。"""
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        raise InvalidTransition("只有已確認的案件可以改期")
    if visit_request.slot_id is None:
        raise InvalidTransition("這筆案件沒有時段可以改")
    if new_slot_id == visit_request.slot_id:
        return visit_request

    old_slot_id = visit_request.slot_id
    # 固定用字串排序決定鎖定順序，兩個併發的改期請求就算新舊時段
    # 互換，也會用同一個順序搶鎖，不會互相等待造成 deadlock。
    ordered_ids = sorted([old_slot_id, new_slot_id], key=str)
    locked_slots = {}
    for sid in ordered_ids:
        locked_slots[sid] = await slot_service.get_slot_for_update(db, sid)
    new_slot = locked_slots[new_slot_id]

    if new_slot is None or new_slot.campus_key != visit_request.campus_key or new_slot.closed:
        raise SlotFull()

    booked = await slot_service.count_booked(db, new_slot.id)
    if booked >= new_slot.capacity:
        raise SlotFull()

    visit_request.slot = new_slot
    _add_event(db, visit_request.id, "rescheduled")
    enqueue_outbox(
        db,
        visit_request.id,
        "visit_request_rescheduled",
        {"campus_key": visit_request.campus_key, "receipt_id": str(visit_request.id)},
    )
    await db.flush()
    return visit_request


async def expire_holds(db: AsyncSession, *, limit: int = 100) -> int:
    """規格 222：人工待確認的占位到期後轉 cancelled、記 hold_expired、
    釋放名額並通知園方。回傳實際處理的筆數。

    冪等：以 `status = pending_confirmation AND hold_expires_at <= now`
    為條件並鎖住列，已經被別的 worker 處理過的不會再被選到，所以重跑
    不會重複釋放名額或重複發通知。名額本來就是依狀態即時算出來的，
    轉成 cancelled 就等於釋放，不需要額外扣減。"""
    now = now_utc()
    result = await db.execute(
        select(VisitRequest)
        .where(
            VisitRequest.status == VisitRequestStatus.PENDING_CONFIRMATION.value,
            VisitRequest.hold_expires_at.is_not(None),
            VisitRequest.hold_expires_at <= now,
        )
        .order_by(VisitRequest.hold_expires_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    expired = list(result.scalars())
    for visit_request in expired:
        visit_request.status = VisitRequestStatus.CANCELLED.value
        visit_request.cancelled_at = now
        visit_request.hold_expires_at = None
        await access_service.revoke_access_for_visit_request(db, visit_request.id)
        _add_event(db, visit_request.id, "hold_expired")
        enqueue_outbox(
            db,
            visit_request.id,
            "visit_request_hold_expired",
            {"campus_key": visit_request.campus_key, "receipt_id": str(visit_request.id)},
        )
    await db.flush()
    return len(expired)


async def add_contact_note(
    db: AsyncSession,
    visit_request: VisitRequest,
    *,
    note: str,
    follow_up_at: datetime | None,
    created_by: uuid.UUID,
) -> VisitContactNote:
    record = VisitContactNote(
        id=uuid.uuid4(),
        visit_request_id=visit_request.id,
        note=note,
        created_by=created_by,
        created_at=datetime.now(timezone.utc),
    )
    db.add(record)
    if follow_up_at is not None:
        visit_request.follow_up_at = follow_up_at
    _add_event(db, visit_request.id, "contact_logged")
    await db.flush()
    return record


class AssigneeInvalid(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


async def assign(
    db: AsyncSession, visit_request: VisitRequest, assignee: User | None
) -> VisitRequest:
    """改承辦人。assignee 是已載入 campus_scopes 的 User 或 None（取消
    指派）；只能指派給仍啟用、而且有這個校區案件管理權限的人，否則這筆
    案件會落到一個根本看不到它的人名下。"""
    if assignee is not None:
        if not assignee.is_active:
            raise AssigneeInvalid("這個帳號已停用，不能指派")
        if not has_capability(assignee, "booking.manage"):
            raise AssigneeInvalid("這個帳號沒有處理參觀案件的權限")
        if assignee.role != Role.SUPER_ADMIN and not any(
            s.campus_key == visit_request.campus_key for s in assignee.campus_scopes
        ):
            raise AssigneeInvalid("這個帳號沒有這個校區的權限")
    new_id = assignee.id if assignee is not None else None
    if visit_request.assigned_staff_id == new_id:
        return visit_request
    visit_request.assigned_staff_id = new_id
    _add_event(db, visit_request.id, "assigned" if new_id else "unassigned")
    await db.flush()
    return visit_request
