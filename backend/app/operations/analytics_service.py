from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.history import Actor
from app.booking.models import VisitEventSource, VisitRequest
from app.common import ratelimit
from app.common.timezones import local_day_bounds_utc
from app.operations.models import (
    CANCEL_REASON_PARENT,
    CANCEL_REASON_STAFF,
    PUBLIC_REPORTABLE_EVENT_TYPES,
    AnalyticsEvent,
    AnalyticsEventType,
)

# 公開點擊與伺服器事件的分組（漏斗頁依這兩組分開呈現）。
CLICK_EVENT_TYPES = tuple(t for t in AnalyticsEventType if t in PUBLIC_REPORTABLE_EVENT_TYPES)
OUTCOME_EVENT_TYPES = tuple(t for t in AnalyticsEventType if t not in PUBLIC_REPORTABLE_EVENT_TYPES)
# 依來源分組時，舊事件（沒有快照）與沒填「從哪裡知道我們」的案件的代碼。
UNKNOWN = "unknown"
NO_REFERRAL = "none"

CLICK_WINDOW_SECONDS = 60
CLICK_MAX_PER_WINDOW = 20
CLICK_LIMIT = ratelimit.Limit("analytics_click", CLICK_WINDOW_SECONDS, CLICK_MAX_PER_WINDOW)


class EventTypeNotAllowed(Exception):
    """成效類事件（request_created/visit_confirmed/visit_completed）只能
    由伺服器內部流程產生，不接受公開端點直接回報——否則任何人都能偽造
    「已預約」的統計數字。"""


class RateLimited(Exception):
    pass


async def check_rate_limit(limiter: ratelimit.RateLimiter, client_key: str) -> None:
    try:
        await limiter.check(CLICK_LIMIT, client_key)
    except ratelimit.RateLimited as exc:
        raise RateLimited() from exc


async def record_public_click(
    db: AsyncSession,
    *,
    event_type: str,
    campus_key: str | None,
    event_id: uuid.UUID,
    entry: str | None,
    limiter: ratelimit.RateLimiter,
    client_key: str,
) -> bool:
    """回傳是否真的新增了一筆；同一個 event_id 重送（keepalive 重試、網路
    重播）回 False、不重複計數。"""
    try:
        parsed_type = AnalyticsEventType(event_type)
    except ValueError as exc:
        raise EventTypeNotAllowed() from exc
    if parsed_type not in PUBLIC_REPORTABLE_EVENT_TYPES:
        raise EventTypeNotAllowed()

    await check_rate_limit(limiter, client_key)

    # 以唯一約束去重：兩個重送同時到也只會有一筆成功，另一筆什麼都不做。
    result = await db.execute(
        insert(AnalyticsEvent)
        .values(
            id=uuid.uuid4(),
            event_type=parsed_type,
            campus_key=campus_key,
            created_at=datetime.now(timezone.utc),
            event_id=event_id,
            entry=entry,
        )
        .on_conflict_do_nothing(constraint="uq_analytics_events_event_id")
        .returning(AnalyticsEvent.id)
    )
    return result.scalar_one_or_none() is not None


async def record_internal_event(
    db: AsyncSession,
    *,
    event_type: AnalyticsEventType,
    campus_key: str | None,
    visit_request: VisitRequest | None = None,
    reason: str | None = None,
) -> None:
    """給伺服器內部流程呼叫（建案/確認/完成/取消），不經過 allowlist 檢查，
    因為呼叫端本身就是唯一的事實來源。帶了案件就記下來源快照（不記案件
    id、姓名或電話），統計才能依來源分組。"""
    db.add(
        AnalyticsEvent(
            id=uuid.uuid4(),
            event_type=event_type,
            campus_key=campus_key,
            created_at=datetime.now(timezone.utc),
            source=visit_request.source if visit_request is not None else None,
            referral_sources=list(visit_request.referral_sources or []) if visit_request is not None else None,
            reason=reason,
        )
    )
    await db.flush()


def cancel_reason(actor: Actor | None) -> str:
    """後台取消與家長取消都走 workflow_service.cancel，依操作者分原因。"""
    return CANCEL_REASON_PARENT if actor is not None and actor.source == VisitEventSource.PARENT.value else CANCEL_REASON_STAFF


async def record_cancelled(
    db: AsyncSession, visit_request: VisitRequest, *, reason: str
) -> None:
    await record_internal_event(
        db,
        event_type=AnalyticsEventType.VISIT_CANCELLED,
        campus_key=visit_request.campus_key,
        visit_request=visit_request,
        reason=reason,
    )


