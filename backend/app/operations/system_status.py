"""總管理者的系統狀態頁（2026-10-15 規格 docs/specs/2026-10-15-admin-system-status-design.md）。

只讀、不寫任何資料：
- 設定只看「有沒有設」，不回傳金鑰、密碼、token；寄信例外，主機、port、加密方式與寄件地址不是秘密（S10）。
- 背景迴圈的狀態取自回應這次請求的程序記憶體（app.state 上的 loop 物件）；正式站目前單一副本（S13）。
- 維護排程與轉檔只回傳哪一步失敗，不回傳錯誤原文（可能夾帶 Email 或案件內容，S9）；公開資料的
  last_error 例外，內容是來源與 HTTP 錯誤、不含地址（GeoDatasetStatus 的說明）。
- 每一列只有 key、level 與結構化的 detail；文案在後台 utils/systemStatusFormat.ts。

營運總覽「系統狀態有 N 項要注意」用同一個 attention_count（S4）。"""

from __future__ import annotations

import smtplib
import ssl
from datetime import datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo import providers
from app.admissions.geo.models import DATASETS, GeoDatasetStatus
from app.admissions.geo.sync import REFRESH_AFTER
from app.common import ratelimit
from app.common.timezones import OPERATING_TZ
from app.config import Settings
from app.content.models import ContentItem, PublishJob
from app.content.publish_jobs import unresolved_condition
from app.media.models import MediaAsset, MediaJob, MediaStatus
from app.notifications import outbox_admin
from app.notifications.email_adapter import EmailAdapter, EmailNotConfigured, get_email_adapter
from app.operations.models import RetentionPolicy

Level = Literal["ok", "attention", "info", "off"]

# 維護排程：超過 max(5 分鐘, 5 輪) 沒跑完一輪算停擺（S8）。
MAINTENANCE_STALE_FLOOR = timedelta(minutes=5)
MAINTENANCE_STALE_ROUNDS = 5
# 公開資料同步迴圈：超過「檢查間隔＋2 小時」沒有結果算停擺（預設 26 小時，計畫裁定 P12）。
GEO_LOOP_SLACK = timedelta(hours=2)
# 門牌每月手動匯入一次（正式站連不到來源），35 天沒換版就提醒（S6）。
DOORPLATE_STALE_AFTER = timedelta(days=35)
# 其他公開資料：同步程式的更新週期再 3 天沒動算過期（S7）；沒列的用 REFRESH_AFTER（30 天）。
DATASET_GRACE = timedelta(days=3)
_DATASET_REFRESH = {
    "kindergartens": providers.PROVIDER_REFRESH_AFTER,
    "babycare": providers.PROVIDER_REFRESH_AFTER,
}
# 同步工作內部用的指紋，畫面不讀（GeoDatasetStatus 的說明）。
HIDDEN_DATASETS = frozenset({"campuses"})


class SystemStatusItem(BaseModel):
    key: str
    level: Level
    detail: dict[str, Any] = Field(default_factory=dict)


class SystemStatusOut(BaseModel):
    generated_at: datetime
    attention_count: int
    services: list[SystemStatusItem]
    background: list[SystemStatusItem]
    # None＝招生開關關閉，整區不回（規格 §3.1）。
    datasets: list[SystemStatusItem] | None
    notifications: list[SystemStatusItem]


def geo_sync_active(settings: Settings) -> bool:
    """公開資料自動同步有沒有在跑：招生關閉時同步迴圈不會啟動（main.py lifespan），所以兩個都開才算。"""
    return settings.admissions_enabled and settings.geo_auto_sync


