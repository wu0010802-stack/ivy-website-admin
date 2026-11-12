"""內容興趣統計：官網各頁停留、區塊觸及、互動、單篇消息與造訪來源（2026-11-11）。

寫入經 web 的 /api/telemetry 轉進來（和瀏覽量同一道閘與限流）；彙總給後台
「數據」頁。全部是匿名資料：一列是一次頁面瀏覽，`session_id` 只是分頁內的暫時
代碼。分母為 0 的比率回 None（畫面顯示「—」）。"""
from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy import Integer, and_, case, cast, delete, distinct, extract, func, literal, or_, select, true, union_all
from sqlalchemy.dialects.postgresql import aggregate_order_by, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.campuses.models import CAMPUS_KEYS
from app.common.timezones import local_day_bounds_utc, now_utc, today_local
from app.content import service as content_service
from app.operations.models import (
    ENGAGEMENT_BOOKED_ACTION,
    ENGAGEMENT_CLASS_ACTIONS,
    ENGAGEMENT_FORM_INVALID,
    ENGAGEMENT_FORM_NO_SLOTS,
    ENGAGEMENT_FORM_STEPS,
    ENGAGEMENT_MAX_ACTIVE_MS,
    ENGAGEMENT_READ_ACTION,
    ENGAGEMENT_RETENTION_DAYS,
    ENGAGEMENT_STORY_PREFIXES,
    AnalyticsEvent,
    AnalyticsEventType,
    EngagementVisit,
)

# 停留不到這麼久就離開算「很快離開」。
BOUNCE_MS = 10_000
# 區塊在畫面中央停留滿這麼久才算「看到」。
SECTION_SEEN_MS = 1_000
# 「看過這個區塊的造訪」門檻比「看到」高：捲過去的不算。
SECTION_ENGAGED_MS = 3_000
# 常見瀏覽順序只看每次造訪的前幾頁、列前幾名；活動代碼列前幾名。
PATH_PAGES = 4
PATH_LIMIT = 10
CAMPAIGN_LIMIT = 30

_last_purge: date | None = None


