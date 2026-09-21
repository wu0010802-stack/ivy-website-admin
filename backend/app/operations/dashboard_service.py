from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import BookingConfig, BookingMode, OutboxMessage, OutboxStatus, VisitRequest, VisitRequestStatus, VisitSlot
from app.campuses.models import Campus
from app.content.models import ContentItem


async def get_dashboard_summary(db: AsyncSession, campus_keys: list[str] | None) -> dict:
    """campus_keys 為 None 代表 super_admin（不限校區）；否則只統計
    這個使用者有權限的校區，天然不會洩漏其他校的數字。"""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)

    def _scope(stmt, column):
        if campus_keys is not None:
            return stmt.where(column.in_(campus_keys))
        return stmt

    # 今日參觀：時段落在今天且狀態是 confirmed。
    today_visits_stmt = (
        select(func.count())
        .select_from(VisitRequest)
        .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
        .where(
            VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
            VisitSlot.slot_date == today_start.date(),
        )
    )
    today_visits_stmt = _scope(today_visits_stmt, VisitRequest.campus_key)
    today_visits = (await db.execute(today_visits_stmt)).scalar_one()

    pending_follow_up_stmt = select(func.count()).select_from(VisitRequest).where(
        VisitRequest.follow_up_at.is_not(None),
        VisitRequest.follow_up_at <= now,
        VisitRequest.status.not_in([VisitRequestStatus.CANCELLED.value, VisitRequestStatus.COMPLETED.value]),
    )
    pending_follow_up_stmt = _scope(pending_follow_up_stmt, VisitRequest.campus_key)
    pending_follow_up = (await db.execute(pending_follow_up_stmt)).scalar_one()

    # 保守估計「待發布」：從未發布過但已經有草稿的內容項。精確判斷
    # 「草稿版本比已發布版本新」需要額外比對 latest revision id，
    # 目前 admin 畫面看到 current_published_revision_id 就能自行核對，
    # 這裡先給最基本、不會漏掉全新未發布內容的數字。
    unpublished_stmt = select(func.count()).select_from(ContentItem).where(
        ContentItem.current_published_revision_id.is_(None), ContentItem.latest_version > 0
    )
    if campus_keys is not None:
        unpublished_stmt = unpublished_stmt.where(
            (ContentItem.campus_key.in_(campus_keys)) | (ContentItem.campus_key.is_(None))
        )
    pending_publish = (await db.execute(unpublished_stmt)).scalar_one()

    campuses_stmt = select(Campus.key)
    if campus_keys is not None:
        campuses_stmt = campuses_stmt.where(Campus.key.in_(campus_keys))
    all_campus_keys = [row[0] for row in (await db.execute(campuses_stmt)).all()]

    configs_result = await db.execute(
        select(BookingConfig).where(BookingConfig.campus_key.in_(all_campus_keys))
    )
    configs_by_campus = {c.campus_key: c for c in configs_result.scalars()}
    missing_config = []
    for key in all_campus_keys:
        config = configs_by_campus.get(key)
        if config is None or config.mode == BookingMode.PAUSED:
            missing_config.append(key)

    failed_notifications_stmt = select(func.count()).select_from(OutboxMessage).where(
        OutboxMessage.status == OutboxStatus.FAILED.value
    )
    failed_notifications = (await db.execute(failed_notifications_stmt)).scalar_one()

    return {
        "today_visits": today_visits,
        "pending_follow_up": pending_follow_up,
        "pending_publish": pending_publish,
        "campuses_without_active_booking": missing_config,
        "failed_notifications": failed_notifications,
    }
