from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ContactPhraseSet(Base):
    """聯絡片語（2026-10-12 規格 4.2）：總部統一維護的一組常用句子，案件與招生的
    聯絡紀錄輸入框上方以小按鈕顯示，點一下帶入。全站只有一份，固定一列
    key='default'（migration 插入預設 6 句；測試或誤刪造成列不存在時，service 回程式
    內建的預設，寫入時自己建立）。存檔直接生效，不經草稿與發布。"""

    __tablename__ = "contact_phrase_sets"

    key: Mapped[str] = mapped_column(String(16), primary_key=True)
    # list[str]，順序就是畫面順序。
    phrases: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    # 樂觀鎖：PUT 帶 expected_version，不符回 409。
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # 預設列（migration 或程式建立）沒有人編輯過，兩個欄位都是 NULL。
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
