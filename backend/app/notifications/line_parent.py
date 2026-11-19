"""家長 LINE 通知（2026-11-16，docs/specs/2026-11-16-line-integrations-design.md §4–§6）。

流程：
1. 後台 LINE 通知頁替某校選「家長通知用哪個官方帳號」（main 或該校自己的帳號）；沒選＝沒開。
2. 家長在預約完成頁或修改頁按「用 LINE 接收通知」：產生一次性代碼 LN-XXXXXXXX（30 分鐘、只存雜湊），
   手機直接開 `line.me/R/oaMessage/<帳號>/?<預填文字>`，桌機掃 QR code。
3. 家長在 LINE 按送出：webhook 收到一對一訊息，比對代碼 → 記下這筆預約綁定的 LINE userId，回覆一則確認（不計則數）。
4. 之後的家長通知（預約成功／變更／取消、停課、參觀提醒）除了 Email，也推到這個 LINE。
5. 家長在官方帳號輸入「我的預約」：回覆綁定在這個 LINE 的預約（含修改連結）。

為什麼不用 LINE Login：一個 LINE Login channel 只能連結一個官方帳號（五校各有帳號），而且要另外申請、上架；
傳代碼只要 Messaging API，和園方群組驗證碼同一套作法。代價是要家長多按一次送出。
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.booking.models import VisitRequest, VisitRequestStatus
from app.config import LineAccountCredentials, Settings
from app.insights.cache import TtlCache
from app.notifications import line as line_api
from app.notifications.models import LineParentCampusAccount, LineParentLink, LineParentLinkCode

logger = logging.getLogger("app.line")

CODE_TTL = timedelta(minutes=30)
# 家長按送出的預填文字。代碼前面留一句人看得懂的話，家長在聊天室裡看到的就是這句。
PREFILL_TEXT = "我要用 LINE 接收參觀通知 {code}"
MY_VISITS_KEYWORDS = ("我的預約", "查詢預約", "查預約")
# 帳號名稱與 LINE ID 一小時查一次就好（後台改名不常發生）。查失敗記 1 分鐘，這段時間直接當查不到：
# LINE 連不上時，後台頁面與營運總覽不必每次都等逾時（2026-11-16 審查）。
_BOT_INFO_CACHE: TtlCache[line_api.BotInfo] = TtlCache(ttl_seconds=3600)
_BOT_INFO_FAILED: dict[tuple, float] = {}
FAILURE_HOLD_SECONDS = 60.0
# 頁面同步查 LINE 時的逾時（推播仍用 client 預設的 10 秒）。
QUERY_TIMEOUT_SECONDS = 5.0


class LineClients:
    """一次工作裡用到的各帳號 client（第一次用到才建），結束時一起關。"""

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.settings = settings
        self._accounts = settings.line_accounts
        self._transport = transport
        self._clients: dict[str, line_api.LineMessagingClient] = {}

    def has(self, key: str) -> bool:
        return key in self._accounts

    def get(self, key: str) -> line_api.LineMessagingClient | None:
        account = self._accounts.get(key)
        if account is None:
            return None
        if key not in self._clients:
            self._clients[key] = line_api.LineMessagingClient(account.access_token, transport=self._transport)
        return self._clients[key]

    async def aclose(self) -> None:
        for client in self._clients.values():
            await client.aclose()
        self._clients.clear()

    async def __aenter__(self) -> "LineClients":
        return self

    async def __aexit__(self, *exc_info) -> None:
        await self.aclose()


async def bot_info(account: LineAccountCredentials, transport=None) -> line_api.BotInfo | None:
    """帳號名稱與 LINE ID（@xxxx）；查不到回 None（不快取失敗）。"""

    async def fetch() -> line_api.BotInfo:
        async with line_api.LineMessagingClient(
            account.access_token, transport=transport, timeout=QUERY_TIMEOUT_SECONDS
        ) as client:
            return await client.bot_info()

    # 快取鍵含 token 的雜湊：換了金鑰就重查，不會沿用舊帳號的名稱。
    key = (account.key, hash(account.access_token))
    failed_at = _BOT_INFO_FAILED.get(key)
    if failed_at is not None and time.monotonic() - failed_at < FAILURE_HOLD_SECONDS:
        return None
    try:
        info = (await _BOT_INFO_CACHE.get(key, fetch)).value
    except line_api.LineApiError as exc:
        logger.warning("LINE 帳號資訊查詢失敗：account=%s error=%s", account.key, exc)
        _BOT_INFO_FAILED[key] = time.monotonic()
        return None
    _BOT_INFO_FAILED.pop(key, None)
    return info


def clear_bot_info_cache() -> None:
    """測試用。"""
    _BOT_INFO_CACHE._entries.clear()
    _BOT_INFO_FAILED.clear()


async def parent_account_key(db: AsyncSession, settings: Settings, campus_key: str) -> str | None:
    """這校的家長 LINE 通知用哪個帳號；沒開、或選的帳號金鑰已拿掉，都回 None。"""
    row = await db.get(LineParentCampusAccount, campus_key)
    if row is None or row.account_key not in settings.line_accounts:
        return None
    return row.account_key


async def active_link(
    db: AsyncSession, visit_request_id: uuid.UUID, account_key: str | None = None
) -> LineParentLink | None:
    """這筆預約目前有效的 LINE 綁定（家長沒封鎖官方帳號）。給 account_key 時只認綁在這個帳號上的
    （這校目前的家長通知帳號；後台換帳號時舊帳號的綁定會被刪掉，這裡是第二道防線）。"""
    conditions = [LineParentLink.visit_request_id == visit_request_id, LineParentLink.unfollowed_at.is_(None)]
    if account_key is not None:
        conditions.append(LineParentLink.account_key == account_key)
    return await db.scalar(select(LineParentLink).where(*conditions))


async def has_active_link(db: AsyncSession, visit_request_id: uuid.UUID) -> bool:
    return await active_link(db, visit_request_id) is not None


async def linked_visit_ids(
    db: AsyncSession, visit_request_ids: list[uuid.UUID], account_key: str | None = None
) -> set[uuid.UUID]:
    if not visit_request_ids:
        return set()
    conditions = [LineParentLink.visit_request_id.in_(visit_request_ids), LineParentLink.unfollowed_at.is_(None)]
    if account_key is not None:
        conditions.append(LineParentLink.account_key == account_key)
    rows = await db.scalars(select(LineParentLink.visit_request_id).where(*conditions))
    return set(rows)


async def drop_campus_links(db: AsyncSession, campus_key: str, *, keep_account: str | None) -> int:
    """後台把這校的家長通知關掉或換帳號：綁在其他帳號上的綁定與還沒用掉的代碼一起刪掉
    （userId 換了帳號推不到，留著只會讓家長頁顯示「已開啟」卻收不到）。回傳刪掉幾筆綁定。"""
    visit_ids = select(VisitRequest.id).where(VisitRequest.campus_key == campus_key).scalar_subquery()
    link_conditions = [LineParentLink.visit_request_id.in_(visit_ids)]
    code_conditions = [LineParentLinkCode.visit_request_id.in_(visit_ids), LineParentLinkCode.used_at.is_(None)]
    if keep_account is not None:
        link_conditions.append(LineParentLink.account_key != keep_account)
        code_conditions.append(LineParentLinkCode.account_key != keep_account)
    result = await db.execute(delete(LineParentLink).where(*link_conditions))
    await db.execute(update(LineParentLinkCode).where(*code_conditions).values(expires_at=datetime.now(timezone.utc)))
    return result.rowcount or 0


@dataclass(frozen=True)
class IssuedCode:
    code: str
    expires_at: datetime
    account_key: str


async def issue_code(db: AsyncSession, settings: Settings, visit_request: VisitRequest, account_key: str) -> IssuedCode:
    """產生一次性綁定代碼。同一筆預約先前還沒用掉的代碼一併作廢（畫面上只會有最新那組）。"""
    now = datetime.now(timezone.utc)
    await db.execute(
        update(LineParentLinkCode)
        .where(LineParentLinkCode.visit_request_id == visit_request.id, LineParentLinkCode.used_at.is_(None))
        .values(expires_at=now)
    )
    code = line_api.new_parent_code()
    row = LineParentLinkCode(
        id=uuid.uuid4(),
        visit_request_id=visit_request.id,
        account_key=account_key,
        code_hash=line_api.parent_code_hash(settings.session_secret, code),
        created_at=now,
        expires_at=now + CODE_TTL,
    )
    db.add(row)
    return IssuedCode(code=code, expires_at=row.expires_at, account_key=account_key)


def message_url(basic_id: str, code: str) -> str:
    """手機上開 LINE、跳到官方帳號的聊天室並預填文字（LINE URL scheme 規定 LINE ID 與文字都要 percent-encode）。"""
    return f"https://line.me/R/oaMessage/{quote(basic_id, safe='')}/?{quote(PREFILL_TEXT.format(code=code), safe='')}"


def add_friend_url(basic_id: str) -> str:
    return f"https://line.me/R/ti/p/{quote(basic_id, safe='')}"


async def consume_code(
    db: AsyncSession, settings: Settings, account_key: str, text: str, user_id: str, now: datetime
) -> tuple[bool, VisitRequest | None]:
    """訊息裡有代碼就試著綁定。回傳 (訊息看起來有代碼, 綁定成功的預約)。
    代碼要是這個帳號發的、沒過期、沒用過；預約要還是已確認、沒匿名化。"""
    candidates = line_api.parent_code_candidates(text)
    if not candidates:
        return False, None
    for candidate in candidates:
        code = await db.scalar(
            select(LineParentLinkCode)
            .where(
                LineParentLinkCode.code_hash == line_api.parent_code_hash(settings.session_secret, candidate),
                LineParentLinkCode.account_key == account_key,
                LineParentLinkCode.used_at.is_(None),
                LineParentLinkCode.expires_at > now,
            )
            .with_for_update()
        )
        if code is None:
            continue
        visit_request = await db.scalar(
            select(VisitRequest).options(selectinload(VisitRequest.slot)).where(VisitRequest.id == code.visit_request_id)
        )
        code.used_at = now
        if (
            visit_request is None
            or visit_request.anonymized_at is not None
            or visit_request.status != VisitRequestStatus.CONFIRMED.value
            # 取代碼之後後台關掉或換了帳號：綁了也推不到，不綁。
            or await parent_account_key(db, settings, visit_request.campus_key) != account_key
        ):
            return True, None
        existing = await db.scalar(
            select(LineParentLink).where(LineParentLink.visit_request_id == visit_request.id).with_for_update()
        )
        if existing is None:
            db.add(
                LineParentLink(
                    id=uuid.uuid4(),
                    visit_request_id=visit_request.id,
                    account_key=account_key,
                    line_user_id=user_id,
                    created_at=now,
                )
            )
        else:
            # 換一個 LINE 綁（例如家長換手機帳號、或改由另一位家長收）：只留最新的。
            existing.account_key = account_key
            existing.line_user_id = user_id
            existing.created_at = now
            existing.unfollowed_at = None
        return True, visit_request
    return True, None


async def set_follow_state(db: AsyncSession, account_key: str, user_id: str, *, following: bool, now: datetime) -> None:
    await db.execute(
        update(LineParentLink)
        .where(LineParentLink.account_key == account_key, LineParentLink.line_user_id == user_id)
        .values(unfollowed_at=None if following else now)
    )


async def unlink(db: AsyncSession, visit_request_id: uuid.UUID) -> bool:
    result = await db.execute(delete(LineParentLink).where(LineParentLink.visit_request_id == visit_request_id))
    await db.execute(
        update(LineParentLinkCode)
        .where(LineParentLinkCode.visit_request_id == visit_request_id, LineParentLinkCode.used_at.is_(None))
        .values(expires_at=datetime.now(timezone.utc))
    )
    return bool(result.rowcount)


async def linked_upcoming_visits(
    db: AsyncSession, account_key: str, user_id: str, now: datetime
) -> list[VisitRequest]:
    """綁在這個 LINE 上、還沒結束的已確認預約（依參觀時間排）。"""
    from app.common.timezones import slot_start_utc

    rows = (
        await db.scalars(
            select(VisitRequest)
            .options(selectinload(VisitRequest.slot))
            .join(LineParentLink, LineParentLink.visit_request_id == VisitRequest.id)
            .where(
                LineParentLink.account_key == account_key,
                LineParentLink.line_user_id == user_id,
                VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
                VisitRequest.anonymized_at.is_(None),
            )
        )
    ).all()
    upcoming = [
        visit for visit in rows if visit.slot is not None and slot_start_utc(visit.slot.slot_date, visit.slot.end_time) > now
    ]
    return sorted(upcoming, key=lambda visit: (visit.slot.slot_date, visit.slot.start_time))


def is_my_visits_request(text: str) -> bool:
    cleaned = "".join(text.split())
    return any(cleaned == keyword or cleaned == f"{keyword}？" for keyword in MY_VISITS_KEYWORDS)
