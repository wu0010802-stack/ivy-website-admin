from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class BookingMode(str, enum.Enum):
    INQUIRY = "inquiry"
    SLOTS = "slots"  # 保留給階段 D；階段 C 不可被設定為啟用中的模式
    LINE = "line"
    PHONE = "phone"
    EXTERNAL = "external"
    PAUSED = "paused"


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
    age: Mapped[str | None] = mapped_column(String(32), nullable=True)
    preferred_time: Mapped[str | None] = mapped_column(String(32), nullable=True)
    questions: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    consent_given: Mapped[bool] = mapped_column(nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="new")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    events: Mapped[list["VisitRequestEvent"]] = relationship(
        back_populates="visit_request", cascade="all, delete-orphan"
    )
    outbox_messages: Mapped[list["OutboxMessage"]] = relationship(
        back_populates="visit_request", cascade="all, delete-orphan"
    )


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


class OutboxMessage(Base):
    """交易式 outbox；本階段只寫入，實際發送 worker 屬 Task 9。
    outbox 不得在案件交易提交前對外發送——這裡連寄送邏輯都還沒接，
    天然滿足這個規則。"""

    __tablename__ = "outbox_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    visit_request: Mapped[VisitRequest] = relationship(back_populates="outbox_messages")
