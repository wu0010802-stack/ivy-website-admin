"""內容興趣統計：官網各頁停留、區塊觸及、互動、單篇消息與造訪來源（2026-11-11）。

寫入經 web 的 /api/telemetry 轉進來（和瀏覽量同一道閘與限流）；彙總給後台
「數據」頁。全部是匿名資料：一列是一次頁面瀏覽，`session_id` 只是分頁內的暫時
代碼。分母為 0 的比率回 None（畫面顯示「—」）。"""
from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy import Integer, and_, case, cast, delete, distinct, func, literal, select, true, union_all
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.timezones import now_utc, today_local
from app.content import service as content_service
from app.operations.models import (
    ENGAGEMENT_BOOKED_ACTION,
    ENGAGEMENT_MAX_ACTIVE_MS,
    ENGAGEMENT_READ_ACTION,
    ENGAGEMENT_RETENTION_DAYS,
    EngagementVisit,
)

# 停留不到這麼久就離開算「很快離開」。
BOUNCE_MS = 10_000
# 區塊在畫面中央停留滿這麼久才算「看到」。
SECTION_SEEN_MS = 1_000
# 「看過這個區塊的造訪」門檻比「看到」高：捲過去的不算。
SECTION_ENGAGED_MS = 3_000

_last_purge: date | None = None


async def record_visit(
    db: AsyncSession, *, visit_id: uuid.UUID, session_id: uuid.UUID, page: str, campus_key: str | None,
    item: str | None, device: str, source: str, active_ms: int, scroll_pct: int,
    sections: dict[str, int], actions: dict[str, int],
) -> None:
    now = now_utc()
    stmt = insert(EngagementVisit).values(
        id=visit_id, session_id=session_id, day=today_local(now), page=page, campus_key=campus_key or "",
        item=item or "", device=device, source=source, active_ms=min(active_ms, ENGAGEMENT_MAX_ACTIVE_MS),
        scroll_pct=scroll_pct, sections=sections, actions=actions, updated_at=now,
    )
    # 同一次瀏覽會回報多次（切到背景、換頁、關分頁），數字只會變大：留最新的一次。
    # 只更新同一個造訪、同一頁的那一列，別人拿同一個 id 蓋不掉。
    await db.execute(stmt.on_conflict_do_update(
        index_elements=[EngagementVisit.id],
        set_={
            "active_ms": func.greatest(EngagementVisit.active_ms, stmt.excluded.active_ms),
            "scroll_pct": func.greatest(EngagementVisit.scroll_pct, stmt.excluded.scroll_pct),
            "sections": stmt.excluded.sections,
            "actions": stmt.excluded.actions,
            "updated_at": stmt.excluded.updated_at,
        },
        where=and_(
            EngagementVisit.session_id == stmt.excluded.session_id,
            EngagementVisit.page == stmt.excluded.page,
            EngagementVisit.item == stmt.excluded.item,
        ),
    ))
    await purge_old_visits_once_a_day(db)


async def purge_old_visits_once_a_day(db: AsyncSession, today: date | None = None) -> None:
    """每個程序每天最多清一次 90 天前的紀錄。"""
    global _last_purge
    today = today or today_local()
    if _last_purge == today:
        return
    await db.execute(delete(EngagementVisit).where(EngagementVisit.day < today - timedelta(days=ENGAGEMENT_RETENTION_DAYS)))
    _last_purge = today


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def _median(column):
    return func.percentile_cont(0.5).within_group(column)


def _int(value) -> int:
    return int(round(float(value))) if value is not None else 0


async def _news_titles(db: AsyncSession) -> dict[str, str]:
    payload = await content_service.published_payload(db, "home_news", None) or {}
    articles = payload.get("articles")
    if not isinstance(articles, list):
        return {}
    return {
        str(article["id"]): str(article.get("title") or "")
        for article in articles if isinstance(article, dict) and article.get("id")
    }


