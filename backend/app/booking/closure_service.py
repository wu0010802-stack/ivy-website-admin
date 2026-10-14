"""停班停課（2026-10-14 規格 §3）：把一天設成休假日（可一次好幾校），再請已約的家長
用修改連結自己改約或取消。

已約的預約不自動取消（同既有休假規則）：有 Email 而且正式站有設寄信時排一封停課通知
（去重鍵：預約＋日期，同一筆同一天只寄一次）；沒有 Email 的照舊列在「待人工處理」由
櫃台來電。停課日家長不受線上修改期限限制（parent_policy.day_closed）。"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.booking import access_service, history, schedule_service, slot_service
from app.booking.history import Actor
from app.booking.models import OutboxMessage, VisitException, VisitRequest, VisitSlot
from app.booking.outbox import day_closed_dedupe_key, enqueue_day_closed_email

CLOSURE_NOTICE_EVENT = "closure_notice"


@dataclass
class CampusClosureResult:
    campus_key: str
    # 動手前那天就已經是休假日（這次只更新原因、補寄通知）。
    already_closed: bool = False
    # 這次關掉的場次（dry run：會關掉的）。
    closed_slots: int = 0
    # 那天已確認、要來參觀的預約。
    confirmed_requests: int = 0
    with_email: int = 0
    # 這次排入的停課通知（dry run：會排入的）。
    notified: int = 0
    # 之前已經排過停課通知、這次不重寄的。
    already_notified: int = 0
    # 沒有 Email、要櫃台來電的。
    no_email: int = 0


async def _confirmed_visits(db: AsyncSession, campus_key: str, day: date) -> list[VisitRequest]:
    """那天要來參觀的預約（已確認）。停課時 add_exception 會關掉那天所有場次，所以不看
    關閉來源：先停止申請、之後整天休假的場次，已約的家長一樣不能來（同
    attention.needs_attention_condition）；dry run 時場次還沒關，數字也一樣。"""
    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
        .where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date == day,
            slot_service.awaiting_visit_condition(),
        )
        .order_by(VisitRequest.id)
    )
    return list(result.scalars())


async def _notified_ids(db: AsyncSession, visits: list[VisitRequest], day: date) -> set[uuid.UUID]:
    if not visits:
        return set()
    keys = {day_closed_dedupe_key(v.id, day): v.id for v in visits}
    result = await db.execute(select(OutboxMessage.dedupe_key).where(OutboxMessage.dedupe_key.in_(list(keys))))
    return {keys[key] for key in result.scalars()}


async def close_day(
    db: AsyncSession,
    campus_key: str,
    day: date,
    reason: str,
    *,
    actor_id: uuid.UUID,
    notify: bool,
    secret: str,
    dry_run: bool,
) -> CampusClosureResult:
    """一校停課。notify＝要寄信（呼叫端已確認正式站有設寄信）。呼叫端負責 commit 與操作紀錄。"""
    out = CampusClosureResult(campus_key=campus_key)
    existing = await db.scalar(
        select(VisitException.id).where(
            VisitException.campus_key == campus_key, VisitException.exception_date == day
        )
    )
    out.already_closed = existing is not None
    if dry_run:
        out.closed_slots = (
            await db.scalar(
                select(func.count())
                .select_from(VisitSlot)
                .where(VisitSlot.campus_key == campus_key, VisitSlot.slot_date == day, VisitSlot.closed.is_(False))
            )
        ) or 0
    else:
        _, out.closed_slots, _ = await schedule_service.add_exception(db, campus_key, day, reason, actor_id)
    visits = await _confirmed_visits(db, campus_key, day)

    out.confirmed_requests = len(visits)
    notified_before = await _notified_ids(db, visits, day)
    actor = Actor.staff(actor_id)
    for visit in visits:
        if not visit.email:
            out.no_email += 1
            continue
        out.with_email += 1
        if not notify:
            continue
        if visit.id in notified_before:
            out.already_notified += 1
            continue
        if dry_run:
            out.notified += 1
            continue
        if not await enqueue_day_closed_email(db, visit, day=day, reason=reason):
            out.already_notified += 1
            continue
        # 信裡要放得進修改連結：沒有可重算的連結就發一條（舊的隨機連結會換新並記歷程）。
        await access_service.ensure_access_token(db, visit.id, secret=secret, slot=visit.slot, actor=actor)
        history.record_event(
            db, visit.id, CLOSURE_NOTICE_EVENT, actor=actor, after={"date": day.isoformat()}, reason=reason
        )
        out.notified += 1
    await db.flush()
    return out

