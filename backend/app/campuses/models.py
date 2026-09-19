from __future__ import annotations

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

CAMPUS_KEYS = ("yihua", "minghua", "chongde", "international", "renwu")


class Campus(Base):
    """五校。`key` 是固定的網址/程式代號，不是 tenant_id——本系統單租戶，
    僅用 campus scope 做管理範圍隔離。"""

    __tablename__ = "campuses"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
