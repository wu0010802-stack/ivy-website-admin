"""每日早上的參觀摘要（2026-11-17，設計 §4.1、§4.2）。

台灣時間 08:00–12:00 之間，每個開了摘要的群組（校區群組或總部群組）推一則「今日參觀」卡片，
列出它服務的校區今天所有已確認的參觀。不走 outbox（outbox 的每一列都綁一個案件）：直接推播，
推成功才寫 `LineDigestRun`；失敗下一輪（約每分鐘）再試，到 12:00 為止。今天沒有案件就不推、也不寫
run 列，之後補登的案件仍能在 12:00 前補發一次；已經發過的那天不會再發。

`rows_between` 是單純的查詢（不改資料），Task 8 的「今天／明天／本週參觀」指令共用。
`rows_awaiting_attendance` 是群組「待標記」指令（2026-11-25）的名單，條件同後台總覽的「待標記到場」。"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, time

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import exclusion, pending_kinds
from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.campuses.models import Campus
from app.common.timezones import OPERATING_TZ, now_utc
from app.config import Settings
from app.notifications import line_flex
from app.notifications.line import LineMessagingClient, LinePushError
from app.notifications.line_flex import VisitRow
from app.notifications.line_group_settings import digest_targets
from app.notifications.models import LineDigestRun
from app.notifications.service import _WEEKDAYS, line_parent_name, push_slot_text

logger = logging.getLogger("app.line_digest")

DIGEST_START = time(8, 0)
DIGEST_END = time(12, 0)


def _when(slot: VisitSlot) -> str:
    """同群組卡片與確認卡的時段寫法（service.push_slot_text：11/8（六）10:00）。"""
    return push_slot_text(slot)


async def rows_between(db: AsyncSession, campus_keys: list[str], start: date, end: date) -> list[VisitRow]:
    """這些校區在 [start, end]（含）內已確認、有場次的參觀，依場次日期與時間排序。
    排除標記的測試／重複案件與已匿名化的不列。"""
    if not campus_keys:
        return []
    return await _rows(
        db,
        campus_keys,
        [
            VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
            VisitSlot.slot_date >= start,
            VisitSlot.slot_date <= end,
        ],
        order=(VisitSlot.slot_date, VisitSlot.start_time, Campus.key, VisitRequest.created_at),
    )


async def rows_awaiting_attendance(db: AsyncSession, campus_keys: list[str], now: datetime | None = None) -> list[VisitRow]:
    """參觀時間已開始、還沒標記到場或未到場的已確認預約（pending_kinds 的 awaiting_attendance，同後台總覽），
    新的在前：最近剛結束的最可能還記得有沒有來。"""
    if not campus_keys:
        return []
    return await _rows(
        db,
        campus_keys,
        [pending_kinds.condition("awaiting_attendance", now)],
        order=(VisitSlot.slot_date.desc(), VisitSlot.start_time.desc(), Campus.key, VisitRequest.created_at),
    )


async def _rows(db: AsyncSession, campus_keys: list[str], conditions: list, *, order: tuple) -> list[VisitRow]:
    """排除標記的測試／重複案件與已匿名化的不列。"""
    result = await db.execute(
        select(
            VisitRequest.id,
            VisitRequest.parent_name,
            VisitRequest.party_size,
            VisitRequest.attendance_confirmed_at,
            VisitRequest.attendance_confirmed_slot_id,
            VisitSlot,
            Campus.name,
        )
        .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
        .join(Campus, Campus.key == VisitRequest.campus_key)
        .where(
            VisitRequest.campus_key.in_(campus_keys),
            VisitRequest.anonymized_at.is_(None),
            exclusion.not_excluded(),
            *conditions,
        )
        .order_by(*order)
    )
    return [
        VisitRow(
            receipt_id=str(visit_id),
            campus_name=campus_name,
            when=_when(slot),
            parent_name=line_parent_name(parent_name) or None,
            status=VisitRequestStatus.CONFIRMED.value,
            party_size=party_size,
            attendance_confirmed=confirmed_at is not None and confirmed_slot_id == slot.id,
        )
        for visit_id, parent_name, party_size, confirmed_at, confirmed_slot_id, slot, campus_name in result.all()
    ]


async def rows_for_day(db: AsyncSession, campus_keys: list[str], day: date) -> list[VisitRow]:
    return await rows_between(db, campus_keys, day, day)


async def send_due_digests(
    db: AsyncSession, settings: Settings, *, line_client: LineMessagingClient, now: datetime | None = None
) -> int:
    """推今天還沒推的摘要，回傳成功推出的則數。`now` 讓測試凍結時間。"""
    local = (now or now_utc()).astimezone(OPERATING_TZ)
    if not DIGEST_START <= local.time() < DIGEST_END:
        return 0
    day = local.date()
    done = set(
        (await db.execute(select(LineDigestRun.target_id).where(LineDigestRun.digest_date == day))).scalars()
    )
    sent = 0
    for target, campus_keys in await digest_targets(db):
        if target.target_id in done:
            continue
        rows = await rows_for_day(db, campus_keys, day)
        if not rows:
            continue
        message = line_flex.visit_list_message(
            f"今日參觀（{day.month}/{day.day} 週{_WEEKDAYS[day.weekday()]}）", rows, empty_text=""
        )
        key = uuid.uuid5(uuid.NAMESPACE_URL, f"digest:{target.target_id}:{day.isoformat()}")
        try:
            await line_client.push(target.target_id, [message], key=key)
        except (LinePushError, httpx.HTTPError):
            logger.warning("每日摘要推播失敗，下一輪再試：%s", target.target_id, exc_info=True)
            continue
        db.add(LineDigestRun(target_id=target.target_id, digest_date=day, created_at=now_utc()))
        await db.commit()
        sent += 1
    return sent
