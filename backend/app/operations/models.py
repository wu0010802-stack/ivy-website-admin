from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, Date, DateTime, Enum, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
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
# 後台 analyticsLabels.ts 的 CTA_ENTRY_LABELS 也要有中文（admin 測試會比對）。
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
    "about",
    "news",
    "anniversary",
    "visit_page",
    "visit_manage",
    "other",
)

# visit_cancelled 的取消原因：家長用管理連結取消、園方在後台取消。hold_expired
# （人工待確認的占位逾期）的流程 2026-10-06 已拿掉，只剩舊的已取消案件與事件，
# 統計與後台照常顯示。
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


class ErrorGroup(Base):
    """官網前端、後台與 API 的未處理錯誤，同一種錯誤歸成一列（2026-11-05）。

    fingerprint＝sha256(source|kind|去掉參數的訊息|位置)，數字、十六進位串、UUID、引號內
    字串先換成佔位符，同一個錯誤帶不同參數仍歸同一組（見 operations/error_reports.py）。
    只存遮蔽過的訊息與堆疊，不存 IP、cookie、帳號、query string。`resolved_at` 是總管理者按
    「標為已處理」的時間；之後同一組又發生就清回 NULL（重新開啟）。`last_seen_at` 超過 90
    天的列刪除。"""

    __tablename__ = "error_groups"
    __table_args__ = (
        UniqueConstraint("fingerprint", name="uq_error_groups_fingerprint"),
        Index("ix_error_groups_last_seen_at", "last_seen_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    # web（官網）／admin（後台）／api（伺服器未處理例外）
    source: Mapped[str] = mapped_column(String(8), nullable=False)
    kind: Mapped[str] = mapped_column(String(120), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    # JS：堆疊第一個同源 frame 的「檔名:行:列」；Python：最後一個 app/ 底下 frame 的「module:function:lineno」。
    location: Mapped[str | None] = mapped_column(String(300), nullable=True)
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    release: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sample_stack: Mapped[str | None] = mapped_column(Text, nullable=True)
    sample_user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 上一次發出手機推播的時間（notifications/error_alerts.py）：15 分鐘內不重複通知同一組。
    alerted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditLogEntry(Base):
    """管理操作稽核；`metadata_json` 只放不含家長個資的摘要（例如「mode 從
    slots 改成 paused」）。分校公開設定（預約方式、學校電話、連結）可以記
    修改前後的完整值。"""

    __tablename__ = "audit_log_entries"
    __table_args__ = (
        # 稽核頁 keyset 分頁：ORDER BY created_at DESC, id DESC（有分校篩選時前面多一欄）。
        Index("ix_audit_log_entries_created_at_id", text("created_at DESC"), text("id DESC")),
        Index(
            "ix_audit_log_entries_campus_created_at_id", "campus_key", text("created_at DESC"), text("id DESC")
        ),
    )

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
    # 操作當下的來源（2026-10-06 起，之前的紀錄是 NULL）：官網代理帶進來的 IP
    # 與 User-Agent，見 app/common/client_info.py。背景工作、CLI 都是 NULL。
    # 只記後台同事的操作與登入，家長端的動作不寫稽核表。
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)


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
        CheckConstraint(
            f"admissions_days IS NULL OR admissions_days BETWEEN {RETENTION_MIN_DAYS} AND {RETENTION_MAX_DAYS}",
            name="ck_retention_policies_admissions_days",
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
    # 招生訪視（2026-10 招生入學規格 11）：最後更新後幾天匿名化。NULL＝不自動清理
    # （預設；天數待業主裁定）。
    admissions_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
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


# 內容興趣統計的來源分類：瀏覽器只回報這幾種代碼，不回報來源網址。要和
# web/shared/engagement.ts 的 ENGAGEMENT_SOURCES 一致（web 測試會比對），後台
# admin/src/api/engagement.ts 的 SOURCE_LABELS 也要有中文。
ENGAGEMENT_SOURCES = ("direct", "search", "facebook", "instagram", "line", "youtube", "ads", "other")
# 單次瀏覽的停留上限（30 分鐘）；分頁開著不動不會一直累計，瀏覽器端也只算有操作的時間。
ENGAGEMENT_MAX_ACTIVE_MS = 1_800_000
ENGAGEMENT_MAX_KEYS = 24
ENGAGEMENT_RETENTION_DAYS = 90
# 家長送出預約成功時，預約頁那一筆瀏覽會帶這個互動代碼（瀏覽器自己回報，只用來看
# 「看過什麼內容的造訪比較會預約」，不是正式的預約數；正式數字看預約漏斗）。
ENGAGEMENT_BOOKED_ACTION = "booking_done"
ENGAGEMENT_READ_ACTION = "read_end"
# 預約表單的進度（2026-11-11 第二輪）：預約頁那一筆瀏覽帶的互動代碼，依序是選了日期、選了場次、
# 開始填資料、按了送出；另外兩個是看到「沒有開放場次」與送出時欄位沒過。要和
# web/app/utils/engagement.ts 的 FORM_ACTIONS 一致（web 測試會比對）。
ENGAGEMENT_FORM_STEPS = ("form_date", "form_slot", "form_contact", "form_submit")
ENGAGEMENT_FORM_NO_SLOTS = "form_no_slots"
ENGAGEMENT_FORM_INVALID = "form_invalid"
# 入學試算查到的班別（入學資訊頁，只記班別不記生日）。順序同官網的分班表，
# 要和 web/app/utils/engagement.ts 的 CLASS_ACTIONS 一致（web 測試會比對）。
ENGAGEMENT_CLASS_ACTIONS = ("class_young", "class_toddler", "class_small", "class_middle", "class_big", "class_school")
# 首頁點開的消息／活動／影片：代碼是前綴加內容代號。
ENGAGEMENT_STORY_PREFIXES = {"sn_": "news", "se_": "event", "sf_": "film"}
ENGAGEMENT_MAX_SEQ = 500


class EngagementVisit(Base):
    """官網單次頁面瀏覽的停留與互動（2026-11-11）。`id` 是瀏覽器為這次瀏覽產生的
    隨機 UUID，同一次瀏覽離開前會回報多次（切到背景、換頁），以 id upsert 成最新值。
    `session_id` 是分頁內的暫時代碼（sessionStorage，關掉分頁就消失），只用來把同一次
    造訪看過的頁面串起來；不存 IP、cookie、來源網址，也不指回預約案件。
    `sections`：區塊代碼 → 在畫面中央停留的毫秒數；`actions`：互動代碼 → 次數。
    保留 90 天。"""

    __tablename__ = "engagement_visits"
    __table_args__ = (
        Index("ix_engagement_visits_day_page", "day", "page"),
        Index("ix_engagement_visits_session", "session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    page: Mapped[str] = mapped_column(String(16), nullable=False)
    campus_key: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    # 最新消息內文頁的消息代號；其他頁是空字串。
    item: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    device: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    active_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    scroll_pct: Mapped[int] = mapped_column(Integer, nullable=False)
    sections: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False)
    actions: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # 這是這次造訪的第幾頁（從 1 起算），用來看進站頁、離開頁與瀏覽順序。2026-11-11 第二輪加，
    # 之前的紀錄與還開著舊版頁面的瀏覽器是 NULL。
    seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 進站連結上的活動代碼（utm_campaign，園方自己在連結上設的）；沒有就是 NULL。
    campaign: Mapped[str | None] = mapped_column(String(32), nullable=True)
