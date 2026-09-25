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
from app.booking.access_models import RescheduleRequest
from app.booking.models import VisitRequest, VisitSlot
from app.campuses.models import Campus
from app.notifications import line as line_api
from app.notifications import reminders
from app.notifications.email_adapter import EmailAdapter
from app.notifications.models import LineCampusTarget, LineGroup, NotificationDelivery, NotificationInboxItem

_KIND_LABELS = {
    "visit_request_created": "新的參觀需求",
    # 規格 197：人工確認模式下「待園方確認」不是「已確認」，文案必須分開，
    # 否則園方收到的信會誤以為這筆預約已經成立。
    "visit_request_pending_confirmation": "新的時段申請（待園方確認）",
    "visit_request_confirmed": "參觀預約已確認",
    "visit_request_cancelled": "參觀預約已取消",
    "visit_request_rescheduled": "參觀預約已改期",
    "visit_request_hold_expired": "時段占位已逾期，名額已釋放",
    # 規格 L239、L268：家長線上申請改期只是申請，原時段仍有效，要園方核准。
    "visit_reschedule_requested": "家長申請改期（待園方核准）",
    # 規格 L268：定期工作產生的提醒（notifications/reminders.py）。
    reminders.UPCOMING_VISIT_KIND: f"即將參觀（{reminders.whole_hours(reminders.UPCOMING_VISIT_LEAD)} 小時內）",
    reminders.OVERDUE_KIND: "案件逾期未處理",
}


