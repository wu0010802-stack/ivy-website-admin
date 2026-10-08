from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import follow_up as admissions_follow_up
from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.admissions.constants import SCHOOL_YEAR_MAX, SCHOOL_YEAR_MIN
from app.admissions.schemas import AdmissionsRate
from app.auth.permissions import (
    campus_scope,
    can_edit_shared_content,
    can_publish_shared_content,
    covers_campus,
    has_capability,
    require_scope,
)
from app.campuses.models import CAMPUS_KEYS, Campus
from app.common import ratelimit
from app.common.timezones import local_day_bounds_utc, now_utc, today_local
from app.notifications.models import UserNotification
from app.operations import (
    analytics_service,
    audit_service,
    booking_outcomes_service,
    dashboard_service,
    public_caps,
    retention_service,
    traffic_service,
)
from app.operations.models import (
    CTA_ENTRIES,
    RETENTION_MAX_DAYS,
    RETENTION_MIN_DAYS,
    RetentionPolicy,
    RetentionRunTrigger,
)

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


def _trusted_source(request: Request) -> str | None:
    """每來源每日上限的 key；代理沒帶訪客 IP 時為 None（不套用，免得全站共用一桶）。"""
    return ratelimit.client_key(request) if ratelimit.trusted_client_ip(request) else None


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
            # 單一來源之外的全站每分鐘、每來源每日與全站每日上限；滿了安靜丟棄（仍回 204）。
            caps=public_caps.click_limits(request.app.state.settings, _trusted_source(request)),
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
    # 2026-09-30 起公開內頁（關於、特色教學、環境、入學、最新消息）也回報；消息內文頁一律記成 news。
    # 2026-10-04 加 30 週年分頁（anniversary）。
    page: Literal["home", "campus", "visit", "about", "curriculum", "environment", "admission", "news", "anniversary"]
    campus: Literal["yihua", "minghua", "chongde", "international", "renwu"] | None
    device: Literal["mobile", "desktop"]
    value: float | None = None
    id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _consistent(self) -> "TelemetryIn":
        # 只有分校頁一定帶校、預約頁可帶可不帶；首頁與內頁都不帶
        if (self.page not in ("campus", "visit") and self.campus is not None) or (self.page == "campus" and self.campus is None):
            raise ValueError("page 與 campus 不一致")
        if self.event in ("LCP", "INP", "CLS"):
            limit = 100 if self.event == "CLS" else 3_600_000
            if self.value is None or self.id is None or not (0 <= self.value <= limit):
                raise ValueError("效能指標需要合理的 value 與 id")
        elif self.value is not None or self.id is not None:
            raise ValueError("非效能事件不接受 value／id")
        return self


# 單一來源每分鐘上限；正常瀏覽一頁約 1 筆瀏覽＋3–6 筆效能回報。另有全站
# 每分鐘、每來源每日與全站每日上限（public_caps），滿了安靜丟棄。
TELEMETRY_LIMIT = ratelimit.Limit("telemetry", window_seconds=60, max_per_window=120)


