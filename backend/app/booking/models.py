from __future__ import annotations

import enum
import uuid
from datetime import date as date_, datetime, time as time_

from sqlalchemy import JSON, Boolean, CheckConstraint, Date, DateTime, Enum, ForeignKey, Index, Integer, String, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class BookingMode(str, enum.Enum):
    INQUIRY = "inquiry"
    SLOTS = "slots"
    LINE = "line"
    PHONE = "phone"
    EXTERNAL = "external"
    PAUSED = "paused"


class VisitRequestStatus(str, enum.Enum):
    NEW = "new"
    # 規格 6.2：園方已開始聯絡但還沒排定時段。不占名額。
    CONTACTING = "contacting"
    # 規格 221：slots 模式的人工待確認狀態。占名額（避免超收），但還不是
    # 「預約成立」，家長頁與通知文案都必須講「待園方確認」。
    PENDING_CONFIRMATION = "pending_confirmation"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    COMPLETED = "completed"


class VisitRequestSource(str, enum.Enum):
    """案件從哪裡進來。web 是官網表單；其餘是園方在後台人工補登
    （規格 6.2：不得憑外連點擊自動建案，只能由人員確認後補登）。"""

    WEB = "web"
    PHONE = "phone"
    LINE = "line"
    WALK_IN = "walk_in"
    EXTERNAL = "external"


