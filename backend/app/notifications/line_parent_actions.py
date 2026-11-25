"""家長一對一卡片按鈕的 postback（2026-11-25，docs/specs/2026-11-25-line-more-features-design.md §7、§8）。

- 會準時到（`ivy:pa:<案件>`）：參觀提醒卡上的按鈕。記下回覆時間與當時的場次（改期後場次對不上就不算），
  同一場次只寫第一次的歷程。
- 取消預約（`ivy:pc:<案件>`）：「我的預約」卡上的按鈕，只回確認卡、不寫入；確認卡的「確定取消」
  （`ivy:pcok:<案件>:<token>`）帶群組按鈕同一種無狀態 token（綁動作與案件 id、5 分鐘），驗過才寫入；
  「不取消」（`ivy:pcno`）什麼都不寫。

授權：這個 LINE（帳號＋userId）綁在這筆預約上（line_parent_links），而且這個帳號仍是這校目前的家長通知帳號。
綁定是拿修改連結取代碼才建得起來，園方撤銷或重發連結、更正 Email 都會一併解除，所以等同拿著修改連結。
取消的規則同官網家長頁（access_routes.parent_cancel）：鎖案件列重讀場次、已確認、線上異動期限沒過（停課日不受限），
走 workflow_service.cancel（同交易排家長取消通知與園方群組卡片）。

回覆一律 reply（不計則數），由 line_routes 在 commit 之後送。log 不記 userId。"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.booking import history, workflow_service
from app.booking.history import Actor
from app.booking.models import VisitRequest, VisitRequestStatus
from app.booking.parent_policy import change_deadline_hours, day_closed, parent_change_open
from app.common.timezones import slot_start_utc
from app.config import LineAccountCredentials
from app.notifications import line as line_api
from app.notifications import line_flex, line_parent
from app.notifications.line_group_actions import check_token, decode, encode, make_token
from app.notifications.models import LineParentLink
from app.operations import audit_service

ATTEND = "pa"
CANCEL_ASK = "pc"
CANCEL_OK = "pcok"
CANCEL_KEEP = "pcno"
_PART_COUNTS = {ATTEND: 1, CANCEL_ASK: 1, CANCEL_OK: 2, CANCEL_KEEP: 0}

ATTENDANCE_EVENT = "attendance_confirmed"
ATTENDANCE_REPLY = "收到，期待與您見面！"
ATTENDANCE_GONE_REPLY = "這筆預約已無法回覆，輸入「我的預約」可以查看目前的預約。"
DAY_CLOSED_REPLY = "這天園方停課，請依停課通知改約其他時間或取消。"
CANCEL_DONE_REPLY = "已取消這次參觀預約。想再參觀歡迎重新預約。"
CANCEL_KEEP_REPLY = "好的，預約保留不變。"
CANCEL_EXPIRED_REPLY = "這個確認已過期，請到「我的預約」再按一次。"
CANCEL_GONE_REPLY = "這筆預約已無法取消，輸入「我的預約」可以查看目前的預約。"


def attendance_data(visit_request_id: uuid.UUID | str) -> str:
    return encode(ATTEND, str(visit_request_id))


def cancel_data(visit_request_id: uuid.UUID | str) -> str:
    return encode(CANCEL_ASK, str(visit_request_id))


def deadline_text(campus_phone: str | None) -> str:
    call = f"請來電 {campus_phone}" if campus_phone else "請直接聯絡園所"
    return f"已過線上修改期限，要改時間或取消，{call}。"


def parse(event: dict) -> tuple[str, list[str]] | None:
    """家長一對一的 postback；不是我們編的（格式、動作、參數個數不符）回 None。"""
    postback = event.get("postback")
    decoded = decode(postback.get("data")) if isinstance(postback, dict) else None
    if decoded is None or _PART_COUNTS.get(decoded[0]) != len(decoded[1]):
        return None
    return decoded


async def _load(db: AsyncSession, visit_id: str) -> VisitRequest | None:
    try:
        parsed = uuid.UUID(visit_id)
    except ValueError:
        return None
    return await db.scalar(select(VisitRequest).options(selectinload(VisitRequest.slot)).where(VisitRequest.id == parsed))


async def _authorized(
    db: AsyncSession, request: Request, account: LineAccountCredentials, user_id: str, visit: VisitRequest
) -> bool:
    """這個 LINE 綁在這筆預約上，而且這個帳號仍是這校目前的家長通知帳號（後台換帳號或關閉，舊綁定就不算）。"""
    if visit.anonymized_at is not None:
        return False
    linked = await db.scalar(
        select(LineParentLink.id).where(
            LineParentLink.visit_request_id == visit.id,
            LineParentLink.account_key == account.key,
            LineParentLink.line_user_id == user_id,
        )
    )
    if linked is None:
        return False
    return await line_parent.parent_account_key(db, request.app.state.settings, visit.campus_key) == account.key


async def _lock(db: AsyncSession, visit: VisitRequest) -> None:
    """同 access_routes.require_change_window(locked=True)：鎖住案件列重讀狀態與場次，再依鎖內的值判斷。"""
    await workflow_service.lock_status(db, visit)
    await db.refresh(visit, attribute_names=["slot", "anonymized_at", "attendance_confirmed_at", "attendance_confirmed_slot_id"])


async def _attend(
    request: Request, db: AsyncSession, account: LineAccountCredentials, user_id: str, visit: VisitRequest, now: datetime
) -> dict:
    await _lock(db, visit)
    slot = visit.slot
    if (
        not await _authorized(db, request, account, user_id, visit)
        or visit.status != VisitRequestStatus.CONFIRMED.value
        or slot is None
        or slot_start_utc(slot.slot_date, slot.end_time) <= now
    ):
        await db.rollback()
        return line_api.text_message(ATTENDANCE_GONE_REPLY)
    if await day_closed(db, visit):
        await db.rollback()
        return line_api.text_message(DAY_CLOSED_REPLY)
    if visit.parent_attendance_confirmed_at is None:
        visit.attendance_confirmed_at = now
        visit.attendance_confirmed_slot_id = slot.id
        history.record_event(
            db, visit.id, ATTENDANCE_EVENT, actor=Actor.line_parent(), after={"slot": history.slot_brief(slot)}
        )
        await db.commit()
    else:
        await db.rollback()  # 這個場次已回覆過：不再寫，回同一句
    return line_api.text_message(ATTENDANCE_REPLY)


async def _cancel_refusal(db: AsyncSession, visit: VisitRequest) -> dict | None:
    """不能從 LINE 取消的原因（回覆訊息）；可以就回 None。期限同官網家長頁，停課日不受限。"""
    if visit.status != VisitRequestStatus.CONFIRMED.value or visit.slot is None:
        return line_api.text_message(CANCEL_GONE_REPLY)
    hours = await change_deadline_hours(db, visit.campus_key)
    if not parent_change_open(visit, hours, day_closed=await day_closed(db, visit)):
        from app.notifications.service import campus_phone

        return line_api.text_message(deadline_text(await campus_phone(db, visit.campus_key)))
    return None


async def _cancel_ask(
    request: Request, db: AsyncSession, account: LineAccountCredentials, user_id: str, visit: VisitRequest, now: datetime
) -> dict:
    from app.notifications.parent_email import visit_when
    from app.notifications.service import campus_display_name

    if not await _authorized(db, request, account, user_id, visit):
        return line_api.text_message(CANCEL_GONE_REPLY)
    refusal = await _cancel_refusal(db, visit)
    if refusal is not None:
        return refusal
    visit_id = str(visit.id)
    token = make_token(request.app.state.settings.session_secret, CANCEL_OK, visit_id, now=now)
    return line_flex.parent_cancel_confirm(
        f"常春藤{await campus_display_name(db, visit.campus_key)}",
        visit_when(visit.slot.slot_date, visit.slot.start_time),
        ok_data=encode(CANCEL_OK, visit_id, token),
        keep_data=encode(CANCEL_KEEP),
    )


async def _cancel(
    request: Request, db: AsyncSession, account: LineAccountCredentials, user_id: str, visit: VisitRequest
) -> dict:
    await _lock(db, visit)
    if not await _authorized(db, request, account, user_id, visit):
        await db.rollback()
        return line_api.text_message(CANCEL_GONE_REPLY)
    refusal = await _cancel_refusal(db, visit)
    if refusal is not None:
        await db.rollback()
        return refusal
    try:
        await workflow_service.cancel(db, visit, actor=Actor.line_parent())
    except workflow_service.InvalidTransition:
        await db.rollback()
        return line_api.text_message(CANCEL_GONE_REPLY)
    await audit_service.log_action(
        db,
        actor_user_id=None,
        action="line.parent.cancel",
        target_type="visit_request",
        target_id=str(visit.id),
        campus_key=visit.campus_key,
        metadata={"account_key": account.key},
    )
    await db.commit()
    return line_api.text_message(CANCEL_DONE_REPLY)


async def respond(
    request: Request,
    db: AsyncSession,
    account: LineAccountCredentials,
    user_id: str,
    action: str,
    parts: list[str],
    now: datetime,
) -> dict | None:
    """處理一則家長 postback，回傳要回覆的訊息；不回應回 None。每次寫入各自 commit。"""
    if action == CANCEL_KEEP:
        return line_api.text_message(CANCEL_KEEP_REPLY)
    if action == CANCEL_OK and not check_token(
        request.app.state.settings.session_secret, CANCEL_OK, parts[0], parts[1], now=now
    ):
        return line_api.text_message(CANCEL_EXPIRED_REPLY)
    visit = await _load(db, parts[0])
    if visit is None:
        return line_api.text_message(ATTENDANCE_GONE_REPLY if action == ATTEND else CANCEL_GONE_REPLY)
    if action == ATTEND:
        return await _attend(request, db, account, user_id, visit, now)
    if action == CANCEL_ASK:
        return await _cancel_ask(request, db, account, user_id, visit, now)
    return await _cancel(request, db, account, user_id, visit)
