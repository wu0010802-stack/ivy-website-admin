"""員工 LINE 群組的文字指令（設計 §4.2、§4.6、§4.7）：「今天／明天／本週參觀」、@官方帳號叫出選單、
新成員加入時回覆說明。2026-11-25 加「下週參觀」「11/28 參觀」與「待標記」
（docs/specs/2026-11-25-line-more-features-design.md §2、§3），同日再以總部群組為基準擴充
（docs/specs/2026-11-25-line-group-commands-design.md）：手打 @ 與同義字、指令前加校名、待追蹤、名額、
休假日、待辦，以及只給總部群組的統計與額度。報表的查詢在 line_group_reports。

只處理已綁定校區（或總部）的群組或多人聊天室；回覆一律用 reply（不計每月則數）。查名單是唯讀的，
2026-09-29 以前綁定、沒貼過驗證碼的舊群組照常可用（會寫入的按鈕才要驗證過，見 line_group_actions）。
不存、不記錄任何訊息文字或 userId。"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, replace
from datetime import date, timedelta

import httpx
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.common import ratelimit
from app.common.timezones import today_local
from app.notifications import line as line_api
from app.notifications import line_digest, line_flex, line_reports
from app.notifications import line_group_reports as reports
from app.notifications.line_group_settings import campuses_served, is_hq_group

logger = logging.getLogger("app.line")

QUERY_LIMIT = ratelimit.Limit("line_group_query", window_seconds=60, max_per_window=6)
HELP_LIMIT = ratelimit.Limit("line_group_help", window_seconds=600, max_per_window=1)


@dataclass(frozen=True)
class Command:
    """認出來的一則指令。kind：visits／awaiting／follow_up／seats／closures／todo／stats／quota／help／menu。
    arg：visits、seats 是 today／tomorrow／week／next_week／next7 或指定的日期；stats 是 line_group_reports.STATS_PERIODS。
    campus：指令前面指定的校區（key）。"""

    kind: str
    arg: str | date | None = None
    campus: str | None = None


def _spread(mapping: dict[tuple[str, ...], Command]) -> dict[str, Command]:
    return {word: command for words, command in mapping.items() for word in words}


# 整則訊息完全相符才算（前後空白、全形半形不計）。
_FULL = _spread({
    ("今天參觀", "今日參觀", "當日參觀"): Command("visits", "today"),
    ("明天參觀", "明日參觀"): Command("visits", "tomorrow"),
    ("本週參觀", "這週參觀", "本周參觀", "這周參觀"): Command("visits", "week"),
    ("下週參觀", "下周參觀"): Command("visits", "next_week"),
    ("待標記", "未標記"): Command("awaiting"),
    ("待追蹤",): Command("follow_up"),
    ("今天名額", "今日名額"): Command("seats", "today"),
    ("明天名額", "明日名額"): Command("seats", "tomorrow"),
    ("本週名額", "這週名額", "本周名額", "這周名額"): Command("seats", "week"),
    ("下週名額", "下周名額"): Command("seats", "next_week"),
    ("休假日", "停課日"): Command("closures"),
    ("待辦",): Command("todo"),
    ("本週統計", "這週統計", "本周統計", "這周統計"): Command("stats", "week"),
    ("上週統計", "上周統計"): Command("stats", "last_week"),
    ("本月統計", "這個月統計"): Command("stats", "month"),
    ("上月統計", "上個月統計"): Command("stats", "last_month"),
    ("額度",): Command("quota"),
    # 2026-11-26：週報、月報（總部群組）、官網電話與 LINE 按鈕的點擊。
    ("週報", "周報"): Command("weekly_report"),
    ("月報",): Command("monthly_report"),
    ("今天聯絡", "今日聯絡", "昨天聯絡", "昨日聯絡"): Command("contact"),
    ("指令", "指令說明"): Command("help"),
})
# 短字：只有標記官方帳號（或手打 @）時才認，避免日常閒聊誤觸。
_SHORT = _spread({
    ("今天", "今日", "當日"): Command("visits", "today"),
    ("明天", "明日"): Command("visits", "tomorrow"),
    ("本週", "這週", "本周", "這周"): Command("visits", "week"),
    ("下週", "下周"): Command("visits", "next_week"),
    ("名額",): Command("seats", "next7"),
    ("休假", "停課"): Command("closures"),
    ("統計",): Command("stats", "week"),
    ("聯絡",): Command("contact"),
    ("說明", "幫助", "help"): Command("help"),
})
# 可以在前面加校名的指令；額度、說明、選單與校區無關。
_CAMPUS_KINDS = frozenset({"visits", "awaiting", "follow_up", "seats", "closures", "todo", "stats", "contact"})
# 訊息裡有這些字才值得查校名再試「校名＋指令」（一般閒聊不必多一次查詢）。
_CAMPUS_HINTS = ("參觀", "名額", "統計", "待標記", "未標記", "待追蹤", "休假日", "停課日", "待辦", "聯絡")
# 只給總部群組（後台這兩組數字限總管理者）。
HQ_ONLY_KINDS = frozenset({"stats", "quota", "weekly_report", "monthly_report"})
# 「11/28 參觀」「11/28 名額」；@官方帳號 時「11/28」也算（查參觀）。先 NFKC，所以只比對半形。
_DAY_COMMAND = re.compile(r"([0-9]{1,2})/([0-9]{1,2})\s*(參觀|名額)")
_DAY_SHORT = re.compile(r"([0-9]{1,2})/([0-9]{1,2})")
# 「月/日」取前後這麼多天內的那一天。
_PAST_DAY_WINDOW = timedelta(days=183)
_WEEKDAYS = "一二三四五六日"
EMPTY_TEXT = "這段時間沒有參觀預約。"
AWAITING_EMPTY_TEXT = "目前沒有待標記到場的參觀。"
PAST_DAY_TEXT = "已經過去的日期請到後台查看；還沒標記到場的請輸入「待標記」。"
PAST_SEATS_TEXT = "已經過去的日期請到後台查看。"
FOLLOW_UP_EMPTY_TEXT = "目前沒有到期的待追蹤。"
ADMISSIONS_OFF_TEXT = "招生入學功能沒有開啟，沒有待追蹤名單。"
HQ_ONLY_TEXT = "這個指令只有總部群組可以用。"
NOT_SERVED_TEXT = "這個群組查不到{name}。"


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


def _day_of(month: int, day: int, today: date) -> date | None:
    """「月/日」換成離今天最近的那一天（前後各約半年內：12 月查「1/5」是明年、1 月查「12/30」是去年）；
    不存在的日期（2/30）回 None。"""
    for year in (today.year - 1, today.year, today.year + 1):
        try:
            found = date(year, month, day)
        except ValueError:
            continue
        if today - _PAST_DAY_WINDOW <= found < today + _PAST_DAY_WINDOW:
            return found
    return None


def _addressed(event: dict, text: str) -> tuple[str, bool, bool]:
    """回傳 (剝掉 @ 之後的字, 有沒有在叫官方帳號, 是不是手打的 @)。
    真的標記：依 mention 的位置切掉（可以在訊息任何位置，名稱含空白也行；其他人的 @ 不剝）。
    手打的 @（「@待標記」，沒有 mention 資料）：拿掉開頭那個 @，當成有叫官方帳號。全形先轉半形（NFKC）。"""
    mentioned = _mentions_self(event)
    if mentioned:
        stripped = _without_self_mentions(text, _mentionees(event))
        if stripped is not None:
            text = stripped
        else:
            text = text.strip()
            if text.startswith("@"):
                _, _, text = text.partition(" ")
    text = unicodedata.normalize("NFKC", text).strip()
    # 訊息裡有真的標記（標記別的成員）就不算手打：「@小明 今天」不是在叫官方帳號。
    typed = not mentioned and not _mentionees(event) and text.startswith("@")
    if typed:
        text = text[1:].strip()
    return text, mentioned or typed, typed


def _match(text: str, addressed: bool, today: date) -> Command | None:
    if text in _FULL:
        return _FULL[text]
    if addressed and text.lower() in _SHORT:
        return _SHORT[text.lower()]
    match = _DAY_COMMAND.fullmatch(text)
    if match is not None:
        day = _day_of(int(match.group(1)), int(match.group(2)), today)
        return Command("visits" if match.group(3) == "參觀" else "seats", day) if day is not None else None
    match = _DAY_SHORT.fullmatch(text) if addressed else None
    if match is not None:
        day = _day_of(int(match.group(1)), int(match.group(2)), today)
        return Command("visits", day) if day is not None else None
    return None


def _campus_prefix(text: str, names: dict[str, str]) -> tuple[str, str] | None:
    """開頭是校名（有沒有「校」字都認）而且後面還有字：回 (校區 key, 後面的字)。"""
    for key, name in sorted(names.items(), key=lambda item: -len(item[1])):
        for prefix in (name, name.removesuffix("校")):
            if prefix and text.startswith(prefix):
                rest = text[len(prefix):].strip()
                if rest:
                    return key, rest
    return None


def parse(
    text: str, addressed: bool, typed: bool, names: dict[str, str] | None, today: date | None = None
) -> Command | None:
    """text 是 _addressed 剝過的字。names（校區 key → 名稱）有給才試「校名＋指令」。"""
    current = today or today_local()
    if addressed and not text:
        return Command("menu")
    candidates = [(text, addressed)]
    pieces = text.split(None, 1)
    if typed and len(pieces) == 2:
        # 手打「@常春藤 待標記」：沒有 mention 資料，再試第一個空白後面的字；前面那段可能是任何人的名字，
        # 所以這裡只認完整指令、不認短字（「@小明 今天」不算）。
        candidates.append((pieces[1].strip(), False))
    for candidate, short_ok in candidates:
        found = _match(candidate, short_ok, current)
        if found is not None:
            return found
        split = _campus_prefix(candidate, names) if names else None
        if split is not None:
            found = _match(split[1], short_ok, current)
            if found is not None and found.kind in _CAMPUS_KINDS:
                return replace(found, campus=split[0])
    return None


def _range(arg: str, today: date) -> tuple[date, date, str, str]:
    """today／tomorrow／week／next_week／next7 → (開始, 結束, 稱呼, 括號裡的日期)。"""
    if arg == "today":
        return today, today, "今日", _day_label(today)
    if arg == "tomorrow":
        day = today + timedelta(days=1)
        return day, day, "明日", _day_label(day)
    if arg == "next_week":
        start = today + timedelta(days=7 - today.weekday())
        end = start + timedelta(days=6)
        return start, end, "下週", f"{_md(start)}–{_md(end)}"
    if arg == "next7":
        end = today + timedelta(days=6)
        return today, end, "近 7 天", f"{_md(today)}–{_md(end)}"
    end = today + timedelta(days=6 - today.weekday())
    return today, end, "本週", f"{_md(today)}–{_md(end)}"


async def _visit_reply(db: AsyncSession, campuses: list[str], kind: str | date) -> dict:
    today = today_local()
    if kind == "awaiting":
        rows = await line_digest.rows_awaiting_attendance(db, campuses)
        return line_flex.visit_list_message("待標記到場", rows, empty_text=AWAITING_EMPTY_TEXT)
    if isinstance(kind, date):
        if kind < today:
            # 名單只列已確認的：過去的日子列出來，標記過的都不在，會誤以為沒人來。
            return line_api.text_message(PAST_DAY_TEXT)
        start = end = kind
        title = f"{_day_label(kind)}參觀"
    else:
        start, end, word, when = _range(kind, today)
        title = f"{word}參觀（{when}）"
    rows = await line_digest.rows_between(db, campuses, start, end)
    return line_flex.visit_list_message(title, rows, empty_text=EMPTY_TEXT)


async def _follow_up_reply(request: Request, db: AsyncSession, campuses: list[str], names: dict[str, str]) -> dict:
    from app.notifications.service import admin_visit_url

    settings = request.app.state.settings
    if not settings.admissions_enabled:
        return line_api.text_message(ADMISSIONS_OFF_TEXT)
    rows = await reports.follow_up_rows(db, campuses, names)
    if not rows:
        return line_api.text_message(FOLLOW_UP_EMPTY_TEXT)
    urls: dict[str, str] = {}
    for row in rows:
        url = admin_visit_url(settings.admin_origin, row.receipt_id, external_browser=True)
        if url:
            urls[row.visit_id] = url
    return line_flex.follow_up_list_message(rows, admin_urls=urls)


async def _seats_reply(db: AsyncSession, campuses: list[str], names: dict[str, str], arg: str | date) -> dict:
    today = today_local()
    if isinstance(arg, date):
        if arg < today:
            return line_api.text_message(PAST_SEATS_TEXT)
        start, end, title = arg, arg, f"{_day_label(arg)}名額"
    else:
        start, end, word, when = _range(arg, today)
        title = f"{word}名額（{when}）"
    return line_api.text_message(await reports.seats_text(db, campuses, names, start, end, title))


async def _respond(request: Request, db: AsyncSession, target_id: str, served: list[str], command: Command) -> dict:
    """served：這個群組能查的校區。總部專用的指令在其他群組一律回同一句，不透露任何數字。"""
    settings = request.app.state.settings
    kind = command.kind
    if kind in ("menu", "help") or kind in HQ_ONLY_KINDS:
        is_hq = await is_hq_group(db, target_id)
        if kind == "menu":
            return line_flex.menu_message(is_hq=is_hq)
        if kind == "help":
            return line_flex.help_message(is_hq=is_hq)
        if not is_hq:
            return line_api.text_message(HQ_ONLY_TEXT)
    if kind == "quota":
        return line_api.text_message(await reports.quota_text(settings, getattr(request.app.state, "line_transport", None)))
    if kind in ("weekly_report", "monthly_report"):
        return await line_reports.build(db, kind)
    names = await reports.campus_names(db)
    campuses = reports.ordered(served)
    if command.campus is not None:
        if command.campus not in served:
            return line_api.text_message(NOT_SERVED_TEXT.format(name=names.get(command.campus, command.campus)))
        campuses = [command.campus]
    if kind == "visits":
        return await _visit_reply(db, campuses, command.arg)
    if kind == "awaiting":
        return await _visit_reply(db, campuses, "awaiting")
    if kind == "follow_up":
        return await _follow_up_reply(request, db, campuses, names)
    if kind == "seats":
        return await _seats_reply(db, campuses, names, command.arg)
    if kind == "closures":
        return line_api.text_message(await reports.closures_text(db, campuses, names))
    if kind == "contact":
        # 沒帶校區的點擊只有總部群組、而且沒指定校名時才列。
        unassigned = command.campus is None and await is_hq_group(db, target_id)
        return line_api.text_message(await reports.contact_text(db, campuses, names, with_unassigned=unassigned))
    if kind == "todo":
        return line_api.text_message(
            await reports.todo_text(db, campuses, names, admissions_enabled=settings.admissions_enabled)
        )
    return line_api.text_message(await reports.stats_text(db, campuses, names, str(command.arg)))


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
                replies.append((token, line_flex.help_message(is_hq=await is_hq_group(db, target_id))))
            continue
        raw = _event_text(event)
        if raw is None:
            continue
        text, addressed, typed = _addressed(event, raw)
        command = parse(text, addressed, typed, None)
        if command is None and text and (addressed or any(word in text for word in _CAMPUS_HINTS)):
            # 沒對上但看起來像指令：查校名再試一次「校名＋指令」。一般閒聊不查。
            command = parse(text, addressed, typed, await reports.campus_names(db))
        if command is None:
            continue
        if not await _allowed(request, QUERY_LIMIT, target_id):
            continue
        replies.append((token, await _respond(request, db, target_id, campuses, command)))
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
