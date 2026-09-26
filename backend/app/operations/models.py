from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, Date, DateTime, Enum, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AnalyticsEventType(str, enum.Enum):
    # 點擊類：只有這幾種能透過公開端點自己回報。booking_cta_clicked 是點了
    # 往官網預約表單的按鈕（規格 L277）；其餘三種是預約方式為 LINE／電話／
    # 外部網站時的聯絡連結點擊（規格的 contact_link_clicked，依管道分開計）。
    BOOKING_CTA_CLICKED = "booking_cta_clicked"
    CTA_CLICK_LINE = "cta_click_line"
    CTA_CLICK_PHONE = "cta_click_phone"
    CTA_CLICK_EXTERNAL = "cta_click_external"
    # 成效類：只能由伺服器在對應的業務流程裡產生，絕不接受公開端點
    # 直接回報——否則任何人都可以偽造「已預約」的統計數字。
    REQUEST_CREATED = "request_created"
    VISIT_CONFIRMED = "visit_confirmed"
    VISIT_COMPLETED = "visit_completed"
    VISIT_CANCELLED = "visit_cancelled"


PUBLIC_REPORTABLE_EVENT_TYPES = {
    AnalyticsEventType.BOOKING_CTA_CLICKED,
    AnalyticsEventType.CTA_CLICK_LINE,
    AnalyticsEventType.CTA_CLICK_PHONE,
    AnalyticsEventType.CTA_CLICK_EXTERNAL,
}

# 公開點擊的入口代碼：按鈕在官網哪個區塊。白名單要和
# web/app/utils/cta-analytics.ts 的 CTA_ENTRIES 一致（web 測試會比對），
# 後台 labels.ts 的 CTA_ENTRY_LABELS 也要有中文（admin 測試會比對）。
CTA_ENTRIES = (
    "header",
    "menu",
    "footer",
    "home_campus_board",
    "campus_hero",
    "campus_info",
    "campus_contact",
    "campus_banner",
    "campus_tour",
    "admission",
    "environment",
    "curriculum",
    "visit_page",
    "visit_manage",
    "other",
)

# visit_cancelled 的取消原因：家長用管理連結取消、園方在後台取消、
# 人工待確認的占位逾期由定期工作取消。
CANCEL_REASON_PARENT = "parent"
CANCEL_REASON_STAFF = "staff"
CANCEL_REASON_HOLD_EXPIRED = "hold_expired"
CANCEL_REASONS = (CANCEL_REASON_PARENT, CANCEL_REASON_STAFF, CANCEL_REASON_HOLD_EXPIRED)