class BookingConfig(Base):
    """每校一列。`version` 是樂觀鎖版本號，公開提交時要重驗這個值，
    版本不符代表使用者看到的設定已經過期（園方剛好改了模式）。"""

    __tablename__ = "booking_configs"
    __table_args__ = (
        CheckConstraint(
            "parent_change_deadline_hours BETWEEN 1 AND 336",
            name="ck_booking_configs_parent_change_deadline_hours",
        ),
    )

    campus_key: Mapped[str] = mapped_column(
        ForeignKey("campuses.key", ondelete="RESTRICT"), primary_key=True
    )
    mode: Mapped[BookingMode] = mapped_column(
        Enum(BookingMode, name="booking_mode"), nullable=False, default=BookingMode.PAUSED
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    line_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    external_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 規格 197：slots 模式預設人工確認；園方要「送出即成立」才打開。
    slots_auto_confirm: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # 規格 225：公開可選時段的時間窗。改這兩個值不動 version——它們不影響
    # 預約方式，只影響哪些時段現在列給家長看；送單時仍依當下的值重判。
    min_lead_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=24, server_default="24")
    max_advance_days: Mapped[int] = mapped_column(Integer, nullable=False, default=60, server_default="60")
    # 規格 238：家長用管理連結線上取消／申請改期，最晚到參觀前幾小時。
    # 同樣不動 version：只影響已成立的案件，不影響官網送單。
    parent_change_deadline_hours: Mapped[int] = mapped_column(
        Integer, nullable=False, default=24, server_default="24"
    )
    # 定期工作上次依每週規則補產生時段的台灣日期；一天只補一次。改規則、
    # 改最遠開放天數時清成 NULL，下一輪（約一分鐘內）就依新設定補上。
    rules_extended_on: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class VisitRequest(Base):
    """`idempotency_key` 與 `campus_key` 組成唯一鍵；`payload_hash` 用來
    判斷重播請求的內容是否真的相同（同 key 不同 body 要拒絕，不能悄悄
    當成同一筆）。"""

    __tablename__ = "visit_requests"
    __table_args__ = (
        UniqueConstraint("campus_key", "idempotency_key", name="uq_visit_request_idempotency"),
        CheckConstraint(
            "party_size IS NULL OR party_size BETWEEN 1 AND 10",
            name="ck_visit_requests_party_size",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(
        ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False, index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    config_version: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_name: Mapped[str] = mapped_column(String(64), nullable=False)
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    child_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    child_birthdate: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    referral_sources: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )
    age: Mapped[str | None] = mapped_column(String(32), nullable=True)
    preferred_time: Mapped[str | None] = mapped_column(String(32), nullable=True)
    questions: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    consent_given: Mapped[bool] = mapped_column(nullable=False, default=False)
    # 規格 L196：家長同意的是哪一版同意說明（booking_content 的已發布
    # revision）與伺服器接受的時間。官網送單才有版本；人工補登是人員向家長
    # 說明後代勾，沒有版本。2026-09-25 以前的案件沒有版本。
    consent_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "content_revisions.id",
            ondelete="RESTRICT",
            name="fk_visit_requests_consent_revision_id_content_revisions",
        ),
        nullable=True,
    )
    consent_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 規格 L194、L221：參觀人數（含家長與孩子）1–10。名額仍以家庭組數計，
    # 人數另存給接待準備用。舊案件與沒問到人數的補登為 NULL。
    party_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="new")
    # 規格 6.2：結案後重新預約（含換校）另建新案，指回舊案。
    related_request_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default=VisitRequestSource.WEB.value, server_default="web"
    )
    # 人工補登的建立人；官網表單送出的案件為 NULL。
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", name="fk_visit_requests_created_by_users"),
        nullable=True,
    )

    slot_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("visit_slots.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    assigned_staff_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 規格 222：人工待確認的 slot 案件占位期限。到期轉 cancelled、記
    # hold_expired、釋放名額。只有 pending_confirmation 會有值。
    hold_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    anonymized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    events: Mapped[list["VisitRequestEvent"]] = relationship(
        back_populates="visit_request", cascade="all, delete-orphan"
    )
    outbox_messages: Mapped[list["OutboxMessage"]] = relationship(
        back_populates="visit_request", cascade="all, delete-orphan"
    )
    contact_notes: Mapped[list["VisitContactNote"]] = relationship(
        back_populates="visit_request", cascade="all, delete-orphan"
    )
    slot: Mapped["VisitSlot | None"] = relationship(back_populates="visit_requests")


class SlotClosedSource(str, enum.Enum):
    """時段為什麼是關閉的。取消休假日只重開 exception 關掉的；manual 與
    舊資料（NULL，分不出來源）都視為園方刻意關閉，不自動打開。"""

    MANUAL = "manual"
    EXCEPTION = "exception"


class VisitSlot(Base):
    """單次時段。可由分校管理者手動建立，或依每週規則產生。容量以占用
    名額的案件數即時計算（slot_service.occupying_condition：待確認、已確認、
    已完成、未到場），不用可變計數器，天然避免取消重試重複釋放名額的問題。"""

    __tablename__ = "visit_slots"
    __table_args__ = (
        CheckConstraint(
            "closed_source IS NULL OR closed_source IN ('manual', 'exception')",
            name="ck_visit_slots_closed_source",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(
        ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False, index=True
    )
    slot_date: Mapped[date_] = mapped_column(Date, nullable=False)
    start_time: Mapped[time_] = mapped_column(Time, nullable=False)
    end_time: Mapped[time_] = mapped_column(Time, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # SlotClosedSource；開放中的時段為 NULL。
    closed_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 依規則自動產生的時段為 NULL（定期工作沒有操作人）。
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    visit_requests: Mapped[list[VisitRequest]] = relationship(back_populates="slot")


class VisitRule(Base):
    """每週開放規則（規格 6.3）：週幾、時間區間、每格長度、每格容量。
    定期工作每天依規則補產生時段到「最遠開放天數」（schedule_service.
    extend_from_rules），園方也可以按「依規則產生時段」手動補。改規則只影響
    之後產生的時段，已存在（含園方調過名額或關閉）的一律不動。"""

    __tablename__ = "visit_rules"
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_visit_rules_weekday"),
        CheckConstraint("end_time > start_time", name="ck_visit_rules_time_order"),
        CheckConstraint("slot_minutes > 0 AND capacity > 0", name="ck_visit_rules_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(
        ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False, index=True
    )
    # 0＝週一 … 6＝週日，與 Python date.weekday() 相同。
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[time_] = mapped_column(Time, nullable=False)
    end_time: Mapped[time_] = mapped_column(Time, nullable=False)
    slot_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class VisitException(Base):
    """休假日／臨時封鎖：整天不開放。建立時會把當天既有時段關閉（停止
    新申請，closed_source＝exception），已占位的案件不自動取消，列入案件
    清單的「待人工處理」。取消休假時只重開因休假關閉的時段。"""

    __tablename__ = "visit_exceptions"
    __table_args__ = (UniqueConstraint("campus_key", "exception_date", name="uq_visit_exception_day"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(
        ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False, index=True
    )
    exception_date: Mapped[date_] = mapped_column(Date, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class VisitContactNote(Base):
    """接待聯絡紀錄；每筆是一次聯絡歷程，不覆寫舊紀錄。"""

    __tablename__ = "visit_contact_notes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    note: Mapped[str] = mapped_column(String(1000), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    visit_request: Mapped[VisitRequest] = relationship(back_populates="contact_notes")


class VisitEventSource(str, enum.Enum):
    """歷程是誰做的。staff 另記 actor_user_id；家長沒有帳號，只記來源。"""

    STAFF = "staff"
    PARENT = "parent"
    SYSTEM = "system"


class VisitRequestEvent(Base):
    """案件歷程（規格 L299 VisitHistory）：做了什麼、誰做的、異動前後與原因。
    before／after 只放狀態、時段、承辦人這類非個資欄位；reason 是人員填的
    自由文字，匿名化時會清掉。2026-09-25 以前的舊歷程沒有操作人與前後值。"""

    __tablename__ = "visit_request_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", name="fk_visit_request_events_actor_user_id_users"),
        nullable=True,
    )
    source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    visit_request: Mapped[VisitRequest] = relationship(back_populates="events")


class OutboxStatus(str, enum.Enum):
    PENDING = "pending"
    LEASED = "leased"
    SENT = "sent"
    FAILED = "failed"
    # 定期工作產生的提醒到寄送當下已不適用（改期、取消、已處理），不寄也
    # 不算失敗。
    SKIPPED = "skipped"


class OutboxMessage(Base):
    """交易式 outbox：只在案件交易提交後才會被 worker 看到（因為這一列
    本身就是同一個交易寫入的），不會在交易提交前對外發送。Task 9 起
    worker 用 DB lease（`leased_by`/`leased_until`）認領工作，成功才
    ack，失敗記 attempt/next_attempt_at/error_code，達上限保留 failed
    供人工重試——不會憑空遺失案件通知。"""

    __tablename__ = "outbox_messages"
    __table_args__ = (
        Index("uq_outbox_messages_dedupe_key", "dedupe_key", unique=True),
        Index("ix_outbox_messages_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    status: Mapped[str] = mapped_column(String(16), nullable=False, default=OutboxStatus.PENDING.value)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    leased_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    leased_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 寄送失敗後由後台或 CLI 重新排入的時間；「太舊不再推播寄信」改從這裡算。
    requeued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 定期工作的提醒用：同一案件同一種提醒只寫一次（見 notifications/reminders.py）。
    dedupe_key: Mapped[str | None] = mapped_column(String(160), nullable=True)

    visit_request: Mapped[VisitRequest] = relationship(back_populates="outbox_messages")