async def get_engagement_summary(db: AsyncSession, days: int) -> dict:
    today = today_local()
    since = today - timedelta(days=days - 1)
    V = EngagementVisit
    in_range = V.day >= since
    booked_flag = V.actions.has_key(ENGAGEMENT_BOOKED_ACTION)  # noqa: W601（JSONB 的 ? 運算子）

    # 各頁：瀏覽次數、停留中位數、很快離開的比例、捲動深度中位數。
    page_rows = (await db.execute(
        select(
            V.page, V.campus_key, func.count(), _median(V.active_ms),
            func.count().filter(V.active_ms < BOUNCE_MS), _median(V.scroll_pct),
        ).where(in_range).group_by(V.page, V.campus_key)
    )).all()
    pages = sorted(
        (
            {
                "page": page, "campus_key": campus_key or None, "visits": int(visits),
                "median_active_ms": _int(active), "bounce_rate": _rate(int(bounces), int(visits)),
                "median_scroll_pct": _int(scroll),
            }
            for page, campus_key, visits, active, bounces, scroll in page_rows
        ),
        key=lambda row: (-row["visits"], row["page"], row["campus_key"] or ""),
    )
    visits_by_page: dict[str, int] = {}
    for row in pages:
        visits_by_page[row["page"]] = visits_by_page.get(row["page"], 0) + row["visits"]

    # 區塊：在畫面中央停留滿 1 秒算看到；停留中位數只算看到的那些瀏覽。
    sec = func.jsonb_each_text(V.sections).table_valued("key", "value").alias("sec")
    sec_ms = cast(sec.c.value, Integer)
    section_rows = (await db.execute(
        select(V.page, sec.c.key, func.count(), _median(sec_ms))
        .select_from(V).join(sec, true())
        .where(in_range, sec_ms >= SECTION_SEEN_MS)
        .group_by(V.page, sec.c.key)
    )).all()
    sections = sorted(
        (
            {
                "page": page, "key": key, "reached": int(reached), "visits": visits_by_page.get(page, 0),
                "reach_rate": _rate(int(reached), visits_by_page.get(page, 0)), "median_ms": _int(ms),
            }
            for page, key, reached, ms in section_rows
        ),
        key=lambda row: (row["page"], -row["reached"], row["key"]),
    )

    # 互動：做過這個互動的瀏覽數與總次數（預約成功與讀完是內部標記，不列在互動表）。
    act = func.jsonb_each_text(V.actions).table_valued("key", "value").alias("act")
    action_rows = (await db.execute(
        select(V.page, act.c.key, func.count(), func.sum(cast(act.c.value, Integer)))
        .select_from(V).join(act, true())
        .where(in_range, act.c.key.not_in([ENGAGEMENT_BOOKED_ACTION, ENGAGEMENT_READ_ACTION]))
        .group_by(V.page, act.c.key)
    )).all()
    actions = sorted(
        (
            {"page": page, "key": key, "visits": int(visits), "total": int(total or 0)}
            for page, key, visits, total in action_rows
        ),
        key=lambda row: (-row["visits"], row["page"], row["key"]),
    )

    # 單篇消息：瀏覽、停留中位數、讀到文末的比例。
    titles = await _news_titles(db)
    news_rows = (await db.execute(
        select(
            V.item, func.count(), _median(V.active_ms),
            func.count().filter(V.actions.has_key(ENGAGEMENT_READ_ACTION)),  # noqa: W601
        ).where(in_range, V.page == "news", V.item != "").group_by(V.item)
    )).all()
    news = sorted(
        (
            {
                "id": item, "title": titles.get(item) or None, "visits": int(visits),
                "median_active_ms": _int(active), "read_rate": _rate(int(read), int(visits)),
            }
            for item, visits, active, read in news_rows
        ),
        key=lambda row: (-row["visits"], row["id"]),
    )

    # 造訪（同一個分頁的一串瀏覽）：來源、看了幾頁、有沒有送出預約。
    sessions = (
        select(
            V.session_id.label("session_id"), func.min(V.source).label("source"),
            func.count().label("page_visits"), func.bool_or(booked_flag).label("booked"),
            func.sum(V.active_ms).label("active_ms"),
        ).where(in_range).group_by(V.session_id).subquery("sessions")
    )
    booked_int = case((sessions.c.booked, 1), else_=0)
    total_sessions, booked_sessions, page_visits, median_session_ms = (await db.execute(
        select(func.count(), func.coalesce(func.sum(booked_int), 0), func.coalesce(func.sum(sessions.c.page_visits), 0),
               _median(sessions.c.active_ms))
    )).one()
    total_sessions, booked_sessions, page_visits = int(total_sessions), int(booked_sessions), int(page_visits)
    source_rows = (await db.execute(
        select(sessions.c.source, func.count(), func.sum(booked_int)).group_by(sessions.c.source)
    )).all()
    sources = sorted(
        (
            {
                "source": source, "sessions": int(count), "booked_sessions": int(booked or 0),
                "booked_rate": _rate(int(booked or 0), int(count)),
            }
            for source, count, booked in source_rows
        ),
        key=lambda row: (-row["sessions"], row["source"]),
    )

    # 看過哪些內容的造訪比較會預約：以造訪為單位，一個造訪看過同一頁／同一區塊只算一次。
    # 預約頁本身不列（送出預約一定經過它）。
    page_feature = (
        select(V.session_id.label("session_id"), literal("page").label("kind"), V.page.label("page"), literal("").label("key"))
        .where(in_range, V.page != "visit").distinct()
    )
    section_feature = (
        select(V.session_id.label("session_id"), literal("section").label("kind"), V.page.label("page"), sec.c.key.label("key"))
        .select_from(V).join(sec, true())
        .where(in_range, V.page != "visit", sec_ms >= SECTION_ENGAGED_MS).distinct()
    )
    features = union_all(page_feature, section_feature).subquery("features")
    feature_rows = (await db.execute(
        select(features.c.kind, features.c.page, features.c.key, func.count(distinct(features.c.session_id)), func.sum(booked_int))
        .select_from(features).join(sessions, sessions.c.session_id == features.c.session_id)
        .group_by(features.c.kind, features.c.page, features.c.key)
    )).all()
    conversion = sorted(
        (
            {
                "kind": kind, "page": page, "key": key or None, "sessions": int(count),
                "booked_sessions": int(booked or 0), "booked_rate": _rate(int(booked or 0), int(count)),
            }
            for kind, page, key, count, booked in feature_rows
        ),
        key=lambda row: (-row["sessions"], row["kind"], row["page"], row["key"] or ""),
    )

    median_active = await db.scalar(select(_median(V.active_ms)).where(in_range))
    return {
        "days": days,
        "since": since.isoformat(),
        "until": today.isoformat(),
        "totals": {
            "visits": page_visits,
            "sessions": total_sessions,
            "booked_sessions": booked_sessions,
            "booked_rate": _rate(booked_sessions, total_sessions),
            "median_active_ms": _int(median_active),
            "median_session_ms": _int(median_session_ms),
            "pages_per_session": round(page_visits / total_sessions, 2) if total_sessions else None,
        },
        "pages": pages,
        "sections": sections,
        "actions": actions,
        "news": news,
        "sources": sources,
        "conversion": conversion,
    }
