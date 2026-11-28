"""成效統計的 LINE 區塊（2026-11-16，docs/specs/2026-11-16-line-integrations-design.md §7）：
各官方帳號期間內的好友變化，搭配官網 LINE 按鈕點擊數與綁定 LINE 通知的預約數。

- 好友數來自 LINE 的 insight API（某一天 UTC+9 的累計數字，隔天才算好；最早 2016-11-01）。期間的起點取
  開始日前一天、終點取結束日（今天的還沒算好就往前一天）。followers 是累計「加好友」次數，封鎖不會減少，
  所以「新增好友」＝兩天的 followers 相減；封鎖數另外看兩天的 blocks。
- 每個 (帳號, 日期) 的結果快取 6 小時；LINE 這支 API 每小時限 60 次。
- 點擊數與綁定數是官網自己的資料（成效事件 cta_click_line、line_parent_links）。"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import VisitRequest
from app.campuses.models import CAMPUS_KEYS, Campus
from app.config import LineAccountCredentials, Settings
from app.insights.cache import TtlCache
from app.notifications import line as line_api
from app.notifications import line_parent
from app.notifications.models import LineParentLink
from app.operations.analytics_service import FunnelRange
from app.operations.models import AnalyticsEvent, AnalyticsEventType

logger = logging.getLogger("app.insights")

_FOLLOWERS_CACHE: TtlCache[line_api.Followers] = TtlCache(ttl_seconds=6 * 3600)
EARLIEST = date(2016, 11, 1)
# 好友輪廓：LINE 本來就晚約 3 天才更新，每個帳號 12 小時查一次；每小時限 60 次。失敗不快取。
_DEMOGRAPHIC_CACHE: TtlCache[dict] = TtlCache(ttl_seconds=12 * 3600)
# LINE 同時給舊的 from50（50 歲以上合計）與細分的 from50to54…from70。
_FINE_AGES_FROM_50 = frozenset({"from50to54", "from55to59", "from60to64", "from65to69", "from70"})


async def followers(account: LineAccountCredentials, day: date, transport=None) -> line_api.Followers:
    async def fetch() -> line_api.Followers:
        async with line_api.LineMessagingClient(account.access_token, transport=transport) as client:
            return await client.followers(day)

    cached = await _FOLLOWERS_CACHE.get((account.key, hash(account.access_token), day), fetch)
    if cached.value.status != "ready":
        # 還沒算好的不留 6 小時：下次再問。
        _FOLLOWERS_CACHE._entries.pop((account.key, hash(account.access_token), day), None)
    return cached.value


def clear_cache() -> None:
    """測試用。"""
    _FOLLOWERS_CACHE._entries.clear()


async def demographic(account: LineAccountCredentials, transport=None) -> dict:
    async def fetch() -> dict:
        async with line_api.LineMessagingClient(account.access_token, transport=transport) as client:
            return await client.demographic()

    return (await _DEMOGRAPHIC_CACHE.get((account.key, hash(account.access_token)), fetch)).value


def clear_demographic_cache() -> None:
    """測試用。"""
    _DEMOGRAPHIC_CACHE._entries.clear()


def _items(raw, name: str) -> list[dict]:
    """LINE 的 [{<name>: 代碼, percentage: 數字}] 轉成 [{key, percentage}]；百分比 0 或不是數字的不回。"""
    items = []
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        key, percentage = entry.get(name), entry.get("percentage")
        if isinstance(key, str) and isinstance(percentage, (int, float)) and not isinstance(percentage, bool) and percentage > 0:
            items.append({"key": key[:40], "percentage": float(percentage)})
    return items


def demographic_row(data: dict) -> dict:
    """LINE 回應轉成回給前端的一個帳號（不含 key 與名稱）。好友不到 20 位時 available 是 False。"""
    if data.get("available") is not True:
        return {"available": False}
    ages = _items(data.get("ages"), "age")
    if any(item["key"] in _FINE_AGES_FROM_50 for item in ages):
        ages = [item for item in ages if item["key"] != "from50"]
    return {
        "available": True,
        "genders": _items(data.get("genders"), "gender"),
        "ages": ages,
        "areas": sorted(_items(data.get("areas"), "area"), key=lambda item: -item["percentage"]),
        "subscription_periods": _items(data.get("subscriptionPeriods"), "subscriptionPeriod"),
    }


async def demographic_rows(settings: Settings, transport=None) -> list[dict]:
    rows = []
    for account in settings.line_accounts.values():
        info = await line_parent.bot_info(account, transport)
        row: dict = {"key": account.key, "display_name": info.display_name if info else None}
        try:
            row.update(demographic_row(await demographic(account, transport)))
        except line_api.LineApiError as exc:
            logger.warning("LINE 好友輪廓查詢失敗：account=%s error=%s", account.key, exc)
            row["error_status"] = exc.status_code or 0
        rows.append(row)
    return rows


def follower_days(start: date, end: date, today: date) -> tuple[date, date]:
    """(起點, 終點)：起點＝開始日前一天，終點＝結束日但不晚於昨天（今天的數字隔天才算好）。"""
    last = min(end, today - timedelta(days=1))
    first = max(start - timedelta(days=1), EARLIEST)
    return min(first, last), last


async def account_rows(settings: Settings, start: date, end: date, today: date, transport=None) -> list[dict]:
    first, last = follower_days(start, end, today)
    rows = []
    for account in settings.line_accounts.values():
        info = await line_parent.bot_info(account, transport)
        row: dict = {
            "key": account.key,
            "display_name": info.display_name if info else None,
            "basic_id": info.basic_id if info else None,
            "from_date": first,
            "to_date": last,
        }
        try:
            begin = await followers(account, first, transport)
            finish = await followers(account, last, transport)
        except line_api.LineApiError as exc:
            logger.warning("LINE 好友數查詢失敗：account=%s error=%s", account.key, exc)
            row["error_status"] = exc.status_code or 0
            rows.append(row)
            continue
        row["ready"] = begin.status == "ready" and finish.status == "ready"
        row["followers"] = finish.followers
        row["blocks"] = finish.blocks
        row["targeted_reaches"] = finish.targeted_reaches
        if row["ready"] and begin.followers is not None and finish.followers is not None:
            row["new_followers"] = max(finish.followers - begin.followers, 0)
        if row["ready"] and begin.blocks is not None and finish.blocks is not None:
            row["blocks_change"] = finish.blocks - begin.blocks
        rows.append(row)
    return rows


async def campus_rows(db: AsyncSession, start: date, end: date) -> list[dict]:
    period = FunnelRange(start, end)
    clicks = dict(
        (
            await db.execute(
                select(AnalyticsEvent.campus_key, func.count())
                .where(AnalyticsEvent.event_type == AnalyticsEventType.CTA_CLICK_LINE, *period.conditions())
                .group_by(AnalyticsEvent.campus_key)
            )
        ).all()
    )
    linked = dict(
        (
            await db.execute(
                select(VisitRequest.campus_key, func.count())
                .join(LineParentLink, LineParentLink.visit_request_id == VisitRequest.id)
                .where(*period.on(LineParentLink.created_at))
                .group_by(VisitRequest.campus_key)
            )
        ).all()
    )
    order = {key: index for index, key in enumerate(CAMPUS_KEYS)}
    campuses = sorted((await db.execute(select(Campus))).scalars().all(), key=lambda c: (order.get(c.key, 99), c.key))
    rows = [
        {"campus_key": c.key, "campus_name": c.name, "line_clicks": clicks.get(c.key, 0), "linked": linked.get(c.key, 0)}
        for c in campuses
    ]
    # 不分校區的 LINE 點擊（頁首選單、頁尾等沒有校區的位置）。
    if clicks.get(None):
        rows.append({"campus_key": None, "campus_name": "不分校區", "line_clicks": clicks[None], "linked": 0})
    return rows
