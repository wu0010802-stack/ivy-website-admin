from __future__ import annotations

import asyncio
import re
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import User
from app.auth.permissions import covers_campus, roles_with
from app.notifications.email_adapter import EmailAdapter
from app.notifications.models import NotificationDelivery, NotificationInboxItem

_KIND_LABELS = {
    "visit_request_created": "新的參觀需求",
    # 規格 197：人工確認模式下「待園方確認」不是「已確認」，文案必須分開，
    # 否則園方收到的信會誤以為這筆預約已經成立。
    "visit_request_pending_confirmation": "新的時段申請（待園方確認）",
    "visit_request_confirmed": "參觀預約已確認",
    "visit_request_cancelled": "參觀預約已取消",
    "visit_request_rescheduled": "參觀預約已改期",
    "visit_request_hold_expired": "時段占位已逾期，名額已釋放",
}

_HEADER_UNSAFE_RE = re.compile(r"[\r\n]")

# 超過這個時間還沒送出的訊息只寫站內通知、不再推播或寄信。正常重試（5 次、
# 最長間隔 15 分鐘）遠短於此，這條只會擋到積壓的舊訊息——例如定期工作第一次
# 上線、或寄信設定修好時，不該把幾天前的通知一次寄給所有人。
EXTERNAL_DELIVERY_STALE_AFTER = timedelta(hours=24)


def _header_safe(value: str) -> str:
    """收件者與主旨進 SMTP header 之前先把換行拿掉——含換行的值可以在
    header 區段插入額外欄位（header injection）。目前的 sink adapter 不會
    真的組 header，但這個函式是給之後接真實 SMTP 用的防線。"""
    return _HEADER_UNSAFE_RE.sub(" ", value)


async def get_notification_recipients(db: AsyncSession, campus_key: str) -> list[User]:
    """依校區通知：只給目前真的還有這個校區權限、且帳號啟用中的人員。
    這裡每次都即時查詢目前的 scope，不在建立通知時就把收件人清單寫死，
    帳號被停權或改 scope 後自然收不到後續通知，不需要額外清理。

    收件人＝能處理這個校區案件的人（booking.manage），跟權限表同一個定義，
    不另外寫死角色。"""
    result = await db.execute(
        select(User)
        .options(selectinload(User.campus_scopes))
        .where(User.is_active.is_(True), User.role.in_(roles_with("booking.manage")))
        .order_by(User.email)
    )
    return [user for user in result.scalars() if covers_campus(user, campus_key)]


async def _already_delivered(
    db: AsyncSession, outbox_message_id: uuid.UUID, channel: str, recipient_key: str
) -> bool:
    result = await db.execute(
        select(NotificationDelivery.id).where(
            NotificationDelivery.outbox_message_id == outbox_message_id,
            NotificationDelivery.channel == channel,
            NotificationDelivery.recipient_key == recipient_key,
        )
    )
    return result.scalars().first() is not None


def _record_delivery(
    db: AsyncSession, outbox_message_id: uuid.UUID, channel: str, recipient_key: str
) -> None:
    db.add(
        NotificationDelivery(
            id=uuid.uuid4(),
            outbox_message_id=outbox_message_id,
            channel=channel,
            recipient_key=recipient_key,
            created_at=datetime.now(timezone.utc),
        )
    )


async def dispatch_outbox_message(
    db: AsyncSession,
    *,
    outbox_message_id: uuid.UUID,
    campus_key: str,
    kind: str,
    payload: dict,
    adapter: EmailAdapter | None,
    created_at: datetime | None = None,
) -> None:
    """處理一筆 outbox 訊息：寫站內通知＋寄信。任何一個收件人寄信失敗
    都讓整筆工作視為失敗，交給 worker 的重試機制處理，不會靜默丟失、
    也不假裝已寄出。

    `adapter` 為 None 代表部署環境沒有設定寄信：站內通知照寫、email 這個
    管道整個略過。原本「未配置」會讓整批 outbox 停著不處理，結果後台連
    站內通知都收不到；等日後設好 SMTP，又會把累積幾個月的舊通知一次寄出。

    重試時以 notification_deliveries 逐一去重：已經成功寄出的收件人不會
    再收到第二封，站內通知也只會寫一筆——原本整筆重試會讓每一輪都多一
    則站內通知、且已收到信的人重複收信。"""
    label = _KIND_LABELS.get(kind, kind)

    if not await _already_delivered(db, outbox_message_id, "inbox", campus_key):
        db.add(
            NotificationInboxItem(
                id=uuid.uuid4(),
                campus_key=campus_key,
                kind=kind,
                payload=payload,
                created_at=datetime.now(timezone.utc),
            )
        )
        _record_delivery(db, outbox_message_id, "inbox", campus_key)
        # 立刻 commit：這是「已經發生的事實」。如果留到整筆結束才提交，
        # 後面任一收件人寄失敗導致 rollback，這則站內通知就會在下一輪
        # 重試時再寫一次。
        await db.commit()

    if adapter is None:
        return
    if created_at is not None and datetime.now(timezone.utc) - created_at > EXTERNAL_DELIVERY_STALE_AFTER:
        return
    recipients = await get_notification_recipients(db, campus_key)
    for user in recipients:
        if await _already_delivered(db, outbox_message_id, "email", user.email):
            continue
        # SMTP 是阻塞 I/O（連線逾時 20 秒）。定期工作跑在 API 的 event loop
        # 上，直接呼叫會讓這段期間所有請求一起卡住。
        await asyncio.to_thread(
            adapter.send,
            to=_header_safe(user.email),
            subject=_header_safe(f"[常春藤官網] {label}"),
            body=f"校區：{campus_key}\n案件：{payload.get('receipt_id')}\n類型：{label}",
        )
        # 寄成功才記，而且立刻 commit——信已經寄出去了，這個事實不能被
        # 後面其他收件人的失敗回滾掉，否則這個人下一輪會再收一封。
        _record_delivery(db, outbox_message_id, "email", user.email)
        await db.commit()
