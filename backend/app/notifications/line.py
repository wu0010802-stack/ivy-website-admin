"""LINE Messaging API：webhook 簽章驗證與群組推播。

LINE Notify 已於 2025-03-31 停止服務，園方群組通知改由官方帳號（bot）加入
各校員工群組、以 push message 推送。推播會用掉官方帳號的每月訊息則數。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import uuid
from itertools import islice

import httpx

LINE_API_BASE = "https://api.line.me"
# 群組 C＋32 位十六進位、多人聊天室 R＋32 位十六進位。
TARGET_ID_RE = re.compile(r"^[CR][0-9a-f]{32}$")
_MAX_TEXT = 5000
# 群組驗證碼：IVY- 加 8 個 Crockford base32 字元（去掉 I、L、O、U，手打不易混淆），
# 約 40 bits；10 分鐘過期、一次性，線上猜中的機會可以忽略。
_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_CODE_RE = re.compile(r"IVY-([0-9A-HJKMNP-TV-Z]{8})(?![0-9A-Z])", re.IGNORECASE)
# 一則訊息最多比對幾個像驗證碼的字串：不讓一則長訊息塞進大量猜測值。
_MAX_CODE_CANDIDATES = 3


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
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url,
            transport=transport,
            timeout=httpx.Timeout(10.0),
            headers={"Authorization": f"Bearer {access_token}"},
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "LineMessagingClient":
        return self

    async def __aexit__(self, *exc_info) -> None:
        await self.aclose()

    async def push_text(self, to: str, text: str, *, key: uuid.UUID) -> None:
        response = await self._http.post(
            "/v2/bot/message/push",
            json={"to": to, "messages": [{"type": "text", "text": text[:_MAX_TEXT]}]},
            headers={"X-Line-Retry-Key": str(key)},
        )
        # 409＋x-line-accepted-request-id：同一把 retry key 先前已被接受，
        # 訊息已經送出，這次視為成功。
        if response.status_code == 409 and response.headers.get("x-line-accepted-request-id"):
            return
        if response.status_code >= 400:
            raise LinePushError(f"LINE_HTTP_{response.status_code}")

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
