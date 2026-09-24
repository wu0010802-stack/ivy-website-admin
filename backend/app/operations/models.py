from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AnalyticsEventType(str, enum.Enum):
    # 點擊類：只有這幾種能透過公開端點自己回報。
    CTA_CLICK_LINE = "cta_click_line"
    CTA_CLICK_PHONE = "cta_click_phone"
    CTA_CLICK_EXTERNAL = "cta_click_external"
    # 成效類：只能由伺服器在對應的業務流程裡產生，絕不接受公開端點
    # 直接回報——否則任何人都可以偽造「已預約」的統計數字。
    REQUEST_CREATED = "request_created"
    VISIT_CONFIRMED = "visit_confirmed"
    VISIT_COMPLETED = "visit_completed"


PUBLIC_REPORTABLE_EVENT_TYPES = {
    AnalyticsEventType.CTA_CLICK_LINE,
    AnalyticsEventType.CTA_CLICK_PHONE,
    AnalyticsEventType.CTA_CLICK_EXTERNAL,
}


class AnalyticsEvent(Base):
    """去識別化的成效事件；不存訪客個資，`campus_key` 可為 null
    代表跨校事件（目前沒有這種情境，保留彈性）。"""

    __tablename__ = "analytics_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    event_type: Mapped[AnalyticsEventType] = mapped_column(
        Enum(AnalyticsEventType, name="analytics_event_type"), nullable=False
    )
    campus_key: Mapped[str | None] = mapped_column(
        ForeignKey("campuses.key", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


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
    """管理操作稽核；`metadata_json` 只放非個資摘要（例如「mode 從
    inquiry 改成 paused」），不記完整表單內容。"""

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
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
