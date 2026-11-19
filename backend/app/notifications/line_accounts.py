"""各個 LINE 官方帳號的狀態：名稱、LINE ID、這個月的訊息額度（2026-11-16，
docs/specs/2026-11-16-line-integrations-design.md §2、§3）。

後台 LINE 通知頁與系統狀態頁共用。額度 5 分鐘查一次（每月 200 則的免費方案用完之後 LINE 回 429，
推播會一直失敗、整筆通知進重試，所以要在用完前看得到）；查失敗記 1 分鐘，期間不再重查。"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

from app.config import LINE_MAIN_ACCOUNT, LineAccountCredentials, Settings
from app.insights.cache import TtlCache
from app.notifications import line as line_api
from app.notifications import line_parent

logger = logging.getLogger("app.line")

# 用到這個比例就提醒（系統狀態算「要注意」）。
QUOTA_WARN_RATIO = 0.8
_QUOTA_CACHE: TtlCache[line_api.Quota] = TtlCache(ttl_seconds=300)
_QUOTA_FAILED: dict[tuple, tuple[float, int | None]] = {}
WEBHOOK_BASE = "/api/website/v1/line/webhook"


@dataclass(frozen=True)
class AccountStatus:
    key: str
    webhook_url: str | None
    display_name: str | None
    basic_id: str | None
    quota_limit: int | None
    quota_used: int | None
    # 查額度失敗：LINE 的 HTTP 狀態碼（401＝金鑰失效），連不上是 None 且 quota_error=True。
    quota_error: bool
    quota_error_status: int | None

    @property
    def quota_warning(self) -> bool:
        return (
            self.quota_limit is not None
            and self.quota_used is not None
            and self.quota_limit > 0
            and self.quota_used >= self.quota_limit * QUOTA_WARN_RATIO
        )


def webhook_url(settings: Settings, key: str) -> str | None:
    if not settings.admin_origin:
        return None
    path = WEBHOOK_BASE if key == LINE_MAIN_ACCOUNT else f"{WEBHOOK_BASE}/{key}"
    return f"{settings.admin_origin.rstrip('/')}{path}"


async def quota(account: LineAccountCredentials, transport=None) -> line_api.Quota:
    """失敗記 1 分鐘（同 line_parent.bot_info），這段時間直接丟同一個錯，不再等逾時。"""
    key = (account.key, hash(account.access_token))
    failed = _QUOTA_FAILED.get(key)
    if failed is not None and time.monotonic() - failed[0] < line_parent.FAILURE_HOLD_SECONDS:
        raise line_api.LineApiError(failed[1])

    async def fetch() -> line_api.Quota:
        async with line_api.LineMessagingClient(
            account.access_token, transport=transport, timeout=line_parent.QUERY_TIMEOUT_SECONDS
        ) as client:
            return await client.quota()

    try:
        value = (await _QUOTA_CACHE.get(key, fetch)).value
    except line_api.LineApiError as exc:
        _QUOTA_FAILED[key] = (time.monotonic(), exc.status_code)
        raise
    _QUOTA_FAILED.pop(key, None)
    return value


def clear_quota_cache() -> None:
    """測試用。"""
    _QUOTA_CACHE._entries.clear()
    _QUOTA_FAILED.clear()


async def account_status(settings: Settings, account: LineAccountCredentials, transport=None) -> AccountStatus:
    info = await line_parent.bot_info(account, transport)
    limit = used = status_code = None
    error = False
    try:
        current = await quota(account, transport)
        limit, used = current.limit, current.used
    except line_api.LineApiError as exc:
        logger.warning("LINE 額度查詢失敗：account=%s error=%s", account.key, exc)
        error, status_code = True, exc.status_code
    return AccountStatus(
        key=account.key,
        webhook_url=webhook_url(settings, account.key),
        display_name=info.display_name if info else None,
        basic_id=info.basic_id if info else None,
        quota_limit=limit,
        quota_used=used,
        quota_error=error,
        quota_error_status=status_code,
    )


async def all_statuses(settings: Settings, transport=None) -> list[AccountStatus]:
    """各帳號同時查（LINE 連不上時不必一個一個等逾時）。"""
    return list(
        await asyncio.gather(*(account_status(settings, account, transport) for account in settings.line_accounts.values()))
    )
