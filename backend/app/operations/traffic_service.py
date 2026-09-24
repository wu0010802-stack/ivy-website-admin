"""官網瀏覽量與 Core Web Vitals：寫入（經 web 的 /api/telemetry 轉進來）與後台彙總。"""
from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.timezones import now_utc, today_local
from app.operations.models import PageViewDaily, WebVitalSample

VITAL_RETENTION_DAYS = 90
# Google 對 Core Web Vitals 的「良好／需要改善」門檻（p75）。
VITAL_THRESHOLDS = {"LCP": (2500.0, 4000.0), "INP": (200.0, 500.0), "CLS": (0.1, 0.25)}

_last_purge: date | None = None


async def record_page_view(db: AsyncSession, *, page: str, campus_key: str | None, device: str) -> None:
    stmt = insert(PageViewDaily).values(
        id=uuid.uuid4(), day=today_local(), page=page, campus_key=campus_key or "", device=device, views=1
    )
    await db.execute(stmt.on_conflict_do_update(
        constraint="uq_page_view_daily_bucket", set_={"views": PageViewDaily.views + 1}
    ))


async def record_web_vital(
    db: AsyncSession, *, sample_id: uuid.UUID, metric: str, page: str, campus_key: str | None,
    device: str, value: float,
) -> None:
    now = now_utc()
    stmt = insert(WebVitalSample).values(
        id=sample_id, day=today_local(now), metric=metric, page=page, campus_key=campus_key or "",
        device=device, value=value, updated_at=now,
    )
    # 同一個指標在頁面存活期間會回報多次（CLS／INP 只會變大），留最後一次。
    # 只更新同一指標的樣本，不讓另一種指標蓋掉。
    await db.execute(stmt.on_conflict_do_update(
        index_elements=[WebVitalSample.id],
        set_={"value": stmt.excluded.value, "updated_at": stmt.excluded.updated_at},
        where=WebVitalSample.metric == stmt.excluded.metric,
    ))
    await purge_old_vitals_once_a_day(db)


async def purge_old_vitals_once_a_day(db: AsyncSession, today: date | None = None) -> None:
    """每個程序每天最多清一次 90 天前的樣本；瀏覽量是每日一列，量小，不清。"""
    global _last_purge
    today = today or today_local()
    if _last_purge == today:
        return
    await db.execute(delete(WebVitalSample).where(WebVitalSample.day < today - timedelta(days=VITAL_RETENTION_DAYS)))
    _last_purge = today


def _rating(metric: str, p75: float) -> str:
    good, poor = VITAL_THRESHOLDS[metric]
    return "good" if p75 <= good else "needs_improvement" if p75 <= poor else "poor"


async def get_traffic_summary(db: AsyncSession, days: int) -> dict:
    today = today_local()
    since = today - timedelta(days=days - 1)

    rows = (await db.execute(
        select(PageViewDaily.day, PageViewDaily.page, PageViewDaily.campus_key, PageViewDaily.device,
               func.sum(PageViewDaily.views))
        .where(PageViewDaily.day >= since)
        .group_by(PageViewDaily.day, PageViewDaily.page, PageViewDaily.campus_key, PageViewDaily.device)
    )).all()
    by_day = {since + timedelta(days=i): 0 for i in range(days)}
    by_page: dict[tuple[str, str], int] = {}
    by_device: dict[str, int] = {}
    for day, page, campus_key, device, views in rows:
        views = int(views)
        by_day[day] = by_day.get(day, 0) + views
        by_page[(page, campus_key)] = by_page.get((page, campus_key), 0) + views
        by_device[device] = by_device.get(device, 0) + views

    p75 = func.percentile_cont(0.75).within_group(WebVitalSample.value)
    vital_rows = (await db.execute(
        select(WebVitalSample.metric, WebVitalSample.device, p75, func.count())
        .where(WebVitalSample.day >= since)
        .group_by(WebVitalSample.metric, WebVitalSample.device)
    )).all()

    return {
        "days": days,
        "since": since.isoformat(),
        "until": today.isoformat(),
        "total_views": sum(by_day.values()),
        "daily": [{"day": d.isoformat(), "views": v} for d, v in sorted(by_day.items())],
        "pages": sorted(
            ({"page": page, "campus_key": campus_key or None, "views": views} for (page, campus_key), views in by_page.items()),
            key=lambda item: -item["views"],
        ),
        "devices": {device: views for device, views in sorted(by_device.items())},
        "vitals": sorted(
            (
                {"metric": metric, "device": device, "p75": float(value), "samples": int(count),
                 "rating": _rating(metric, float(value))}
                for metric, device, value, count in vital_rows
            ),
            key=lambda item: (["LCP", "INP", "CLS"].index(item["metric"]), item["device"]),
        ),
    }
