from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class NotificationInboxItem(Base):
    """站內通知，依校區顯示給有權限的人員；不存訪客個資以外的敏感欄位，
    payload 只放案件 id 與必要摘要，明細仍要透過權限檢查的 API 讀取。"""

    __tablename__ = "notification_inbox_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(
        ForeignKey("campuses.key", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationDelivery(Base):
    """「這筆 outbox 訊息已經送到這個收件人」的紀錄。

    outbox 是 at-least-once：任何一個收件人寄信失敗，整筆訊息都會重試，
    已經收到信的人會被重複打擾。有了這張表，重試時只會補寄還沒成功的人。
    UNIQUE (outbox_message_id, channel, recipient_key) 同時也擋住兩個
    worker 同時處理同一筆訊息造成的重複寄送。"""

    __tablename__ = "notification_deliveries"
    __table_args__ = (
        UniqueConstraint(
            "outbox_message_id", "channel", "recipient_key", name="uq_notification_delivery"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    outbox_message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("outbox_messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    recipient_key: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