def service_items(settings: Settings, *, policy_auto_run: bool) -> list[SystemStatusItem]:
    """對外服務設定。寄信沒設只在 production 算要注意；其他都是選擇，不是故障（S5）。"""
    production = settings.environment == "production"
    if settings.smtp_host:
        smtp = SystemStatusItem(
            key="smtp",
            level="ok",
            detail={
                "host": settings.smtp_host,
                "port": settings.smtp_port,
                "security": settings.smtp_security,
                "sender": settings.smtp_from,
            },
        )
    elif settings.notification_email_sink_dir and not production:
        smtp = SystemStatusItem(key="smtp", level="info", detail={"sink": True})
    else:
        smtp = SystemStatusItem(key="smtp", level="attention" if production else "info")

    def configured(key: str, flag: bool) -> SystemStatusItem:
        return SystemStatusItem(key=key, level="ok" if flag else "info", detail={"configured": flag})

    def switch(key: str, enabled: bool) -> SystemStatusItem:
        return SystemStatusItem(key=key, level="info" if enabled else "off", detail={"enabled": enabled})

    retention_on = settings.retention_allow_real_run and policy_auto_run
    return [
        smtp,
        configured("line_messaging", settings.line_messaging_enabled),
        configured("turnstile", settings.turnstile_enabled),
        configured("google_login", settings.google_oauth_enabled),
        configured("line_login", settings.line_oauth_enabled),
        SystemStatusItem(key="media_storage", level="info", detail={"storage": settings.media_storage}),
        switch("admissions", settings.admissions_enabled),
        switch("geo_auto_sync", geo_sync_active(settings)),
        SystemStatusItem(
            key="retention_auto_run",
            level="info" if retention_on else "off",
            detail={"env_allowed": settings.retention_allow_real_run, "policy_enabled": policy_auto_run},
        ),
    ]


