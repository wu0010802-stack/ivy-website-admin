from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

CAMPUS_KEYS = ("yihua", "minghua", "chongde", "international", "renwu")
# 五校預設名稱（seed 用的名稱，也用來辨認舊版消息裡手打的校區文字）。
CAMPUS_NAMES = {
    "yihua": "義華校",
    "minghua": "明華校",
    "chongde": "崇德校",
    "international": "國際校",
    "renwu": "仁武校",
}


class Campus(Base):
    """五校。`key` 是固定的網址/程式代號，不是 tenant_id——本系統單租戶，
    僅用 campus scope 做管理範圍隔離。"""

    __tablename__ = "campuses"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # 停用不硬刪：保留歷史預約、素材與紀錄，只停止公開預約（規格 3.2）。
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deactivated_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
