"""家長什麼時候按電話、LINE（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §6）。

讀成效事件（analytics_events）的 cta_click_phone／cta_click_line：瀏覽器在點下去的當下回報，時間準到秒
（內容興趣的時間是離開那一頁的時間，不適合）。看家長多半在園方上班時間內還是外想聯絡，判斷 LINE 要不要設自動回覆、
電話要不要轉接。全站匿名計數，和其他成效統計一樣登入的後台帳號都看得到。"""
from __future__ import annotations

from datetime import date

from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.timezones import OPERATING_TZ, local_day_bounds_utc, today_local
from app.operations.models import AnalyticsEvent, AnalyticsEventType
from app.operations.stats_window import stats_since

CHANNELS = {AnalyticsEventType.CTA_CLICK_PHONE: "phone", AnalyticsEventType.CTA_CLICK_LINE: "line"}
# 園方上班時間：週一到週五 08:00–17:59（台北）。這是一般幼兒園的行政時間，各校實際不同時再改這裡。
OFFICE_WEEKDAYS = range(1, 6)
OFFICE_HOURS = range(8, 18)


def in_office(weekday: int, hour: int) -> bool:
    return weekday in OFFICE_WEEKDAYS and hour in OFFICE_HOURS


async def get_contact_hours(db: AsyncSession, days: int, stats_start: date | None) -> dict:
    today = today_local()
    since = stats_since(today, days, stats_start)
    local = func.timezone(str(OPERATING_TZ), AnalyticsEvent.created_at)
    weekday, hour = extract("isodow", local), extract("hour", local)
    rows = (await db.execute(
        select(AnalyticsEvent.event_type, AnalyticsEvent.campus_key, weekday, hour, func.count())
        .where(
            AnalyticsEvent.event_type.in_(tuple(CHANNELS)),
            AnalyticsEvent.created_at >= local_day_bounds_utc(since)[0],
            AnalyticsEvent.created_at < local_day_bounds_utc(today)[1],
        )
        .group_by(AnalyticsEvent.event_type, AnalyticsEvent.campus_key, weekday, hour)
    )).all()
    cells: dict[tuple[int, int], dict[str, int]] = {}
    channels = {name: {"channel": name, "clicks": 0, "office": 0} for name in CHANNELS.values()}
    campuses: dict[str, dict] = {}
    for event_type, campus_key, day, at, count in rows:
        name = CHANNELS[AnalyticsEventType(event_type)]
        day, at, count = int(day), int(at), int(count)
        cell = cells.setdefault((day, at), {"phone": 0, "line": 0})
        cell[name] += count
        office = in_office(day, at)
        channels[name]["clicks"] += count
        channels[name]["office"] += count if office else 0
        campus = campuses.setdefault(campus_key or "", {"campus_key": campus_key, "phone": 0, "line": 0, "office": 0, "clicks": 0})
        campus[name] += count
        campus["clicks"] += count
        campus["office"] += count if office else 0
    total = sum(row["clicks"] for row in channels.values())
    office = sum(row["office"] for row in channels.values())
    return {
        "days": days, "since": since.isoformat(), "until": today.isoformat(),
        "office_hours": {"weekdays": [OFFICE_WEEKDAYS.start, OFFICE_WEEKDAYS.stop - 1], "hours": [OFFICE_HOURS.start, OFFICE_HOURS.stop]},
        "clicks": total,
        "office": office,
        "channels": list(channels.values()),
        "campuses": sorted(campuses.values(), key=lambda row: (-row["clicks"], row["campus_key"] or "")),
        "cells": [
            {"weekday": day, "hour": at, **counts}
            for (day, at), counts in sorted(cells.items())
        ],
    }
