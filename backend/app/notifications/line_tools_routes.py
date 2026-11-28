"""後台的兩個 LINE 查詢工具（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §2、§5.1）：

- 檢查 webhook 連線：LINE 後台填的網址對不對、開關有沒有開、LINE 連不連得到。
- 群組成員：人數與名稱（即時向 LINE 查、只快取不入庫，不回 userId）。

兩者都只讀 LINE，不寫資料庫、不寫稽核。查 LINE 之前先結束資料庫交易。"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.common import ratelimit
from app.config import LINE_MAIN_ACCOUNT, LineAccountCredentials
from app.insights.cache import TtlCache
from app.notifications import line as line_api
from app.notifications import line_accounts
from app.notifications.models import LineGroup

logger = logging.getLogger("app.line")

router = APIRouter(prefix="/api/website/v1", tags=["line"])

# LINE 的 webhook 測試每小時只給 60 次（整個帳號共用），每人 10 分鐘 10 次擋連點。
WEBHOOK_CHECK_LIMIT = ratelimit.Limit("line_webhook_check", window_seconds=600, max_per_window=10)
MEMBERS_CACHE_SECONDS = 600
MEMBERS_MAX = 200
NAME_CONCURRENCY = 5

_MEMBERS_CACHE: "TtlCache[LineGroupMembersOut]" = TtlCache(ttl_seconds=MEMBERS_CACHE_SECONDS)


def clear_members_cache() -> None:
    """測試用。"""
    _MEMBERS_CACHE._entries.clear()


class LineWebhookTestOut(BaseModel):
    success: bool
    status_code: int | None
    reason: str


class LineWebhookCheckOut(BaseModel):
    account_key: str
    # 這個帳號該填的網址；沒設 WEBSITE_ADMIN_ORIGIN 為 None。
    expected_url: str | None
    # LINE 後台現在填的；None＝還沒填。
    endpoint: str | None = None
    # LINE 後台「使用 Webhook」開關。
    active: bool | None = None
    # endpoint 與 expected_url 去掉結尾斜線後相同；任一個是 None 就是 None。
    matches: bool | None = None
    # 沒填網址不測；測試打的是 LINE 後台填的那個網址。
    test: LineWebhookTestOut | None = None
    # 查 LINE 失敗：HTTP 狀態碼（401＝金鑰失效），連不上是 0。
    error_status: int | None = None


class LineGroupMembersOut(BaseModel):
    # 不含官方帳號；查不到為 None。
    count: int | None
    # 成員的 LINE 顯示名稱（排序後）；None＝拿不到名單。
    names: list[str] | None
    # unverified＝LINE 回 403（帳號不是認證／進階帳號）。
    names_unavailable: Literal["unverified", "error"] | None
    # 超過 200 人只列前 200。
    truncated: bool


def _transport(request: Request):
    return getattr(request.app.state, "line_transport", None)


def _rate_limited(exc: ratelimit.RateLimited, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={"code": "RATE_LIMITED", "message": message},
        headers={"Retry-After": str(exc.retry_after_seconds)},
    )


def _same_url(a: str, b: str) -> bool:
    return a.rstrip("/") == b.rstrip("/")


@router.post("/admin/line/accounts/{account_key}/webhook-check", response_model=LineWebhookCheckOut)
async def check_line_webhook(
    account_key: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LineWebhookCheckOut:
    """先查 LINE 後台填的 webhook，查到才請 LINE 對那個網址送一個空事件。不改任何設定、不寫稽核。"""
    require_scope(current_user, "notifications.manage")
    settings = request.app.state.settings
    account: LineAccountCredentials | None = settings.line_accounts.get(account_key)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    try:
        await ratelimit.limiter(request).check(WEBHOOK_CHECK_LIMIT, str(current_user.id))
    except ratelimit.RateLimited as exc:
        raise _rate_limited(exc, "檢查太多次了，請稍後再試") from exc
    # 向 LINE 查之前先結束登入驗證開的交易，不握著連線等外部 API。
    await db.rollback()

    result = LineWebhookCheckOut(account_key=account_key, expected_url=line_accounts.webhook_url(settings, account_key))
    try:
        async with line_api.LineMessagingClient(account.access_token, transport=_transport(request)) as client:
            endpoint = await client.webhook_endpoint()
            result.endpoint = endpoint.endpoint
            result.active = endpoint.active
            if endpoint.endpoint is not None and result.expected_url is not None:
                result.matches = _same_url(endpoint.endpoint, result.expected_url)
            if endpoint.endpoint is not None:
                tested = await client.test_webhook()
                result.test = LineWebhookTestOut(
                    success=tested.success, status_code=tested.status_code, reason=tested.reason
                )
    except line_api.LineApiError as exc:
        logger.warning("LINE webhook 檢查失敗：account=%s error=%s", account_key, exc)
        result.test = None
        result.error_status = exc.status_code or 0
    return result


async def _fetch_members(
    token: str, transport, target_id: str, source_type: str
) -> LineGroupMembersOut:
    count: int | None = None
    names: list[str] | None = None
    unavailable: Literal["unverified", "error"] | None = None
    truncated = False
    async with line_api.LineMessagingClient(token, transport=transport) as client:
        try:
            count = await client.member_count(target_id, source_type)
        except line_api.LineApiError as exc:
            logger.warning("LINE 群組人數查詢失敗：error=%s", exc)
        try:
            ids, truncated = await client.member_ids(target_id, source_type, limit=MEMBERS_MAX)
        except line_api.LineApiError as exc:
            # 403＝不是認證／進階帳號，LINE 不給名單；只能顯示人數。
            unavailable = "unverified" if exc.status_code == 403 else "error"
            if unavailable == "error":
                logger.warning("LINE 群組名單查詢失敗：error=%s", exc)
        else:
            gate = asyncio.Semaphore(NAME_CONCURRENCY)

            async def one(user_id: str) -> str | None:
                async with gate:
                    return await client.member_name(target_id, user_id, source_type)

            found = await asyncio.gather(*(one(user_id) for user_id in ids))
            names = sorted(name for name in found if name)
    return LineGroupMembersOut(count=count, names=names, names_unavailable=unavailable, truncated=truncated)


@router.get("/admin/line/groups/{target_id}/members", response_model=LineGroupMembersOut)
async def get_line_group_members(
    target_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LineGroupMembersOut:
    """群組（或多人聊天室）裡有誰：人數與顯示名稱。即時向 LINE 查（main 帳號），每個群組快取 10 分鐘，
    不存資料庫、不回 userId。名單只有認證／進階帳號查得到，其他帳號只回人數。"""
    require_scope(current_user, "notifications.manage")
    account = request.app.state.settings.line_accounts.get(LINE_MAIN_ACCOUNT)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "LINE_NOT_CONFIGURED", "message": "尚未設定 LINE 官方帳號的 Messaging API 金鑰"},
        )
    group = await db.get(LineGroup, target_id)
    if group is None or group.left_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    source_type = group.source_type
    # 向 LINE 查之前先結束資料庫交易。
    await db.rollback()

    key = (target_id, hash(account.access_token))
    cached = await _MEMBERS_CACHE.get(
        key, lambda: _fetch_members(account.access_token, _transport(request), target_id, source_type)
    )
    if cached.value.names_unavailable == "error" or cached.value.count is None:
        # 查失敗的不留 10 分鐘：下次再問。
        _MEMBERS_CACHE._entries.pop(key, None)
    return cached.value
