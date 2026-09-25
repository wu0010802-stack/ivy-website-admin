from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.access_models import RescheduleRequest
from app.booking.attention import needs_attention_condition
from app.booking.models import BookingConfig, BookingMode, OutboxMessage, OutboxStatus, VisitRequest, VisitRequestStatus, VisitSlot
from app.campuses.models import Campus
from app.common.timezones import today_local
from app.content.models import ContentItem, ContentRevision


async def get_dashboard_summary(
    db: AsyncSession, campus_keys: list[str] | None, *, include_shared_reviews: bool = False
) -> dict:
    """campus_keys 為 None 代表 super_admin（不限校區）；否則只統計
    這個使用者有權限的校區，天然不會洩漏其他校的數字。"""
    now = datetime.now(timezone.utc)
    # 「今天」要用園方所在時區算。原本用 UTC 的日界線，台北時間
    # 00:00–08:00 之間整個儀表板都會顯示成前一天的名單。
    today = today_local(now)

    def _scope(stmt, column):
        if campus_keys is not None:
            return stmt.where(column.in_(campus_keys))
        return stmt

    # 今日參觀：時段落在今天且狀態是 confirmed。回清單而不是只回數字——
    # 櫃台要的是「今天誰幾點來」，一個數字沒辦法讓人打電話或準備接待。
    today_rows_stmt = (
        select(
            VisitRequest.id,
            VisitRequest.parent_name,
            VisitRequest.campus_key,
            VisitSlot.start_time,
            VisitSlot.end_time,
        )
        .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
        .where(
            VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
            # slot_date 是 naive 的日期欄位，直接跟營運時區的今天比對。
            VisitSlot.slot_date == today,
        )
        .order_by(VisitSlot.start_time, VisitRequest.parent_name)
    )
    today_rows_stmt = _scope(today_rows_stmt, VisitRequest.campus_key)
    today_visit_list = [
        {
            "id": str(row.id),
            "parent_name": row.parent_name,
            "campus_key": row.campus_key,
            "start_time": row.start_time.isoformat(),
            "end_time": row.end_time.isoformat(),
        }
        for row in (await db.execute(today_rows_stmt)).all()
    ]
    today_visits = len(today_visit_list)

    pending_follow_up_stmt = select(func.count()).select_from(VisitRequest).where(
        VisitRequest.follow_up_at.is_not(None),
        VisitRequest.follow_up_at <= now,
        VisitRequest.status.not_in([VisitRequestStatus.CANCELLED.value, VisitRequestStatus.COMPLETED.value]),
    )
    pending_follow_up_stmt = _scope(pending_follow_up_stmt, VisitRequest.campus_key)
    pending_follow_up = (await db.execute(pending_follow_up_stmt)).scalar_one()

    # 參觀案件的兩個待辦：新需求（園方還沒聯絡）與待園方確認（slots 人工確認
    # 模式，占住名額、hold_expires_at 一到就被釋出）。後者有期限，總覽要給
    # 最早到期的時間，櫃台才知道先處理哪一筆。定義與案件列表的 status 篩選相同。
    status_counts_stmt = (
        select(VisitRequest.status, func.count(), func.min(VisitRequest.hold_expires_at))
        .where(
            VisitRequest.status.in_(
                [VisitRequestStatus.NEW.value, VisitRequestStatus.PENDING_CONFIRMATION.value]
            )
        )
        .group_by(VisitRequest.status)
    )
    status_counts_stmt = _scope(status_counts_stmt, VisitRequest.campus_key)
    new_requests = 0
    awaiting_confirmation = 0
    next_hold_expires_at = None
    for status_value, count, earliest_hold in (await db.execute(status_counts_stmt)).all():
        if status_value == VisitRequestStatus.NEW.value:
            new_requests = count
        else:
            awaiting_confirmation = count
            next_hold_expires_at = earliest_hold

    # 家長線上申請改期、等園方核准的件數（規格 L239）。案件已結案的申請會
    # 被標成 closed，這裡另外只算案件仍是已確認的，跟待核准清單同一個定義。
    pending_reschedules_stmt = _scope(
        select(func.count())
        .select_from(RescheduleRequest)
        .join(VisitRequest, RescheduleRequest.visit_request_id == VisitRequest.id)
        .where(
            RescheduleRequest.status == "pending",
            VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
        ),
        VisitRequest.campus_key,
    )
    pending_reschedule_requests = (await db.execute(pending_reschedules_stmt)).scalar_one()

    # 關了時段、設了休假日或停用分校之後仍在進行中的案件（規格 L110、L227），
    # 要有人聯絡家長改期或取消。與案件清單 needs_attention 篩選同一個條件。
    needs_attention_stmt = _scope(
        select(func.count()).select_from(VisitRequest).where(needs_attention_condition(now)),
        VisitRequest.campus_key,
    )
    needs_attention = (await db.execute(needs_attention_stmt)).scalar_one()

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

    # 同時回是哪幾種內容：總覽要能直接連到該編輯頁，而不是丟一個
    # 數字讓人自己在十個內容項裡找。分校型內容多校都有草稿時只算一種。
    unpublished_kinds_stmt = (
        select(ContentItem.kind)
        .where(ContentItem.current_published_revision_id.is_(None), ContentItem.latest_version > 0)
        .distinct()
    )
    if campus_keys is not None:
        unpublished_kinds_stmt = unpublished_kinds_stmt.where(
            (ContentItem.campus_key.in_(campus_keys)) | (ContentItem.campus_key.is_(None))
        )
    pending_publish_kinds = sorted(row[0] for row in (await db.execute(unpublished_kinds_stmt)).all())

    # 等人審核的內容（內容編輯送上來的）。分校帳號只算自己校；共用內容只有
    # 總管理者能發布，所以只算給總管理者。
    pending_review_stmt = (
        select(func.count())
        .select_from(ContentRevision)
        .join(ContentItem, ContentItem.id == ContentRevision.content_item_id)
        .where(ContentRevision.review_status == "pending_review")
    )
    if campus_keys is not None:
        # 有「全站共用內容」授權的分校管理者也要看到共用內容的送審。
        condition = ContentItem.campus_key.in_(campus_keys)
        if include_shared_reviews:
            condition = condition | ContentItem.campus_key.is_(None)
        pending_review_stmt = pending_review_stmt.where(condition)
    pending_review = (await db.execute(pending_review_stmt)).scalar_one()

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

    # outbox 本身沒有校區欄位，要經案件取得校區，否則分校帳號會看到全站數字。
    failed_notifications_stmt = _scope(
        select(func.count())
        .select_from(OutboxMessage)
        .join(VisitRequest, OutboxMessage.visit_request_id == VisitRequest.id)
        .where(OutboxMessage.status == OutboxStatus.FAILED.value),
        VisitRequest.campus_key,
    )
    failed_notifications = (await db.execute(failed_notifications_stmt)).scalar_one()

    return {
        "today_visits": today_visits,
        "today_visit_list": today_visit_list,
        "new_requests": new_requests,
        "awaiting_confirmation": awaiting_confirmation,
        "next_hold_expires_at": next_hold_expires_at.isoformat() if next_hold_expires_at else None,
        "pending_reschedule_requests": pending_reschedule_requests,
        "needs_attention": needs_attention,
        "pending_follow_up": pending_follow_up,
        "pending_publish": pending_publish,
        "pending_publish_kinds": pending_publish_kinds,
        "pending_review": pending_review,
        "campuses_without_active_booking": missing_config,
        "failed_notifications": failed_notifications,
    }
