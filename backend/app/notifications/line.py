"""LINE Messaging API：webhook 簽章驗證、推播、回覆與帳號資訊。

LINE Notify 已於 2025-03-31 停止服務，園方群組通知改由官方帳號（bot）加入
各校員工群組、以 push message 推送。推播會用掉官方帳號的每月訊息則數：推到群組
依群組人數計，回覆（reply）不計（2026-11-16 查證 developers.line.biz pricing）。

2026-11-16 起另有家長一對一通知、「我的預約」回覆、額度與好友數查詢
（docs/specs/2026-11-16-line-integrations-design.md）。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import date
from itertools import islice

import logging

import httpx

LINE_API_BASE = "https://api.line.me"


class _HideUserIdUrls(logging.Filter):
    """httpx 每個請求都在 INFO 記一行完整網址；查好友狀態的網址帶著家長的 LINE userId，不能進平台日誌
    （匿名化清不到日誌，2026-11-16 審查）。同 ad_conversions 的作法：丟掉那幾行。"""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args if isinstance(record.args, tuple) else ()
        return not any("/v2/bot/profile/" in str(arg) for arg in args)


_httpx_logger = logging.getLogger("httpx")
if not any(isinstance(f, _HideUserIdUrls) for f in _httpx_logger.filters):
    _httpx_logger.addFilter(_HideUserIdUrls())
# 群組 C＋32 位十六進位、多人聊天室 R＋32 位十六進位。
TARGET_ID_RE = re.compile(r"^[CR][0-9a-f]{32}$")
_MAX_TEXT = 5000
# 群組驗證碼：IVY- 加 8 個 Crockford base32 字元（去掉 I、L、O、U，手打不易混淆），
# 約 40 bits；10 分鐘過期、一次性，線上猜中的機會可以忽略。
_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_CODE_RE = re.compile(r"IVY-([0-9A-HJKMNP-TV-Z]{8})(?![0-9A-Z])", re.IGNORECASE)
# 一則訊息最多比對幾個像驗證碼的字串：不讓一則長訊息塞進大量猜測值。
_MAX_CODE_CANDIDATES = 3
# 家長綁定 LINE 通知的代碼（2026-11-16）：LN- 加 8 個字元，字母表同上。和群組驗證碼分開前綴，
# 群組裡貼的是 IVY-、家長一對一傳的是 LN-，兩邊不會互相誤認。
_PARENT_CODE_RE = re.compile(r"LN-([0-9A-HJKMNP-TV-Z]{8})(?![0-9A-Z])", re.IGNORECASE)
# 家長一對一的 userId：U＋32 位十六進位。
USER_ID_RE = re.compile(r"^U[0-9a-f]{32}$")
# Flex 的 altText 上限 1500 字（官方文件）；聊天列表與手機通知顯示的就是它。
MAX_ALT_TEXT = 1500


class LinePushError(Exception):
    """推播失敗。訊息只帶狀態碼，不帶回應內容（可能含群組資訊）。"""


def verify_signature(channel_secret: str, body: bytes, signature: str | None) -> bool:
    """X-Line-Signature＝base64(HMAC-SHA256(channel secret, 原始本文))。"""
    # base64 只會有 ASCII；header 經 latin-1 解碼可能帶 0x80 以上的字元，
    # compare_digest 比含非 ASCII 的 str 會丟 TypeError（變成 500），先擋掉、改比 bytes。
    if not signature or not signature.isascii():
        return False
    digest = hmac.new(channel_secret.encode("utf-8"), body, hashlib.sha256).digest()
    return hmac.compare_digest(base64.b64encode(digest), signature.encode("ascii"))


def new_verification_code() -> str:
    return "IVY-" + "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))


def verification_code_hash(secret: str, code: str) -> str:
    """資料庫只存 HMAC：拿到資料庫也無法離線反推還沒用掉的驗證碼。"""
    message = f"line-group-verify\0{code.upper()}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def new_parent_code() -> str:
    return "LN-" + "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))


def parent_code_hash(secret: str, code: str) -> str:
    message = f"line-parent-link\0{code.upper()}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def parent_code_candidates(text: str) -> list[str]:
    return [f"LN-{match.group(1).upper()}" for match in islice(_PARENT_CODE_RE.finditer(text), _MAX_CODE_CANDIDATES)]


def text_message(text: str) -> dict:
    return {"type": "text", "text": text[:_MAX_TEXT]}


def flex_message(alt_text: str, contents: dict) -> dict:
    return {"type": "flex", "altText": alt_text[:MAX_ALT_TEXT], "contents": contents}


@dataclass(frozen=True)
class Quota:
    """這個月的訊息額度。limit 為 None＝沒有上限（LINE 回 type none）。used 是 LINE 給的近似值。"""

    limit: int | None
    used: int


@dataclass(frozen=True)
class BotInfo:
    basic_id: str | None
    display_name: str | None


@dataclass(frozen=True)
class Followers:
    """某一天（UTC+9）的好友統計。status 不是 ready 時三個數字都是 None。
    followers 是累計加好友次數（封鎖不會減少），blocks 是目前封鎖的人數。"""

    status: str
    followers: int | None
    targeted_reaches: int | None
    blocks: int | None


class LineApiError(Exception):
    """查詢類 API（額度、帳號資訊、好友數）失敗。只帶狀態碼。"""

    def __init__(self, status_code: int | None) -> None:
        self.status_code = status_code
        super().__init__(f"LINE_HTTP_{status_code}" if status_code else "LINE_UNREACHABLE")


def verification_code_candidates(text: str) -> list[str]:
    """訊息裡像驗證碼的字串（不分大小寫，統一轉成大寫），最多 _MAX_CODE_CANDIDATES 個。"""
    return [f"IVY-{match.group(1).upper()}" for match in islice(_CODE_RE.finditer(text), _MAX_CODE_CANDIDATES)]


def retry_key(outbox_message_id: uuid.UUID, target_id: str) -> uuid.UUID:
    """同一則通知推到同一個群組永遠是同一把 X-Line-Retry-Key：推播送出後
    才逾時、沒記到 delivery 的情況下重試，LINE 端會認出是同一個請求，不會
    讓群組收到兩次。"""
    return uuid.uuid5(outbox_message_id, target_id)


class LineMessagingClient:
    def __init__(
        self,
        access_token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        base_url: str = LINE_API_BASE,
        timeout: float = 10.0,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url,
            transport=transport,
            timeout=httpx.Timeout(timeout),
            headers={"Authorization": f"Bearer {access_token}"},
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "LineMessagingClient":
        return self

    async def __aexit__(self, *exc_info) -> None:
        await self.aclose()

    async def push_text(self, to: str, text: str, *, key: uuid.UUID) -> None:
        await self.push(to, [text_message(text)], key=key)

    async def push(self, to: str, messages: list[dict], *, key: uuid.UUID) -> None:
        """推播（群組或一對一）。推給沒加好友或已封鎖的人 LINE 也回 200、只是收不到（不計則數）。"""
        response = await self._http.post(
            "/v2/bot/message/push",
            json={"to": to, "messages": messages},
            headers={"X-Line-Retry-Key": str(key)},
        )
        # 409＋x-line-accepted-request-id：同一把 retry key 先前已被接受，
        # 訊息已經送出，這次視為成功。
        if response.status_code == 409 and response.headers.get("x-line-accepted-request-id"):
            return
        if response.status_code >= 400:
            raise LinePushError(f"LINE_HTTP_{response.status_code}")

    async def reply(self, reply_token: str, messages: list[dict]) -> None:
        """回覆使用者剛傳來的訊息（不計每月則數）。reply token 只能用一次、要在收到後很快用掉。"""
        response = await self._http.post(
            "/v2/bot/message/reply", json={"replyToken": reply_token, "messages": messages}
        )
        if response.status_code >= 400:
            raise LinePushError(f"LINE_HTTP_{response.status_code}")

    async def _get_json(self, path: str, params: dict | None = None) -> dict:
        try:
            response = await self._http.get(path, params=params)
        except httpx.HTTPError as exc:
            raise LineApiError(None) from exc
        if response.status_code != 200:
            raise LineApiError(response.status_code)
        data = response.json()
        if not isinstance(data, dict):
            raise LineApiError(response.status_code)
        return data

    async def quota(self) -> Quota:
        """這個月的額度（含官方帳號後台群發用掉的）。兩支 API 都要成功才回。"""
        target = await self._get_json("/v2/bot/message/quota")
        usage = await self._get_json("/v2/bot/message/quota/consumption")
        value = target.get("value")
        limit = value if target.get("type") == "limited" and isinstance(value, int) else None
        used = usage.get("totalUsage")
        return Quota(limit=limit, used=used if isinstance(used, int) else 0)

    async def bot_info(self) -> BotInfo:
        data = await self._get_json("/v2/bot/info")
        basic_id = data.get("basicId")
        name = data.get("displayName")
        return BotInfo(
            basic_id=basic_id if isinstance(basic_id, str) and basic_id else None,
            display_name=name[:100] if isinstance(name, str) and name else None,
        )

    async def followers(self, day: date) -> Followers:
        """day 是 UTC+9 的日期；當天的數字隔天才算好（status unready）。"""
        data = await self._get_json("/v2/bot/insight/followers", {"date": day.strftime("%Y%m%d")})

        def number(key: str) -> int | None:
            value = data.get(key)
            return value if isinstance(value, int) else None

        status = data.get("status")
        return Followers(
            status=status if isinstance(status, str) else "unready",
            followers=number("followers"),
            targeted_reaches=number("targetedReaches"),
            blocks=number("blocks"),
        )

    async def is_friend(self, user_id: str) -> bool | None:
        """這個人目前是不是好友：profile 200＝是、404＝沒加或已封鎖；其他狀況回 None（不知道）。"""
        try:
            response = await self._http.get(f"/v2/bot/profile/{user_id}")
        except httpx.HTTPError:
            return None
        if response.status_code == 200:
            return True
        if response.status_code == 404:
            return False
        return None

    async def group_name(self, group_id: str) -> str | None:
        """群組名稱只是讓後台認得是哪個群組，拿不到不影響功能。"""
        try:
            response = await self._http.get(f"/v2/bot/group/{group_id}/summary")
        except httpx.HTTPError:
            return None
        if response.status_code != 200:
            return None
        name = response.json().get("groupName")
        return name[:255] if isinstance(name, str) and name else None
