from __future__ import annotations

import enum
import uuid
from datetime import date as date_, datetime, time as time_

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, Time, UniqueConstraint
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
    # 規格 221：slots 模式的人工待確認狀態。占名額（避免超收），但還不是
    # 「預約成立」，家長頁與通知文案都必須講「待園方確認」。
    PENDING_CONFIRMATION = "pending_confirmation"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"
    COMPLETED = "completed"


class BookingConfig(Base):
    """每校一列。`version` 是樂觀鎖版本號，公開提交時要重驗這個值，
    版本不符代表使用者看到的設定已經過期（園方剛好改了模式）。"""

    __tablename__ = "booking_configs"

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
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="new")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    slot_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("visit_slots.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    assigned_staff_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
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


class VisitSlot(Base):
    """單次時段。階段 D 第一版由分校管理者手動建立，不含週期規則
    自動產生（那是 Task 9 的排程工作範圍）。容量以「目前非取消/未到場
    的 confirmed 案件數」即時計算，不用可變計數器，天然避免取消重試
    重複釋放名額的問題。"""

    __tablename__ = "visit_slots"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(
        ForeignKey("campuses.key", ondelete="RESTRICT"), nullable=False, index=True
    )
    slot_date: Mapped[date_] = mapped_column(Date, nullable=False)
    start_time: Mapped[time_] = mapped_column(Time, nullable=False)
    end_time: Mapped[time_] = mapped_column(Time, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    visit_requests: Mapped[list[VisitRequest]] = relationship(back_populates="slot")


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


class VisitRequestEvent(Base):
    """歷程紀錄；階段 C 只寫 created，Task 7 會補 confirmed/cancelled 等。"""

    __tablename__ = "visit_request_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    visit_request: Mapped[VisitRequest] = relationship(back_populates="events")


class OutboxStatus(str, enum.Enum):
    PENDING = "pending"
    LEASED = "leased"
    SENT = "sent"
    FAILED = "failed"


class OutboxMessage(Base):
    """交易式 outbox：只在案件交易提交後才會被 worker 看到（因為這一列
    本身就是同一個交易寫入的），不會在交易提交前對外發送。Task 9 起
    worker 用 DB lease（`leased_by`/`leased_until`）認領工作，成功才
    ack，失敗記 attempt/next_attempt_at/error_code，達上限保留 failed
    供人工重試——不會憑空遺失案件通知。"""

    __tablename__ = "outbox_messages"

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

    visit_request: Mapped[VisitRequest] = relationship(back_populates="outbox_messages")
