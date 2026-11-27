"""搜尋引擎與 AI 爬蟲抓了哪些頁、官網哪些網址找不到（2026-11-20，docs/specs/2026-11-20-analytics-more-design.md §4、§7）。

爬蟲次數由官網伺服器看 User-Agent 認（web/shared/crawlers.ts），每分鐘彙總一次經內部轉送進來；404 有兩個來源：
訪客瀏覽器回報（經 /api/telemetry，帶「從哪裡來」）與爬蟲抓到 404（官網伺服器記，ref＝crawler）。
都只存計數與網址路徑，沒有 IP、cookie 或來源網址。"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.timezones import today_local
from app.operations.models import (
    NOT_FOUND_DAILY_PATHS,
    NOT_FOUND_PATH_MAX,
    NOT_FOUND_REFS,
    NOT_FOUND_RETENTION_DAYS,
    CrawlerHitDaily,
    NotFoundDaily,
)
from app.operations.stats_window import stats_since

# 爬蟲代碼 → 類別。要和 web/shared/crawlers.ts 的 CRAWLERS 一致（web 測試會比對），後台
# admin/src/api/crawlerLabels.ts 也要有名稱。類別：
#   ai_train＝AI 公司收集訓練資料、ai_search＝AI 搜尋建索引、ai_user＝有人在 AI 助理裡問、它即時來讀，
#   search＝搜尋引擎、social＝貼連結時抓預覽、seo＝SEO 工具、monitor＝網站監測、other＝其他自稱爬蟲的。
CRAWLER_GROUPS: dict[str, str] = {
    "gptbot": "ai_train",
    "claudebot": "ai_train",
    "ccbot": "ai_train",
    "bytespider": "ai_train",
    "meta-externalagent": "ai_train",
    "amazonbot": "ai_train",
    "perplexitybot": "ai_search",
    "oai-searchbot": "ai_search",
    "claude-searchbot": "ai_search",
    "chatgpt-user": "ai_user",
    "claude-user": "ai_user",
    "perplexity-user": "ai_user",
    "mistralai-user": "ai_user",
    "duckassistbot": "ai_user",
    "googlebot": "search",
    "google-other": "search",
    "bingbot": "search",
    "applebot": "search",
    "duckduckbot": "search",
    "yandexbot": "search",
    "baiduspider": "search",
    "petalbot": "search",
    "facebookexternalhit": "social",
    "twitterbot": "social",
    "linkedinbot": "social",
    "slackbot": "social",
    "discordbot": "social",
    "telegrambot": "social",
    "whatsapp": "social",
    "ahrefsbot": "seo",
    "semrushbot": "seo",
    "mj12bot": "seo",
    "dotbot": "seo",
    "dataforseobot": "seo",
    "uptimerobot": "monitor",
    "other": "other",
}
CRAWLER_GROUP_ORDER = ("ai_user", "ai_search", "ai_train", "search", "social", "seo", "monitor", "other")
CRAWLER_PAGES = (
    "home", "campus", "visit", "about", "curriculum", "environment", "admission", "news", "anniversary",
    "robots", "sitemap", "llms", "other",
)
CRAWLER_STATUSES = ("2xx", "3xx", "4xx", "5xx")
NOT_FOUND_LIMIT = 50

_last_purge: date | None = None


def clean_path(raw: str) -> str | None:
    """404 網址只留路徑：去掉 ?query 與 #、結尾斜線，小寫，截到上限。控制字元或不是 / 開頭的不收。"""
    path = raw.split("#", 1)[0].split("?", 1)[0]
    if not path.startswith("/") or any(ord(char) < 32 or ord(char) == 127 for char in path):
        return None
    path = path.rstrip("/") or "/"
    return path.lower()[:NOT_FOUND_PATH_MAX]


def is_probe_path(path: str) -> bool:
    """掃描程式試探設定檔的網址（/.env、/.git/config、/.aws/credentials）：有一段以「.」開頭。
    官網沒有這種網址，不是該補的轉址；/.well-known/ 是公開慣例的位置，不算。"""
    segments = [segment for segment in path.split("/") if segment]
    return any(segment.startswith(".") and segment != ".well-known" for segment in segments)


async def record_not_found(db: AsyncSession, rows: list[tuple[str, str, int]], today: date | None = None) -> None:
    """rows：(路徑, 從哪裡來, 次數)。一天最多 NOT_FOUND_DAILY_PATHS 個不同的網址，滿了只累加已經記過的。"""
    today = today or today_local()
    known = set((await db.execute(
        select(NotFoundDaily.path, NotFoundDaily.ref).where(NotFoundDaily.day == today)
    )).all())
    distinct_paths = {path for path, _ in known}
    for raw, ref, hits in rows:
        path = clean_path(raw)
        if path is None or ref not in NOT_FOUND_REFS or hits < 1:
            continue
        if path not in distinct_paths and len(distinct_paths) >= NOT_FOUND_DAILY_PATHS:
            continue
        distinct_paths.add(path)
        stmt = insert(NotFoundDaily).values(day=today, path=path, ref=ref, hits=hits)
        await db.execute(stmt.on_conflict_do_update(
            constraint="uq_not_found_daily_bucket", set_={"hits": NotFoundDaily.hits + stmt.excluded.hits}
        ))
    await purge_once_a_day(db, today)


