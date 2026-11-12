"""粉專貼文轉成 campus_news 消息的欄位對照（docs/specs/2026-10-28-facebook-news-sync-design.md §5）。
Instagram 貼文共用同一套對照，只有原文連結的字不同。"""

from __future__ import annotations

import re

from app.common.timezones import OPERATING_TZ
from app.content.schemas import NEWS_BODY_MAX_BLOCKS
from app.facebook.models import FacebookPagePost

TITLE_MAX = 40
DESCRIPTION_MAX = 120
PARAGRAPH_MAX = 2000
FALLBACK_TITLE = "粉專貼文"
# 原文連結的字：Instagram 來的貼文寫「在 Instagram 看原文」。
LINK_LABELS = {"facebook": "在 Facebook 看原文", "instagram": "在 Instagram 看原文"}
# 內文留一格給最後的原文連結（有影片時開頭再留一格，見 build_article）。
_MAX_PARAGRAPHS = NEWS_BODY_MAX_BLOCKS - 1

_HASH_SIGNS = "#＃"
_NO_HASH = {ord(sign): None for sign in _HASH_SIGNS}
# emoji 與組字用的控制字元（膚色、變體選擇器、ZWJ、鍵帽、旗幟標籤）。Python re 沒有
# \p{Extended_Pictographic}，用涵蓋實際粉專貼文的區段。
_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF⌀-⏿☀-➿⬀-⯿"
    "︀-️‍⃣\U000E0020-\U000E007F〰〽㊗㊙]"
)
_SPACES = re.compile(r"[ \t　]+")
_WRAPPED = re.compile(r"^【([^【】]+)】$")


def article_id(post_id: str) -> str:
    return "fb-" + re.sub(r"[^A-Za-z0-9-]", "-", post_id)[:61]


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _strip_hashtags(line: str) -> str:
    """粉專貼文結尾常有一整段 hashtag（每行幾個，夾著 emoji）：整行或行尾的那串拿掉；
    句子中間的 hashtag（「邀請 #公視台語台《#穎仔穎仔育》團隊」）只去掉 # 留字，免得句子斷掉。"""
    tokens = line.split()

    def is_tag(token: str) -> bool:
        return token[0] in _HASH_SIGNS

    end = len(tokens)
    while end and (is_tag(tokens[end - 1]) or not _EMOJI.sub("", tokens[end - 1])):
        end -= 1
    if any(is_tag(token) for token in tokens[end:]):
        tokens = tokens[:end]
    return " ".join(token.translate(_NO_HASH) for token in tokens)


def _title_text(line: str) -> str:
    """標題不放 emoji；整行被【】包起來（粉專慣用的標題寫法）就拿掉外層括號。"""
    text = _SPACES.sub(" ", _EMOJI.sub("", line)).strip()
    wrapped = _WRAPPED.match(text)
    return wrapped.group(1).strip() if wrapped else text


def _split(message: str | None) -> tuple[str, str, list[str]]:
    """回 (標題, 標題那一行, 其餘段落)。段落以空行分隔，段內換行保留成空白；
    只有 emoji 或 hashtag 的行不當標題。"""
    lines = [
        _strip_hashtags(line)
        for line in (message or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    ]
    title, title_line = "", ""
    rest_start = len(lines)
    for index, line in enumerate(lines):
        if text := _title_text(line):
            title, title_line, rest_start = text, line, index + 1
            break
    paragraphs: list[str] = []
    current: list[str] = []
    for line in [*lines[rest_start:], ""]:
        if line:
            current.append(line)
        elif current:
            paragraphs.append(" ".join(current))
            current = []
    return title, title_line, paragraphs


def build_article(post: FacebookPagePost, media_id: str, video_id: str | None = None) -> dict:
    """media_id 是封面照片；video_id 有給（影片貼文）就在內文最前面放一個影片區塊。"""
    title_text, title_line, paragraphs = _split(post.message)
    title = _clip(title_text, TITLE_MAX) if title_text else FALLBACK_TITLE
    # 標題被截斷時，完整的那一行放回內文開頭，不丟字。
    if title_text and title != title_text:
        paragraphs = [title_line, *paragraphs]
    body: list[dict] = [{"type": "video", "video": video_id, "caption": ""}] if video_id else []
    body += [
        {"type": "paragraph", "text": _clip(text, PARAGRAPH_MAX)}
        for text in paragraphs[: _MAX_PARAGRAPHS - len(body)]
    ]
    if post.permalink_url:
        body.append({"type": "link", "label": LINK_LABELS.get(post.source, LINK_LABELS["facebook"]), "url": post.permalink_url})
    return {
        "id": article_id(post.post_id),
        "date": post.posted_at.astimezone(OPERATING_TZ).date().isoformat(),
        "category": "",
        "title": title,
        "description": _clip(" ".join(paragraphs), DESCRIPTION_MAX),
        "image": media_id,
        "alt": "",
        "body": body,
        "show_from": None,
        "show_until": None,
    }
