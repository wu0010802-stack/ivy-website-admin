"""機器金鑰驗證：`X-Ivy-Integration-Key` 的 SHA-256 與該校區設定的雜湊比對。

- 不使用後台 session cookie：帶了有效 session 但沒有金鑰一樣 401。
- 沒帶標頭、金鑰不對、該校區沒設定金鑰、校區代號不認得，一律同一種 401（錯誤碼與訊息相同），
  不洩漏哪個校區有設定；比對一律做一次 compare_digest（沒設定的校區比對固定的假雜湊），
  不因為校區有沒有設定而走不同路徑。
- 驗證失敗依來源 IP 限流（同 auth 的登入：計數存 PostgreSQL），超過回 429＋Retry-After。
  只有「失敗」計數；有效金鑰不被來源的失敗次數擋住（猜 256 位元的金鑰不會因此變快）。
- 記 WARNING log（來源、校區、有沒有帶標頭），不記金鑰內容。"""

from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import Header, HTTPException, Query, Request, status

from app.campuses.models import CAMPUS_KEYS
from app.common import ratelimit
from app.config import Settings

logger = logging.getLogger("app.integrations.ivy_management")

KEY_HEADER = "X-Ivy-Integration-Key"
# 每個來源 5 分鐘內最多 20 次失敗；第 21 次失敗起回 429。
AUTH_FAIL_LIMIT = ratelimit.Limit("ivy_sync_auth_fail", window_seconds=300, max_per_window=20)

AUTH_FAILED_DETAIL = {"code": "INTEGRATION_AUTH_FAILED", "message": "金鑰無效或未提供"}
RATE_LIMITED_DETAIL = {"code": "INTEGRATION_AUTH_RATE_LIMITED", "message": "驗證失敗次數過多，請稍後再試"}

# 校區沒設定金鑰時拿來比對的固定值（不會等於任何真的金鑰的 SHA-256）。
_NO_KEY_DIGEST = hashlib.sha256(b"ivy-sync:no-key-configured").hexdigest()


def key_digest(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def key_matches(settings: Settings, campus_key: str, presented: str | None) -> bool:
    """金鑰對不對。沒設定的校區、沒帶金鑰都回 False，且都會做一次定時比對。"""
    expected = settings.ivy_sync_hashes.get(campus_key)
    matched = hmac.compare_digest(key_digest(presented or ""), expected or _NO_KEY_DIGEST)
    return bool(matched and expected and presented)


async def require_integration_key(
    request: Request,
    campus_key: str = Query(..., max_length=64, description="要拉哪一校的資料（義華 yihua、明華 minghua…）"),
    integration_key: str | None = Header(default=None, alias=KEY_HEADER),
) -> str:
    """路由依賴：驗證通過回傳 campus_key，否則 401（失敗太多次 429）。"""
    settings: Settings = request.app.state.settings
    if key_matches(settings, campus_key, integration_key):
        return campus_key
    source = ratelimit.client_key(request)
    # 校區代號是呼叫端自填的，只有已知的才進 log，免得有人把任意字串灌進日誌。
    logged_campus = campus_key if campus_key in CAMPUS_KEYS else "(unknown)"
    try:
        await ratelimit.limiter(request).check(AUTH_FAIL_LIMIT, source)
    except ratelimit.RateLimited as exc:
        logger.warning(
            "園務同步驗證失敗過多：source=%s campus=%s has_key=%s retry_after=%s",
            source, logged_campus, integration_key is not None, exc.retry_after_seconds,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=RATE_LIMITED_DETAIL,
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    logger.warning(
        "園務同步驗證失敗：source=%s campus=%s has_key=%s", source, logged_campus, integration_key is not None
    )
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=AUTH_FAILED_DETAIL)
