"""手機推播（Web Push，RFC 8030／8291／8292）的送出核心（2026-11-05）。

流程：payload JSON → aes128gcm 加密（http-ece，每次都產生新的 ECDH 金鑰與 salt）→ VAPID 簽章（py-vapid，
JWT 的 aud＝推播服務的 origin、exp 不超過 12 小時）→ 用 httpx POST 到瀏覽器訂閱時給的 endpoint。
不用 pywebpush（會拉進 requests 與 aiohttp）。

安全邊界：
- endpoint 是使用者的瀏覽器給的字串，伺服器只對白名單內的推播服務送請求（vapid.endpoint_allowed）：
  訂閱時驗一次，送出前再驗一次；httpx 不跟隨轉址，白名單內的服務也不能把我們導去別處。
- VAPID 私鑰只在這裡簽章時取用，不進 log、不進例外訊息、不進回傳值；log 只寫結果代碼與 HTTP 狀態。
- 推播內容不放家長姓名、電話、Email（鎖定畫面看得到），由呼叫端負責（service.py、error_alerts.py）。

這個模組不 commit：呼叫端決定什麼時候提交。推播失敗一律以回傳值表示，不丟例外。"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import http_ece
import httpx
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.common.timezones import now_utc
from app.config import Settings
from app.notifications import vapid
from app.notifications.models import PushSubscription

logger = logging.getLogger("app.web_push")


class _HidePushEndpoints(logging.Filter):
    """httpx 每個請求都在 INFO 記一行「HTTP Request: POST <完整網址>」，推播的網址就是裝置的 endpoint。
    endpoint 不進平台日誌：丟掉目標是推播服務的那幾行（其他 httpx 請求的記錄照舊）。"""

    def filter(self, record: logging.LogRecord) -> bool:
        return not any(vapid.endpoint_allowed(str(arg)) for arg in (record.args if isinstance(record.args, tuple) else ()))


def _hide_endpoints_from_httpx_log() -> None:
    httpx_logger = logging.getLogger("httpx")
    if not any(isinstance(f, _HidePushEndpoints) for f in httpx_logger.filters):
        httpx_logger.addFilter(_HidePushEndpoints())


_hide_endpoints_from_httpx_log()

SEND_TIMEOUT_SECONDS = 10.0
DEFAULT_TTL_SECONDS = 86400
# VAPID JWT 的有效期。RFC 8292 上限 24 小時，Apple 較嚴，取 12 小時。
VAPID_LIFETIME_SECONDS = 12 * 3600
# 連續失敗這麼多次的訂閱視為失效（裝置關機太久、瀏覽器已移除但推播服務沒回 404/410）。
MAX_CONSECUTIVE_FAILURES = 10
# aes128gcm 單一記錄 4096 bytes，扣掉標頭與加密開銷，明文不能超過這個長度。
MAX_PLAINTEXT_BYTES = 3500
# 同時對外送出的最多幾個（每人通常 1–3 台裝置）。
_CONCURRENCY = 8
URGENCIES = ("very-low", "low", "normal", "high")

Outcome = Literal["ok", "gone", "failed"]


@dataclass(frozen=True)
class Result:
    """一次送出的結果。reason 是給 log 看的短代碼（不含 endpoint、金鑰與內容）。"""

    outcome: Outcome
    status: int | None = None
    reason: str | None = None


@dataclass(frozen=True)
class PushSender:
    """派送用：設定（金鑰、subject）加一個 httpx client。outbox 派送與背景任務都只收這個，沒傳＝不推播。"""

    settings: Settings
    client: httpx.AsyncClient


def _failed(reason: str, status: int | None = None) -> Result:
    return Result("failed", status, reason)


def _prepare(subscription: PushSubscription, plaintext: bytes, settings: Settings, ttl: int, urgency: str):
    """加密與簽章（CPU 運算，在執行緒裡跑，不卡住 API 的 event loop）。回傳 (本文, headers)。"""
    p256dh = vapid.public_key_point(subscription.p256dh)
    auth = vapid.auth_secret(subscription.auth)
    body = http_ece.encrypt(
        plaintext,
        private_key=ec.generate_private_key(ec.SECP256R1()),  # 每則訊息一把新的 ECDH 金鑰
        dh=p256dh,
        auth_secret=auth,
        version="aes128gcm",
    )  # salt 不傳＝每次 os.urandom(16)
    assert settings.vapid_private_key is not None
    signer = vapid.load_signer(settings.vapid_private_key)
    claims = {
        "sub": settings.web_push_subject,
        "aud": vapid.endpoint_origin(subscription.endpoint),
        "exp": int(time.time()) + VAPID_LIFETIME_SECONDS,
    }
    headers = {
        "TTL": str(ttl),
        "Urgency": urgency,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        **signer.sign(claims),  # {"Authorization": "vapid t=<JWT>,k=<公鑰>"}
    }
    return body, headers


async def send(
    subscription: PushSubscription,
    payload: dict,
    *,
    settings: Settings,
    client: httpx.AsyncClient,
    ttl: int = DEFAULT_TTL_SECONDS,
    urgency: str = "high",
) -> Result:
    """對一台裝置送一則推播。永遠不丟例外；只回傳結果，不動資料庫（見 record_result）。

    2xx＝ok；404／410＝訂閱已失效（gone）；其他狀態、連線與逾時錯誤、endpoint 不在白名單＝failed。"""
    if not settings.web_push_enabled:
        return _failed("disabled")
    if urgency not in URGENCIES:
        return _failed("bad_urgency")
    if not vapid.endpoint_allowed(subscription.endpoint):
        return _failed("endpoint_not_allowed")
    try:
        plaintext = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError):
        return _failed("bad_payload")
    if len(plaintext) > MAX_PLAINTEXT_BYTES:
        return _failed("payload_too_large")
    try:
        body, headers = await asyncio.to_thread(_prepare, subscription, plaintext, settings, ttl, urgency)
    except Exception as exc:  # noqa: BLE001 —— 金鑰格式壞掉、簽章失敗；只記類型，不記訊息
        logger.warning("推播加密或簽章失敗：%s", type(exc).__name__)
        return _failed("prepare_failed")
    try:
        response = await client.post(subscription.endpoint, content=body, headers=headers, timeout=SEND_TIMEOUT_SECONDS)
    except httpx.TimeoutException:
        return _failed("timeout")
    except httpx.HTTPError as exc:
        # httpx 的例外訊息會帶完整網址（含 endpoint），只記類型。
        return _failed(type(exc).__name__)
    code = response.status_code
    if 200 <= code < 300:
        return Result("ok", code)
    if code in (404, 410):
        return Result("gone", code, "subscription_gone")
    return _failed("http_error", code)


async def record_result(db: AsyncSession, subscription: PushSubscription, result: Result, now: datetime) -> None:
    """把送出結果記回訂閱：成功清零失敗次數、失效就刪、連續失敗 10 次也刪。不 commit。"""
    if result.outcome == "ok":
        subscription.last_success_at = now
        subscription.failure_count = 0
        return
    if result.outcome == "gone":
        await db.delete(subscription)
        return
    subscription.failure_count = (subscription.failure_count or 0) + 1
    subscription.last_failure_at = now
    if subscription.failure_count >= MAX_CONSECUTIVE_FAILURES:
        await db.delete(subscription)


async def subscriptions_of(db: AsyncSession, user_ids: list[uuid.UUID]) -> list[PushSubscription]:
    if not user_ids:
        return []
    result = await db.execute(
        select(PushSubscription)
        .where(PushSubscription.user_id.in_(user_ids))
        .order_by(PushSubscription.created_at, PushSubscription.id)
    )
    return list(result.scalars())


async def send_all(
    subscriptions: list[PushSubscription],
    payload: dict,
    *,
    settings: Settings,
    client: httpx.AsyncClient,
    ttl: int = DEFAULT_TTL_SECONDS,
    urgency: str = "high",
) -> list[Result]:
    """對一組訂閱裝置各送一則推播（同時最多 8 個）。只做網路，不碰資料庫；回傳順序同 subscriptions。"""
    gate = asyncio.Semaphore(_CONCURRENCY)

    async def one(subscription: PushSubscription) -> Result:
        async with gate:
            return await send(subscription, payload, settings=settings, client=client, ttl=ttl, urgency=urgency)

    return list(await asyncio.gather(*(one(subscription) for subscription in subscriptions)))


async def apply_results(db: AsyncSession, subscriptions: list[PushSubscription], results: list[Result]) -> None:
    """把送出結果記回各訂閱列（不 commit）。呼叫端若要隔離寫庫失敗，自己包 savepoint。"""
    now = now_utc()
    for subscription, result in zip(subscriptions, results):
        if result.outcome != "ok":
            logger.warning(
                "手機推播未送達：subscription=%s reason=%s status=%s", subscription.id, result.reason, result.status
            )
        await record_result(db, subscription, result, now)


def delivered_user_ids(subscriptions: list[PushSubscription], results: list[Result]) -> set[uuid.UUID]:
    """至少一台裝置成功的人。"""
    return {s.user_id for s, r in zip(subscriptions, results) if r.outcome == "ok"}


async def deliver(
    db: AsyncSession,
    subscriptions: list[PushSubscription],
    payload: dict,
    *,
    settings: Settings,
    client: httpx.AsyncClient,
    ttl: int = DEFAULT_TTL_SECONDS,
    urgency: str = "high",
) -> list[Result]:
    """send_all＋apply_results：送出後把結果記回訂閱列（不 commit）。"""
    results = await send_all(subscriptions, payload, settings=settings, client=client, ttl=ttl, urgency=urgency)
    await apply_results(db, subscriptions, results)
    return results


async def send_to_users(
    db: AsyncSession,
    users: list[User],
    payload: dict,
    *,
    settings: Settings,
    client: httpx.AsyncClient,
    ttl: int = DEFAULT_TTL_SECONDS,
    urgency: str = "high",
) -> dict[uuid.UUID, bool]:
    """對每個人的每個訂閱裝置送一則推播，結果記回訂閱列（不 commit）。

    回傳 {user.id: 至少一台裝置成功}。沒有訂閱的人不在回傳裡（和「送了但失敗」區分）。"""
    subscriptions = await subscriptions_of(db, [user.id for user in users])
    if not subscriptions:
        return {}
    results = await deliver(db, subscriptions, payload, settings=settings, client=client, ttl=ttl, urgency=urgency)
    delivered: dict[uuid.UUID, bool] = {}
    for subscription, result in zip(subscriptions, results):
        delivered[subscription.user_id] = delivered.get(subscription.user_id, False) or result.outcome == "ok"
    return delivered


def new_client(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    """推播專用的 httpx client：不跟隨轉址、逾時 10 秒。transport 給測試注入 MockTransport。"""
    return httpx.AsyncClient(
        transport=transport,
        timeout=httpx.Timeout(SEND_TIMEOUT_SECONDS),
        follow_redirects=False,
    )