def maintenance_item(settings: Settings, loop: Any | None, now: datetime) -> SystemStatusItem:
    interval = settings.background_jobs_interval
    if not interval:
        return SystemStatusItem(key="maintenance", level="off", detail={"running": False})
    stale_after = max(MAINTENANCE_STALE_FLOOR, timedelta(seconds=interval * MAINTENANCE_STALE_ROUNDS))
    detail: dict[str, Any] = {
        "running": loop is not None,
        "interval_seconds": interval,
        "stale_minutes": int(stale_after.total_seconds() // 60),
    }
    if loop is None:
        # 背景工作開著卻沒有 loop：啟動失敗或程序不是用 lifespan 起來的。
        return SystemStatusItem(
            key="maintenance",
            level="attention",
            detail={**detail, "stalled": True, "failed_steps": [], "last_completed_at": None, "last_clean_at": None},
        )
    reference = loop.last_completed_at or loop.started_at
    stalled = reference is None or now - reference > stale_after
    failed = list(loop.last_failed_steps)
    detail.update(
        last_completed_at=loop.last_completed_at,
        last_clean_at=loop.last_clean_at,
        failed_steps=failed,
        stalled=stalled,
    )
    return SystemStatusItem(key="maintenance", level="attention" if stalled or failed else "ok", detail=detail)


async def media_item(db: AsyncSession, settings: Settings, loop: Any | None) -> SystemStatusItem:
    if settings.media_video_processing_mode != "background":
        return SystemStatusItem(key="media_jobs", level="info", detail={"mode": "inline"})
    queued = dict(
        (
            await db.execute(
                select(MediaJob.status, func.count())
                .where(MediaJob.status.in_(("pending", "running")))
                .group_by(MediaJob.status)
            )
        ).all()
    )
    # 看素材狀態，不看失敗的工作列：按「重新處理」會另建新工作，舊的失敗列不會消失（計畫裁定 P3）。
    failed = (
        await db.execute(
            select(func.count())
            .select_from(MediaAsset)
            .where(MediaAsset.status == MediaStatus.FAILED, MediaAsset.deleted_at.is_(None))
        )
    ).scalar_one()
    running = loop is not None and loop.running
    detail = {
        "mode": "background",
        "loop_running": running,
        "pending": queued.get("pending", 0),
        "running": queued.get("running", 0),
        "failed_assets": failed,
        "last_processed_at": loop.last_processed_at if loop is not None else None,
    }
    return SystemStatusItem(key="media_jobs", level="attention" if failed or not running else "ok", detail=detail)


def geo_loop_item(settings: Settings, loop: Any | None, now: datetime) -> SystemStatusItem:
    if not geo_sync_active(settings):
        return SystemStatusItem(key="geo_sync_loop", level="off", detail={"running": False})
    stale_after = timedelta(seconds=settings.geo_sync_check_seconds) + GEO_LOOP_SLACK
    running = loop is not None and loop.running
    detail: dict[str, Any] = {"running": running, "stale_hours": int(stale_after.total_seconds() // 3600)}
    if not running:
        return SystemStatusItem(key="geo_sync_loop", level="attention", detail={**detail, "stalled": True, "last_run_at": None})
    reference = loop.last_run_at or loop.started_at
    stalled = reference is None or now - reference > stale_after
    return SystemStatusItem(
        key="geo_sync_loop",
        level="attention" if stalled else "ok",
        detail={**detail, "stalled": stalled, "last_run_at": loop.last_run_at},
    )


def dataset_item(dataset: str, row: GeoDatasetStatus | None, now: datetime, *, auto_sync: bool) -> SystemStatusItem:
    error = row.last_error if row is not None else None
    if row is None or row.synced_at is None:
        return SystemStatusItem(
            key=dataset, level="attention" if error else "info", detail={"imported": False, "error": error, "stale": False},
        )
    manual = dataset == "doorplates"
    if manual:
        # 門牌只看換版時間（S6）；確認過來源沒變不算數。
        threshold = DOORPLATE_STALE_AFTER
        age = now - row.synced_at
    else:
        threshold = _DATASET_REFRESH.get(dataset, REFRESH_AFTER) + DATASET_GRACE
        age = now - max(t for t in (row.synced_at, row.checked_at) if t is not None)
    stale = age > threshold
    # 非門牌資料靠自動同步更新：自動同步沒開時沒有人會去動它，過期只是資訊；同步出過錯（error）
    # 仍要注意。門牌每月手動匯入，不受這個開關影響（P-3）。
    auto_sync_off = not auto_sync and not manual
    if error or (stale and not auto_sync_off):
        level: Level = "attention"
    else:
        level = "info" if stale else "ok"
    return SystemStatusItem(
        key=dataset,
        level=level,
        detail={
            "imported": True,
            "label": row.label,
            "synced_at": row.synced_at,
            "checked_at": row.checked_at,
            "error": error,
            "stale": stale,
            "stale_days": threshold.days,
            "auto_sync_off": auto_sync_off,
        },
    )


async def dataset_items(db: AsyncSession, now: datetime, *, auto_sync: bool) -> list[SystemStatusItem]:
    rows = {row.dataset: row for row in (await db.execute(select(GeoDatasetStatus))).scalars()}
    # 動態跟著 DATASETS：新增資料時清單自己長出來，後台測試會要求補中文（計畫裁定 P11）。
    return [
        dataset_item(name, rows.get(name), now, auto_sync=auto_sync) for name in DATASETS if name not in HIDDEN_DATASETS
    ]


async def notification_items(db: AsyncSession) -> list[SystemStatusItem]:
    """寄送與排程發布失敗：列出筆數，不計入要注意（總覽各有一行，S11）；條件和總覽一致（P13）。"""
    failed_outbox = await outbox_admin.count_failed(db, None)
    failed_jobs = (
        await db.execute(
            select(func.count())
            .select_from(PublishJob)
            .join(ContentItem, ContentItem.id == PublishJob.content_item_id)
            .where(PublishJob.status == "failed", unresolved_condition())
        )
    ).scalar_one()
    return [
        SystemStatusItem(key="failed_outbox", level="info" if failed_outbox else "ok", detail={"count": failed_outbox}),
        SystemStatusItem(key="failed_publish_jobs", level="info" if failed_jobs else "ok", detail={"count": failed_jobs}),
    ]


async def build_status(db: AsyncSession, state: Any, settings: Settings, now: datetime) -> SystemStatusOut:
    # 只讀：不用 retention_service.get_policy（沒有政策列時它會建一列）。
    policy = await db.get(RetentionPolicy, 1)
    services = service_items(settings, policy_auto_run=bool(policy is not None and policy.auto_run_enabled))
    background = [
        maintenance_item(settings, getattr(state, "maintenance", None), now),
        await media_item(db, settings, getattr(state, "media_jobs", None)),
        geo_loop_item(settings, getattr(state, "geo_sync", None), now),
    ]
    datasets = (
        await dataset_items(db, now, auto_sync=geo_sync_active(settings)) if settings.admissions_enabled else None
    )
    notifications = await notification_items(db)
    attention = sum(item.level == "attention" for item in [*services, *background, *(datasets or []), *notifications])
    return SystemStatusOut(
        generated_at=now,
        attention_count=attention,
        services=services,
        background=background,
        datasets=datasets,
        notifications=notifications,
    )


# --- 測試信（規格 §3.4） -------------------------------------------------------------

# 每位使用者 10 分鐘 3 封。
TEST_EMAIL_LIMIT = ratelimit.Limit("system_test_email", 600, 3)
TEST_EMAIL_TIMEOUT_SECONDS = 20.0
TEST_EMAIL_SUBJECT = "【常春藤官網後台】測試信"
SystemEmailTestError = Literal["not_configured", "auth_failed", "connect_failed", "rejected", "timeout", "other"]


class SystemEmailTestOut(BaseModel):
    ok: bool
    error: SystemEmailTestError | None = None


def mail_adapter(settings: Settings) -> EmailAdapter:
    """寄測試信用的 adapter；沒有可用的寄信管道時丟 EmailNotConfigured。測試以 monkeypatch 換掉
    （比照 auth/password_reset.mail_adapter）。

    正式環境只認 SMTP：沒設 SMTP 時就算有 sink 資料夾也不寫檔，否則畫面會說「已寄出」，信卻只是
    躺在伺服器的資料夾裡（比照 password_reset.email_enabled）。"""
    if settings.environment == "production" and not settings.smtp_host:
        raise EmailNotConfigured("正式環境沒有設定 SMTP")
    return get_email_adapter(settings.notification_email_sink_dir, settings)


def build_test_email(settings: Settings, now: datetime) -> tuple[str, str]:
    local = now.astimezone(OPERATING_TZ)
    body = "\n".join(
        [
            "這是從官網後台「系統狀態」寄出的測試信。",
            f"寄出時間：{local:%Y-%m-%d %H:%M}（台北）",
            f"環境：{settings.environment}",
            "",
            "收到這封信，代表後台的寄信設定可以把信寄出去。",
            "這封信由系統自動寄出，請勿直接回覆。",
        ]
    )
    return TEST_EMAIL_SUBJECT, body


def classify_email_error(exc: BaseException) -> SystemEmailTestError:
    """例外類型 → 給畫面看的原因；不回傳原始錯誤訊息（可能含伺服器回應與地址）。
    smtplib 的例外都是 OSError 的子類別，所以先判斷 SMTP 專屬的，再判斷一般連線錯誤。
    伺服器不支援 STARTTLS（SMTPNotSupportedError）與憑證或加密錯（ssl.SSLError）都是主機、port 或
    加密方式設錯，歸 connect_failed，畫面叫人檢查這三項。"""
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "auth_failed"
    if isinstance(exc, (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError)):
        return "rejected"
    if isinstance(exc, TimeoutError):
        return "timeout"
    if isinstance(exc, (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, smtplib.SMTPNotSupportedError)):
        return "connect_failed"
    if isinstance(exc, smtplib.SMTPException):
        return "other"
    if isinstance(exc, (ssl.SSLError, OSError)):
        return "connect_failed"
    return "other"
