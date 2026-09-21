from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.operations.models import PUBLIC_REPORTABLE_EVENT_TYPES, AnalyticsEvent, AnalyticsEventType

# 簡易限流：同一個 process 記憶體內滑動窗口，跟 auth 的登入限流同一種
# 做法（見 app/auth/service.py 的說明與限制）。
_CLICK_ATTEMPTS: dict[str, list[float]] = {}
CLICK_WINDOW_SECONDS = 60
CLICK_MAX_PER_WINDOW = 20


class EventTypeNotAllowed(Exception):
    """成效類事件（request_created/visit_confirmed/visit_completed）只能
    由伺服器內部流程產生，不接受公開端點直接回報——否則任何人都能偽造
    「已預約」的統計數字。"""


class RateLimited(Exception):
    pass


def check_rate_limit(client_key: str) -> None:
    now = time.monotonic()
    attempts = [t for t in _CLICK_ATTEMPTS.get(client_key, []) if now - t < CLICK_WINDOW_SECONDS]
    _CLICK_ATTEMPTS[client_key] = attempts
    if len(attempts) >= CLICK_MAX_PER_WINDOW:
        raise RateLimited()
    attempts.append(now)


async def record_public_click(
    db: AsyncSession, *, event_type: str, campus_key: str | None, client_key: str
) -> None:
    try:
        parsed_type = AnalyticsEventType(event_type)
    except ValueError as exc:
        raise EventTypeNotAllowed() from exc
    if parsed_type not in PUBLIC_REPORTABLE_EVENT_TYPES:
        raise EventTypeNotAllowed()

    check_rate_limit(client_key)

    db.add(
        AnalyticsEvent(
            id=uuid.uuid4(),
            event_type=parsed_type,
            campus_key=campus_key,
            created_at=datetime.now(timezone.utc),
        )
    )
    await db.flush()


async def record_internal_event(
    db: AsyncSession, *, event_type: AnalyticsEventType, campus_key: str | None
) -> None:
    """給伺服器內部流程呼叫（建案/確認/完成），不經過 allowlist 檢查，
    因為呼叫端本身就是唯一的事實來源。"""
    db.add(
        AnalyticsEvent(
            id=uuid.uuid4(),
            event_type=event_type,
            campus_key=campus_key,
            created_at=datetime.now(timezone.utc),
        )
    )
    await db.flush()


async def get_campus_funnel_counts(db: AsyncSession, campus_key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for event_type in AnalyticsEventType:
        result = await db.execute(
            select(func.count())
            .select_from(AnalyticsEvent)
            .where(AnalyticsEvent.campus_key == campus_key, AnalyticsEvent.event_type == event_type)
        )
        counts[event_type.value] = result.scalar_one()
    return counts
