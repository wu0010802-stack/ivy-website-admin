from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ParentAccessToken(Base):
    """高熵分享連結對應的 token；只存 hash，原始 token 只在建立當下
    回傳一次，之後查不到、也不記在任何 log。"""

    __tablename__ = "parent_access_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ParentSession(Base):
    """exchange 後換到的受限 session；只綁定單一 visit_request_id，
    跟員工登入 session（app.auth.models.Session）完全分開，不能互換。"""

    __tablename__ = "parent_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RescheduleRequest(Base):
    """家長自助申請改期：不直接動時段，先建一筆待核准紀錄，
    園方核准後才真的呼叫 workflow_service.reschedule。"""

    __tablename__ = "reschedule_requests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    requested_slot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_slots.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
