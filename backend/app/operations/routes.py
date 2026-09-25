from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import campus_scope, can_publish_shared_content, has_capability, require_scope
from app.campuses.models import Campus
from app.common import ratelimit
from app.notifications.models import UserNotification
from app.operations import analytics_service, audit_service, dashboard_service, retention_service, traffic_service
from app.operations.models import CTA_ENTRIES, SiteSettings

router = APIRouter(prefix="/api/website/v1", tags=["operations"])


CtaEntry = Literal[CTA_ENTRIES]  # type: ignore[valid-type]


class AnalyticsEventCreate(BaseModel):
    """規格 L279、L314：只收允許的點擊、event id、校區與入口代碼。
    event_id 由瀏覽器每次點擊產生一個 UUID，重送同一個 id 只算一次。"""

    model_config = ConfigDict(extra="forbid")

    event_type: str
    campus_key: str | None = None
    event_id: uuid.UUID
    entry: CtaEntry | None = None


@router.post("/public/analytics-events", status_code=status.HTTP_204_NO_CONTENT)
async def create_analytics_event(
    payload: AnalyticsEventCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    if payload.campus_key:
        result = await db.execute(select(Campus).where(Campus.key == payload.campus_key))
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個校區")

    # 公開 API 一律經 Nuxt server route 代理進來，request.client.host 恆為
    # 代理的內網位址——用它當限流 key 等於全站訪客共用一個 20 次/分鐘的桶，
    # 正常流量就會把彼此的 CTA 點擊互相擠掉。改採代理帶進來的訪客 IP。
    client_key = ratelimit.client_key(request)
    try:
        await analytics_service.record_public_click(
            db,
            event_type=payload.event_type,
            campus_key=payload.campus_key,
            event_id=payload.event_id,
            entry=payload.entry,
            limiter=ratelimit.limiter(request),
            client_key=client_key,
        )
    except analytics_service.EventTypeNotAllowed as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "EVENT_TYPE_NOT_ALLOWED", "message": "這個事件類型不能由公開端點回報"},
        ) from exc
    except analytics_service.RateLimited as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="請求太頻繁"
        ) from exc
    await db.commit()


class TelemetryIn(BaseModel):
    """與 web/shared/telemetry.ts 的 validateTelemetry 同一套規則：web 端先驗過、
    這裡再驗一次，因為同源代理讓任何人都能直接打到這支公開端點。"""

    model_config = ConfigDict(extra="forbid")

    event: Literal["page_view", "visit_click", "LCP", "INP", "CLS"]
    page: Literal["home", "campus", "visit"]
    campus: Literal["yihua", "minghua", "chongde", "international", "renwu"] | None
    device: Literal["mobile", "desktop"]
    value: float | None = None
    id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _consistent(self) -> "TelemetryIn":
        if (self.page == "home" and self.campus is not None) or (self.page == "campus" and self.campus is None):
            raise ValueError("page 與 campus 不一致")
        if self.event in ("LCP", "INP", "CLS"):
            limit = 100 if self.event == "CLS" else 3_600_000
            if self.value is None or self.id is None or not (0 <= self.value <= limit):
                raise ValueError("效能指標需要合理的 value 與 id")
        elif self.value is not None or self.id is not None:
            raise ValueError("非效能事件不接受 value／id")
        return self


# 單一來源每分鐘上限；正常瀏覽一頁約 1 筆瀏覽＋3–6 筆效能回報。
TELEMETRY_LIMIT = ratelimit.Limit("telemetry", window_seconds=60, max_per_window=120)


