from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.booking import pending_kinds, slot_service
from app.booking.attention import needs_attention_condition
from app.booking.models import BookingConfig, BookingMode, OutboxMessage, OutboxStatus, VisitRequest, VisitRequestStatus, VisitSlot
from app.campuses.models import Campus
from app.common.timezones import today_local
from app.content.models import ContentItem, ContentRevision, PublishJob
from app.content.publish_jobs import unresolved_condition
from app.content.registry import CONTENT_KIND_REGISTRY, HQ_MANAGED_KINDS
from app.media.models import MediaAsset, MediaStatus

# 今天的名單列哪些狀態：已確認、已到場、未到場；已取消不列。
_TODAY_STATUSES = (
    VisitRequestStatus.CONFIRMED.value,
    VisitRequestStatus.COMPLETED.value,
    VisitRequestStatus.NO_SHOW.value,
)


async def get_dashboard_summary(
    db: AsyncSession,
    campus_keys: list[str] | None,
    *,
    include_shared_content: bool = False,
    include_shared_reviews: bool = False,
) -> dict:
    """campus_keys 為 None 代表 super_admin（不限校區）；否則只統計
    這個使用者有權限的校區，天然不會洩漏其他校的數字。

    共用內容（首頁、消息、頁尾…）的待發布、素材問題與排程失敗只算給能編
    共用內容的人（include_shared_content，和後台共用內容頁進不進得去同一條
    規則）；送審只算給能發布共用內容的人（include_shared_reviews）。"""
    now = datetime.now(timezone.utc)
    # 「今天」要用園方所在時區算。原本用 UTC 的日界線，台北時間
    # 00:00–08:00 之間整個儀表板都會顯示成前一天的名單。
    today = today_local(now)

    def _scope(stmt, column):
        if campus_keys is not None:
            return stmt.where(column.in_(campus_keys))
        return stmt

    # 今日參觀：場次落在今天的案件。回清單而不是只回數字——櫃台要的是「今天誰幾點來」，
    # 一個數字沒辦法讓人打電話或準備接待。2026-10-06 起整天都列：已到場、未到場的也留在
    # 名單上（帶 status），總覽才是「今天的行程板」而不是待辦；已取消的不列。承辦人同日拿掉，不回。
    today_rows_stmt = (
        select(
            VisitRequest.id,
            VisitRequest.parent_name,
            VisitRequest.child_name,
            VisitRequest.phone,
            VisitRequest.status,
            VisitRequest.campus_key,
            VisitSlot.start_time,
            VisitSlot.end_time,
        )
        .join(VisitSlot, VisitRequest.slot_id == VisitSlot.id)
        .where(
            VisitRequest.status.in_(_TODAY_STATUSES),
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
            "child_name": row.child_name,
            "phone": row.phone,
            "status": row.status,
            "campus_key": row.campus_key,
            "start_time": row.start_time.isoformat(),
            "end_time": row.end_time.isoformat(),
        }
        for row in (await db.execute(today_rows_stmt)).all()
    ]
    today_visits = len(today_visit_list)

    # 參觀時間已過、還沒標記到場或未到場的案件（booking/pending_kinds.py，和案件列表
    # 「時間已過」那一組的已確認部分、成效統計同一個條件）。總覽提醒有人去補標記。
    awaiting_attendance_stmt = _scope(
        select(func.count()).select_from(VisitRequest).where(pending_kinds.condition("awaiting_attendance", now)),
        VisitRequest.campus_key,
    )
    awaiting_attendance = (await db.execute(awaiting_attendance_stmt)).scalar_one()

    pending_follow_up_stmt = _scope(
        select(func.count()).select_from(VisitRequest).where(pending_kinds.condition("follow_up_due", now)),
        VisitRequest.campus_key,
    )
    pending_follow_up = (await db.execute(pending_follow_up_stmt)).scalar_one()

    # 關了時段、設了休假日或停用分校之後仍在進行中的案件（規格 L110、L227），
    # 要有人聯絡家長改期或取消。與案件清單 needs_attention 篩選同一個條件。
    needs_attention_stmt = _scope(
        select(func.count()).select_from(VisitRequest).where(needs_attention_condition(now)),
        VisitRequest.campus_key,
    )
    needs_attention = (await db.execute(needs_attention_stmt)).scalar_one()

    # 「待發布」：最新一版還沒上官網的內容項——從來沒發布過的，以及發布後
    # 又存了新草稿的（最新版本號比官網上的版本新）。正式站初始化時已經全部
    # 發布過一次，之後改了文案忘了發布就是後者，只算前者會一直顯示 0。
    content_items = await _content_in_scope(db, campus_keys, include_shared=include_shared_content)
    pending_publish_items = [
        {
            "kind": item.kind,
            "campus_key": item.campus_key,
            "latest_version": item.latest_version,
            "published_version": published.version if published else None,
            "updated_at": latest.created_at.isoformat() if latest else None,
        }
        for item, latest, published in content_items
        if item.latest_version > 0 and (published is None or item.latest_version > published.version)
    ]
    pending_publish_items.sort(key=lambda row: (row["updated_at"] or ""), reverse=True)
    pending_publish = len(pending_publish_items)
    # 總覽連到編輯頁用；分校型內容多校都有草稿時只算一種。
    pending_publish_kinds = sorted({row["kind"] for row in pending_publish_items})

    content_media_issues = await _media_issues(db, content_items)

    # 排程發布到點沒有執行（檢查不過）而且還沒有人處理（之後沒有發布過這項
    # 內容、也沒有人按「知道了」）：要有人決定改完再發布、重新排程或不發布。
    # 到期時官網已是較新版本而略過的不算，沒有待辦。
    failed_jobs_stmt = (
        select(PublishJob, ContentItem, ContentRevision.version)
        .join(ContentItem, ContentItem.id == PublishJob.content_item_id)
        .join(ContentRevision, ContentRevision.id == PublishJob.revision_id)
        .where(PublishJob.status == "failed", unresolved_condition())
        .order_by(PublishJob.finished_at.desc())
        .limit(20)
    )
    if campus_keys is not None:
        failed_jobs_stmt = failed_jobs_stmt.where(_content_scope_condition(campus_keys, include_shared_content))
    failed_publish_jobs = [
        {
            "id": str(job.id),
            "kind": item.kind,
            "campus_key": item.campus_key,
            "revision_version": version,
            "publish_at": job.publish_at.isoformat(),
            "error": job.error,
        }
        for job, item, version in (await db.execute(failed_jobs_stmt)).all()
    ]

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
        pending_review_stmt = pending_review_stmt.where(_content_scope_condition(campus_keys, include_shared_reviews))
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
    # 開放家長選時段，但官網現在一個可預約的場次都沒有：家長進到表單只看到
    # 「目前沒有開放的參觀場次」。有每週規則時定期工作約一分鐘內會補上，
    # 所以只看實際可預約的場次，不看規則。
    slots_without_openings = []
    for key in all_campus_keys:
        config = configs_by_campus.get(key)
        if config is None or config.mode == BookingMode.PAUSED:
            missing_config.append(key)
        elif config.mode == BookingMode.SLOTS and await slot_service.count_bookable_slots(db, key, config, now) == 0:
            slots_without_openings.append(key)

    # 本週五校（2026-10-06 總覽行程板）：今天起七天內各校已預約幾組、還可約幾組。
    # 「已預約」算占名額的案件（已確認、已到場、未到場），和月曆的已排數一致；
    # 「還可約」只有自選場次的校才有，暫停或其他方式回 None（畫面寫「未開放」或方式）。
    week_campuses = await _week_campuses(db, all_campus_keys, configs_by_campus, today)

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
        "awaiting_attendance": awaiting_attendance,
        "needs_attention": needs_attention,
        "pending_follow_up": pending_follow_up,
        "pending_publish": pending_publish,
        "pending_publish_kinds": pending_publish_kinds,
        "pending_publish_items": pending_publish_items,
        "content_media_issues": content_media_issues,
        "failed_publish_jobs": failed_publish_jobs,
        "pending_review": pending_review,
        "campuses_without_active_booking": missing_config,
        "campuses_slots_without_openings": slots_without_openings,
        "week_campuses": week_campuses,
        "failed_notifications": failed_notifications,
    }


