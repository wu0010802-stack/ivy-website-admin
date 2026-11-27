"""成效統計的每月彙總（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §1）。

內容興趣（engagement_visits）只留 90 天；明年招生季要和今年同月比，得先把每個月的數字留下來。
定期工作每天跑一次 `rollup`：整個月的紀錄都還在的月份（最多三、四個月）刪掉重算，紀錄開始被清之後就不再動，
留下的是那個月完整時的數字。本月一路累計到昨天。

讀的時候再把三種永久保存的資料接上去：每日瀏覽量（page_view_daily）、官網預約案件（visit_requests）、
爬蟲次數（crawler_hits_daily）。全部是計數，沒有訪客資料。"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import Date, DateTime, and_, case, cast, delete, distinct, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import exclusion
from app.booking.models import VisitRequest, VisitRequestSource
from app.common.timezones import OPERATING_TZ, local_day_bounds_utc, now_utc, today_local
from app.operations.models import (
    ENGAGEMENT_BOOKED_ACTION,
    ENGAGEMENT_FORM_STEPS,
    ENGAGEMENT_RETENTION_DAYS,
    EngagementMonthly,
    EngagementVisit,
    PageViewDaily,
)

# 後台最多列幾個月（兩年多一點，夠看去年同月）。
MONTH_LIMIT = 25
_last_rollup: date | None = None


def month_start(day: date) -> date:
    return day.replace(day=1)


def next_month(month: date) -> date:
    return (month.replace(day=28) + timedelta(days=4)).replace(day=1)


def _median(column):
    return func.percentile_cont(0.5).within_group(column)


def _int(value) -> int:
    return int(round(float(value))) if value is not None else 0


def months_to_rollup(today: date, stats_start: date | None, earliest: date | None) -> list[tuple[date, date, date]]:
    """要重算的月份與實際涵蓋的日子：(月, 第一天, 最後一天)。

    只算昨天以前（今天還沒過完）、起算日之後、而且整段紀錄都還在的月份（第一天不早於清除的界線）。
    earliest 是 engagement_visits 最早的一天；沒有紀錄回空的。"""
    if earliest is None:
        return []
    last = today - timedelta(days=1)
    kept_from = today - timedelta(days=ENGAGEMENT_RETENTION_DAYS)
    first = max(earliest, stats_start) if stats_start else earliest
    result = []
    month = month_start(first)
    while month <= last:
        start = max(month, first)
        end = min(next_month(month) - timedelta(days=1), last)
        # 這個月的第一天已經被清掉就不重算，保留它完整時的數字。「第一天」要看這個月本來從哪天起算
        # （月初或起算日），不能看 earliest：當天的清除先跑過（部署重啟、午夜訪客回報比定期工作早到），
        # earliest 就被推到清除界線，月初已被清的月份會看起來整月都在，被只剩後半段的紀錄蓋掉。
        floor = max(month, stats_start) if stats_start else month
        if floor >= kept_from and start <= end:
            result.append((month, start, end))
        month = next_month(month)
    return result


async def _rollup_month(db: AsyncSession, month: date, start: date, end: date) -> None:
    V = EngagementVisit
    in_range = and_(V.day >= start, V.day <= end)
    now = now_utc()
    sessions = (
        select(
            V.session_id.label("session_id"),
            func.min(V.source).label("source"),
            func.min(V.device).label("device"),
            func.bool_or(V.returning).label("returning"),
            func.count().label("page_visits"),
            func.bool_or(V.actions.has_key(ENGAGEMENT_BOOKED_ACTION)).label("booked"),  # noqa: W601
            func.sum(V.active_ms).label("active_ms"),
        ).where(in_range).group_by(V.session_id).subquery("month_sessions")
    )
    booked = func.count().filter(sessions.c.booked)
    rows: list[dict] = []

    def row(kind: str, key: str, **values) -> None:
        rows.append({
            "month": month, "kind": kind, "key": key, "sessions": 0, "visits": 0, "booked_sessions": 0,
            "median_ms": None, "first_day": None, "last_day": None, "computed_at": now, **values,
        })

    total, page_visits, booked_total, median_ms = (await db.execute(
        select(func.count(), func.coalesce(func.sum(sessions.c.page_visits), 0), booked, _median(sessions.c.active_ms))
    )).one()
    row("total", "", sessions=int(total), visits=int(page_visits), booked_sessions=int(booked_total),
        median_ms=_int(median_ms) if total else None, first_day=start, last_day=end)
    for kind, column in (("device", sessions.c.device), ("source", sessions.c.source)):
        for key, count, booked_count, visits in (await db.execute(
            select(column, func.count(), booked, func.coalesce(func.sum(sessions.c.page_visits), 0)).group_by(column)
        )).all():
            row(kind, str(key), sessions=int(count), booked_sessions=int(booked_count), visits=int(visits))
    returning_key = case((sessions.c.returning.is_(True), "returning"), (sessions.c.returning.is_(False), "new"), else_="unknown")
    for key, count, booked_count in (await db.execute(
        select(returning_key, func.count(), booked).group_by(returning_key)
    )).all():
        row("returning", str(key), sessions=int(count), booked_sessions=int(booked_count))
    for page, visits, page_sessions, active in (await db.execute(
        select(V.page, func.count(), func.count(distinct(V.session_id)), _median(V.active_ms)).where(in_range).group_by(V.page)
    )).all():
        row("page", page, visits=int(visits), sessions=int(page_sessions), median_ms=_int(active))
    # 預約表單：進過預約頁的造訪裡，各走到哪一步（同內容興趣「預約表單卡在哪一步」）。
    is_visit = V.page == "visit"
    steps = {
        "visit": func.bool_or(is_visit),
        "campus": func.bool_or(and_(is_visit, V.campus_key != "")),
        **{key: func.bool_or(and_(is_visit, V.actions.has_key(key))) for key in ENGAGEMENT_FORM_STEPS},  # noqa: W601
        ENGAGEMENT_BOOKED_ACTION: func.bool_or(V.actions.has_key(ENGAGEMENT_BOOKED_ACTION)),  # noqa: W601
    }
    form = select(*(column.label(f"s{index}") for index, column in enumerate(steps.values()))).where(in_range).group_by(V.session_id).subquery("month_form")
    counts = (await db.execute(select(*(func.count().filter(column) for column in form.c)).where(form.c.s0))).one()
    for key, count in zip(steps, counts):
        row("form", key, sessions=int(count))

    await db.execute(delete(EngagementMonthly).where(EngagementMonthly.month == month))
    await db.execute(insert(EngagementMonthly).values(rows))


async def rollup(db: AsyncSession, stats_start: date | None, today: date | None = None) -> int:
    """重算還能完整重算的月份，回傳算了幾個月。呼叫端負責 commit。"""
    today = today or today_local()
    earliest = await db.scalar(select(func.min(EngagementVisit.day)))
    months = months_to_rollup(today, stats_start, earliest)
    for month, start, end in months:
        await _rollup_month(db, month, start, end)
    return len(months)


async def rollup_once_a_day(db: AsyncSession, stats_start: date | None, today: date | None = None) -> int:
    """每個程序每天最多算一次（定期工作每分鐘跑一輪）。算完才記日期：中途失敗下一輪再試。"""
    global _last_rollup
    today = today or today_local()
    if _last_rollup == today:
        return 0
    count = await rollup(db, stats_start, today)
    await db.commit()
    _last_rollup = today
    return count


def reset_rollup_clock() -> None:
    """測試用：讓下一次 rollup_once_a_day 一定會跑。"""
    global _last_rollup
    _last_rollup = None


def _month_of(local_timestamp):
    """不帶時區的時間 → 那個月的第一天（date）。全程不碰 timestamptz，不受連線時區影響。"""
    return cast(func.date_trunc("month", local_timestamp), Date)


async def get_monthly(db: AsyncSession, booking_campuses: frozenset[str], stats_start: date | None) -> dict:
    """後台「每月比較」：最近 MONTH_LIMIT 個月，新的在前。booking_campuses 同內容興趣：
    這位使用者可以看實際預約數的校區；沒有任何一校就不給預約數（None）。"""
    today = today_local()
    stored = (await db.execute(
        select(EngagementMonthly).order_by(EngagementMonthly.month.desc())
    )).scalars().all()
    by_month: dict[date, list[EngagementMonthly]] = {}
    for item in stored:
        by_month.setdefault(item.month, []).append(item)

    # 每日瀏覽量永久保存：起算日之後、到昨天為止。
    view_since = stats_start or date.min
    views_month = _month_of(cast(PageViewDaily.day, DateTime(timezone=False)))
    page_views = {
        value: int(views)
        for value, views in (await db.execute(
            select(views_month, func.sum(PageViewDaily.views))
            .where(PageViewDaily.day >= view_since, PageViewDaily.day < today)
            .group_by(views_month)
        )).all()
    }
    bookings: dict[date, int] = {}
    if booking_campuses:
        created_month = _month_of(func.timezone(str(OPERATING_TZ), VisitRequest.created_at))
        conditions = [
            VisitRequest.source == VisitRequestSource.WEB.value,
            VisitRequest.campus_key.in_(booking_campuses),
            VisitRequest.created_at < local_day_bounds_utc(today)[0],
            exclusion.not_excluded(),
        ]
        if stats_start:
            conditions.append(VisitRequest.created_at >= local_day_bounds_utc(stats_start)[0])
        bookings = {
            value: int(count)
            for value, count in (await db.execute(
                select(created_month, func.count()).where(*conditions).group_by(created_month)
            )).all()
        }

    months = sorted(set(by_month) | set(page_views) | set(bookings), reverse=True)[:MONTH_LIMIT]
    result = []
    for month in months:
        items = by_month.get(month, [])
        total = next((item for item in items if item.kind == "total"), None)

        def rows(kind: str, items=items) -> list[dict]:
            return sorted(
                (
                    {"key": item.key, "sessions": item.sessions, "visits": item.visits,
                     "booked_sessions": item.booked_sessions, "median_ms": item.median_ms}
                    for item in items if item.kind == kind
                ),
                key=lambda value: (-value["sessions"], -value["visits"], value["key"]),
            )

        result.append({
            "month": month.isoformat()[:7],
            "first_day": total.first_day if total else None,
            "last_day": total.last_day if total else None,
            "complete": bool(total and total.last_day and total.last_day >= next_month(month) - timedelta(days=1)),
            "page_views": page_views.get(month, 0),
            "bookings": bookings.get(month, 0) if booking_campuses else None,
            "sessions": total.sessions if total else None,
            "visits": total.visits if total else None,
            "booked_sessions": total.booked_sessions if total else None,
            "median_session_ms": total.median_ms if total else None,
            "devices": rows("device"),
            "sources": rows("source"),
            "returning": rows("returning"),
            "pages": rows("page"),
            "form": [row for key in ("visit", "campus", *ENGAGEMENT_FORM_STEPS, ENGAGEMENT_BOOKED_ACTION)
                     for row in rows("form") if row["key"] == key],
            "computed_at": total.computed_at if total else None,
        })
    return {"months": result}