def notification_label(kind: str, payload: dict | None = None) -> str:
    """通知的中文標題。逾期未處理另外帶出是哪一種（新需求放太久、占位快到期）。"""
    label = _KIND_LABELS.get(kind, kind)
    reason = (payload or {}).get("reason")
    if kind == reminders.OVERDUE_KIND and reason in reminders.REASON_LABELS:
        return f"{label}：{reminders.REASON_LABELS[reason]}"
    return label

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

    收件人＝能處理這個校區案件的人（booking.handle，含接待人員——真正接
    新案的是櫃台），跟權限表同一個定義，不另外寫死角色。"""
    result = await db.execute(
        select(User)
        .options(selectinload(User.campus_scopes))
        .where(User.is_active.is_(True), User.role.in_(roles_with("booking.handle")))
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


async def campus_line_target(db: AsyncSession, campus_key: str) -> str | None:
    """這個校區目前要推播的 LINE 群組；bot 已被移出的群組不算。"""
    result = await db.execute(
        select(LineGroup.target_id)
        .join(LineCampusTarget, LineCampusTarget.target_id == LineGroup.target_id)
        .where(LineCampusTarget.campus_key == campus_key, LineGroup.left_at.is_(None))
    )
    return result.scalar_one_or_none()


async def _campus_name(db: AsyncSession, campus_key: str) -> str:
    name = (await db.execute(select(Campus.name).where(Campus.key == campus_key))).scalar_one_or_none()
    return name or campus_key


def admin_visit_url(admin_origin: str | None, receipt_id: str | None) -> str | None:
    if not admin_origin or not receipt_id:
        return None
    return f"{admin_origin.rstrip('/')}/admin/visit-requests/{receipt_id}"


def line_text(label: str, campus_name: str, receipt_id: str | None, admin_origin: str | None) -> str:
    """群組裡可能有非管理員：只放類型、校區、案件編號，不放家長或孩子資料；
    明細要點連結登入後台看。"""
    lines = [f"[常春藤官網] {label}", f"校區：{campus_name}"]
    if receipt_id:
        lines.append(f"案件編號：{receipt_id}")
        if url := admin_visit_url(admin_origin, receipt_id):
            lines.append(url)
    return "\n".join(lines)


# 信件稱呼用。表單沒有性別欄位，只有家長自己寫了稱謂（王媽媽、林先生）
# 才換成「先生／小姐」，其他一律稱「家長」，不猜。
_MALE_TITLES = ("先生", "爸爸", "爸比", "把拔", "爹地")
_FEMALE_TITLES = ("小姐", "女士", "太太", "媽媽", "媽咪", "馬麻")
_COMPOUND_SURNAMES = (
    "歐陽", "司馬", "諸葛", "上官", "張簡", "范姜", "東方", "皇甫", "司徒",
    "端木", "公孫", "夏侯", "慕容", "令狐", "長孫", "宇文", "尉遲",
)
_WEEKDAYS = "一二三四五六日"


def parent_salutation(parent_name: str | None) -> str:
    """信件裡的家長稱呼：只用姓氏加「先生／小姐」，判斷不出來就稱「家長」。
    不放全名——信可能被轉寄或留在共用信箱，完整資料要登入後台看。"""
    name = (parent_name or "").strip()
    title = None
    for suffixes, label in ((_MALE_TITLES, "先生"), (_FEMALE_TITLES, "小姐")):
        suffix = next((s for s in suffixes if name.endswith(s)), None)
        if suffix:
            name, title = name[: -len(suffix)].strip(), label
            break
    if title is None or not name or not "\u4e00" <= name[0] <= "\u9fff":
        return "家長"
    surname = next((s for s in _COMPOUND_SURNAMES if name.startswith(s)), name[0])
    return f"{surname}{title}"


def slot_text(slot: VisitSlot) -> str:
    """2026/09/26（週六）10:00–11:00，和後台案件頁的寫法一致。"""
    day = slot.slot_date
    return (
        f"{day:%Y/%m/%d}（週{_WEEKDAYS[day.weekday()]}）"
        f"{slot.start_time:%H:%M}–{slot.end_time:%H:%M}"
    )


async def _load_visit_request(db: AsyncSession, receipt_id: str | None) -> VisitRequest | None:
    try:
        visit_id = uuid.UUID(str(receipt_id))
    except ValueError:
        return None
    result = await db.execute(
        select(VisitRequest).options(selectinload(VisitRequest.slot)).where(VisitRequest.id == visit_id)
    )
    return result.scalar_one_or_none()


async def _requested_slot(db: AsyncSession, reschedule_request_id: object) -> VisitSlot | None:
    try:
        request_id = uuid.UUID(str(reschedule_request_id))
    except ValueError:
        return None
    record = await db.get(RescheduleRequest, request_id)
    return await db.get(VisitSlot, record.requested_slot_id) if record is not None else None


async def email_content(
    db: AsyncSession,
    *,
    label: str,
    campus_key: str,
    receipt_id: str | None,
    admin_origin: str | None,
    payload: dict | None = None,
) -> tuple[str, str]:
    """(主旨, 內文)。收件人都是有這校案件權限的園方人員，但信件仍只放校名、
    家長稱呼、參觀時段與後台連結，不放手機、Email 或孩子資料。內容在寄出
    當下讀案件，時段是寄信時的最新狀態。改期申請另外列家長想改到的時段。"""
    campus_name = await _campus_name(db, campus_key)
    visit_request = await _load_visit_request(db, receipt_id)
    anonymized = visit_request is not None and visit_request.anonymized_at is not None
    lines = [
        f"[常春藤官網] {label}",
        "",
        f"校區：{campus_name}",
        f"家長：{parent_salutation(None if visit_request is None or anonymized else visit_request.parent_name)}",
    ]
    if visit_request is not None and visit_request.slot is not None:
        lines.append(f"參觀時段：{slot_text(visit_request.slot)}")
    if payload and payload.get("reschedule_request_id"):
        requested = await _requested_slot(db, payload["reschedule_request_id"])
        if requested is not None:
            lines.append(f"申請改到：{slot_text(requested)}")
    if url := admin_visit_url(admin_origin, receipt_id):
        lines.append(f"案件：{url}")
    elif receipt_id:
        lines.append(f"案件編號：{receipt_id}")
    lines += ["", "家長的聯絡方式與孩子資料請登入後台查看，信件不附個資。"]
    return f"[常春藤官網] {campus_name}｜{label}", "\n".join(lines)


async def dispatch_outbox_message(
    db: AsyncSession,
    *,
    outbox_message_id: uuid.UUID,
    campus_key: str,
    kind: str,
    payload: dict,
    adapter: EmailAdapter | None,
    created_at: datetime | None = None,
    line: line_api.LineMessagingClient | None = None,
    admin_origin: str | None = None,
) -> bool:
    """處理一筆 outbox 訊息：寫站內通知 → 推播校區的 LINE 群組 → 寄信。
    任何一個管道或收件人失敗都讓整筆工作視為失敗，交給 worker 的重試機制
    處理，不會靜默丟失、也不假裝已送出。`line` 為 None 或這校沒有指定
    群組時略過 LINE。

    `adapter` 為 None 代表部署環境沒有設定寄信：站內通知照寫、email 這個
    管道整個略過。原本「未配置」會讓整批 outbox 停著不處理，結果後台連
    站內通知都收不到；等日後設好 SMTP，又會把累積幾個月的舊通知一次寄出。

    重試時以 notification_deliveries 逐一去重：已經成功寄出的收件人不會
    再收到第二封，站內通知也只會寫一筆——原本整筆重試會讓每一輪都多一
    則站內通知、且已收到信的人重複收信。

    `created_at` 是判斷「太舊不再推播寄信」的基準，人工重新排入的訊息由呼叫端
    傳重新排入的時間。定期工作產生的提醒在這裡先重新判斷是否仍然成立（改期、
    取消、已處理），不成立就什麼都不送並回傳 False，其他情況回傳 True。"""
    if kind in reminders.REMINDER_KINDS and not await reminders.still_applies(db, kind, payload):
        return False
    label = notification_label(kind, payload)

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

    if created_at is not None and datetime.now(timezone.utc) - created_at > EXTERNAL_DELIVERY_STALE_AFTER:
        return True

    if line is not None:
        target = await campus_line_target(db, campus_key)
        if target and not await _already_delivered(db, outbox_message_id, "line", target):
            receipt_id = payload.get("receipt_id")
            await line.push_text(
                target,
                line_text(label, await _campus_name(db, campus_key), receipt_id, admin_origin),
                key=line_api.retry_key(outbox_message_id, target),
            )
            _record_delivery(db, outbox_message_id, "line", target)
            await db.commit()

    if adapter is None:
        return True
    recipients = await get_notification_recipients(db, campus_key)
    pending = [
        user for user in recipients
        if not await _already_delivered(db, outbox_message_id, "email", user.email)
    ]
    if not pending:
        return True
    subject, body = await email_content(
        db,
        label=label,
        campus_key=campus_key,
        receipt_id=payload.get("receipt_id"),
        admin_origin=admin_origin,
        payload=payload,
    )
    for user in pending:
        # SMTP 是阻塞 I/O（連線逾時 20 秒）。定期工作跑在 API 的 event loop
        # 上，直接呼叫會讓這段期間所有請求一起卡住。
        await asyncio.to_thread(
            adapter.send,
            to=_header_safe(user.email),
            subject=_header_safe(subject),
            body=body,
        )
        # 寄成功才記，而且立刻 commit——信已經寄出去了，這個事實不能被
        # 後面其他收件人的失敗回滾掉，否則這個人下一輪會再收一封。
        _record_delivery(db, outbox_message_id, "email", user.email)
        await db.commit()
    return True