async def record_crawler_hits(db: AsyncSession, rows: list[tuple[str, str, str, int]], today: date | None = None) -> None:
    """rows：(爬蟲代碼, 頁面, 回應類別, 次數)；不認得的代碼、頁面、類別略過。"""
    today = today or today_local()
    for bot, page, status, hits in rows:
        if bot not in CRAWLER_GROUPS or page not in CRAWLER_PAGES or status not in CRAWLER_STATUSES or hits < 1:
            continue
        stmt = insert(CrawlerHitDaily).values(day=today, bot=bot, page=page, status_class=status, hits=hits)
        await db.execute(stmt.on_conflict_do_update(
            constraint="uq_crawler_hits_daily_bucket", set_={"hits": CrawlerHitDaily.hits + stmt.excluded.hits}
        ))


async def purge_once_a_day(db: AsyncSession, today: date | None = None) -> None:
    """404 網址只留 90 天（網址是訪客打的字，不永久保存）；爬蟲次數只有代碼與計數，不清。"""
    global _last_purge
    today = today or today_local()
    if _last_purge == today:
        return
    await db.execute(delete(NotFoundDaily).where(NotFoundDaily.day < today - timedelta(days=NOT_FOUND_RETENTION_DAYS)))
    _last_purge = today


async def get_not_found(db: AsyncSession, days: int, stats_start: date | None) -> dict:
    """近 N 天找不到的網址：每個網址的總次數、各來源次數、最後一天，依次數排序，最多 NOT_FOUND_LIMIT 個。
    掃描程式的試探網址（is_probe_path）不列、不算進總數，只回傳次數與網址數。"""
    today = today_local()
    since = stats_since(today, days, stats_start)
    rows = (await db.execute(
        select(NotFoundDaily.path, NotFoundDaily.ref, func.sum(NotFoundDaily.hits), func.max(NotFoundDaily.day))
        .where(NotFoundDaily.day >= since)
        .group_by(NotFoundDaily.path, NotFoundDaily.ref)
    )).all()
    paths: dict[str, dict] = {}
    totals = {ref: 0 for ref in NOT_FOUND_REFS}
    probe_hits = 0
    probe_paths: set[str] = set()
    for path, ref, hits, last in rows:
        if is_probe_path(path):
            probe_hits += int(hits)
            probe_paths.add(path)
            continue
        entry = paths.setdefault(path, {"path": path, "hits": 0, "visitor_hits": 0, "refs": {}, "last_day": last})
        entry["hits"] += int(hits)
        if ref != "crawler":
            entry["visitor_hits"] += int(hits)
        entry["refs"][ref] = int(hits)
        entry["last_day"] = max(entry["last_day"], last)
        totals[ref] += int(hits)
    ordered = sorted(paths.values(), key=lambda row: (-row["visitor_hits"], -row["hits"], row["path"]))
    return {
        "days": days, "since": since.isoformat(), "until": today.isoformat(),
        "paths_total": len(ordered),
        "totals": [{"ref": ref, "hits": totals[ref]} for ref in NOT_FOUND_REFS],
        "probe_hits": probe_hits,
        "probe_paths": len(probe_paths),
        "paths": [
            {**row, "refs": [{"ref": ref, "hits": row["refs"].get(ref, 0)} for ref in NOT_FOUND_REFS if row["refs"].get(ref)]}
            for row in ordered[:NOT_FOUND_LIMIT]
        ],
    }


async def get_crawlers(db: AsyncSession, days: int, stats_start: date | None) -> dict:
    """近 N 天各爬蟲抓了幾次、抓了哪些頁（依類別分組）。"""
    today = today_local()
    since = stats_since(today, days, stats_start)
    rows = (await db.execute(
        select(CrawlerHitDaily.bot, CrawlerHitDaily.page, CrawlerHitDaily.status_class, func.sum(CrawlerHitDaily.hits), func.max(CrawlerHitDaily.day))
        .where(CrawlerHitDaily.day >= since)
        .group_by(CrawlerHitDaily.bot, CrawlerHitDaily.page, CrawlerHitDaily.status_class)
    )).all()
    bots: dict[str, dict] = {}
    pages: dict[tuple[str, str], int] = {}
    for bot, page, status, hits, last in rows:
        entry = bots.setdefault(bot, {
            "bot": bot, "group": CRAWLER_GROUPS.get(bot, "other"), "hits": 0, "errors": 0, "pages": {}, "last_day": last,
        })
        entry["hits"] += int(hits)
        if status in ("4xx", "5xx"):
            entry["errors"] += int(hits)
        entry["pages"][page] = entry["pages"].get(page, 0) + int(hits)
        entry["last_day"] = max(entry["last_day"], last)
        group = CRAWLER_GROUPS.get(bot, "other")
        pages[(group, page)] = pages.get((group, page), 0) + int(hits)
    groups = []
    for group in CRAWLER_GROUP_ORDER:
        members = sorted((row for row in bots.values() if row["group"] == group), key=lambda row: (-row["hits"], row["bot"]))
        if not members:
            continue
        groups.append({
            "group": group,
            "hits": sum(row["hits"] for row in members),
            "bots": [
                {**row, "pages": [
                    {"page": page, "hits": hits}
                    for page, hits in sorted(row["pages"].items(), key=lambda item: (-item[1], item[0]))
                ]}
                for row in members
            ],
            "pages": [
                {"page": page, "hits": hits}
                for (row_group, page), hits in sorted(pages.items(), key=lambda item: (-item[1], item[0][1]))
                if row_group == group
            ],
        })
    return {
        "days": days, "since": since.isoformat(), "until": today.isoformat(),
        "hits": sum(group["hits"] for group in groups),
        "groups": groups,
    }