async def _week_campuses(db: AsyncSession, campus_keys: list[str], configs_by_campus: dict, today) -> list[dict]:
    week_end = today + timedelta(days=6)
    booked_sub = (
        select(func.count())
        .select_from(VisitRequest)
        .where(VisitRequest.slot_id == VisitSlot.id, slot_service.occupying_condition())
        .correlate(VisitSlot)
        .scalar_subquery()
    )
    rows = (
        await db.execute(
            select(VisitSlot.campus_key, VisitSlot.closed, VisitSlot.capacity, booked_sub).where(
                VisitSlot.campus_key.in_(campus_keys),
                VisitSlot.slot_date >= today,
                VisitSlot.slot_date <= week_end,
            )
        )
    ).all()
    booked: dict[str, int] = {key: 0 for key in campus_keys}
    open_seats: dict[str, int] = {key: 0 for key in campus_keys}
    for campus_key, closed, capacity, booked_count in rows:
        booked[campus_key] += booked_count
        if not closed:
            open_seats[campus_key] += max(capacity - booked_count, 0)
    result = []
    for key in campus_keys:
        config = configs_by_campus.get(key)
        mode = BookingMode.PAUSED.value if config is None else config.mode.value
        result.append(
            {
                "campus_key": key,
                "mode": mode,
                "booked": booked[key],
                "open": open_seats[key] if mode == BookingMode.SLOTS.value else None,
            }
        )
    return result


