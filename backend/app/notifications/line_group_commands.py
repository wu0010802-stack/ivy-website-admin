"""員工 LINE 群組的文字指令（設計 §4.2、§4.6、§4.7）：「今天／明天／本週參觀」、@官方帳號叫出選單、
新成員加入時回覆說明。

只處理已綁定校區（或總部）的群組或多人聊天室；回覆一律用 reply（不計每月則數）。查名單是唯讀的，
2026-09-29 以前綁定、沒貼過驗證碼的舊群組照常可用（會寫入的按鈕才要驗證過，見 line_group_actions）。
不存、不記錄任何訊息文字或 userId。"""

from __future__ import annotations

import logging
from datetime import date, timedelta

import httpx
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.common import ratelimit
from app.common.timezones import today_local
from app.notifications import line as line_api
from app.notifications import line_digest, line_flex
from app.notifications.line_group_settings import campuses_served

logger = logging.getLogger("app.line")

QUERY_LIMIT = ratelimit.Limit("line_group_query", window_seconds=60, max_per_window=6)
HELP_LIMIT = ratelimit.Limit("line_group_help", window_seconds=600, max_per_window=1)

_COMMANDS = {"今天參觀": "today", "明天參觀": "tomorrow", "本週參觀": "week"}
_SHORT_WORDS = {"今天": "today", "明天": "tomorrow", "本週": "week"}
_WEEKDAYS = "一二三四五六日"
EMPTY_TEXT = "這段時間沒有參觀預約。"


def _md(day: date) -> str:
    return f"{day.month}/{day.day}"


def _day_label(day: date) -> str:
    return f"{_md(day)} 週{_WEEKDAYS[day.weekday()]}"


def _mentionees(event: dict) -> list:
    message = event.get("message")
    mention = message.get("mention") if isinstance(message, dict) else None
    mentionees = mention.get("mentionees") if isinstance(mention, dict) else None
    return mentionees if isinstance(mentionees, list) else []


def _mentions_self(event: dict) -> bool:
    return any(isinstance(m, dict) and m.get("isSelf") is True for m in _mentionees(event))


def _without_self_mentions(text: str, mentionees: list) -> str | None:
    """把訊息裡 @官方帳號 的那幾段（mentionees 裡 isSelf 的 index／length）切掉，回傳剩下的字。
    LINE 的 index 與 length 以 UTF-16 code unit 計（emoji 等 BMP 以外的字算 2），所以在 UTF-16 編碼上切。
    任何一段的 index／length 不能用（缺、不是整數、超出訊息、彼此重疊、切在 emoji 中間）就回 None，
    由呼叫端退回舊的「剝掉開頭 @… 到第一個空白」規則。"""
    try:
        encoded = text.encode("utf-16-le")
    except UnicodeEncodeError:  # JSON 裡落單的 \ud800 之類
        return None
    units = len(encoded) // 2
    spans: list[tuple[int, int]] = []
    for mentionee in mentionees:
        if not (isinstance(mentionee, dict) and mentionee.get("isSelf") is True):
            continue
        index, length = mentionee.get("index"), mentionee.get("length")
        if type(index) is not int or type(length) is not int or index < 0 or length <= 0 or index + length > units:
            return None
        spans.append((index, index + length))
    if not spans:
        return None
    spans.sort()
    if any(start < previous_end for (_, previous_end), (start, _) in zip(spans, spans[1:])):
        return None
    kept, cursor = [], 0
    for start, end in spans:
        kept.append(encoded[cursor * 2:start * 2])
        cursor = end
    kept.append(encoded[cursor * 2:])
    try:
        return "".join(part.decode("utf-16-le") for part in kept)
    except UnicodeDecodeError:
        return None


def _command(event: dict, text: str) -> tuple[str | None, bool]:
    """回傳 (查詢種類或 None, 是不是只有 @ 官方帳號沒有其他字)。@官方帳號 可以在訊息任何位置
    （「@常春藤 今天」「今天 @常春藤」），名稱含空白也行；其他人的 @ 不剝。"""
    mentioned = _mentions_self(event)
    if mentioned:
        stripped = _without_self_mentions(text, _mentionees(event))
        if stripped is not None:
            text = stripped
        else:
            text = text.strip()
            if text.startswith("@"):
                _, _, text = text.partition(" ")
    text = text.strip()
    if mentioned and not text:
        return None, True
    if text in _COMMANDS:
        return _COMMANDS[text], False
    if mentioned and text in _SHORT_WORDS:
        return _SHORT_WORDS[text], False
    return None, False


async def _visit_reply(db: AsyncSession, campuses: list[str], kind: str) -> dict:
    today = today_local()
    if kind == "today":
        start = end = today
        title = f"今日參觀（{_day_label(today)}）"
    elif kind == "tomorrow":
        start = end = today + timedelta(days=1)
        title = f"明日參觀（{_day_label(start)}）"
    else:
        start, end = today, today + timedelta(days=6 - today.weekday())
        title = f"本週參觀（{_md(start)}–{_md(end)}）"
    rows = await line_digest.rows_between(db, campuses, start, end)
    return line_flex.visit_list_message(title, rows, empty_text=EMPTY_TEXT)


async def handle(request: Request, db: AsyncSession, events: list[dict]) -> None:
    # line_routes 會 import 本模組，helper 在函式內才取，避免循環 import。
    from app.notifications.line_routes import _client, _event_text, _reply_token, _target

    replies: list[tuple[str, dict]] = []
    for event in events:
        kind = event.get("type")
        if kind not in ("message", "memberJoined", "join"):
            continue
        found = _target(event)  # 群組或多人聊天室（兩者都能被選為推播目標）；一對一回 None
        if found is None:
            continue
        target_id = found[1]
        token = _reply_token(event)
        if token is None:
            continue
        campuses = await campuses_served(db, target_id)
        if campuses is None:
            continue
        if kind in ("memberJoined", "join"):
            if await _allowed(request, HELP_LIMIT, target_id):
                replies.append((token, line_flex.help_message()))
            continue
        text = _event_text(event)
        if text is None:
            continue
        query, menu = _command(event, text)
        if query is None and not menu:
            continue
        if not await _allowed(request, QUERY_LIMIT, target_id):
            continue
        replies.append((token, line_flex.menu_message() if menu else await _visit_reply(db, campuses, query)))
    if not replies:
        return
    async with _client(request) as client:
        for token, message in replies:
            try:
                await client.reply(token, [message])
            except (line_api.LinePushError, httpx.HTTPError) as exc:
                logger.warning("LINE 群組回覆失敗：error=%s", exc)


async def _allowed(request: Request, limit: ratelimit.Limit, target_id: str) -> bool:
    try:
        await ratelimit.limiter(request).check(limit, target_id)
    except ratelimit.RateLimited:
        return False
    return True
