"""程式建立的 LINE 圖文選單（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §4）。

每個官方帳號兩版：一般（預約參觀…）與已預約（我的預約…）。後台替帳號選模式：
- booked：只建「已預約」版，逐人換上；其他好友照舊看 LINE Official Account Manager 設的選單。
- all：再建「一般」版並設成 API 預設選單（會蓋掉 OA Manager 的那個）。

誰該看已預約版由 reconcile 對齊（維護週期每一輪跑；套用之後立刻跑一次）：參觀結束、取消、解除綁定、
匿名化都不另外掛勾，下一輪自然換回去。LINE 沒有「這個選單綁了誰」的查詢，所以自己記在 line_rich_menu_users。

選單的圖是 repo 內建的四張 PNG（richmenu/），一個選單的圖上傳後不能換，內容變了就整個重建。"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import httpx
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.common.timezones import slot_start_utc, today_local
from app.config import LINE_CAMPUS_ACCOUNT_KEYS, LineAccountCredentials, Settings
from app.content import service as content_service
from app.insights.cache import TtlCache
from app.notifications import line as line_api
from app.notifications import line_parent
from app.notifications.models import LineParentCampusAccount, LineParentLink, LineRichMenu, LineRichMenuUser
from app.operations import audit_service

logger = logging.getLogger("app.line")

MODES = ("all", "booked")
KINDS = ("default", "booked")
WIDTH, HEIGHT = 2500, 843
# 三格橫排（左中右）；寬度加起來要剛好 2500。
_CELL_WIDTHS = (833, 834, 833)
ASSET_DIR = Path(__file__).parent / "richmenu"
MY_VISITS_TEXT = line_parent.MY_VISITS_KEYWORDS[0]
CHAT_BAR_TEXT = {"default": "預約參觀", "booked": MY_VISITS_TEXT}
# 一輪對齊最多替幾個人換上、換回（LINE 逐人呼叫；人數通常是個位數到數十）。
RECONCILE_BATCH = 200
_INSIGHT_CACHE: TtlCache[dict | None] = TtlCache(ttl_seconds=6 * 3600)
# LINE 的統計以 UTC+9 的日期計。
_LINE_TZ = timezone(timedelta(hours=9))


class RichMenuUnavailable(Exception):
    """還沒設官網網址（WEBSITE_PUBLIC_ORIGIN／WEBSITE_ADMIN_ORIGIN），組不出選單的連結。"""


class RichMenuFailed(Exception):
    """LINE 沒有建立成功。只帶狀態碼。"""


@dataclass(frozen=True)
class Cell:
    label: str
    action: dict


@dataclass(frozen=True)
class MenuSpec:
    kind: str  # default／booked
    layout: str  # campus（預約｜園所位置｜電話）／shared（預約｜校園環境｜官方網站）
    cells: tuple[Cell, Cell, Cell]

    @property
    def image_name(self) -> str:
        return f"{self.layout}-{self.kind}.png"

    def to_line(self, account_key: str) -> dict:
        areas = []
        x = 0
        for width, cell in zip(_CELL_WIDTHS, self.cells):
            areas.append({"bounds": {"x": x, "y": 0, "width": width, "height": HEIGHT}, "action": cell.action})
            x += width
        return {
            "size": {"width": WIDTH, "height": HEIGHT},
            "selected": True,
            "name": f"ivy-{account_key}-{self.kind}",
            "chatBarText": CHAT_BAR_TEXT[self.kind],
            "areas": areas,
        }


@lru_cache(maxsize=8)
def image_bytes(name: str) -> bytes:
    return (ASSET_DIR / name).read_bytes()


def _uri(label: str, uri: str) -> Cell:
    return Cell(label, {"type": "uri", "label": label, "uri": uri})


def _tel(phone: str | None) -> str | None:
    """tel: 網址只留數字與開頭的 +；太短的當作沒有電話。"""
    digits = re.sub(r"[^0-9+]", "", phone or "")
    return f"tel:{digits}" if len(digits) >= 7 and "+" not in digits[1:] else None


async def _liff_base(db: AsyncSession, settings: Settings, campus_key: str | None) -> str | None:
    """「預約參觀」要不要走 LIFF：有設 LIFF，而且（這校／任何一校）有開家長 LINE 通知——在 LINE 裡預約才綁得到。
    沒開的話 LIFF 只會多一個同意畫面，直接開官網。"""
    if not settings.line_liff_url:
        return None
    if campus_key is not None:
        return settings.line_liff_url if await line_parent.parent_account_key(db, settings, campus_key) else None
    rows = (await db.scalars(select(LineParentCampusAccount.account_key))).all()
    return settings.line_liff_url if any(key in settings.line_accounts for key in rows) else None


async def build_specs(db: AsyncSession, settings: Settings, account_key: str) -> dict[str, MenuSpec] | None:
    """這個帳號兩版選單現在該有的內容；沒設官網網址回 None。"""
    origin = (settings.parent_origin or "").rstrip("/")
    if not origin:
        return None
    campus_key = account_key if account_key in LINE_CAMPUS_ACCOUNT_KEYS else None
    liff = await _liff_base(db, settings, campus_key)
    suffix = f"/{campus_key}" if campus_key else ""
    visit = _uri("預約參觀", f"{liff}{suffix}" if liff else f"{origin}/visit{suffix}")
    my_visits = Cell(MY_VISITS_TEXT, {"type": "message", "label": MY_VISITS_TEXT, "text": MY_VISITS_TEXT})

    rest: tuple[Cell, Cell] | None = None
    if campus_key is not None:
        from app.notifications.service import campus_map_url

        profile = await content_service.published_payload(db, "campus_profile", campus_key) or {}
        tel = _tel(str(profile.get("phone") or ""))
        map_url = campus_map_url(profile)
        if tel and map_url:
            rest = (_uri("園所位置", map_url), _uri("撥打電話", tel))
    layout = "campus" if rest is not None else "shared"
    if rest is None:
        rest = (_uri("校園環境", f"{origin}/environment"), _uri("官方網站", f"{origin}/"))
    return {
        "default": MenuSpec("default", layout, (visit, *rest)),
        "booked": MenuSpec("booked", layout, (my_visits, *rest)),
    }


def spec_hash(account_key: str, specs: dict[str, MenuSpec]) -> str:
    """兩版選單內容（含圖）的雜湊：和建立當下不同＝要重新套用。"""
    digest = hashlib.sha256()
    for kind in KINDS:
        spec = specs[kind]
        digest.update(json.dumps(spec.to_line(account_key), sort_keys=True, ensure_ascii=False).encode("utf-8"))
        digest.update(hashlib.sha256(image_bytes(spec.image_name)).digest())
    return digest.hexdigest()


@dataclass(frozen=True)
class State:
    mode: str
    created_at: datetime
    outdated: bool


async def states(db: AsyncSession, settings: Settings) -> dict[str, State]:
    """各帳號目前的圖文選單（後台 LINE 通知頁用）。不查 LINE。"""
    out: dict[str, State] = {}
    for row in (await db.scalars(select(LineRichMenu))).all():
        specs = await build_specs(db, settings, row.account_key)
        outdated = specs is not None and spec_hash(row.account_key, specs) != row.spec_hash
        out[row.account_key] = State(mode=row.mode, created_at=row.created_at, outdated=outdated)
    return out


async def _quiet(action, what: str, account_key: str) -> None:
    """清理類的 LINE 呼叫：失敗只記 log（殘留的選單不影響功能，下次套用會重建）。"""
    try:
        await action
    except (line_api.LineApiError, httpx.HTTPError) as exc:
        logger.warning("LINE 圖文選單%s失敗：account=%s error=%s", what, account_key, exc)


async def _create(client: line_api.LineMessagingClient, spec: MenuSpec, account_key: str) -> str:
    menu_id = await client.create_rich_menu(spec.to_line(account_key))
    try:
        await client.upload_rich_menu_image(menu_id, image_bytes(spec.image_name))
    except (line_api.LineApiError, httpx.HTTPError):
        await _quiet(client.delete_rich_menu(menu_id), "刪除（傳圖失敗後）", account_key)
        raise
    return menu_id


async def apply(
    db: AsyncSession,
    settings: Settings,
    account: LineAccountCredentials,
    mode: str,
    *,
    actor_user_id: uuid.UUID | None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    """替這個帳號建立（或重建）圖文選單。LINE 那邊先建好才寫資料庫；失敗時把這次建的刪掉、資料庫不動。"""
    if mode not in MODES:
        raise ValueError(mode)
    specs = await build_specs(db, settings, account.key)
    if specs is None:
        raise RichMenuUnavailable()
    new_hash = spec_hash(account.key, specs)
    existing = await db.get(LineRichMenu, account.key)
    before = existing.mode if existing else None
    old_ids = [menu_id for menu_id in (existing.default_menu_id, existing.booked_menu_id) if menu_id] if existing else []
    # 向 LINE 建選單前先結束讀取交易。
    await db.commit()

    async with line_api.LineMessagingClient(account.access_token, transport=transport) as client:
        created: list[str] = []
        try:
            booked_id = await _create(client, specs["booked"], account.key)
            created.append(booked_id)
            default_id = None
            if mode == "all":
                default_id = await _create(client, specs["default"], account.key)
                created.append(default_id)
                await client.set_default_rich_menu(default_id)
        except (line_api.LineApiError, httpx.HTTPError) as exc:
            for menu_id in created:
                await _quiet(client.delete_rich_menu(menu_id), "刪除（建立失敗後）", account.key)
            logger.warning("LINE 圖文選單建立失敗：account=%s error=%s", account.key, exc)
            raise RichMenuFailed(str(exc)) from exc

        now = datetime.now(timezone.utc)
        row = await db.get(LineRichMenu, account.key, with_for_update=True)
        if row is None:
            row = LineRichMenu(account_key=account.key)
            db.add(row)
        row.mode = mode
        row.default_menu_id = default_id
        row.booked_menu_id = booked_id
        row.spec_hash = new_hash
        row.created_at = now
        row.created_by = actor_user_id
        # 舊選單要刪了，原本記的「替誰換上」全部作廢，下面的對齊會重新綁到新選單。
        await db.execute(delete(LineRichMenuUser).where(LineRichMenuUser.account_key == account.key))
        await audit_service.log_action(
            db,
            actor_user_id=actor_user_id,
            action="line.rich_menu.update",
            target_type="line_account",
            target_id=account.key,
            metadata={"before": before, "after": mode},
        )
        await db.commit()

        if before == "all" and mode != "all":
            await _quiet(client.clear_default_rich_menu(), "取消預設", account.key)
        for menu_id in old_ids:
            await _quiet(client.delete_rich_menu(menu_id), "刪除舊選單", account.key)

    async with line_parent.LineClients(settings, transport) as clients:
        await reconcile(db, clients, account_key=account.key)


async def remove(
    db: AsyncSession,
    account: LineAccountCredentials,
    *,
    actor_user_id: uuid.UUID | None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> bool:
    """停用這個帳號的圖文選單：替換上已預約版的人換回去、取消預設選單、刪掉選單。
    LINE 那邊失敗只記 log，資料庫照清。本來就沒有回 False。"""
    row = await db.get(LineRichMenu, account.key)
    if row is None:
        return False
    before = row.mode
    menu_ids = [menu_id for menu_id in (row.default_menu_id, row.booked_menu_id) if menu_id]
    users = (
        await db.scalars(select(LineRichMenuUser.line_user_id).where(LineRichMenuUser.account_key == account.key))
    ).all()
    await db.commit()

    async with line_api.LineMessagingClient(account.access_token, transport=transport) as client:
        for user_id in users:
            await _quiet(client.unlink_rich_menu(user_id), "換回", account.key)
        if before == "all":
            await _quiet(client.clear_default_rich_menu(), "取消預設", account.key)
        for menu_id in menu_ids:
            await _quiet(client.delete_rich_menu(menu_id), "刪除", account.key)

    await db.execute(delete(LineRichMenuUser).where(LineRichMenuUser.account_key == account.key))
    await db.execute(delete(LineRichMenu).where(LineRichMenu.account_key == account.key))
    await audit_service.log_action(
        db,
        actor_user_id=actor_user_id,
        action="line.rich_menu.update",
        target_type="line_account",
        target_id=account.key,
        metadata={"before": before, "after": None},
    )
    await db.commit()
    return True


async def _desired_users(db: AsyncSession, account_key: str, now: datetime) -> set[str]:
    """該看「已預約」版的人：綁在這個帳號、沒封鎖、預約已確認、沒匿名化、場次還沒結束，
    而且那筆預約的校區目前的家長通知帳號就是這個帳號（同 linked_upcoming_visits 與推播端的條件）。"""
    rows = (
        await db.execute(
            select(LineParentLink.line_user_id, VisitSlot.slot_date, VisitSlot.end_time)
            .join(VisitRequest, VisitRequest.id == LineParentLink.visit_request_id)
            .join(VisitSlot, VisitSlot.id == VisitRequest.slot_id)
            .join(LineParentCampusAccount, LineParentCampusAccount.campus_key == VisitRequest.campus_key)
            .where(
                LineParentLink.account_key == account_key,
                LineParentLink.unfollowed_at.is_(None),
                LineParentCampusAccount.account_key == account_key,
                VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
                VisitRequest.anonymized_at.is_(None),
                VisitSlot.slot_date >= today_local() - timedelta(days=1),
            )
        )
    ).all()
    return {user_id for user_id, slot_date, end_time in rows if slot_start_utc(slot_date, end_time) > now}


async def reconcile(
    db: AsyncSession, clients: line_parent.LineClients, *, account_key: str | None = None, now: datetime | None = None
) -> int:
    """把「誰該看已預約版」和 LINE 那邊對齊。回傳這次換上＋換回的人數。
    帳號金鑰拿掉了就跳過（不呼叫 LINE、紀錄留著，金鑰回來再對齊）。LINE 回錯的那一位跳過、下一輪再試。"""
    now = now or datetime.now(timezone.utc)
    stmt = select(LineRichMenu.account_key, LineRichMenu.booked_menu_id)
    if account_key is not None:
        stmt = stmt.where(LineRichMenu.account_key == account_key)
    menus = (await db.execute(stmt)).all()
    changed = 0
    for key, menu_id in menus:
        client = clients.get(key)
        if client is None:
            continue
        desired = await _desired_users(db, key, now)
        current = set(
            (await db.scalars(select(LineRichMenuUser.line_user_id).where(LineRichMenuUser.account_key == key))).all()
        )
        to_link = sorted(desired - current)[:RECONCILE_BATCH]
        to_unlink = sorted(current - desired)[:RECONCILE_BATCH]
        # 呼叫 LINE 前先結束讀取交易。
        await db.commit()
        if not to_link and not to_unlink:
            continue
        linked: list[str] = []
        unlinked: list[str] = []
        for user_id in to_link:
            try:
                await client.link_rich_menu(user_id, menu_id)
                linked.append(user_id)
            except (line_api.LineApiError, httpx.HTTPError) as exc:
                logger.warning("LINE 圖文選單換上失敗：account=%s error=%s", key, exc)
        for user_id in to_unlink:
            try:
                await client.unlink_rich_menu(user_id)
                unlinked.append(user_id)
            except (line_api.LineApiError, httpx.HTTPError) as exc:
                logger.warning("LINE 圖文選單換回失敗：account=%s error=%s", key, exc)
        if linked:
            # 同時有兩個對齊在跑（維護週期與後台剛套用）也不撞主鍵。
            await db.execute(
                pg_insert(LineRichMenuUser)
                .values([{"account_key": key, "line_user_id": user_id, "linked_at": now} for user_id in linked])
                .on_conflict_do_nothing()
            )
        if unlinked:
            await db.execute(
                delete(LineRichMenuUser).where(
                    LineRichMenuUser.account_key == key, LineRichMenuUser.line_user_id.in_(unlinked)
                )
            )
        await db.commit()
        changed += len(linked) + len(unlinked)
    return changed


def insight_range(days: int, now: datetime | None = None) -> tuple[date, date]:
    """(起, 迄)，UTC+9 的日期；迄＝昨天（當天的數字隔天才算好）。"""
    last = (now or datetime.now(timezone.utc)).astimezone(_LINE_TZ).date() - timedelta(days=1)
    return last - timedelta(days=days - 1), last


def _count(value: object) -> int:
    return value if isinstance(value, int) and value >= 0 else 0


def _menu_insight(kind: str, labels: tuple[str, ...], summary: dict | None) -> dict:
    """LINE 回的統計整理成後台要的樣子。點的人不到 20 位時 LINE 只回 richMenuId（沒有 impression／clicks）。"""
    impression = summary.get("impression") if isinstance(summary, dict) else None
    clicks = summary.get("clicks") if isinstance(summary, dict) else None
    if not isinstance(impression, dict) and not isinstance(clicks, list):
        return {"kind": kind, "available": False, "impressions": None, "impression_users": None, "areas": []}
    metrics = impression.get("metrics") if isinstance(impression, dict) else None
    metrics = metrics if isinstance(metrics, dict) else {}
    by_x: dict[int, dict] = {}
    for click in clicks if isinstance(clicks, list) else []:
        bounds = click.get("bounds") if isinstance(click, dict) else None
        counts = click.get("metrics") if isinstance(click, dict) else None
        if isinstance(bounds, dict) and isinstance(bounds.get("x"), int) and isinstance(counts, dict):
            by_x[bounds["x"]] = counts
    areas = []
    x = 0
    for width, label in zip(_CELL_WIDTHS, labels):
        counts = by_x.get(x, {})
        areas.append({"label": label, "clicks": _count(counts.get("count")), "users": _count(counts.get("uniqueUsers"))})
        x += width
    return {
        "kind": kind,
        "available": True,
        "impressions": _count(metrics.get("count")),
        "impression_users": _count(metrics.get("uniqueUsers")),
        "areas": areas,
    }


async def insight(
    db: AsyncSession,
    settings: Settings,
    account: LineAccountCredentials,
    days: int,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict | None:
    """這個帳號各版選單近 days 天的顯示與點擊。沒有選單回 None。每個（選單, 期間）快取 6 小時。"""
    row = await db.get(LineRichMenu, account.key)
    if row is None:
        return None
    specs = await build_specs(db, settings, account.key)
    menu_ids = {"default": row.default_menu_id, "booked": row.booked_menu_id}
    await db.commit()
    start, end = insight_range(days)
    out: dict = {"from_date": start, "to_date": end, "menus": [], "error_status": None}
    async with line_api.LineMessagingClient(
        account.access_token, transport=transport, timeout=line_parent.QUERY_TIMEOUT_SECONDS
    ) as client:
        for kind in KINDS:
            menu_id = menu_ids[kind]
            if not menu_id:
                continue

            async def fetch(menu_id: str = menu_id) -> dict | None:
                return await client.rich_menu_summary(menu_id, start, end)

            try:
                summary = (await _INSIGHT_CACHE.get((account.key, menu_id, start, end), fetch)).value
            except line_api.LineApiError as exc:
                logger.warning("LINE 圖文選單統計查詢失敗：account=%s error=%s", account.key, exc)
                out["error_status"] = exc.status_code or 0
                continue
            labels = tuple(cell.label for cell in specs[kind].cells) if specs else ("左", "中", "右")
            out["menus"].append(_menu_insight(kind, labels, summary))
    return out


def clear_cache() -> None:
    """測試用。"""
    _INSIGHT_CACHE._entries.clear()
    image_bytes.cache_clear()
