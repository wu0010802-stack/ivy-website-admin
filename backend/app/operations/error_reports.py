"""官網、後台與 API 的錯誤回報（2026-11-05）：遮蔽、分組、寫入、保存期限與伺服器端擷取。

正式站出錯時不必等家長或園方回報：官網與後台的未處理 JS 錯誤（經 web 的 /api/client-errors
轉進 POST /public/client-errors）與 API 的未處理例外，依 fingerprint 分成一組一列存進
error_groups，總管理者在「系統狀態」頁看、標為已處理。

不存個資：沒有 IP、cookie、帳號，也不存 query string 與 hash；訊息、堆疊、頁面路徑一律先
遮蔽再入庫（redact_text），後端堆疊另外套資料庫例外的遮蔽（logging_config.redact_database_error_text，
和平台日誌共用同一份）。瀏覽器端送出前也會先遮一次（web/shared/client-error.ts、
admin/src/utils/errorReport.ts），這裡是最後一道，不信任呼叫端。

錯誤回報本身失敗一律吞掉（記 warning）：不能讓原本的請求或頁面因此壞掉。"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import time
import traceback
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import Request
from sqlalchemy import delete, func, literal_column, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import ClientDisconnect

from app.common import ratelimit
from app.common.timezones import now_utc, today_local
from app.logging_config import redact_database_error_text
from app.notifications import error_alerts
from app.operations.models import ErrorGroup
from app.operations.public_caps import DAY_SECONDS

logger = logging.getLogger("app.operations.error_reports")

SOURCES = ("web", "admin", "api")
RETENTION_DAYS = 90
MESSAGE_LIMIT = 500
KIND_LIMIT = 120
LOCATION_LIMIT = 300
PATH_LIMIT = 300
RELEASE_LIMIT = 64
STACK_LIMIT = 8000
USER_AGENT_LIMIT = 300
SERVER_STACK_LINES = 40

# 單一來源每分鐘上限（超過回 429）與全站每日上限（超過安靜丟棄、仍回 204，比照 public_caps）。
CLIENT_ERROR_SOURCE_PER_MINUTE = ratelimit.Limit("client_errors", window_seconds=60, max_per_window=60)
CLIENT_ERROR_DAILY = ratelimit.Limit("client_errors_daily", DAY_SECONDS, 5000, sliding=False)

# 同一個 fingerprint 在這個程序內 10 秒最多寫一次 DB；期間的次數累加到下一次寫入。
# 崩潰迴圈（每個請求都丟同一個例外）才不會把 DB 打爆。
THROTTLE_SECONDS = 10.0
# 寫入錯誤回報最多等這麼久：DB 本身掛掉時不能讓 500 回應跟著卡住。
SERVER_WRITE_TIMEOUT_SECONDS = 3.0
_THROTTLE_MAX_TRACKED = 1000

# ----------------------------------------------------------------------------- 遮蔽

# 網址（含 // 開頭與 / 開頭的站內路徑）後面的 ?query 與 #hash 整段拿掉，但保留堆疊 frame 的
# 「:行:列」。站內路徑要求前面不是字元、斜線或冒號，免得把 https://host/x 的第二段誤當路徑。
_URL_QUERY = re.compile(
    r"(?P<url>(?:[A-Za-z][A-Za-z0-9+.\-]*:)?//[^\s'\"<>()?#]+|(?<![\w/.:\-])/[^\s'\"<>()?#:]+)"
    r"[?#][^\s'\"<>()]*?(?P<pos>(?::\d+){0,2})(?=[\s'\"<>)\]]|$)"
)
# https://user:password@host：資料庫連線字串之類，帳密整段不留。
_USERINFO = re.compile(r"(?<=//)[^\s/@]+@")
_SQL_PARAMETERS = re.compile(r"\[parameters: [^\n]*\]")
_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+")
_TW_ID = re.compile(r"(?<![A-Za-z0-9])[A-Za-z][12]\d{8}(?!\d)", re.ASCII)
# 連續 7 位以上數字，中間容許單一的 - 或空白（電話 0912-345-678、+886 912 345 678）。
_LONG_DIGITS = re.compile(r"[0-9](?:[ \-]?[0-9]){6,}")
_TOKEN = re.compile(r"[A-Za-z0-9_\-]{20,}")


def _token_replacer(mode: str):
    def replace(match: re.Match[str]) -> str:
        value = match.group()
        if not any(ch.isalnum() for ch in value):  # 全是 - 或 _（分隔線）不是 token
            return value
        if mode == "digits" and not any(ch.isdigit() for ch in value):
            return value
        return "[token]"

    return replace


def redact_text(text: str, *, tokens: Literal["all", "digits", "off"] = "all") -> str:
    """把可能識別個人的片段換成佔位符。順序有意義：身分證要在長數字之前（A123456789
    含 9 位數字），網址 query 最先拿掉（query 裡常有電話、Email）。

    tokens 決定「20 字以上的英數連續串」這一條怎麼套：
    - all：全換成 [token]。瀏覽器回報的內容一律這樣（訪客的字串，什麼都可能在裡面）。
    - digits：只換含數字的。伺服器自己產生的錯誤文字用：asyncpg.exceptions.NotNullViolationError
      這類 20 字以上的例外與函式名稱全是英文字母，全換掉就看不出是什麼錯；真正的 token（base64、
      十六進位、UUID、session id）幾乎一定含數字。
    - off：不套。Python 堆疊的 frame 與原始碼行是程式不是資料。"""
    text = _URL_QUERY.sub(lambda m: m.group("url") + m.group("pos"), text)
    text = _USERINFO.sub("[credentials]@", text)
    text = _SQL_PARAMETERS.sub("[parameters: 已隱藏]", text)
    text = _EMAIL.sub("[email]", text)
    text = _TW_ID.sub("[id]", text)
    # token 在長數字之前：UUID 與 20 位以上的長串整段換掉，不會被數字規則切成兩半。
    if tokens != "off":
        text = _TOKEN.sub(_token_replacer(tokens), text)
    return _LONG_DIGITS.sub("[n]", text)


def redact_path(path: str) -> str:
    """頁面路徑：去掉 query／hash 後套同一組遮蔽（家長管理連結的 token 就在路徑裡）。"""
    return redact_text(path.split("?", 1)[0].split("#", 1)[0])


def redact_traceback(text: str, exc: BaseException | None) -> str:
    """Python 堆疊：資料庫例外先換掉 DETAIL 與參數值，再逐行遮蔽。縮排的行是 frame 與原始碼，
    不套 token 規則；不縮排的行（例外類別與訊息、串接例外的說明）才是可能帶資料的地方。"""
    text = redact_database_error_text(text, exc)
    return "\n".join(redact_text(line, tokens="off" if line[:1].isspace() else "digits") for line in text.split("\n"))


# ----------------------------------------------------------------------------- 分組

_NORMALIZERS = (
    (re.compile(r"'[^'\n]*'|\"[^\"\n]*\"|`[^`\n]*`"), "<s>"),
    (re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"), "<uuid>"),
    (re.compile(r"\b0[xX][0-9a-fA-F]+\b"), "<hex>"),
    # 至少有一個數字與一個 a–f 字母的 8 碼以上：不把 deadbeef 以外的一般英文單字當十六進位。
    (re.compile(r"\b(?=[0-9a-fA-F]*[0-9])(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{8,}\b"), "<hex>"),
    (re.compile(r"[0-9]+"), "<n>"),
)


def normalize_message(message: str) -> str:
    """同一個錯誤帶不同參數（id、數字、引號裡的名稱）要歸同一組：參數換成佔位符。"""
    for pattern, placeholder in _NORMALIZERS:
        message = pattern.sub(placeholder, message)
    return message


# 分組用的位置不能每次部署都變，否則同一個錯誤部署後會開新的一組（之後接推播就是每次部署都再通知一次）：
# 去掉 Python 行號與 JS 的行:列，再去掉打包檔名裡的內容雜湊——Nuxt 是 `/_nuxt/<8 碼>.js`、
# 後台 Vite 是 `/admin/assets/<名稱>-<8 碼>.js`（base64url，可能含 - 與 _）。存進 DB 的 location 照舊有行號。
_LINE_SUFFIX = re.compile(r":\d+(?::\d+)?$")
_BUNDLE_HASH = re.compile(r"(?:(?<=/)|-)[A-Za-z0-9_-]{8}(?=\.m?js$)")


def stable_location(location: str | None) -> str:
    if not location:
        return ""
    return _BUNDLE_HASH.sub("", _LINE_SUFFIX.sub("", location))


def fingerprint(source: str, kind: str, message: str, location: str | None) -> str:
    raw = "|".join((source, kind, normalize_message(message), stable_location(location)))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# 堆疊 frame 裡以 / 開頭的路徑＝同源（瀏覽器端送出前已把自己的 origin 拿掉，跨來源的腳本
# 仍是完整網址，不會誤判成自己的檔案）。後面可能跟 ?v=…，一律略過。
_JS_FRAME = re.compile(
    r"(?<![\w/.:\-])(?P<file>/[^\s()'\"<>?#:]*)(?:[?#][^\s()'\"<>]*?)?:(?P<line>\d+):(?P<col>\d+)(?=[\s)\]]|$)"
)


def js_location(stack: str | None) -> str | None:
    """堆疊第一個同源 frame 的「檔名:行:列」（去掉 origin 與 query）。"""
    if not stack:
        return None
    match = _JS_FRAME.search(stack)
    if match is None:
        return None
    return f"{match.group('file')}:{match.group('line')}:{match.group('col')}"[:LOCATION_LIMIT]


def python_location(exc: BaseException) -> str | None:
    """最後一個 app/ 底下 frame 的「module:function:lineno」；例外是從哪支程式丟出來的。"""
    found: str | None = None
    for frame, lineno in traceback.walk_tb(exc.__traceback__):
        module = str(frame.f_globals.get("__name__", ""))
        if module == "app" or module.startswith("app."):
            found = f"{module}:{frame.f_code.co_name}:{lineno}"
    return found[:LOCATION_LIMIT] if found else None


def exception_kind(exc: BaseException) -> str:
    cls = type(exc)
    return (cls.__qualname__ if cls.__module__ == "builtins" else f"{cls.__module__}.{cls.__qualname__}")[:KIND_LIMIT]


def release_id() -> str | None:
    sha = os.environ.get("RAILWAY_GIT_COMMIT_SHA", "").strip()
    return sha[:12] or None


# ----------------------------------------------------------------------------- 寫入

_last_purge: date | None = None


@dataclass(frozen=True)
class ErrorEntry:
    """已遮蔽、可以直接入庫的一筆錯誤。"""

    source: str
    kind: str
    message: str
    location: str | None
    path: str
    release: str | None
    stack: str | None
    user_agent: str | None

    @property
    def fingerprint(self) -> str:
        return fingerprint(self.source, self.kind, self.message, self.location)


def client_entry(
    *, source: str, kind: str, message: str, stack: str | None, path: str, release: str | None, user_agent: str | None
) -> ErrorEntry:
    """瀏覽器回報的錯誤：長度截到欄位上限、再遮蔽一次。位置先從還沒遮蔽的堆疊取（檔名可能是
    20 字以上的連續串，遮成 [token] 就失去分組的意義），取出後同樣去掉 query。"""
    return ErrorEntry(
        source=source,
        kind=redact_text(kind, tokens="off")[:KIND_LIMIT] or "Error",
        message=redact_text(message)[:MESSAGE_LIMIT],
        location=js_location(stack),
        path=redact_path(path)[:PATH_LIMIT] or "/",
        release=release[:RELEASE_LIMIT] if release else None,
        stack=redact_text(stack)[:STACK_LIMIT] if stack else None,
        user_agent=user_agent[:USER_AGENT_LIMIT] if user_agent else None,
    )


def server_entry(request: Request, exc: BaseException) -> ErrorEntry:
    route = request.scope.get("route")
    route_path = getattr(route, "path", None)
    # 路由樣板（/admin/visit-requests/{request_id}）是程式寫死的，不套遮蔽；沒比對到路由才退回
    # 實際路徑，那是訪客給的字串，要遮。
    path = route_path if isinstance(route_path, str) and route_path else redact_path(request.url.path)
    lines = "".join(traceback.format_exception(exc)).rstrip("\n").split("\n")[-SERVER_STACK_LINES:]
    stack = redact_traceback("\n".join(lines), exc)
    message = redact_text(redact_database_error_text(str(exc), exc), tokens="digits")
    return ErrorEntry(
        source="api",
        kind=exception_kind(exc),
        message=message[:MESSAGE_LIMIT],
        location=python_location(exc),
        path=path[:PATH_LIMIT],
        release=release_id(),
        stack=stack[-STACK_LIMIT:],
        user_agent=(request.headers.get("user-agent") or "")[:USER_AGENT_LIMIT] or None,
    )


@dataclass(frozen=True)
class UpsertOutcome:
    """upsert 的結果：哪一組，以及這次要不要發手機通知（第一次出現，或已處理後又發生）。"""

    group_id: int
    notify: bool


async def upsert(
    db: AsyncSession, entry: ErrorEntry, *, count: int = 1, now: datetime | None = None
) -> UpsertOutcome:
    """同一個 fingerprint 累加次數、更新最後發生時間與樣本，並把已處理的重新開啟。

    手機通知（notifications/error_alerts.py）的觸發條件在這裡判斷：新增的一列（RETURNING xmax = 0）
    或寫入前 resolved_at 不是空的（已處理後又發生）。寫入前的 resolved_at 另用一次查詢取得——
    ON CONFLICT DO UPDATE 的 RETURNING 只看得到更新後的值；兩次之間剛好被標為已處理的極小窗口
    只會少通知一次，不會多通知。"""
    now = now or now_utc()
    previous = (
        await db.execute(select(ErrorGroup.resolved_at).where(ErrorGroup.fingerprint == entry.fingerprint))
    ).first()
    stmt = insert(ErrorGroup).values(
        fingerprint=entry.fingerprint,
        source=entry.source,
        kind=entry.kind,
        message=entry.message,
        location=entry.location,
        path=entry.path,
        release=entry.release,
        sample_stack=entry.stack,
        sample_user_agent=entry.user_agent,
        count=count,
        first_seen_at=now,
        last_seen_at=now,
        resolved_at=None,
    )
    row = (
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=[ErrorGroup.fingerprint],
                set_={
                    "count": ErrorGroup.count + stmt.excluded.count,
                    "last_seen_at": stmt.excluded.last_seen_at,
                    "message": stmt.excluded.message,
                    "path": stmt.excluded.path,
                    "release": stmt.excluded.release,
                    "sample_stack": stmt.excluded.sample_stack,
                    "sample_user_agent": stmt.excluded.sample_user_agent,
                    "resolved_at": None,
                },
            ).returning(ErrorGroup.id, literal_column("(xmax = 0)").label("inserted"))
        )
    ).one()
    reopened = previous is not None and previous[0] is not None
    return UpsertOutcome(group_id=row.id, notify=bool(row.inserted) or reopened)


async def purge_old_once_a_day(db: AsyncSession, now: datetime | None = None) -> None:
    """每個程序每天最多清一次：最後發生超過 90 天的錯誤組刪掉（比照 traffic_service 的效能樣本）。"""
    global _last_purge
    now = now or now_utc()
    today = today_local(now)
    if _last_purge == today:
        return
    await db.execute(delete(ErrorGroup).where(ErrorGroup.last_seen_at < now - timedelta(days=RETENTION_DAYS)))
    _last_purge = today


async def record_client_error(db: AsyncSession, entry: ErrorEntry) -> UpsertOutcome:
    """寫入並 commit；回傳的 notify 為真時，呼叫端（POST /public/client-errors）排手機通知。"""
    outcome = await upsert(db, entry)
    await purge_old_once_a_day(db)
    await db.commit()
    return outcome


# ----------------------------------------------------------------------------- 伺服器端擷取


@dataclass
class _Throttle:
    last_write: float
    pending: int = 0


_throttle: dict[str, _Throttle] = {}
# 測試換成假時鐘。
_clock = time.monotonic


def reset_state() -> None:
    """測試用：清掉節流與每日清理的程序內狀態。"""
    global _last_purge
    _throttle.clear()
    _last_purge = None


def _prune_throttle(now: float) -> None:
    if len(_throttle) < _THROTTLE_MAX_TRACKED:
        return
    for key in [k for k, v in _throttle.items() if v.pending == 0 and now - v.last_write >= THROTTLE_SECONDS]:
        del _throttle[key]


async def record_server_error(request: Request, exc: BaseException) -> None:
    """API 未處理例外（main.py 的 SQLAlchemyError 與 Exception handler）。永遠不丟例外。

    用新的 session：請求那個可能已經壞掉（交易中止、連線斷了）。HTTPException 與 422 不走這兩個
    handler；客戶端中途斷線（ClientDisconnect）不是程式錯誤，不記。"""
    try:
        if isinstance(exc, ClientDisconnect):
            return
        entry = server_entry(request, exc)
        key = entry.fingerprint
        now = _clock()
        state = _throttle.get(key)
        if state is not None and now - state.last_write < THROTTLE_SECONDS:
            state.pending += 1
            return
        pending = (state.pending if state is not None else 0) + 1
        _prune_throttle(now)
        # 先登記再寫：寫入期間同一個例外又來了，會被上面的節流擋下、累加到下一次。
        state = _throttle[key] = _Throttle(last_write=now, pending=0)
        try:
            await asyncio.wait_for(_write_server_error(request, entry, pending), timeout=SERVER_WRITE_TIMEOUT_SECONDS)
        except BaseException:
            # 沒寫進去：次數留著，下次一起寫。
            state.pending += pending
            raise
    except Exception:  # noqa: BLE001 —— 錯誤回報壞了不能影響原本的 500 回應
        logger.warning("錯誤回報寫入失敗（略過）", exc_info=False)


async def _write_server_error(request: Request, entry: ErrorEntry, count: int) -> None:
    async with request.app.state.session_factory() as db:
        outcome = await upsert(db, entry, count=count)
        await purge_old_once_a_day(db)
        await db.commit()
    # 寫入已經完成；通知在背景排程，不等它（schedule 永遠不丟例外）。
    if outcome.notify:
        error_alerts.schedule(request.app, outcome.group_id)


# ----------------------------------------------------------------------------- 後台

OPEN_WINDOW = timedelta(hours=24)


async def open_counts(db: AsyncSession, now: datetime) -> tuple[int, int]:
    """(全部未處理的組數, 其中過去 24 小時內還有發生的組數)。"""
    row = (
        await db.execute(
            select(
                func.count(),
                func.count().filter(ErrorGroup.last_seen_at >= now - OPEN_WINDOW),
            ).where(ErrorGroup.resolved_at.is_(None))
        )
    ).one()
    return int(row[0]), int(row[1])


async def list_groups(db: AsyncSession, *, status: str, limit: int) -> list[ErrorGroup]:
    query = select(ErrorGroup).order_by(ErrorGroup.last_seen_at.desc(), ErrorGroup.id.desc()).limit(limit)
    if status == "open":
        query = query.where(ErrorGroup.resolved_at.is_(None))
    elif status == "resolved":
        query = query.where(ErrorGroup.resolved_at.is_not(None))
    return list((await db.execute(query)).scalars())


async def resolve(db: AsyncSession, group_id: int, now: datetime) -> ErrorGroup | None:
    """標為已處理；已經處理過的保留原本的處理時間。找不到回 None。"""
    group = await db.get(ErrorGroup, group_id)
    if group is None:
        return None
    if group.resolved_at is None:
        group.resolved_at = now
        await db.flush()
    return group


async def resolve_all(db: AsyncSession, now: datetime) -> int:
    result = await db.execute(update(ErrorGroup).where(ErrorGroup.resolved_at.is_(None)).values(resolved_at=now))
    return result.rowcount or 0
