from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RateLimitCounter(Base):
    """限流計數。一個來源在一個固定窗口只佔一列，見 app/common/ratelimit.py。

    `key_hash` 是 HMAC 後的值：限流 key 含手機、email、訪客 IP，不能以明文
    落地。列在 `expires_at`（窗口結束後再多留一個窗口，供加權計算）之後就
    沒有用了，由背景工作清掉。"""

    __tablename__ = "rate_limit_counters"
    __table_args__ = (Index("ix_rate_limit_counters_expires_at", "expires_at"),)

    bucket: Mapped[str] = mapped_column(String(64), primary_key=True)
    key_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    # epoch 秒；用整數才能直接算「前一個窗口」。
    window_start: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    hits: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
