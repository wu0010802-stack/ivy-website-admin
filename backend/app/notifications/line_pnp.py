"""家長通知改用 LINE 通知型訊息送（用電話號碼，2026-11-25，
docs/specs/2026-11-25-line-notification-messages-research.md）。

誰會收到：這筆預約**沒留 Email**、**沒綁 LINE 通知**（綁了的照舊用一般推播卡片），而且這校在後台打開了
「通知型訊息」、這校的家長通知帳號列在 WEBSITE_LINE_PNP_ACCOUNTS（LINE 已開通）。有留 Email 的家長一律只收信
（使用者 2026-11-25 決定）。

用範本型（templated push），版面與開頭那句話由 LINE 固定，我們只填項目與按鈕：
- 預約成功、已變更 → reservation_completed_zh（預約完成通知）
- 已取消 → reservation_cancellation_zh（預約取消通知）
- 參觀提醒 → reservation_reminder_zh（行程預約提醒）
- 停課（含停課日的預約成功／已變更）→ 沒有合適範本，不送（取消範本會說「預約已取消」，但停課是請家長改約）。

「查看詳情」按鈕放修改連結（使用者 2026-11-25 決定；過了線上修改期限就不放，同 Email）。
內容不放家長姓名、孩子資料。"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.outbox import (
    PARENT_VISIT_BOOKED,
    PARENT_VISIT_CANCELLED,
    PARENT_VISIT_CHANGED,
    PARENT_VISIT_REMINDER,
)
from app.config import Settings
from app.notifications import line as line_api
from app.notifications.models import LineParentCampusAccount, LinePnpMessage
from app.notifications.parent_email import ParentEmail, _deadline_text

logger = logging.getLogger("app.line")

TEMPLATE_COMPLETED = "reservation_completed_zh"
TEMPLATE_CANCELLATION = "reservation_cancellation_zh"
TEMPLATE_REMINDER = "reservation_reminder_zh"
ITEM_DATE_TIME = "reservation_date_time_zh"  # 預約日期/時間：
ITEM_DETAIL = "reservation_detail_zh"  # 預約內容：
ITEM_COUNT = "reservation_count_zh"  # 預約人數：
ITEM_PHONE = "contact_phone_zh"  # 聯絡電話：
BUTTON_DETAILS = "check_details_zh"  # 查看詳情

# LINE 的上限（API reference）：強調項目 15 字、其他項目 300 字、按鈕網址 1000 字。
MAX_EMPHASIZED = 15
MAX_ITEM = 300
MAX_BUTTON_URL = 1000
_WEEKDAYS = "一二三四五六日"


def template_for(mail: ParentEmail) -> str | None:
    """這則家長通知用哪個範本；None＝通知型訊息不送（停課內容）。"""
    if mail.kind in (PARENT_VISIT_BOOKED, PARENT_VISIT_CHANGED):
        return None if mail.day_closed else TEMPLATE_COMPLETED
    if mail.kind == PARENT_VISIT_CANCELLED:
        return TEMPLATE_CANCELLATION
    if mail.kind == PARENT_VISIT_REMINDER:
        return None if mail.day_closed else TEMPLATE_REMINDER
    return None


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def template_body(mail: ParentEmail) -> dict:
    """範本的項目與按鈕。同一個項目只能用一次（LINE 會回 400）。"""
    body: dict = {}
    if mail.slot_date and mail.start_time:
        # 「11/03（一）09:30」13 字，放得進強調項目的 15 字。
        when = f"{mail.slot_date:%m/%d}（{_WEEKDAYS[mail.slot_date.weekday()]}）{mail.start_time:%H:%M}"
        body["emphasizedItem"] = {"itemKey": ITEM_DATE_TIME, "content": _clip(when, MAX_EMPHASIZED)}

    detail = f"常春藤{mail.campus_name} 校園參觀"
    if mail.start_time and mail.end_time:
        detail += f"（{mail.start_time:%H:%M}–{mail.end_time:%H:%M}）"
    if mail.campus_address and mail.kind != PARENT_VISIT_CANCELLED:
        detail += f"；地址：{mail.campus_address}"
    if mail.kind != PARENT_VISIT_CANCELLED:
        if mail.manage_url and mail.change_deadline:
            detail += f"；{_deadline_text(mail.change_deadline)} 前可按「查看詳情」改期或取消"
        elif mail.manage_url:
            detail += "；要改期或取消，請按「查看詳情」"
        else:
            detail += "；要改期或取消，請來電洽詢"
    items = [{"itemKey": ITEM_DETAIL, "content": _clip(detail, MAX_ITEM)}]
    if mail.party_size and mail.kind != PARENT_VISIT_CANCELLED:
        items.append({"itemKey": ITEM_COUNT, "content": f"{mail.party_size} 位"})
    if mail.campus_phone:
        items.append({"itemKey": ITEM_PHONE, "content": _clip(mail.campus_phone, MAX_ITEM)})
    body["items"] = items

    # 取消：按鈕開重新預約頁（分校停用就沒有）；其他：開修改連結（過了修改期限就沒有）。
    url = mail.rebook_url if mail.kind == PARENT_VISIT_CANCELLED else mail.manage_url
    if url and len(url) <= MAX_BUTTON_URL:
        body["buttons"] = [{"buttonKey": BUTTON_DETAILS, "url": url}]
    return body


async def campus_account(db: AsyncSession, settings: Settings, campus_key: str) -> str | None:
    """這校現在能用來送通知型訊息的帳號：後台打開了、帳號就是這校的家長通知帳號、金鑰還在、LINE 已開通。"""
    row = await db.get(LineParentCampusAccount, campus_key)
    if (
        row is None
        or not row.pnp_enabled
        or row.account_key not in settings.line_accounts
        or row.account_key not in settings.line_pnp_account_keys
    ):
        return None
    return row.account_key


async def enabled_campuses(db: AsyncSession) -> set[str]:
    """後台打開通知型訊息的校區（只看資料庫）。排信時用：排了之後送出當下還會再看設定，
    帳號沒開通就略過（skipped）。"""
    rows = await db.scalars(select(LineParentCampusAccount.campus_key).where(LineParentCampusAccount.pnp_enabled.is_(True)))
    return set(rows)


def reachable(visit_request, campuses: set[str]) -> bool:
    """排信時判斷：沒留 Email、電話是台灣手機、這校打開了通知型訊息。"""
    return (
        not visit_request.email
        and visit_request.campus_key in campuses
        and line_api.tw_mobile_e164(visit_request.phone) is not None
    )


async def already_attempted(db: AsyncSession, outbox_message_id: uuid.UUID) -> bool:
    """這則通知送過通知型訊息了（不論結果）。通知型訊息不支援 retry key，送過就不再送。"""
    found = await db.scalar(select(LinePnpMessage.id).where(LinePnpMessage.outbox_message_id == outbox_message_id))
    return found is not None


async def mark_delivered(db: AsyncSession, delivery_data: object, now: datetime) -> bool:
    """webhook 的 delivery 事件：delivery.data 是送出時帶的 X-Line-Delivery-Tag（outbox 訊息 id）。
    對不上（例如別的系統用同一個帳號送的）就忽略。回傳有沒有對到。"""
    outbox_message_id = line_api.parse_pnp_delivery_tag(delivery_data)
    if outbox_message_id is None:
        return False
    result = await db.execute(
        update(LinePnpMessage)
        .where(LinePnpMessage.outbox_message_id == outbox_message_id, LinePnpMessage.delivered_at.is_(None))
        .values(delivered_at=now)
    )
    return bool(result.rowcount)
