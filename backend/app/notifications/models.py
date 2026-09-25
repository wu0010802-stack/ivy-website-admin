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


class UserNotification(Base):
    """給特定一個人的站內通知（內容送審、核准或退回、排程發布沒有執行）。

    和上面依校區共用的案件通知不同：這些只跟收件人自己有關，已讀也是個人的；
    內容編輯沒有案件權限，一樣看得到給自己的通知。payload 只放內容種類、版本
    與原因這類摘要，不放內容本身。"""

    __tablename__ = "user_notifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    recipient_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    content_item_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("content_items.id", ondelete="CASCADE"), nullable=True
    )
    campus_key: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("campuses.key", ondelete="CASCADE"), nullable=True
    )
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


class LineGroup(Base):
    """LINE 官方帳號（bot）所在的群組或多人聊天室，由 webhook 自動記錄。

    bot 被拉進群組（join）或群組裡有人發話時記下 ID，被踢出（leave）時標記
    `left_at`。只存 ID 與群組名稱，不存任何訊息內容。"""

    __tablename__ = "line_groups"

    # 群組 C＋32 位十六進位、多人聊天室 R＋32 位十六進位；推播時兩者都當 `to`。
    target_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_type: Mapped[str] = mapped_column(String(8), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LineCampusTarget(Base):
    """某校的案件通知要推到哪個 LINE 群組。一校最多一個群組，同一個群組可以
    同時收多校（例如總部群組）。"""

    __tablename__ = "line_campus_targets"

    campus_key: Mapped[str] = mapped_column(
        ForeignKey("campuses.key", ondelete="CASCADE"), primary_key=True
    )
    target_id: Mapped[str] = mapped_column(
        ForeignKey("line_groups.target_id", ondelete="CASCADE"), nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