async def record_visit(
    db: AsyncSession, *, visit_id: uuid.UUID, session_id: uuid.UUID, page: str, campus_key: str | None,
    item: str | None, device: str, source: str, active_ms: int, scroll_pct: int,
    sections: dict[str, int], actions: dict[str, int], seq: int | None = None, campaign: str | None = None,
    rev: int | None = None,
) -> None:
    now = now_utc()
    stmt = insert(EngagementVisit).values(
        id=visit_id, session_id=session_id, day=today_local(now), page=page, campus_key=campus_key or "",
        item=item or "", device=device, source=source, active_ms=min(active_ms, ENGAGEMENT_MAX_ACTIVE_MS),
        scroll_pct=scroll_pct, sections=sections, actions=actions, updated_at=now, seq=seq, campaign=campaign or None, rev=rev,
    )
    # 同一次瀏覽會回報多次（切到背景、換頁、關分頁），數字只會變大：留最新的一次。
    # 回報是 fire-and-forget，幾筆可能不照順序到：帶回報序號（rev）的，序號比較舊就不動區塊與互動，
    # 免得晚到的舊回報把「預約成功」「讀到文末」蓋掉；沒帶序號的舊版頁面照舊以後到的為準。
    # 只更新同一個造訪、同一頁的那一列，別人拿同一個 id 蓋不掉。
    newer = or_(EngagementVisit.rev.is_(None), stmt.excluded.rev.is_(None), stmt.excluded.rev > EngagementVisit.rev)
    await db.execute(stmt.on_conflict_do_update(
        index_elements=[EngagementVisit.id],
        set_={
            "active_ms": func.greatest(EngagementVisit.active_ms, stmt.excluded.active_ms),
            "scroll_pct": func.greatest(EngagementVisit.scroll_pct, stmt.excluded.scroll_pct),
            "sections": case((newer, stmt.excluded.sections), else_=EngagementVisit.sections),
            "actions": case((newer, stmt.excluded.actions), else_=EngagementVisit.actions),
            "rev": func.greatest(EngagementVisit.rev, stmt.excluded.rev),
            "updated_at": func.greatest(EngagementVisit.updated_at, stmt.excluded.updated_at),
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


async def _news_content(db: AsyncSession) -> dict[str, dict[str, str]]:
    """目前發布中的消息、活動、影片：代號 → 標題（後台顯示用）。"""
    payload = await content_service.published_payload(db, "home_news", None) or {}

    def titles(key: str) -> dict[str, str]:
        items = payload.get(key)
        if not isinstance(items, list):
            return {}
        return {str(item["id"]): str(item.get("title") or "") for item in items if isinstance(item, dict) and item.get("id")}

    content = {"news": titles("articles"), "event": titles("events"), "film": titles("films")}
    # 各校自己發布的消息與活動：官網把代號加上校區前綴（yihua:open-day），這裡照樣對。
    for campus_key in CAMPUS_KEYS:
        payload = await content_service.published_payload(db, "campus_news", campus_key) or {}
        for kind, key in (("news", "articles"), ("event", "events")):
            content[kind].update({f"{campus_key}:{item_id}": title for item_id, title in titles(key).items()})
    return content


def _sessions_subquery(condition, name: str):
    V = EngagementVisit
    return (
        select(
            V.session_id.label("session_id"), func.min(V.source).label("source"),
            func.max(V.campaign).label("campaign"),
            func.count().label("page_visits"),
            func.bool_or(V.actions.has_key(ENGAGEMENT_BOOKED_ACTION)).label("booked"),  # noqa: W601
            func.sum(V.active_ms).label("active_ms"),
        ).where(*condition).group_by(V.session_id).subquery(name)
    )


async def _session_totals(db: AsyncSession, sessions) -> dict:
    booked_int = case((sessions.c.booked, 1), else_=0)
    total, booked, page_visits, median_ms = (await db.execute(
        select(func.count(), func.coalesce(func.sum(booked_int), 0), func.coalesce(func.sum(sessions.c.page_visits), 0),
               _median(sessions.c.active_ms))
    )).one()
    total, booked, page_visits = int(total), int(booked), int(page_visits)
    return {
        "visits": page_visits, "sessions": total, "booked_sessions": booked, "booked_rate": _rate(booked, total),
        "median_session_ms": _int(median_ms), "pages_per_session": round(page_visits / total, 2) if total else None,
    }


async def get_engagement_summary(
    db: AsyncSession, days: int, device: str | None = None, booking_campuses: frozenset[str] = frozenset(),
) -> dict:
    """device：只看手機或電腦（None＝全部）。booking_campuses：這位使用者可以看實際預約數的
    校區（招生統計權限與校區範圍由路由決定）；不在裡面的校區 bookings 回 None。"""
    today = today_local()
    since = today - timedelta(days=days - 1)
    V = EngagementVisit
    device_filter = [V.device == device] if device else []
    scope = [V.day >= since, *device_filter]
    in_range = and_(*scope)

    # 各頁：瀏覽次數、停留中位數、很快離開的比例、捲動深度中位數；上一期的瀏覽次數拿來比較。
    # 上一期＝往前同樣天數；紀錄只留 90 天，期間的兩倍超過 90 天就沒有完整的上一期。
    has_previous = days * 2 <= ENGAGEMENT_RETENTION_DAYS
    previous_scope = [V.day >= since - timedelta(days=days), V.day < since, *device_filter]
    previous_pages: dict[tuple[str, str], int] = {}
    previous_news: dict[str, int] = {}
    if has_previous:
        for page, campus_key, item, visits in (await db.execute(
            select(V.page, V.campus_key, V.item, func.count()).where(*previous_scope).group_by(V.page, V.campus_key, V.item)
        )).all():
            previous_pages[(page, campus_key)] = previous_pages.get((page, campus_key), 0) + int(visits)
            if page == "news" and item:
                previous_news[item] = int(visits)

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
                "previous_visits": previous_pages.get((page, campus_key), 0) if has_previous else None,
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

    # 互動：做過這個互動的瀏覽數與總次數。預約成功、讀完、表單進度、試算班別、首頁點開的消息
    # 各有自己的統計，不列在互動表。
    act = func.jsonb_each_text(V.actions).table_valued("key", "value").alias("act")
    action_rows = (await db.execute(
        select(V.page, act.c.key, func.count(), func.sum(cast(act.c.value, Integer)))
        .select_from(V).join(act, true())
        .where(in_range)
        .group_by(V.page, act.c.key)
    )).all()
    special = {
        ENGAGEMENT_BOOKED_ACTION, ENGAGEMENT_READ_ACTION, ENGAGEMENT_FORM_NO_SLOTS, ENGAGEMENT_FORM_INVALID,
        *ENGAGEMENT_FORM_STEPS, *ENGAGEMENT_CLASS_ACTIONS,
    }
    content = await _news_content(db)
    actions: list[dict] = []
    class_counts = {key: 0 for key in ENGAGEMENT_CLASS_ACTIONS}
    stories: list[dict] = []
    campus_clicks = {key: {"tab": 0, "map": 0} for key in CAMPUS_KEYS}
    for page, key, visits, total in action_rows:
        visits = int(visits)
        if key in class_counts:
            # 試算查一次算一次（互動次數的加總），不是做過試算的瀏覽數：同一頁查了兩個同班別的孩子算兩次。
            if page == "admission":
                class_counts[key] += int(total or 0)
            continue
        story_kind = ENGAGEMENT_STORY_PREFIXES.get(key[:3])
        if story_kind:
            if page == "home":
                # 只列目前還在發布中的內容：亂送的代號不出現在後台。
                title = content[story_kind].get(key[3:])
                if title is not None:
                    stories.append({"kind": story_kind, "id": key[3:], "title": title or None, "visits": visits})
            continue
        if key in special:
            continue
        if page == "home":
            prefix, _, campus = key.partition("_")
            if prefix in ("campus", "map") and campus in campus_clicks:
                campus_clicks[campus]["tab" if prefix == "campus" else "map"] += visits
        actions.append({"page": page, "key": key, "visits": visits, "total": int(total or 0)})
    actions.sort(key=lambda row: (-row["visits"], row["page"], row["key"]))
    stories.sort(key=lambda row: (-row["visits"], row["kind"], row["id"]))
    classes = [{"key": key, "visits": count} for key, count in class_counts.items()]

    # 單篇消息：瀏覽、停留中位數、讀到文末的比例。
    news_rows = (await db.execute(
        select(
            V.item, func.count(), _median(V.active_ms),
            func.count().filter(V.actions.has_key(ENGAGEMENT_READ_ACTION)),  # noqa: W601
        ).where(in_range, V.page == "news", V.item != "").group_by(V.item)
    )).all()
    news = sorted(
        (
            {
                "id": item, "title": content["news"].get(item) or None, "visits": int(visits),
                "previous_visits": previous_news.get(item, 0) if has_previous else None,
                "median_active_ms": _int(active), "read_rate": _rate(int(read), int(visits)),
            }
            for item, visits, active, read in news_rows
        ),
        key=lambda row: (-row["visits"], row["id"]),
    )

    # 造訪（同一個分頁的一串瀏覽）：來源、看了幾頁、有沒有送出預約。
    sessions = _sessions_subquery(scope, "sessions")
    booked_int = case((sessions.c.booked, 1), else_=0)
    totals = await _session_totals(db, sessions)
    totals["median_active_ms"] = _int(await db.scalar(select(_median(V.active_ms)).where(in_range)))
    totals["mobile_sessions"] = int(await db.scalar(
        select(func.count(distinct(V.session_id))).where(in_range, V.device == "mobile")
    ) or 0)
    previous = None
    if has_previous:
        previous = await _session_totals(db, _sessions_subquery(previous_scope, "previous_sessions"))

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

    # 活動代碼：園方在連結上自己設的 utm_campaign，看是哪一則貼文或廣告帶來的造訪。
    campaign_rows = (await db.execute(
        select(sessions.c.campaign, sessions.c.source, func.count(), func.sum(booked_int))
        .where(sessions.c.campaign.is_not(None))
        .group_by(sessions.c.campaign, sessions.c.source)
        .order_by(func.count().desc(), sessions.c.campaign, sessions.c.source)
        .limit(CAMPAIGN_LIMIT)
    )).all()
    campaigns = [
        {
            "campaign": campaign, "source": source, "sessions": int(count), "booked_sessions": int(booked or 0),
            "booked_rate": _rate(int(booked or 0), int(count)),
        }
        for campaign, source, count, booked in campaign_rows
    ]

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

    # 每日：瀏覽與造訪（一個造訪跨午夜會在兩天各算一次）。
    by_day = {since + timedelta(days=i): (0, 0) for i in range(days)}
    for day, visits, day_sessions in (await db.execute(
        select(V.day, func.count(), func.count(distinct(V.session_id))).where(in_range).group_by(V.day)
    )).all():
        by_day[day] = (int(visits), int(day_sessions))
    daily = [{"day": day.isoformat(), "visits": visits, "sessions": count} for day, (visits, count) in sorted(by_day.items())]

    # 預約表單卡在哪一步：以造訪為單位，進過預約頁的造訪裡各走到哪一步。
    is_visit = V.page == "visit"
    form_columns = {
        "visit": func.bool_or(is_visit),
        "campus": func.bool_or(and_(is_visit, V.campus_key != "")),
        **{key: func.bool_or(and_(is_visit, V.actions.has_key(key))) for key in ENGAGEMENT_FORM_STEPS},  # noqa: W601
        ENGAGEMENT_BOOKED_ACTION: func.bool_or(V.actions.has_key(ENGAGEMENT_BOOKED_ACTION)),  # noqa: W601
        ENGAGEMENT_FORM_NO_SLOTS: func.bool_or(and_(is_visit, V.actions.has_key(ENGAGEMENT_FORM_NO_SLOTS))),  # noqa: W601
        ENGAGEMENT_FORM_INVALID: func.bool_or(and_(is_visit, V.actions.has_key(ENGAGEMENT_FORM_INVALID))),  # noqa: W601
    }
    form_sessions = (
        select(*(column.label(f"f{index}") for index, column in enumerate(form_columns.values())))
        .where(in_range).group_by(V.session_id).subquery("form_sessions")
    )
    form_counts = (await db.execute(
        select(*(func.count().filter(column) for column in form_sessions.c)).where(form_sessions.c.f0)
    )).one()
    form = {key: int(count) for key, count in zip(form_columns, form_counts)}
    step_keys = ["visit", "campus", *ENGAGEMENT_FORM_STEPS, ENGAGEMENT_BOOKED_ACTION]
    booking_form = {
        "sessions": form["visit"],
        "steps": [{"key": key, "sessions": form[key], "rate": _rate(form[key], form["visit"])} for key in step_keys],
        "no_slots_sessions": form[ENGAGEMENT_FORM_NO_SLOTS],
        "invalid_sessions": form[ENGAGEMENT_FORM_INVALID],
    }

    # 進站頁、離開頁與常見的瀏覽順序：只算有記順序的瀏覽（2026-11-11 第二輪上線後）。
    ordered = and_(in_range, V.seq.is_not(None))
    entry_rows = (await db.execute(
        select(V.page, func.count(distinct(V.session_id))).where(ordered, V.seq == 1).group_by(V.page)
    )).all()
    last_page = (
        select(V.session_id, V.page.label("page")).where(ordered)
        .distinct(V.session_id).order_by(V.session_id, V.seq.desc()).subquery("last_page")
    )
    exit_rows = (await db.execute(select(last_page.c.page, func.count()).group_by(last_page.c.page))).all()
    ordered_sessions = int(await db.scalar(select(func.count(distinct(V.session_id))).where(ordered)) or 0)

    def by_page(rows) -> list[dict]:
        return sorted(
            ({"page": page, "sessions": int(count), "rate": _rate(int(count), ordered_sessions)} for page, count in rows),
            key=lambda row: (-row["sessions"], row["page"]),
        )

    session_path = (
        select(func.string_agg(V.page, aggregate_order_by(literal(">"), V.seq)).label("path"))
        .where(ordered, V.seq <= PATH_PAGES).group_by(V.session_id).subquery("session_path")
    )
    path_rows = (await db.execute(
        select(session_path.c.path, func.count()).group_by(session_path.c.path)
        .order_by(func.count().desc(), session_path.c.path).limit(PATH_LIMIT)
    )).all()
    journey = {
        "sessions": ordered_sessions,
        "entries": by_page(entry_rows),
        "exits": by_page(exit_rows),
        "paths": [
            {"pages": path.split(">"), "sessions": int(count), "rate": _rate(int(count), ordered_sessions)}
            for path, count in path_rows
        ],
    }

    # 瀏覽時段：台北時間的星期（1＝星期一…7＝星期日）與幾點，用離開那一頁的時間。
    local = func.timezone("Asia/Taipei", V.updated_at)
    weekday, hour = extract("isodow", local), extract("hour", local)
    hours = [
        {"weekday": int(day), "hour": int(at), "visits": int(visits)}
        for day, at, visits in (await db.execute(
            select(weekday, hour, func.count()).where(in_range).group_by(weekday, hour).order_by(weekday, hour)
        )).all()
    ]

    # 各校：首頁切到哪一校、點哪一校的地址、進哪一校的預約頁，和這段期間實際送出的預約數並排。
    visit_sessions = {
        campus_key: int(count)
        for campus_key, count in (await db.execute(
            select(V.campus_key, func.count(distinct(V.session_id)))
            .where(in_range, is_visit, V.campus_key != "").group_by(V.campus_key)
        )).all()
    }
    bookings: dict[str, int] = {}
    if booking_campuses:
        start, end = local_day_bounds_utc(since)[0], local_day_bounds_utc(today)[1]
        bookings = {
            campus_key: int(count)
            for campus_key, count in (await db.execute(
                select(AnalyticsEvent.campus_key, func.count())
                .where(
                    AnalyticsEvent.event_type == AnalyticsEventType.REQUEST_CREATED,
                    AnalyticsEvent.created_at >= start, AnalyticsEvent.created_at < end,
                    AnalyticsEvent.campus_key.in_(booking_campuses),
                ).group_by(AnalyticsEvent.campus_key)
            )).all()
        }
    campuses = [
        {
            "campus_key": key, "tab_visits": campus_clicks[key]["tab"], "map_visits": campus_clicks[key]["map"],
            "visit_sessions": visit_sessions.get(key, 0),
            "bookings": bookings.get(key, 0) if key in booking_campuses else None,
        }
        for key in CAMPUS_KEYS
    ]

    return {
        "days": days,
        "since": since.isoformat(),
        "until": today.isoformat(),
        "device": device,
        "totals": totals,
        "previous": previous,
        "daily": daily,
        "pages": pages,
        "sections": sections,
        "actions": actions,
        "news": news,
        "stories": stories,
        "classes": classes,
        "sources": sources,
        "campaigns": campaigns,
        "conversion": conversion,
        "booking_form": booking_form,
        "journey": journey,
        "hours": hours,
        "campuses": campuses,
    }