@dataclass(frozen=True)
class FunnelRange:
    """台北日界線的日期區間，兩端都含；None 代表不限。"""

    date_from: date | None = None
    date_to: date | None = None

    def conditions(self) -> list:
        conditions = []
        if self.date_from is not None:
            conditions.append(AnalyticsEvent.created_at >= local_day_bounds_utc(self.date_from)[0])
        if self.date_to is not None:
            conditions.append(AnalyticsEvent.created_at < local_day_bounds_utc(self.date_to)[1])
        return conditions


def _empty(types) -> dict[str, int]:
    return {t.value: 0 for t in types}


async def get_campus_funnel(db: AsyncSession, campus_key: str, period: FunnelRange = FunnelRange()) -> dict:
    """一次 GROUP BY 撈出區間內的事件，再依事件類型、來源、「從哪裡知道
    我們」、取消原因、入口代碼攤開。referral_sources 是 JSON 陣列（PostgreSQL
    的 json 不能直接比較），轉成文字分組後在這裡拆開；一筆可複選多個來源，
    所以各來源加總可能大於總數。"""
    referral_text = cast(AnalyticsEvent.referral_sources, Text)
    rows = (
        await db.execute(
            select(
                AnalyticsEvent.event_type,
                AnalyticsEvent.source,
                referral_text,
                AnalyticsEvent.reason,
                AnalyticsEvent.entry,
                func.count(),
            )
            .where(AnalyticsEvent.campus_key == campus_key, *period.conditions())
            .group_by(AnalyticsEvent.event_type, AnalyticsEvent.source, referral_text, AnalyticsEvent.reason, AnalyticsEvent.entry)
        )
    ).all()

    counts = _empty(AnalyticsEventType)
    cancelled_by_reason: dict[str, int] = {}
    by_source: dict[str, dict[str, int]] = {}
    by_referral: dict[str, dict[str, int]] = {}
    clicks_by_entry: dict[str, dict[str, int]] = {}
    for event_type, source, referral_json, reason, entry, count in rows:
        key = event_type.value
        counts[key] += count
        if event_type in PUBLIC_REPORTABLE_EVENT_TYPES:
            bucket = clicks_by_entry.setdefault(entry or UNKNOWN, _empty(CLICK_EVENT_TYPES))
            bucket[key] += count
            continue
        if event_type == AnalyticsEventType.VISIT_CANCELLED:
            reason_key = reason or UNKNOWN
            cancelled_by_reason[reason_key] = cancelled_by_reason.get(reason_key, 0) + count
        by_source.setdefault(source or UNKNOWN, _empty(OUTCOME_EVENT_TYPES))[key] += count
        # SQL NULL 與 JSON 'null' 都是沒有快照（未記錄）；只有空陣列才是案件沒填。
        parsed = json.loads(referral_json) if referral_json is not None else None
        referrals = [UNKNOWN] if parsed is None else parsed or [NO_REFERRAL]
        for referral in referrals:
            by_referral.setdefault(referral, _empty(OUTCOME_EVENT_TYPES))[key] += count

    return {
        "campus_key": campus_key,
        "date_from": period.date_from,
        "date_to": period.date_to,
        "counts": counts,
        "cancelled_by_reason": cancelled_by_reason,
        "by_source": [{"source": k, "counts": v} for k, v in sorted(by_source.items())],
        "by_referral": [{"referral": k, "counts": v} for k, v in sorted(by_referral.items())],
        "clicks_by_entry": [{"entry": k, "counts": v} for k, v in sorted(clicks_by_entry.items())],
    }



async def get_unassigned_clicks(db: AsyncSession, period: FunnelRange = FunnelRange()) -> dict[str, int]:
    """不分校的公開點擊（首頁頁首往預約總頁的按鈕等），各校漏斗不含這些。"""
    rows = (
        await db.execute(
            select(AnalyticsEvent.event_type, func.count())
            .where(
                AnalyticsEvent.campus_key.is_(None),
                AnalyticsEvent.event_type.in_(CLICK_EVENT_TYPES),
                *period.conditions(),
            )
            .group_by(AnalyticsEvent.event_type)
        )
    ).all()
    counts = _empty(CLICK_EVENT_TYPES)
    for event_type, count in rows:
        counts[event_type.value] = count
    return counts
