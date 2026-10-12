from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ParentAccessToken(Base):
    """高熵分享連結對應的 token；只存 hash，原始 token 不進資料庫、也不記在
    任何 log。要放進信裡時由伺服器密鑰與列 id 重算（access_service._derive_raw）。"""

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