class AnalyticsEvent(Base):
    """去識別化的成效事件；不存訪客個資，也不指回案件。`campus_key` 為 null
    代表不分校的點擊（例如頁首的預約鈕）。

    - `event_id`：公開點擊由瀏覽器產生的 UUID，唯一；同一個點擊重送只記一次。
      伺服器產生的事件為 NULL。
    - `entry`：公開點擊的入口代碼（見 CTA_ENTRIES）。
    - `source`、`referral_sources`：伺服器事件當下案件的來源與「從哪裡知道
      我們」的快照，統計依來源分組用；之後匿名化案件也不影響統計。
    - `reason`：visit_cancelled 的取消原因（見 CANCEL_REASONS）。
    2026-09-25 以前的事件這幾欄都是 NULL。"""

    __tablename__ = "analytics_events"
    __table_args__ = (
        UniqueConstraint("event_id", name="uq_analytics_events_event_id"),
        Index("ix_analytics_events_campus_created", "campus_key", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_type: Mapped[AnalyticsEventType] = mapped_column(
        Enum(AnalyticsEventType, name="analytics_event_type"), nullable=False
    )
    campus_key: Mapped[str | None] = mapped_column(
        ForeignKey("campuses.key", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    entry: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # none_as_null：Python 的 None 寫成 SQL NULL（沒有快照），不是 JSON 'null'；
    # 空陣列才代表案件沒填「從哪裡知道我們」。
    referral_sources: Mapped[list[str] | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(32), nullable=True)


class PageViewDaily(Base):
    """官網瀏覽量，按台北日期、頁面、校區、裝置累計成一列。不存 IP、cookie、
    路徑以外的任何訪客資訊，也不存單次瀏覽的時間點。"""

    __tablename__ = "page_view_daily"
    __table_args__ = (
        # campus_key 為 NULL（首頁、預約總頁）時 PostgreSQL 的唯一約束不會擋重複，
        # 所以用空字串代表「不分校」。
        UniqueConstraint("day", "page", "campus_key", "device", name="uq_page_view_daily_bucket"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    day: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    page: Mapped[str] = mapped_column(String(16), nullable=False)
    campus_key: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    device: Mapped[str] = mapped_column(String(16), nullable=False)
    views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class WebVitalSample(Base):
    """瀏覽器回報的 Core Web Vitals（LCP／INP／CLS）單筆樣本，用來算 p75。
    `id` 是瀏覽器端為每個指標產生的隨機 UUID：同一指標在頁面生命週期內會
    回報多次（CLS／INP 會變大），以 id upsert 成最後一次的值。保留 90 天。"""

    __tablename__ = "web_vital_samples"
    __table_args__ = (Index("ix_web_vital_samples_day_metric", "day", "metric"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    metric: Mapped[str] = mapped_column(String(8), nullable=False)
    page: Mapped[str] = mapped_column(String(16), nullable=False)
    campus_key: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    device: Mapped[str] = mapped_column(String(16), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AuditLogEntry(Base):
    """管理操作稽核；`metadata_json` 只放不含家長個資的摘要（例如「mode 從
    inquiry 改成 paused」）。分校公開設定（預約方式、學校電話、連結）可以記
    修改前後的完整值。"""

    __tablename__ = "audit_log_entries"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[str] = mapped_column(String(64), nullable=False)
    campus_key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SiteSettings(Base):
    """全站設定單例（id=1），比照 SiteState 的單列模式。"""

    __tablename__ = "site_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="常春藤幼兒園")
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    share_image: Mapped[str | None] = mapped_column(String(255), nullable=True)
    noindex: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    privacy_policy_version: Mapped[str] = mapped_column(String(32), nullable=False, default="draft-1")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# 規格 L282：個資保存期限可設定、預設不啟用自動清理。天數下限 30 天，避免
# 誤設成 0 把剛結案的案件立刻清掉。
RETENTION_MIN_DAYS = 30
RETENTION_MAX_DAYS = 3650
# 使用者 2026-09-25 裁定：各類都預設 365 天，要園方到保存政策頁確認後才會啟用。
DEFAULT_RETENTION_DAYS = 365


class RetentionPolicy(Base):
    """個資保存政策單例（id=1）。"""

    __tablename__ = "retention_policies"
    __table_args__ = (
        CheckConstraint(
            f"cancelled_days BETWEEN {RETENTION_MIN_DAYS} AND {RETENTION_MAX_DAYS} "
            f"AND completed_days BETWEEN {RETENTION_MIN_DAYS} AND {RETENTION_MAX_DAYS} "
            f"AND open_overdue_days BETWEEN {RETENTION_MIN_DAYS} AND {RETENTION_MAX_DAYS}",
            name="ck_retention_policies_days",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    # 已取消、未到場：結案（取消／標記未到場）後幾天匿名化。
    cancelled_days: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_RETENTION_DAYS)
    # 已完成參觀：標記完成後幾天匿名化。
    completed_days: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_RETENTION_DAYS)
    # 還沒結案的案件不會被清理；送出超過這個天數仍沒結案的，只算件數提醒
    # 園方先處理（open_overdue_count）。
    open_overdue_days: Mapped[int] = mapped_column(Integer, nullable=False, default=DEFAULT_RETENTION_DAYS)
    # 定期工作要不要每天自動匿名化；另外還要部署設定
    # WEBSITE_RETENTION_ALLOW_REAL_RUN=true，兩個都開才會執行。
    auto_run_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 定期工作上次執行的台灣日期；一天最多跑一次。
    last_scheduled_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class RetentionRunTrigger(str, enum.Enum):
    MANUAL = "manual"
    SCHEDULED = "scheduled"


class RetentionRun(Base):
    """每一次真正的清理留一筆（只試算不留）：什麼時候、手動或定期、誰（定期
    工作為 NULL）、當時的天數、各類幾筆。不記案件 id——匿名化之後也查不回
    是誰。"""

    __tablename__ = "retention_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    trigger: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # {"cancelled_days", "completed_days", "open_overdue_days"}
    policy: Mapped[dict] = mapped_column(JSON, nullable=False)
    # {"cancelled", "no_show", "completed"}：各類匿名化幾筆。
    counts: Mapped[dict] = mapped_column(JSON, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    # 當時超過天數但還沒結案、沒有清理的件數。
    open_overdue_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