@router.post("/public/telemetry", status_code=status.HTTP_204_NO_CONTENT)
async def record_telemetry(
    payload: TelemetryIn,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    # 單一來源上限（被擋回 429）與全站／每來源每日上限（被擋安靜丟棄回 204）在
    # 同一個限流交易內依序檢查。visit_click 只留在 web 的日誌；預約轉換看「預約
    # 流程」的漏斗。不寫資料庫，也不佔全站上限。
    caps = () if payload.event == "visit_click" else public_caps.telemetry_limits(
        request.app.state.settings, _trusted_source(request)
    )
    try:
        admitted = await public_caps.admit(
            ratelimit.limiter(request), caps, gate=(TELEMETRY_LIMIT, ratelimit.client_key(request))
        )
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="請求太頻繁",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    if not admitted or payload.event == "visit_click":
        return
    if payload.event == "page_view":
        await traffic_service.record_page_view(db, page=payload.page, campus_key=payload.campus, device=payload.device)
    elif payload.event in ("LCP", "INP", "CLS"):
        assert payload.id is not None and payload.value is not None
        await traffic_service.record_web_vital(
            db, sample_id=payload.id, metric=payload.event, page=payload.page,
            campus_key=payload.campus, device=payload.device, value=payload.value,
        )
    await db.commit()


@router.get("/admin/analytics/traffic")
async def get_traffic(
    days: int = Query(28, ge=7, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    # 全站匿名彙總（沒有個資、也不分權限範圍），登入的後台帳號都能看。
    summary = await traffic_service.get_traffic_summary(db, days)
    summary["as_of"] = now_utc()
    return summary


@router.get("/admin/dashboard")
async def get_dashboard(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    scope = campus_scope(current_user)
    campus_keys = None if scope is None else sorted(scope)
    summary = await dashboard_service.get_dashboard_summary(
        db,
        campus_keys,
        include_shared_content=can_edit_shared_content(current_user),
        include_shared_reviews=can_publish_shared_content(current_user),
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
    # 招生待追蹤（2026-10-04 參觀後追蹤規格 7.7）：招生入學開啟且看得到招生的人才有這兩個鍵；
    # 條件與招生「待追蹤」分頁的已到期相同（admissions/follow_up.py）。
    if request.app.state.settings.admissions_enabled and has_capability(current_user, "admissions.read"):
        by_campus = await admissions_follow_up.due_counts(db, campus_keys)
        summary["admissions_follow_up_due"] = sum(by_campus.values())
        summary["admissions_follow_up_due_by_campus"] = by_campus
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
    # 伺服器產生這份統計的時間（畫面寫「更新」）。
    as_of: datetime
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


def _validate_range(date_from: date | None, date_to: date | None) -> None:
    """成效統計共用的台北日期區間檢查（兩端都有才檢查）。"""
    if date_from is None or date_to is None:
        return
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


@router.get("/admin/analytics/funnel", response_model=AnalyticsFunnelOut)
async def get_analytics_funnel(
    campus_key: str,
    date_from: date | None = Query(None, alias="from", description="台北日期（含），省略＝不限"),
    date_to: date | None = Query(None, alias="to", description="台北日期（含），省略＝不限"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    require_scope(current_user, "analytics.read", campus_keys=[campus_key])
    _validate_range(date_from, date_to)
    period = analytics_service.FunnelRange(date_from, date_to)
    funnel = await analytics_service.get_campus_funnel(db, campus_key, period)
    if campus_scope(current_user) is None:
        funnel["unassigned_clicks"] = await analytics_service.get_unassigned_clicks(db, period)
    funnel["as_of"] = now_utc()
    return funnel


class OutcomeCountsOut(BaseModel):
    """一批預約案件（期間內送出）現在的結果；各結果加總＝cases。單位是預約案件，
    同一個孩子預約兩校算兩筆，不依電話合併。"""

    cases: int
    # 官網表單送出的；其餘是後台補登（電話、LINE、親自到園、外部網站）。
    web_cases: int
    # 已確認、場次還沒開始。
    upcoming: int
    # 已確認、場次已開始，還沒標記到場或未到場。
    awaiting_attendance: int
    completed: int
    no_show: int
    cancelled: int
    # parent／staff／hold_expired／unknown（舊案沒記原因）。
    cancelled_by_reason: dict[str, int]
    # 已到場 ÷（已到場＋未到場）；還沒標記的不算進分母。
    attendance_rate: AdmissionsRate
    no_show_rate: AdmissionsRate
    # 已取消 ÷ cases。
    cancel_rate: AdmissionsRate


class PendingNowOut(BaseModel):
    """現在的待處理兩種（booking/pending_kinds.py），不受期間影響。"""

    awaiting_attendance: int
    follow_up_due: int


class CampusOutcomeOut(OutcomeCountsOut):
    campus_key: str
    active: bool
    # booking_configs.mode；還沒設定過為 null。
    booking_mode: str | None
    open_now: PendingNowOut


class BookingOutcomesOut(BaseModel):
    as_of: datetime
    date_from: date | None
    date_to: date | None
    unit: Literal["visit_request"]
    # 只有授權範圍內的校區，順序同 CAMPUS_KEYS。
    campuses: list[CampusOutcomeOut]
    totals: OutcomeCountsOut
    open_now_totals: PendingNowOut


@router.get("/admin/analytics/booking-outcomes", response_model=BookingOutcomesOut)
async def get_booking_outcomes(
    date_from: date | None = Query(None, alias="from", description="送出日期起（台北，含），省略＝不限"),
    date_to: date | None = Query(None, alias="to", description="送出日期迄（台北，含），省略＝不限"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """五校並排與各校的預約結果（去識別統計）。只列授權範圍內的校區，沒有校區參數。"""
    require_scope(current_user, "analytics.read")
    _validate_range(date_from, date_to)
    campus_keys = [key for key in CAMPUS_KEYS if covers_campus(current_user, key)]
    return await booking_outcomes_service.booking_outcomes(
        db, campus_keys, analytics_service.FunnelRange(date_from, date_to)
    )


class EventTrendDayOut(BaseModel):
    day: date
    request_created: int
    visit_completed: int
    visit_cancelled: int
    # 四種預約鈕點擊的合計（表單、LINE、電話、外部網站）。
    clicks: int


class EventTrendOut(BaseModel):
    as_of: datetime
    campus_key: str
    # 實際畫出的區間（沒給開始日＝從這校第一筆事件那天起）。
    date_from: date
    date_to: date
    # 超過 400 天時只回最近 400 天。
    truncated: bool
    unit: Literal["event"]
    # 每天一列，沒有事件的日子也列（全是 0）。
    days: list[EventTrendDayOut]


@router.get("/admin/analytics/event-trend", response_model=EventTrendOut)
async def get_event_trend(
    campus_key: str,
    date_from: date | None = Query(None, alias="from", description="台北日期（含），省略＝從第一筆事件"),
    date_to: date | None = Query(None, alias="to", description="台北日期（含），省略＝今天"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    require_scope(current_user, "analytics.read", campus_keys=[campus_key])
    _validate_range(date_from, date_to)
    trend = await analytics_service.get_event_trend(
        db, campus_key, analytics_service.FunnelRange(date_from, date_to), today_local()
    )
    return {**trend, "as_of": now_utc(), "unit": "event"}


class GradeCountOut(BaseModel):
    grade: str
    count: int


class ClassDistributionOut(BaseModel):
    as_of: datetime
    campus_key: str
    date_from: date | None
    date_to: date | None
    school_year: int
    unit: Literal["visit_request"]
    total: int
    # 幼幼班～大班固定四列（0 也列）。
    grades: list[GradeCountOut]
    # 有生日但不在幼幼班～大班。
    out_of_range: int
    # 沒有生日：舊案只有年齡文字、補登沒問，或已匿名化。
    unrecorded: int


@router.get("/admin/analytics/class-distribution", response_model=ClassDistributionOut)
async def get_class_distribution(
    campus_key: str,
    school_year: int = Query(ge=SCHOOL_YEAR_MIN, le=SCHOOL_YEAR_MAX, description="換算用的民國學年度"),
    date_from: date | None = Query(None, alias="from", description="送出日期起（台北，含）"),
    date_to: date | None = Query(None, alias="to", description="送出日期迄（台北，含）"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    require_scope(current_user, "analytics.read", campus_keys=[campus_key])
    _validate_range(date_from, date_to)
    return await booking_outcomes_service.class_distribution(
        db, campus_key, analytics_service.FunnelRange(date_from, date_to), school_year
    )


class AuditLogEntryOut(BaseModel):
    """操作紀錄一筆。actor_*、target_label 是讀取當下 join users 查出來的，
    不存在稽核表裡（metadata 不放同事的 email 或名字）。"""

    id: uuid.UUID
    actor_user_id: uuid.UUID | None
    # 誰做的：系統定期工作或帳號已刪除時為 null。
    actor_email: str | None
    actor_display_name: str | None
    action: str
    target_type: str
    target_id: str
    # 對哪個帳號（target_type 為 user 時）：對方的顯示名稱，沒填就用 email；
    # 其他對象或找不到帳號時為 null。
    target_label: str | None
    # 對參觀案件（target_type 為 visit_request）時：那筆案件現在還在不在，
    # 個資清理刪掉的案件為 false；其他對象為 null。不帶家長個資。
    target_exists: bool | None = None
    campus_key: str | None
    metadata: dict
    created_at: datetime
    # 操作當下的來源；2026-10-06 之前的紀錄、背景工作都是 null。IP 只給總部
    # （audit.read_all）看，其他人一律 null；User-Agent 都給，後台解析成裝置。
    ip_address: str | None = None
    user_agent: str | None = None


def _as_utc(value: datetime) -> datetime:
    # 沒帶時區的游標當成 UTC（API 回的 created_at 都有時區）。
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


@router.get("/admin/audit-log", response_model=list[AuditLogEntryOut])
async def get_audit_log(
    campus_key: str | None = None,
    before: datetime | None = Query(None, description="上一頁最後一筆的 created_at；和 before_id 一起傳，讀更早的紀錄"),
    before_id: uuid.UUID | None = Query(None, description="上一頁最後一筆的 id"),
    exclude_login: bool = Query(False, description="不列例行的登入登出（登入失敗、帳號鎖定照列）"),
    created_from: date | None = Query(None, description="紀錄日期起（含），台灣日期"),
    created_to: date | None = Query(None, description="紀錄日期迄（含），台灣日期"),
    limit: int = Query(100, ge=1, le=500, description="一次幾筆；後台匯出時用 500 減少來回"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[AuditLogEntryOut]:
    """新的在前，一次最多 limit 筆；要更早的就帶上一頁最後一筆的 before／before_id。"""
    if campus_key:
        require_scope(current_user, "booking.read", campus_keys=[campus_key])
    else:
        require_scope(current_user, "audit.read_all")
    if (before is None) != (before_id is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_CURSOR", "message": "before 與 before_id 要一起傳"},
        )
    if created_from and created_to and created_from > created_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_DATE_RANGE", "message": "開始日期不能晚於結束日期"},
        )
    rows = await audit_service.list_recent(
        db,
        campus_key,
        limit=limit,
        before=(_as_utc(before), before_id) if before is not None and before_id is not None else None,
        exclude_login=exclude_login,
        since=local_day_bounds_utc(created_from)[0] if created_from else None,
        until=local_day_bounds_utc(created_to)[1] if created_to else None,
    )
    show_ip = has_capability(current_user, "audit.read_all")
    return [
        AuditLogEntryOut(
            id=row.entry.id,
            actor_user_id=row.entry.actor_user_id,
            actor_email=row.actor_email,
            actor_display_name=row.actor_display_name,
            action=row.entry.action,
            target_type=row.entry.target_type,
            target_id=row.entry.target_id,
            target_label=row.target_label,
            target_exists=row.target_exists,
            campus_key=row.entry.campus_key,
            metadata=row.entry.metadata_json or {},
            created_at=row.entry.created_at,
            ip_address=row.entry.ip_address if show_ip else None,
            user_agent=row.entry.user_agent,
        )
        for row in rows
    ]


class RetentionDaysOut(BaseModel):
    # 已取消、未到場：結案後幾天匿名化。
    cancelled_days: int
    # 已完成參觀：結案後幾天匿名化。
    completed_days: int
    # 送出超過幾天仍未結案就列入提醒（不會被清理）。
    open_overdue_days: int
    # 招生訪視：最後更新後幾天匿名化；None＝不自動清理（預設，天數待業主裁定）。
    # 舊的清理紀錄沒有這個鍵，讀出來也是 None。
    admissions_days: int | None = None


class RetentionCountsOut(BaseModel):
    # 各狀態到期、會被（或已被）匿名化的件數。
    cancelled: int = 0
    no_show: int = 0
    completed: int = 0
    # 招生訪視；沒設定天數時不清，為 0。
    admissions: int = 0


class RetentionReportOut(BaseModel):
    days: RetentionDaysOut
    counts: RetentionCountsOut
    total: int
    # 超過 open_overdue_days 但還沒結案、不會被清的件數。
    open_overdue_count: int
    dry_run: bool
    # 有留紀錄（真的執行）時是那一筆 retention_runs 的 id。
    run_id: uuid.UUID | None = None


class RetentionPolicyOut(RetentionDaysOut):
    auto_run_enabled: bool
    version: int
    updated_at: datetime | None
    updated_by_email: str | None
    updated_by_display_name: str | None = None
    last_scheduled_on: date | None
    # 部署設定 WEBSITE_RETENTION_ALLOW_REAL_RUN；關閉時自動與手動都只能試算。
    real_run_allowed: bool
    # 依目前天數、現在執行會處理幾筆（試算，不留紀錄）。
    preview: RetentionReportOut


class RetentionPolicyUpdate(BaseModel):
    expected_version: int = Field(ge=1)
    cancelled_days: int = Field(ge=RETENTION_MIN_DAYS, le=RETENTION_MAX_DAYS)
    completed_days: int = Field(ge=RETENTION_MIN_DAYS, le=RETENTION_MAX_DAYS)
    open_overdue_days: int = Field(ge=RETENTION_MIN_DAYS, le=RETENTION_MAX_DAYS)
    auto_run_enabled: bool
    # 只有請求帶了這個鍵才寫入（model_fields_set）：後台保存政策頁加上這個欄位
    # 之前（B6），現行畫面存檔不會把它清成 NULL。送 null＝不自動清理。
    admissions_days: int | None = Field(default=None, ge=RETENTION_MIN_DAYS, le=RETENTION_MAX_DAYS)


class RetentionRunOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    # manual＝總管理者在後台按下執行、scheduled＝定期工作。
    trigger: str
    actor_email: str | None
    actor_display_name: str | None = None
    days: RetentionDaysOut
    counts: RetentionCountsOut
    total: int
    open_overdue_count: int


def _report_out(report: retention_service.RetentionReport) -> RetentionReportOut:
    return RetentionReportOut(
        days=RetentionDaysOut(**report.days),
        counts=RetentionCountsOut(**report.counts),
        total=report.total,
        open_overdue_count=report.open_overdue_count,
        dry_run=report.dry_run,
        run_id=report.run_id,
    )


async def _policy_out(db: AsyncSession, request: Request, policy: RetentionPolicy) -> RetentionPolicyOut:
    days = retention_service.policy_days(policy)
    editor = await db.get(User, policy.updated_by) if policy.updated_by else None
    return RetentionPolicyOut(
        **days,
        auto_run_enabled=policy.auto_run_enabled,
        version=policy.version,
        updated_at=policy.updated_at,
        updated_by_email=editor.email if editor else None,
        updated_by_display_name=editor.display_name if editor else None,
        last_scheduled_on=policy.last_scheduled_on,
        real_run_allowed=request.app.state.settings.retention_allow_real_run,
        preview=_report_out(await retention_service.preview(db, days)),
    )


@router.get("/admin/site-policies/retention", response_model=RetentionPolicyOut)
async def get_retention_policy(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RetentionPolicyOut:
    """個資保存政策（規格 L282）：已取消／未到場、已完成的保留天數，未結案
    提醒天數，是否每天自動清理，以及依目前天數試算會處理幾筆。"""
    require_scope(current_user, "retention.manage")
    policy = await retention_service.get_policy(db)
    out = await _policy_out(db, request, policy)
    await db.commit()
    return out


@router.put("/admin/site-policies/retention", response_model=RetentionPolicyOut)
async def update_retention_policy(
    payload: RetentionPolicyUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RetentionPolicyOut:
    require_scope(current_user, "retention.manage")
    policy = await retention_service.get_policy(db, for_update=True)
    if policy.version != payload.expected_version:
        current = policy.version
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "RETENTION_POLICY_VERSION_CONFLICT",
                "message": "保存政策剛被其他人修改，請重新載入後再編輯",
                "current_version": current,
            },
        )
    before = {**retention_service.policy_days(policy), "auto_run_enabled": policy.auto_run_enabled}
    policy.cancelled_days = payload.cancelled_days
    policy.completed_days = payload.completed_days
    policy.open_overdue_days = payload.open_overdue_days
    policy.auto_run_enabled = payload.auto_run_enabled
    if "admissions_days" in payload.model_fields_set:
        policy.admissions_days = payload.admissions_days
    after = {**retention_service.policy_days(policy), "auto_run_enabled": policy.auto_run_enabled}
    if after != before:
        policy.version += 1
        policy.updated_at = datetime.now(timezone.utc)
        policy.updated_by = current_user.id
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="retention_policy.update",
            target_type="retention_policy",
            target_id="1",
            metadata={"before": before, "after": after},
        )
    await db.flush()
    out = await _policy_out(db, request, policy)
    await db.commit()
    return out


@router.post("/admin/retention/dry-run", response_model=RetentionReportOut)
async def retention_dry_run(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RetentionReportOut:
    """依保存政策的天數試算，不改資料、不留紀錄。"""
    require_scope(current_user, "retention.manage")
    policy = await retention_service.get_policy(db)
    report = await retention_service.preview(db, retention_service.policy_days(policy))
    await db.commit()
    return _report_out(report)


@router.post("/admin/retention/run", response_model=RetentionReportOut)
async def retention_run(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> RetentionReportOut:
    """依保存政策的天數立即匿名化，並留一筆清理紀錄。預設環境不允許真的
    清理（WEBSITE_RETENTION_ALLOW_REAL_RUN 需明確設為 true），避免意外把
    個資清掉。"""
    require_scope(current_user, "retention.manage")
    # 鎖政策列：兩個人同時按執行（或剛好碰上定期工作）時排隊，不會重複處理。
    policy = await retention_service.get_policy(db, for_update=True)
    days = retention_service.policy_days(policy)

    settings = request.app.state.settings
    if not settings.retention_allow_real_run:
        preview = await retention_service.preview(db, days)
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "RETENTION_REAL_RUN_DISABLED",
                "message": "部署設定沒有開放真正清理（WEBSITE_RETENTION_ALLOW_REAL_RUN），目前只能試算",
                "dry_run_preview": _report_out(preview).model_dump(mode="json"),
            },
        )

    report = await retention_service.run_sweep(
        db,
        days,
        trigger=RetentionRunTrigger.MANUAL,
        actor_user_id=current_user.id,
    )
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="retention.run",
        target_type="visit_requests",
        target_id="bulk",
        metadata=retention_service.audit_metadata(report, RetentionRunTrigger.MANUAL),
    )
    await db.commit()
    return _report_out(report)


@router.get("/admin/retention-runs", response_model=list[RetentionRunOut])
async def list_retention_runs(
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[RetentionRunOut]:
    """真正執行過的清理紀錄（手動與定期工作；試算不留紀錄），最新的在前。"""
    require_scope(current_user, "retention.manage")
    runs = await retention_service.list_runs(db, limit=limit)
    actor_ids = {run.actor_user_id for run in runs if run.actor_user_id}
    actors: dict = {}
    if actor_ids:
        result = await db.execute(select(User.id, User.email, User.display_name).where(User.id.in_(actor_ids)))
        actors = {user_id: (email, display_name) for user_id, email, display_name in result.all()}
    return [
        RetentionRunOut(
            id=run.id,
            created_at=run.created_at,
            trigger=run.trigger,
            actor_email=actors.get(run.actor_user_id, (None, None))[0],
            actor_display_name=actors.get(run.actor_user_id, (None, None))[1],
            days=RetentionDaysOut(**run.policy),
            counts=RetentionCountsOut(**run.counts),
            total=run.total,
            open_overdue_count=run.open_overdue_count,
        )
        for run in runs
    ]
