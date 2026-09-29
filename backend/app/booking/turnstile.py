"""公開預約的機器人驗證（Cloudflare Turnstile，使用者 2026-09-29 裁定）。

部署同時設定 WEBSITE_TURNSTILE_SITE_KEY 與 WEBSITE_TURNSTILE_SECRET_KEY 才啟用；
沒設定時送單不要求 token，其他防線（限流、占位與每校上限）照常。

驗證服務本身失效時放行並記 warning：Cloudflare 故障時讓家長照常預約，比整站
無法送單重要；限流與上限仍會擋大量灌單。「失效」只限連線錯誤、逾時、5xx，以及
回應的 error-codes 含 internal-error（Cloudflare 自己叫呼叫端重試的情況）。其他
情況（4xx、回應不是 JSON 物件、success 不是 true）一律當驗證失敗（稽核
turnstile-fail-open-on-4xx：原本任何非 2xx 或解析失敗都放行）。

secret 設錯（error-codes 含 missing-input-secret／invalid-input-secret，Cloudflare
回 400）是部署問題而不是訪客的問題：放行（不讓整站停收），但記 error，
部署後的驗證步驟要確認 API log 沒有這筆（見 deploy/README.md）。

不比對回應的 hostname：官網可能同時掛 Railway 網域與自訂網域，能產生 token
的網域由 Cloudflare 後台 widget 的 hostname 清單管制。"""

from __future__ import annotations

import ipaddress
import logging

import httpx

from app.config import Settings

logger = logging.getLogger("app.booking.turnstile")

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TIMEOUT_SECONDS = 5.0


# siteverify 的 error-codes：前兩個是「我們的 secret 設錯」，internal-error 是
# Cloudflare 自己出錯、要呼叫端重試。
_SECRET_ERRORS = frozenset({"missing-input-secret", "invalid-input-secret"})
_RETRYABLE_ERRORS = frozenset({"internal-error"})


class BotCheckFailed(Exception):
    """沒帶 token，或驗證沒有通過（對應 400 BOT_CHECK_FAILED）。"""


async def verify(
    settings: Settings,
    token: str | None,
    remote_ip: str | None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    """通過（或服務失效而放行）時回傳；驗證失敗丟 BotCheckFailed。

    transport 給測試注入 httpx.MockTransport，正式環境走預設網路。"""
    if not settings.turnstile_enabled:
        return
    if not token:
        raise BotCheckFailed()
    form = {"secret": settings.turnstile_secret_key, "response": token}
    if remote_ip:
        form["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(transport=transport, timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(SITEVERIFY_URL, data=form)
    except httpx.HTTPError as exc:
        # 連線錯誤、逾時。不記 token 與回應內容，只記失敗型別。
        logger.warning("Turnstile 驗證服務無法使用，本次送單放行：%s", type(exc).__name__)
        return
    if response.status_code >= 500:
        logger.warning("Turnstile 驗證服務回 HTTP %s，本次送單放行", response.status_code)
        return
    try:
        result = response.json()
    except ValueError:
        result = None
    if not isinstance(result, dict):
        raise BotCheckFailed()
    if result.get("success") is True:
        return
    raw_codes = result.get("error-codes")
    codes = {str(code) for code in raw_codes} if isinstance(raw_codes, list) else set()
    if codes & _SECRET_ERRORS:
        logger.error(
            "Turnstile secret 設定錯誤（%s），伺服器端機器人驗證沒有作用、本次送單放行；"
            "請檢查 WEBSITE_TURNSTILE_SECRET_KEY",
            ",".join(sorted(codes & _SECRET_ERRORS)),
        )
        return
    if codes & _RETRYABLE_ERRORS:
        logger.warning("Turnstile 驗證服務內部錯誤，本次送單放行")
        return
    raise BotCheckFailed()


def visitor_ip(header_value: str | None) -> str | None:
    """代理帶進來的訪客 IP（trusted_client_ip_header 的第一段）；不是合法
    IP 就不送，Cloudflare 的 remoteip 只是輔助訊號。

    官網代理為了限流，把 IPv6 訪客聚合成所在 /64 的網路位址（例如
    2001:db8:1:2::，見 web/shared/request-guard.ts 的 rateLimitSource）。那不是
    解題瀏覽器的實際位址，送給 Cloudflare 只會變成錯誤的訊號，所以後 64 位元
    全為 0 的 IPv6 一律不送。"""
    if not header_value:
        return None
    candidate = header_value.split(",")[0].strip()
    try:
        address = ipaddress.ip_address(candidate)
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and int(address) & ((1 << 64) - 1) == 0:
        return None
    return str(address)