def _content_scope_condition(campus_keys: list[str], include_shared: bool):
    # 總部管理的各校內容（校園探索）比照共用內容：分校帳號不算自己校的，
    # 有「全站共用內容」權限的人五校都算。
    condition = ContentItem.campus_key.in_(campus_keys) & ContentItem.kind.not_in(HQ_MANAGED_KINDS)
    if include_shared:
        condition = condition | ContentItem.campus_key.is_(None) | ContentItem.kind.in_(HQ_MANAGED_KINDS)
    return condition


async def _content_in_scope(
    db: AsyncSession, campus_keys: list[str] | None, *, include_shared: bool
) -> list[tuple[ContentItem, ContentRevision | None, ContentRevision | None]]:
    """範圍內每個內容項，連同最新一版與官網上的那一版。"""
    latest = aliased(ContentRevision)
    published = aliased(ContentRevision)
    stmt = (
        select(ContentItem, latest, published)
        .outerjoin(latest, (latest.content_item_id == ContentItem.id) & (latest.version == ContentItem.latest_version))
        .outerjoin(published, published.id == ContentItem.current_published_revision_id)
        .where(ContentItem.latest_version > 0)
    )
    if campus_keys is not None:
        stmt = stmt.where(_content_scope_condition(campus_keys, include_shared))
    return [tuple(row) for row in (await db.execute(stmt)).all()]


async def _media_issues(
    db: AsyncSession, items: list[tuple[ContentItem, ContentRevision | None, ContentRevision | None]]
) -> list[dict]:
    """官網上或最新草稿引用的素材已被刪除（missing）或還沒處理好（not_ready：
    處理中或失敗）。草稿有問題就發布不了；官網上的版本有問題，家長看到的是
    破圖或備用圖。"""
    refs: list[tuple[ContentItem, bool, list[uuid.UUID]]] = []
    for item, latest, published in items:
        config = CONTENT_KIND_REGISTRY.get(item.kind)
        if config is None:
            continue
        for revision, is_live in ((published, True), (latest, False)):
            if revision is None or (not is_live and published is not None and revision.id == published.id):
                continue
            ids = config.extract_media_ids(revision.payload)
            if ids:
                refs.append((item, is_live, ids))
    all_ids = {media_id for _, _, ids in refs for media_id in ids}
    if not all_ids:
        return []
    # 待清理（deleted_at）的素材公開路由已經回 404，跟真的刪掉一樣算 missing。
    result = await db.execute(
        select(MediaAsset.id, MediaAsset.status).where(MediaAsset.id.in_(all_ids), MediaAsset.deleted_at.is_(None))
    )
    statuses = dict(result.all())
    issues: dict[tuple[str, str | None], dict] = {}
    for item, is_live, ids in refs:
        missing = sum(1 for media_id in set(ids) if media_id not in statuses)
        not_ready = sum(1 for media_id in set(ids) if statuses.get(media_id, MediaStatus.READY) != MediaStatus.READY)
        if not (missing or not_ready):
            continue
        row = issues.setdefault(
            (item.kind, item.campus_key),
            {"kind": item.kind, "campus_key": item.campus_key, "missing": 0, "not_ready": 0, "live": False},
        )
        row["missing"] = max(row["missing"], missing)
        row["not_ready"] = max(row["not_ready"], not_ready)
        row["live"] = row["live"] or is_live
    return sorted(issues.values(), key=lambda row: (not row["live"], row["kind"], row["campus_key"] or ""))
