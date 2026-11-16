"""回傳廣告平台的待送工作（2026-11-16 規格 §2）。

「標記已到場」「招生訪視變成已預繳」時，在同一個交易裡每個已設定的平台各寫一列；API 內建定期工作
（app/workers/maintenance.py）送出到期的列。每個案件×事件×平台只會有一列：重複標記、退預繳後再預繳都不重送。
列裡不存任何個資：送出時才從案件的 ad_click_ids 讀識別碼，案件匿名化後識別碼清掉、還沒送的就記 skipped。
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

PLATFORMS = ("ga4", "meta", "openai")
EVENTS = ("visit_attended", "deposit_paid")
STATUSES = ("pending", "sent", "failed", "skipped")


def _sql_in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class AdConversionJob(Base):
    __tablename__ = "ad_conversion_jobs"
    __table_args__ = (
        UniqueConstraint("visit_request_id", "event", "platform", name="uq_ad_conversion_jobs_request_event_platform"),
        CheckConstraint(_sql_in("platform", PLATFORMS), name="ck_ad_conversion_jobs_platform"),
        CheckConstraint(_sql_in("event", EVENTS), name="ck_ad_conversion_jobs_event"),
        CheckConstraint(_sql_in("status", STATUSES), name="ck_ad_conversion_jobs_status"),
        # 定期工作撈「待送且到期」的列。
        Index("ix_ad_conversion_jobs_due", "status", "next_attempt_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE", name="fk_ad_conversion_jobs_visit_request_id"),
        nullable=False,
        index=True,
    )
    event: Mapped[str] = mapped_column(String(32), nullable=False)
    platform: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    # 轉換發生的時間（標記到場、預繳的那一刻）：送給平台的事件時間，也用來判斷是否已超過平台時限。
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 失敗或略過的原因（HTTP 狀態碼與平台回的錯誤摘要，或 expired／no_identifier／anonymized）；不含個資。
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)
