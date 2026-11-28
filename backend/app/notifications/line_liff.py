"""LIFF：家長在 LINE App 裡開預約頁送單時，驗證帶來的 ID token，取得 LINE userId
（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §7）。

用 LINE 的 verify 端點驗（簽章、發行者、到期都由 LINE 檢查），再自己核對 aud 與 exp。
驗不過、逾時、沒設 LIFF 都回 None：只是不綁 LINE，預約照常成立。token 與 userId 不寫 log。"""

from __future__ import annotations

import logging
import time

import httpx

from app.config import Settings
from app.notifications.line import USER_ID_RE

logger = logging.getLogger("app.line")

VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify"
VERIFY_TIMEOUT_SECONDS = 5.0
# ID token 是 JWT，通常 1–2 KB；超過這個長度的直接不驗。
MAX_TOKEN_LENGTH = 4096


async def verify_id_token(
    settings: Settings, token: str | None, transport: httpx.AsyncBaseTransport | None = None
) -> str | None:
    """LIFF 的 ID token → LINE userId；任何不對勁都回 None。"""
    client_id = settings.line_liff_client_id
    if not client_id or not token or len(token) > MAX_TOKEN_LENGTH:
        return None
    try:
        async with httpx.AsyncClient(transport=transport, timeout=httpx.Timeout(VERIFY_TIMEOUT_SECONDS)) as http:
            response = await http.post(VERIFY_URL, data={"id_token": token, "client_id": client_id})
    except httpx.HTTPError as exc:
        logger.warning("LIFF ID token 驗證連不上 LINE：%s", type(exc).__name__)
        return None
    if response.status_code != 200:
        # 過期、不是這個 channel 發的、亂填的：家長端常見，不是系統問題。
        logger.info("LIFF ID token 驗證沒過：status=%s", response.status_code)
        return None
    try:
        data = response.json()
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    sub, aud, exp = data.get("sub"), data.get("aud"), data.get("exp")
    if aud != client_id or not isinstance(exp, int) or exp <= time.time():
        return None
    return sub if isinstance(sub, str) and USER_ID_RE.match(sub) else None
