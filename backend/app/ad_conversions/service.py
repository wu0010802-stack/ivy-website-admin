"""到場、預繳回傳廣告平台：排入與送出（2026-11-16，docs/specs/2026-11-16-cookie-features-design.md §2）。

- 排入（enqueue）：「標記已到場」與招生訪視「已參觀 → 已預繳」在同一個交易呼叫。案件的 ad_click_ids 有哪個平台
  的識別碼就排哪個平台——送單時只有設定了伺服器端金鑰的平台才會記識別碼，所以這裡不必讀設定。
- 送出（process_due）：API 內建定期工作每輪呼叫。一列一個交易：鎖住、送、記結果。送出當下才讀識別碼；
  案件已匿名化、被標記排除、平台已拿掉設定、超過平台時限的，記 skipped 不送。
- 只送平台規定的識別碼與校區代碼，不送姓名、電話、Email 或它們的雜湊。
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad_conversions.models import AdConversionJob
from app.booking.attribution import PLATFORM_KEYS
from app.booking.models import VisitRequest
from app.config import Settings

logger = logging.getLogger("app.ad_conversions")


class _HideConversionUrls(logging.Filter):
    """httpx 每個請求都在 INFO 記一行「HTTP Request: POST <完整網址>」；GA4 Measurement Protocol 的 api_secret
    只能放在網址上，不能進平台日誌。丟掉目標是這幾個轉換端點的那幾行（同 notifications/web_push.py 的做法）。"""

    _HOSTS = ("www.google-analytics.com/mp/", "graph.facebook.com/", "bzr.openai.com/")

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args if isinstance(record.args, tuple) else ()
        return not any(host in str(arg) for arg in args for host in self._HOSTS)


_httpx_logger = logging.getLogger("httpx")
if not any(isinstance(f, _HideConversionUrls) for f in _httpx_logger.filters):
    _httpx_logger.addFilter(_HideConversionUrls())

VISIT_ATTENDED = "visit_attended"
DEPOSIT_PAID = "deposit_paid"

# 各平台的事件名稱：GA4 與 OpenAI 用小寫底線，Meta 自訂事件慣例用大寫開頭。
EVENT_NAMES: dict[str, dict[str, str]] = {
    VISIT_ATTENDED: {"ga4": "visit_attended", "meta": "VisitAttended", "openai": "visit_attended"},
    DEPOSIT_PAID: {"ga4": "deposit_paid", "meta": "DepositPaid", "openai": "deposit_paid"},
}
# 平台收事件的時限（事件時間距今）：GA4 Measurement Protocol 72 小時、Meta 與 OpenAI 7 天，各留一小時餘裕。
DEADLINES: dict[str, timedelta] = {
    "ga4": timedelta(hours=71),
    "meta": timedelta(days=7) - timedelta(hours=1),
    "openai": timedelta(days=7) - timedelta(hours=1),
}
MAX_ATTEMPTS = 5
# 第 n 次失敗後隔多久再試（n 從 1 起算）。
RETRY_DELAYS = (timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=30), timedelta(hours=2), timedelta(hours=6))
BATCH_LIMIT = 50
REQUEST_TIMEOUT_SECONDS = 10.0
OPENAI_INTEGRATION_SOURCE = "ivy-website"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def enqueue(db: AsyncSession, visit_request: VisitRequest, event: str, *, now: datetime | None = None) -> int:
    """回傳這次新排入幾列（同一案件、事件、平台已經排過的不重排）。"""
    ids = visit_request.ad_click_ids or {}
    platforms = [platform for platform, keys in PLATFORM_KEYS.items() if any(ids.get(key) for key in keys)]
    if not platforms or event not in EVENT_NAMES:
        return 0
    at = now or _now()
    rows = [
        {
            "id": uuid.uuid4(), "visit_request_id": visit_request.id, "event": event, "platform": platform,
            "status": "pending", "occurred_at": at, "attempts": 0, "next_attempt_at": at, "created_at": at,
        }
        for platform in platforms
    ]
    result = await db.execute(
        pg_insert(AdConversionJob)
        .values(rows)
        .on_conflict_do_nothing(constraint="uq_ad_conversion_jobs_request_event_platform")
        .returning(AdConversionJob.id)
    )
    return len(result.all())


class _Retry(Exception):
    """平台暫時性錯誤（逾時、連線失敗、429、5xx）：稍後重試。"""


class _Reject(Exception):
    """平台拒絕這筆（其他 4xx）：重試也不會過，直接記失敗。"""


def _event_id(job: AdConversionJob) -> str:
    return f"{job.visit_request_id}:{job.event}"


def build_request(job: AdConversionJob, ids: dict, campus_key: str, settings: Settings) -> tuple[str, dict, dict] | None:
    """回傳 (網址, 標頭, JSON 本文)；這個平台需要的識別碼都沒有就回 None。金鑰只放在標頭或本文，不進網址
    （GA4 例外：Measurement Protocol 只收網址參數）。"""
    name = EVENT_NAMES[job.event][job.platform]
    if job.platform == "ga4":
        client_id = ids.get("ga_client_id")
        if not client_id:
            return None
        url = (
            "https://www.google-analytics.com/mp/collect"
            f"?measurement_id={settings.ga4_measurement_id}&api_secret={settings.ga4_api_secret}"
        )
        body = {
            "client_id": client_id,
            "timestamp_micros": int(job.occurred_at.timestamp() * 1_000_000),
            # 官網的 gtag 也關了廣告個人化信號（web/app/utils/third-party-analytics.ts）。
            "non_personalized_ads": True,
            "events": [{"name": name, "params": {"campus_key": campus_key, "engagement_time_msec": 1}}],
        }
        return url, {}, body
    if job.platform == "meta":
        user_data = {key: ids[key] for key in ("fbc", "fbp") if ids.get(key)}
        if not user_data:
            return None
        url = f"https://graph.facebook.com/{settings.meta_graph_version}/{settings.meta_pixel_id}/events"
        body = {
            "data": [{
                "event_name": name,
                "event_time": int(job.occurred_at.timestamp()),
                "event_id": _event_id(job),
                "action_source": "physical_store",
                "user_data": user_data,
                "custom_data": {"campus_key": campus_key},
            }],
            "access_token": settings.meta_capi_token,
        }
        return url, {}, body
    if job.platform == "openai":
        oppref, obref = ids.get("oppref"), ids.get("obref")
        if not oppref and not obref:
            return None
        event: dict = {
            "id": _event_id(job),
            "type": "custom",
            "custom_event_name": name,
            "timestamp_ms": int(job.occurred_at.timestamp() * 1000),
            "action_source": "physical_store",
            "data": {"type": "customer_action"},
        }
        if oppref:
            event["oppref"] = oppref
        if obref:
            event["user"] = {"obref": obref}
        url = f"https://bzr.openai.com/v1/events?pid={settings.openai_pixel_id}"
        return url, {"Authorization": f"Bearer {settings.openai_capi_key}"}, {
            "integration_source": OPENAI_INTEGRATION_SOURCE, "events": [event],
        }
    return None


def _error_summary(response: httpx.Response) -> str:
    # 平台的錯誤本文偶爾會把請求內容（含點擊識別碼）帶回來；只留狀態碼與前 200 字。
    text = response.text.replace("\n", " ")[:200]
    return f"HTTP {response.status_code}: {text}"


async def _send(client: httpx.AsyncClient, url: str, headers: dict, body: dict) -> None:
    try:
        response = await client.post(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        raise _Retry(type(exc).__name__) from exc
    if response.status_code < 300:
        return
    if response.status_code == 429 or response.status_code >= 500:
        raise _Retry(_error_summary(response))
    raise _Reject(_error_summary(response))


async def process_due(
    db: AsyncSession, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None, now: datetime | None = None
) -> dict[str, int]:
    """送出到期的待送工作，回傳 {sent, failed, skipped, retried}。每列各自一個交易（先 commit 再處理下一列）。"""
    counts = {"sent": 0, "failed": 0, "skipped": 0, "retried": 0}
    current = now or _now()
    due_ids = (
        await db.scalars(
            select(AdConversionJob.id)
            .where(AdConversionJob.status == "pending", AdConversionJob.next_attempt_at <= current)
            .order_by(AdConversionJob.next_attempt_at)
            .limit(BATCH_LIMIT)
        )
    ).all()
    await db.rollback()
    if not due_ids:
        return counts
    configured = set(settings.ad_conversion_platforms)
    async with httpx.AsyncClient(transport=transport, timeout=REQUEST_TIMEOUT_SECONDS) as client:
        for job_id in due_ids:
            job = (
                await db.execute(
                    select(AdConversionJob)
                    .where(AdConversionJob.id == job_id, AdConversionJob.status == "pending")
                    .with_for_update(skip_locked=True)
                )
            ).scalar_one_or_none()
            if job is None:
                await db.rollback()
                continue
            outcome = await _process_one(db, client, job, settings, configured, current)
            counts[outcome] += 1
            await db.commit()
    if counts["failed"]:
        logger.warning("回傳廣告平台：%s 筆失敗（原因記在 ad_conversion_jobs.last_error）", counts["failed"])
    return counts


def _finish(job: AdConversionJob, status: str, now: datetime, error: str | None = None) -> None:
    job.status = status
    job.finished_at = now
    job.last_error = error[:300] if error else None


async def _process_one(
    db: AsyncSession, client: httpx.AsyncClient, job: AdConversionJob, settings: Settings,
    configured: set[str], now: datetime,
) -> str:
    visit_request = await db.get(VisitRequest, job.visit_request_id)
    if visit_request is None or visit_request.anonymized_at is not None:
        _finish(job, "skipped", now, "anonymized")
        return "skipped"
    if visit_request.excluded_at is not None:
        _finish(job, "skipped", now, "excluded")
        return "skipped"
    if job.platform not in configured:
        _finish(job, "skipped", now, "not_configured")
        return "skipped"
    if now - job.occurred_at > DEADLINES[job.platform]:
        _finish(job, "skipped", now, "expired")
        return "skipped"
    built = build_request(job, visit_request.ad_click_ids or {}, visit_request.campus_key, settings)
    if built is None:
        _finish(job, "skipped", now, "no_identifier")
        return "skipped"
    url, headers, body = built
    job.attempts += 1
    try:
        await _send(client, url, headers, body)
    except _Retry as exc:
        if job.attempts >= MAX_ATTEMPTS:
            _finish(job, "failed", now, str(exc))
            return "failed"
        job.next_attempt_at = now + RETRY_DELAYS[min(job.attempts, len(RETRY_DELAYS)) - 1]
        job.last_error = str(exc)[:300]
        return "retried"
    except _Reject as exc:
        _finish(job, "failed", now, str(exc))
        return "failed"
    _finish(job, "sent", now)
    return "sent"
