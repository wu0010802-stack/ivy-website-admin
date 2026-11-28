from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
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
    # 有人在這個群組裡貼上後台產生的一次性驗證碼的時間。任何人都能把官方帳號
    # 拉進自己取名的群組，所以只有驗證過的群組能被選為校區推播目標；
    # 2026-09-29 以前已綁定的群組不回填，照常推播。
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LineGroupVerificationCode(Base):
    """後台產生、要貼到 LINE 群組裡的一次性驗證碼（證明群組裡有看得到後台的人）。

    只存 HMAC 雜湊，不存驗證碼本身；10 分鐘過期，用過一次就作廢。"""

    __tablename__ = "line_group_verification_codes"
    __table_args__ = (
        UniqueConstraint("code_hash", name="uq_line_group_verification_codes_code_hash"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 用在哪個群組（只作紀錄；群組列可能之後被清掉，不設外鍵）。
    used_target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


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


class LineGroupSetting(Base):
    """每個 LINE 群組的通知設定（2026-11-17）。沒有設定列＝全部預設值（四種通知全開、摘要與
    @所有人開、非總部群組）。`is_hq` 的群組額外收所有校區的通知，和校區群組並存。"""

    __tablename__ = "line_group_settings"

    target_id: Mapped[str] = mapped_column(
        ForeignKey("line_groups.target_id", ondelete="CASCADE"), primary_key=True
    )
    kinds: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=lambda: [
            "visit_request_created",
            "visit_request_confirmed",
            "visit_request_rescheduled",
            "visit_request_cancelled",
        ],
        server_default=text(
            """'["visit_request_created", "visit_request_confirmed", "visit_request_rescheduled", "visit_request_cancelled"]'::jsonb"""
        ),
    )
    digest_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    mention_all_same_day: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    is_hq: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class LineDigestRun(Base):
    """某群組某天的參觀摘要已經推過（避免重複推送）。"""

    __tablename__ = "line_digest_runs"

    target_id: Mapped[str] = mapped_column(
        ForeignKey("line_groups.target_id", ondelete="CASCADE"), primary_key=True
    )
    digest_date: Mapped[date] = mapped_column(Date, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LineReportRun(Base):
    """總部群組的週報／月報已經推過（2026-11-26）：同一期每個群組只推一次。
    kind＝weekly_report／monthly_report；period_start＝那一期的第一天（週一或 1 日）。"""

    __tablename__ = "line_report_runs"

    target_id: Mapped[str] = mapped_column(
        ForeignKey("line_groups.target_id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(32), primary_key=True)
    period_start: Mapped[date] = mapped_column(Date, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PushSubscription(Base):
    """後台手機推播（Web Push）的訂閱：一台裝置的瀏覽器一列（2026-11-05）。

    endpoint 是推播服務（FCM、Mozilla、Apple、WNS）發給這個瀏覽器的位址，加上 p256dh 與 auth
    兩把訂閱端的公開金鑰就能把訊息加密送到那台裝置；知道 endpoint 的人能對那台裝置丟通知，所以
    API 與 log 都不回傳 endpoint 與金鑰。同一個 endpoint 只會有一列（換人登入同一台裝置就改綁）。
    404／410 或連續失敗 10 次的訂閱由 notifications/web_push.py 刪除。"""

    __tablename__ = "push_subscriptions"
    __table_args__ = (UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(200), nullable=False)
    auth: Mapped[str] = mapped_column(String(100), nullable=False)
    # 由 User-Agent 推得的裝置名稱（「iPhone（主畫面）」「Android Chrome」…），畫面上辨認用。
    device_label: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class LineParentCampusAccount(Base):
    """某校的家長 LINE 通知用哪個官方帳號（2026-11-16，docs/specs/2026-11-16-line-integrations-design.md §4）。

    account_key 是設定裡的帳號鍵：main（園方群組推播那個）或某校自己的帳號（WEBSITE_LINE_<校>_*）。
    沒有列＝這校沒開家長 LINE 通知。設定拿掉金鑰後列還在，但 helpers 會當成沒開。"""

    __tablename__ = "line_parent_campus_accounts"

    campus_key: Mapped[str] = mapped_column(
        ForeignKey("campuses.key", ondelete="CASCADE"), primary_key=True
    )
    account_key: Mapped[str] = mapped_column(String(20), nullable=False)
    # 這校沒留 Email、也沒綁 LINE 的家長，改用通知型訊息（用電話號碼）送（2026-11-25）。
    # 帳號還要列在 WEBSITE_LINE_PNP_ACCOUNTS（LINE 已開通）才會真的送。
    pnp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class LinePnpMessage(Base):
    """送給家長的 LINE 通知型訊息（用電話號碼送，2026-11-25，
    docs/specs/2026-11-25-line-notification-messages-research.md）。一則 outbox 通知最多一列。

    通知型訊息 API 不支援 X-Line-Retry-Key：送出後才逾時，重送可能讓家長收到兩則、也付兩次錢。
    所以呼叫 LINE 之前先寫這一列並 commit；確定沒送出去（連不上、LINE 回 429／5xx／401）才刪掉這列讓整筆重試，
    其他情況（逾時、送出後斷線）都留著、不再重送。

    沒有 status 欄：用時間記發生過的事。accepted_at＝LINE 收下（200／202，不代表送到）；
    rejected_at＝LINE 回 422（這支電話沒有 LINE、拒收或不是台日泰門號）；delivered_at＝webhook 收到送達事件。
    三個都空＝送出後不知道結果（逾時）。不存電話或其雜湊。"""

    __tablename__ = "line_pnp_messages"
    __table_args__ = (UniqueConstraint("outbox_message_id", name="uq_line_pnp_messages_outbox_message_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    outbox_message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("outbox_messages.id", ondelete="CASCADE", name="fk_line_pnp_messages_outbox_message_id"),
        nullable=False,
    )
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE", name="fk_line_pnp_messages_visit_request_id"),
        nullable=False,
        index=True,
    )
    account_key: Mapped[str] = mapped_column(String(20), nullable=False)
    template_key: Mapped[str] = mapped_column(String(64), nullable=False)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LineParentLink(Base):
    """家長把一筆參觀預約綁到自己的 LINE（傳代碼給官方帳號）。一筆預約最多一個 LINE；
    同一個 LINE 可以綁多筆。userId 依官方帳號所在的 provider 而不同，所以記下是哪個帳號。

    unfollowed_at：家長封鎖或刪除官方帳號（webhook unfollow）；再加回好友（follow）時清掉。
    封鎖期間不推（LINE 也會回 200 但收不到）。案件匿名化時整列刪掉（retention_service.anonymize）。"""

    __tablename__ = "line_parent_links"
    __table_args__ = (
        UniqueConstraint("visit_request_id", name="uq_line_parent_links_visit_request_id"),
        Index("ix_line_parent_links_account_user", "account_key", "line_user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE", name="fk_line_parent_links_visit_request_id"),
        nullable=False,
    )
    account_key: Mapped[str] = mapped_column(String(20), nullable=False)
    line_user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    unfollowed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LineRichMenu(Base):
    """程式替某個官方帳號建的圖文選單（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §4）。沒有列＝不使用。

    mode：all＝所有好友看「一般」版（設成 API 預設選單，會蓋掉 LINE Official Account Manager 設的那個）、已預約的家長
    看「已預約」版；booked＝只替已預約的家長換上「已預約」版，其他好友照舊。
    spec_hash：建立當下選單內容（連結、電話、圖）的雜湊；和現在算出來的不同＝內容有更新、要重新套用。"""

    __tablename__ = "line_rich_menus"

    account_key: Mapped[str] = mapped_column(String(20), primary_key=True)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)
    default_menu_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    booked_menu_id: Mapped[str] = mapped_column(String(64), nullable=False)
    spec_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", name="fk_line_rich_menus_created_by"), nullable=True
    )


class LineRichMenuUser(Base):
    """我們替誰換上了「已預約」版圖文選單。LINE 沒有「列出某個選單綁了誰」的 API，自己記下來，
    參觀結束、取消或解除綁定後才知道要替誰換回去（notifications/line_rich_menus.reconcile）。"""

    __tablename__ = "line_rich_menu_users"

    account_key: Mapped[str] = mapped_column(String(20), primary_key=True)
    line_user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LineParentLinkCode(Base):
    """家長頁產生、要傳給官方帳號的一次性綁定代碼（LN-XXXXXXXX）。只存 HMAC 雜湊；
    30 分鐘過期、用過一次就作廢。account_key 是產生當下這校用的帳號，從別的帳號傳來不算。"""

    __tablename__ = "line_parent_link_codes"
    __table_args__ = (UniqueConstraint("code_hash", name="uq_line_parent_link_codes_code_hash"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    visit_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="CASCADE", name="fk_line_parent_link_codes_visit_request_id"),
        nullable=False,
        index=True,
    )
    account_key: Mapped[str] = mapped_column(String(20), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
