"""統計健康檢查（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §2）。

2026-11-16～19 GA4 被 CSP 擋了三天沒人發現（[[tracking-csp-fix-20261119]]）。每天看昨天（GA4 看前天，它的資料晚一天才齊）
有沒有這幾種「數字應該有、卻沒有」的情況：

- traffic_zero：昨天官網瀏覽是 0，前幾天平均每天有 5 次以上。
- engagement_low：昨天瀏覽 20 次以上，內容興趣卻不到瀏覽的兩成（兩個是同一個外掛、同一道閘送的，正常應該差不多）。
- attribution_missing：近 7 天官網預約 3 筆以上，卻沒有一筆記到網站來源（ivy_src）。
- ga4_silent：有設 GA4 資源編號時，前天瀏覽 20 次以上、GA4 卻一個事件都沒收到。

後台「成效統計」頁頂端顯示；總部 LINE 群組開了「官網統計異常」的，每天 09:00–12:00 推一次（同一天每個群組只推一次）。
門檻都是為這個站的流量（一天幾十次瀏覽）定的，故意抓寬：寧可漏報小波動，也不要天天誤報。"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import exclusion
from app.booking.models import VisitRequest, VisitRequestSource
from app.common.timezones import OPERATING_TZ, local_day_bounds_utc, now_utc, today_local
from app.config import Settings
from app.insights.ga4_ads import Ga4Ads
from app.insights.http import GoogleApiError
from app.notifications.line import LineMessagingClient, LinePushError
from app.notifications.models import LineGroup, LineGroupSetting
from app.operations.models import EngagementVisit, PageViewDaily, StatsHealthMute, StatsHealthRun

logger = logging.getLogger("app.stats_health")

LINE_KIND = "stats_health"
ALERT_START = time(9, 0)
ALERT_END = time(12, 0)
MIN_VIEWS = 20
ENGAGEMENT_RATIO = 0.2
BASELINE_DAYS = 7
BASELINE_MIN_DAYS = 3
BASELINE_MIN_AVG = 5
BOOKING_DAYS = 7
BOOKING_MIN = 3
_WEEKDAYS = "一二三四五六日"

# 定期工作用（API 那邊用 app.state.ga4_ads）：權杖與結果快取跟著程序。
_worker_ga4 = Ga4Ads()
# 這個程序已經確認「沒有異常」的那一天：09:00–12:00 每分鐘一輪，不必每輪重查。
_clean_day: date | None = None


@dataclass(frozen=True)
class HealthIssue:
    key: str
    day: date
    message: str


async def _views(db: AsyncSession, start: date, end: date) -> dict[date, int]:
    return {
        day: int(views)
        for day, views in (await db.execute(
            select(PageViewDaily.day, func.sum(PageViewDaily.views))
            .where(PageViewDaily.day >= start, PageViewDaily.day <= end)
            .group_by(PageViewDaily.day)
        )).all()
    }


def _md(day: date) -> str:
    return f"{day.month}/{day.day}"


async def check(
    db: AsyncSession, settings: Settings, *, today: date | None = None, ga4: Ga4Ads | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[date, list[HealthIssue]]:
    """回傳（檢查的是哪一天, 異常）。昨天還在成效統計起算日之前就不查。"""
    today = today or today_local()
    yesterday = today - timedelta(days=1)
    start = settings.analytics_stats_start
    if start is not None and yesterday < start:
        return yesterday, []
    issues: list[HealthIssue] = []

    baseline_from = yesterday - timedelta(days=BASELINE_DAYS)
    if start is not None:
        baseline_from = max(baseline_from, start)
    views = await _views(db, min(baseline_from, today - timedelta(days=2)), yesterday)
    views_yesterday = views.get(yesterday, 0)
    baseline_days = (yesterday - baseline_from).days
    if baseline_days >= BASELINE_MIN_DAYS:
        average = sum(views.get(baseline_from + timedelta(days=i), 0) for i in range(baseline_days)) / baseline_days
        if views_yesterday == 0 and average >= BASELINE_MIN_AVG:
            issues.append(HealthIssue(
                "traffic_zero", yesterday,
                f"{_md(yesterday)} 官網瀏覽是 0（前 {baseline_days} 天平均每天 {round(average)} 次）：瀏覽統計可能沒有送進來，或官網打不開。",
            ))

    if views_yesterday >= MIN_VIEWS:
        engaged = int(await db.scalar(select(func.count()).where(EngagementVisit.day == yesterday)) or 0)
        if engaged < views_yesterday * ENGAGEMENT_RATIO:
            issues.append(HealthIssue(
                "engagement_low", yesterday,
                f"{_md(yesterday)} 官網有 {views_yesterday} 次瀏覽，內容興趣只記到 {engaged} 次（不到兩成）：內容興趣統計可能沒有送進來。",
            ))

    booking_from = yesterday - timedelta(days=BOOKING_DAYS - 1)
    if start is not None:
        booking_from = max(booking_from, start)
    web_bookings = select(func.count(), func.count(VisitRequest.first_touch_source)).where(
        VisitRequest.source == VisitRequestSource.WEB.value,
        VisitRequest.created_at >= local_day_bounds_utc(booking_from)[0],
        VisitRequest.created_at < local_day_bounds_utc(yesterday)[1],
        exclusion.not_excluded(),
    )
    bookings, with_source = (await db.execute(web_bookings)).one()
    if int(bookings) >= BOOKING_MIN and int(with_source) == 0:
        issues.append(HealthIssue(
            "attribution_missing", yesterday,
            f"{_md(booking_from)}–{_md(yesterday)} 的官網預約都沒有記到網站來源：來源 cookie 可能沒有寫進去。",
        ))

    ga4 = ga4 or _worker_ga4
    ga4_day = today - timedelta(days=2)
    if ga4.configured(settings) and (start is None or ga4_day >= start) and views.get(ga4_day, 0) >= MIN_VIEWS:
        try:
            events = await ga4.event_count(settings, ga4_day, transport)
        except (GoogleApiError, httpx.HTTPError):
            logger.warning("統計健康檢查：讀不到 GA4 事件數", exc_info=True)
        else:
            if events == 0:
                issues.append(HealthIssue(
                    "ga4_silent", ga4_day,
                    f"{_md(ga4_day)} 官網有 {views[ga4_day]} 次瀏覽，GA4 卻沒有收到任何事件：GA4 可能被擋（例如網站的安全標頭）。",
                ))
    return yesterday, issues


def alert_title(day: date) -> str:
    return f"官網統計可能有狀況（{_md(day)} 週{_WEEKDAYS[day.weekday()]}）"


def analytics_url(admin_origin: str | None) -> str | None:
    """後台「成效統計」：LINE 內建瀏覽器擋 Google 登入，帶 openExternalBrowser=1 改用手機預設瀏覽器。"""
    return f"{admin_origin.rstrip('/')}/admin/analytics?openExternalBrowser=1" if admin_origin else None


def alert_message(day: date, issues: list[HealthIssue], admin_origin: str | None) -> dict:
    """提醒卡片（2026-11-27 起；原本是純文字）：每項一行，「知道了」與「開成效統計」兩顆按鈕。"""
    from app.notifications import line_flex
    from app.notifications.line_group_actions import STATS_MUTE, encode

    mute_data = encode(STATS_MUTE, day.strftime("%Y%m%d"), ",".join(issue.key for issue in issues))
    return line_flex.stats_health_message(
        alert_title(day), [issue.message for issue in issues], mute_data=mute_data, analytics_url=analytics_url(admin_origin)
    )


# ---- 「知道了」（2026-11-27，docs/specs/2026-11-27-line-card-buttons-design.md §4）----

ISSUE_LABELS = {
    "traffic_zero": "瀏覽是 0",
    "engagement_low": "內容興趣偏少",
    "attribution_missing": "預約沒記到來源",
    "ga4_silent": "GA4 沒收到事件",
}
MUTE_DAYS = 3
# 卡片上「檢查的那天」最多早今天幾天還能按（推播是檢查日的隔天早上，留一天緩衝）。
MUTE_CARD_MAX_AGE_DAYS = 2


async def muted_keys(db: AsyncSession, today: date) -> set[str]:
    return set((await db.execute(select(StatsHealthMute.issue_key).where(StatsHealthMute.muted_until >= today))).scalars())


async def mute(db: AsyncSession, keys: list[str], today: date) -> date:
    """這幾種問題暫停推到 today＋MUTE_DAYS（含）；已經暫停到更晚的不縮短。呼叫端 commit。回傳暫停到哪天。"""
    until = today + timedelta(days=MUTE_DAYS)
    now = now_utc()
    # 兩個人同時按（列還不存在）也不會撞主鍵：衝突時取兩者較晚的日期。
    stmt = pg_insert(StatsHealthMute).values([
        {"issue_key": key, "muted_until": until, "updated_at": now} for key in keys
    ])
    await db.execute(stmt.on_conflict_do_update(
        index_elements=[StatsHealthMute.issue_key],
        set_={
            "muted_until": func.greatest(StatsHealthMute.muted_until, stmt.excluded.muted_until),
            "updated_at": stmt.excluded.updated_at,
        },
    ))
    return until


async def _alert_targets(db: AsyncSession) -> list[str]:
    """開了「官網統計異常」的總部群組（bot 還在群組裡）。"""
    rows = (await db.execute(
        select(LineGroupSetting.target_id, LineGroupSetting.kinds)
        .join(LineGroup, LineGroup.target_id == LineGroupSetting.target_id)
        .where(LineGroupSetting.is_hq.is_(True), LineGroup.left_at.is_(None))
        .order_by(LineGroupSetting.target_id)
    )).all()
    return [target_id for target_id, kinds in rows if LINE_KIND in (kinds or ())]


async def send_due_alerts(
    db: AsyncSession, settings: Settings, *, line_client: LineMessagingClient, now: datetime | None = None,
    ga4: Ga4Ads | None = None, transport: httpx.AsyncBaseTransport | None = None,
) -> int:
    """09:00–12:00 推昨天的異常給還沒收到的總部群組，回傳推出幾則。推失敗下一輪再試。"""
    global _clean_day
    local = (now or now_utc()).astimezone(OPERATING_TZ)
    if not ALERT_START <= local.time() < ALERT_END:
        return 0
    today = local.date()
    if _clean_day == today:
        return 0
    targets = await _alert_targets(db)
    yesterday = today - timedelta(days=1)
    done = set((await db.execute(select(StatsHealthRun.target_id).where(StatsHealthRun.day == yesterday))).scalars())
    pending = [target for target in targets if target not in done]
    if not pending:
        return 0
    day, issues = await check(db, settings, today=today, ga4=ga4, transport=transport)
    # 總部按過「知道了」的問題在暫停期間不推（2026-11-27）；全部都在暫停中就跟沒有異常一樣。
    muted = await muted_keys(db, today) if issues else set()
    issues = [issue for issue in issues if issue.key not in muted]
    if not issues:
        _clean_day = today
        return 0
    message = alert_message(day, issues, settings.admin_origin)
    sent = 0
    for target in pending:
        key = uuid.uuid5(uuid.NAMESPACE_URL, f"stats-health:{target}:{day.isoformat()}")
        try:
            await line_client.push(target, [message], key=key)
        except (LinePushError, httpx.HTTPError):
            logger.warning("統計健康檢查推播失敗，下一輪再試：%s", target, exc_info=True)
            continue
        db.add(StatsHealthRun(target_id=target, day=day, created_at=now_utc()))
        await db.commit()
        sent += 1
    return sent


def reset_clean_day() -> None:
    """測試用。"""
    global _clean_day
    _clean_day = None