@router.post("/public/telemetry", status_code=status.HTTP_204_NO_CONTENT)
async def record_telemetry(
    payload: TelemetryIn,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    try:
        await ratelimit.limiter(request).check(TELEMETRY_LIMIT, ratelimit.client_key(request))
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="請求太頻繁",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    if payload.event == "page_view":
        await traffic_service.record_page_view(db, page=payload.page, campus_key=payload.campus, device=payload.device)
    elif payload.event in ("LCP", "INP", "CLS"):
        assert payload.id is not None and payload.value is not None
        await traffic_service.record_web_vital(
            db, sample_id=payload.id, metric=payload.event, page=payload.page,
            campus_key=payload.campus, device=payload.device, value=payload.value,
        )
    # visit_click 只留在 web 的日誌；預約轉換看「預約流程」的漏斗。
    await db.commit()


@router.get("/admin/analytics/traffic")
async def get_traffic(
    days: int = Query(28, ge=7, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    # 全站匿名彙總（沒有個資、也不分權限範圍），登入的後台帳號都能看。
    return await traffic_service.get_traffic_summary(db, days)


@router.get("/admin/dashboard")
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    scope = campus_scope(current_user)
    campus_keys = None if scope is None else sorted(scope)
    summary = await dashboard_service.get_dashboard_summary(
        db, campus_keys, include_shared_reviews=can_publish_shared_content(current_user)
    )
    if not has_capability(current_user, "booking.read"):
        # 今日名單帶家長姓名；沒有案件讀取權的角色只看數字。
        summary["today_visit_list"] = []
    # 給自己的站內通知（送審、核准或退回、排程沒有執行）還沒讀的則數，側欄
    # 「站內通知」旁的數字用；內容編輯也會讀這支 API。
    summary["my_unread_notifications"] = (
        await db.execute(
            select(func.count())
            .select_from(UserNotification)
            .where(UserNotification.recipient_user_id == current_user.id, UserNotification.read_at.is_(None))
        )
    ).scalar_one()
    return summary


class FunnelSourceOut(BaseModel):
    # 案件來源（web／phone／line／walk_in／external）；unknown＝2026-09-25 以前的事件。
    source: str
    counts: dict[str, int]


class FunnelReferralOut(BaseModel):
    # 「從哪裡知道我們」（可複選）；none＝沒填、unknown＝舊事件。
    referral: str
    counts: dict[str, int]


class FunnelEntryOut(BaseModel):
    # 入口代碼（見 CTA_ENTRIES）；unknown＝舊事件或沒帶入口的點擊。
    entry: str
    counts: dict[str, int]


class AnalyticsFunnelOut(BaseModel):
    campus_key: str
    date_from: date | None
    date_to: date | None
    # 每一種事件類型都有鍵（沒有事件為 0）。
    counts: dict[str, int]
    # visit_cancelled 依原因：parent／staff／hold_expired；unknown＝舊事件。
    cancelled_by_reason: dict[str, int]
    # 伺服器事件（建案、確認、完成、取消）依來源分組。
    by_source: list[FunnelSourceOut]
    by_referral: list[FunnelReferralOut]
    # 公開點擊依入口分組。
    clicks_by_entry: list[FunnelEntryOut]
    # 不分校的點擊（首頁頁首往預約總頁等）。只有看得到全部校區的人才有值，
    # 其他人為 null。
    unassigned_clicks: dict[str, int] | None = None


# 日期區間最長一年多一點，夠看一整個招生季，也不會一次掃太多年。
FUNNEL_MAX_DAYS = 400


@router.get("/admin/analytics/funnel", response_model=AnalyticsFunnelOut)
async def get_analytics_funnel(
    campus_key: str,
    date_from: date | None = Query(None, alias="from", description="台北日期（含），省略＝不限"),
    date_to: date | None = Query(None, alias="to", description="台北日期（含），省略＝不限"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    require_scope(current_user, "analytics.read", campus_keys=[campus_key])
    if date_from is not None and date_to is not None:
        if date_from > date_to:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "INVALID_DATE_RANGE", "message": "開始日期不能晚於結束日期"},
            )
        if (date_to - date_from).days + 1 > FUNNEL_MAX_DAYS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "INVALID_DATE_RANGE", "message": f"日期區間最長 {FUNNEL_MAX_DAYS} 天"},
            )
    period = analytics_service.FunnelRange(date_from, date_to)
    funnel = await analytics_service.get_campus_funnel(db, campus_key, period)
    if campus_scope(current_user) is None:
        funnel["unassigned_clicks"] = await analytics_service.get_unassigned_clicks(db, period)
    return funnel


@router.get("/admin/audit-log")
async def get_audit_log(
    campus_key: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict]:
    if campus_key:
        require_scope(current_user, "booking.read", campus_keys=[campus_key])
    else:
        require_scope(current_user, "audit.read_all")
    entries = await audit_service.list_recent(db, campus_key)
    return [
        {
            "id": str(e.id),
            "actor_user_id": str(e.actor_user_id) if e.actor_user_id else None,
            "action": e.action,
            "target_type": e.target_type,
            "target_id": e.target_id,
            "campus_key": e.campus_key,
            "metadata": e.metadata_json,
            "created_at": e.created_at.isoformat(),
        }
        for e in entries
    ]


# 舊的「全站設定」單列：官網與後端都不讀它。官網的描述、分享圖與是否允許
# 收錄以 site_meta 內容（有草稿與發布流程）為唯一來源，家長同意的版本記在
# 案件的 consent_revision_id。端點保留給舊資料相容，後台已不再使用。
class SiteSettingsUpdate(BaseModel):
    title: str
    description: str
    share_image: str | None = None
    noindex: bool
    privacy_policy_version: str


async def _get_or_create_settings(db: AsyncSession) -> SiteSettings:
    result = await db.execute(select(SiteSettings).where(SiteSettings.id == 1))
    settings = result.scalar_one_or_none()
    if settings is None:
        settings = SiteSettings(id=1, updated_at=datetime.now(timezone.utc))
        db.add(settings)
        await db.flush()
    return settings


@router.get("/admin/site-settings", deprecated=True)
async def get_site_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    require_scope(current_user, "content.read")
    settings = await _get_or_create_settings(db)
    await db.commit()
    return {
        "title": settings.title,
        "description": settings.description,
        "share_image": settings.share_image,
        "noindex": settings.noindex,
        "privacy_policy_version": settings.privacy_policy_version,
    }


@router.patch("/admin/site-settings", deprecated=True)
async def update_site_settings(
    payload: SiteSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    require_scope(current_user, "site_settings.manage")
    settings = await _get_or_create_settings(db)
    settings.title = payload.title
    settings.description = payload.description
    settings.share_image = payload.share_image
    settings.noindex = payload.noindex
    settings.privacy_policy_version = payload.privacy_policy_version
    settings.updated_at = datetime.now(timezone.utc)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="site_settings.update",
        target_type="site_settings",
        target_id="1",
        metadata={"noindex": payload.noindex, "privacy_policy_version": payload.privacy_policy_version},
    )
    await db.commit()
    return {
        "title": settings.title,
        "description": settings.description,
        "share_image": settings.share_image,
        "noindex": settings.noindex,
        "privacy_policy_version": settings.privacy_policy_version,
    }


@router.post("/admin/retention/dry-run")
async def retention_dry_run(
    older_than_days: int = 365,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    require_scope(current_user, "retention.manage")
    return await retention_service.run_retention_sweep(db, older_than_days=older_than_days, dry_run=True)


@router.post("/admin/retention/run")
async def retention_run(
    request: Request,
    older_than_days: int = 365,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """預設環境不允許真的清理（WEBSITE_RETENTION_ALLOW_REAL_RUN 需明確
    設為 true），避免意外把個資清掉。"""
    require_scope(current_user, "retention.manage")

    settings = request.app.state.settings
    if not settings.retention_allow_real_run:
        preview = await retention_service.run_retention_sweep(
            db, older_than_days=older_than_days, dry_run=True
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "RETENTION_REAL_RUN_DISABLED",
                "message": "預設不開放真正清理，需設定 WEBSITE_RETENTION_ALLOW_REAL_RUN=true",
                "dry_run_preview": preview,
            },
        )

    result = await retention_service.run_retention_sweep(
        db, older_than_days=older_than_days, dry_run=False
    )
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="retention.run",
        target_type="visit_requests",
        target_id="bulk",
        metadata={"older_than_days": older_than_days, "candidate_count": result["candidate_count"]},
    )
    await db.commit()
    return result
