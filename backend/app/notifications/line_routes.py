"""LINE 群組推播：webhook（記錄 bot 所在的群組）與後台設定。

設定流程：官方帳號開啟 Messaging API 與 webhook（網址見後台「LINE 通知」頁）
→ 把官方帳號拉進各校員工群組 → 後台產生驗證碼、貼到群組裡（群組標記為已驗證）
→ 後台替每校選群組 → 按「送測試訊息」確認。

驗證碼是因為任何人都能把官方帳號拉進自己取名的群組（例如取名「義華行政群」），
沒有驗證就會混在可選清單裡；貼得出後台驗證碼的群組才證明裡面有看得到後台的人。"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.booking import access_service
from app.booking.access_routes import (
    PARENT_SESSION_COOKIE,
    _require_parent_session,
    _require_same_visit_request,
    require_parent_request,
)
from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.booking.parent_policy import change_deadline_hours, day_closed, parent_change_open
from app.common.timezones import slot_start_utc, today_local
from app.campuses.models import CAMPUS_KEYS, Campus
from app.common import ratelimit
from app.config import LINE_MAIN_ACCOUNT, LINE_ONE_TO_ONE_ACCOUNT_KEYS, LINE_SHARED_ACCOUNT_KEYS, LineAccountCredentials
from app.notifications import line as line_api
from app.notifications import (
    line_accounts, line_flex, line_group_actions, line_group_commands, line_parent, line_parent_actions, line_pnp,
)
from app.notifications.line_group_settings import GROUP_KINDS, STAFF_KINDS
from app.notifications.parent_email import visit_when
from app.notifications.models import (
    LineCampusTarget,
    LineGroup,
    LineGroupSetting,
    LineGroupVerificationCode,
    LineParentCampusAccount,
    LineParentLink,
)
from app.notifications.service import campus_display_name, campus_line_target, campus_phone, staff_line_message
from app.operations import audit_service

logger = logging.getLogger("app.line")

router = APIRouter(prefix="/api/website/v1", tags=["line"])

WEBHOOK_PATH = "/api/website/v1/line/webhook"
# 測試推播會用掉官方帳號的每月則數，限制一下誤按連點。
TEST_PUSH_LIMIT = ratelimit.Limit("line_test_push", window_seconds=600, max_per_window=5)
# 群組驗證碼 10 分鐘內有效；每人 10 分鐘最多產生 10 個，同時有效的碼不會太多。
VERIFICATION_CODE_TTL = timedelta(minutes=10)
VERIFICATION_CODE_LIMIT = ratelimit.Limit("line_verification_code", window_seconds=600, max_per_window=10)
_SEEN_EVENTS = {"join", "message", "memberJoined", "memberLeft", "follow", "postback"}
# 家長一對一：同一個 LINE 一分鐘內最多處理 10 則代碼或「我的預約」（亂猜代碼、洗回覆都擋得住）。
PARENT_MESSAGE_LIMIT = ratelimit.Limit("line_parent_message", window_seconds=60, max_per_window=10)
CODE_INVALID_REPLY = "這組代碼已失效或已經用過了。請回到預約頁，再按一次「用 LINE 接收通知」取得新的代碼。"
NOT_FRIEND_REPLY = "提醒您：請把我們加入好友，才收得到之後的通知。"
NO_VISITS_REPLY = (
    "目前沒有綁定在這個 LINE 的參觀預約。\n\n"
    "預約完成頁或預約確認信的修改頁，按「用 LINE 接收通知」就能把預約綁到這裡。"
)


def _client(request: Request, account: LineAccountCredentials | None = None) -> line_api.LineMessagingClient:
    settings = request.app.state.settings
    token = account.access_token if account is not None else settings.line_messaging_access_token
    return line_api.LineMessagingClient(token, transport=getattr(request.app.state, "line_transport", None))


def _target(event: dict) -> tuple[str, str] | None:
    source = event.get("source")
    if not isinstance(source, dict):
        return None
    source_type = source.get("type")
    target_id = source.get("groupId") if source_type == "group" else source.get("roomId") if source_type == "room" else None
    if not isinstance(target_id, str) or not line_api.TARGET_ID_RE.match(target_id):
        return None
    return source_type, target_id


def _user(event: dict) -> str | None:
    """一對一（家長加好友或傳訊息給官方帳號）的 userId。"""
    source = event.get("source")
    if not isinstance(source, dict) or source.get("type") != "user":
        return None
    user_id = source.get("userId")
    return user_id if isinstance(user_id, str) and line_api.USER_ID_RE.match(user_id) else None


async def _matching_code(
    db: AsyncSession, secret: str, event: dict, now: datetime
) -> LineGroupVerificationCode | None:
    """群組裡的文字訊息含有還沒過期、還沒用過的驗證碼時回傳那一筆（已上鎖）。
    只拿訊息文字來比對雜湊，不存任何訊息內容。"""
    text = _event_text(event)
    if text is None:
        return None
    for candidate in line_api.verification_code_candidates(text):
        result = await db.execute(
            select(LineGroupVerificationCode)
            .where(
                LineGroupVerificationCode.code_hash == line_api.verification_code_hash(secret, candidate),
                LineGroupVerificationCode.used_at.is_(None),
                LineGroupVerificationCode.expires_at > now,
            )
            .with_for_update()
        )
        code = result.scalar_one_or_none()
        if code is not None:
            return code
    return None


def _event_text(event: dict) -> str | None:
    message = event.get("message")
    if event.get("type") != "message" or not isinstance(message, dict) or message.get("type") != "text":
        return None
    text = message.get("text")
    return text if isinstance(text, str) else None


def _reply_token(event: dict) -> str | None:
    token = event.get("replyToken")
    return token if isinstance(token, str) and 0 < len(token) <= 200 else None


async def _verified_events(request: Request, account: LineAccountCredentials) -> list[dict]:
    body = await request.body()
    if not line_api.verify_signature(account.channel_secret, body, request.headers.get("x-line-signature")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="簽章不符")
    try:
        payload = json.loads(body)
        events = payload.get("events", []) if isinstance(payload, dict) else []
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="格式錯誤") from exc
    return [event for event in events if isinstance(event, dict)] if isinstance(events, list) else []


@router.post("/line/webhook", include_in_schema=False)
async def line_webhook(request: Request, db: AsyncSession = Depends(get_db_session)) -> dict:
    """園方群組推播帳號（main）的 webhook：群組／多人聊天室的進出與驗證碼，用來知道 bot 在哪些群組；
    2026-11-16 起也處理一對一的家長事件（這個帳號被選為某校的家長通知帳號時）。
    不存任何訊息內容。簽章不符一律拒絕。"""
    account = request.app.state.settings.line_accounts.get(LINE_MAIN_ACCOUNT)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    events = await _verified_events(request, account)
    await _handle_pnp_deliveries(db, events)
    await _handle_group_events(request, db, events)
    await line_group_commands.handle(request, db, events)
    await line_group_actions.handle(request, db, events)
    await _handle_user_events(request, db, account, events)
    return {}


@router.post("/line/webhook/{account_key}", include_in_schema=False)
async def line_campus_webhook(account_key: str, request: Request, db: AsyncSession = Depends(get_db_session)) -> dict:
    """各校自己官方帳號與總部帳號（hq，2026-11-25）的 webhook：只處理一對一的家長事件（綁定代碼、我的預約、
    加好友／封鎖）與通知型訊息的送達事件。群組事件不處理：園方群組推播一律用 main 帳號。"""
    settings = request.app.state.settings
    account = settings.line_accounts.get(account_key) if account_key in LINE_ONE_TO_ONE_ACCOUNT_KEYS else None
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    events = await _verified_events(request, account)
    await _handle_pnp_deliveries(db, events)
    await _handle_user_events(request, db, account, events)
    return {}


async def _handle_pnp_deliveries(db: AsyncSession, events: list[dict]) -> None:
    """通知型訊息送到家長手機：LINE 送 type=delivery，delivery.data 是送出時帶的 X-Line-Delivery-Tag
    （2026-11-25）。這個事件沒有 source（不知道是誰），只記送達時間。"""
    now = datetime.now(timezone.utc)
    matched = False
    for event in events:
        if event.get("type") != "delivery":
            continue
        delivery = event.get("delivery")
        if isinstance(delivery, dict) and await line_pnp.mark_delivered(db, delivery.get("data"), now):
            matched = True
    if matched:
        await db.commit()


def _is_rejoin(event: dict, group: LineGroup) -> bool:
    """這個事件代表官方帳號「被移出後又回到群組」。

    - 記錄上已離開（left_at）又收到事件；
    - 或是收到 join：join 本身就表示官方帳號上一刻不在群組裡。只看 left_at 的話，離開的 webhook 漏收
      （部署重啟時回 5xx、同一批事件後面出錯整批回滾）時，拉回來就默默恢復一切（2026-11-26 資安檢查）。
      LINE 重送（isRedelivery）的 join 是舊事件，記錄上又沒離開時不當作回來。"""
    if group.left_at is not None:
        return True
    if event.get("type") != "join":
        return False
    context = event.get("deliveryContext")
    return not (isinstance(context, dict) and context.get("isRedelivery") is True)


async def _reset_rejoined_group(db: AsyncSession, group: LineGroup, now: datetime) -> None:
    """官方帳號被移出後又回到這個群組：當成一個新群組，要總管理者重新驗證、重新設定。

    - 解除原本綁的校區、取消總部群組（_unbind_rejoined_group；總部群組離開時通常已取消）。
    - 清掉驗證紀錄（2026-11-26 資安檢查）：驗證碼證明的是「當時有管理者在這個群組裡」，官方帳號離開期間
      成員可能已經換了；不清的話後台仍標「已驗證」，總管理者不用新驗證碼就能再選它當校區或總部群組。
    - 清掉群組名稱，回來後重新向 LINE 取：後台才不會一直顯示離開前那個看起來可信的名稱。"""
    await _unbind_rejoined_group(db, group.target_id)
    setting = await db.get(LineGroupSetting, group.target_id)
    if setting is not None and setting.is_hq:
        setting.is_hq = False
        setting.updated_at = now
        setting.updated_by = None
    group.verified_at = None
    group.name = None


async def _unbind_rejoined_group(db: AsyncSession, target_id: str) -> None:
    """官方帳號被移出後又回到這個群組：解除它原本綁的校區，要總管理者在後台重新選（2026-11-19 資安審查）。

    園方可能就是用「把官方帳號移出群組」來停用這個群組，而群組裡任何人都能再把它拉回來；不解除的話，
    回來的那一刻就默默恢復收該校卡片、查名單與按鈕寫入。總部群組在離開時就取消（見呼叫端）；校區綁定
    留到回來才解除，離開期間後台才看得到「群組已離開，目前不會推播」。"""
    targets = (
        await db.execute(
            select(LineCampusTarget)
            .where(LineCampusTarget.target_id == target_id)
            .order_by(LineCampusTarget.campus_key)
            .with_for_update()
        )
    ).scalars().all()
    for target in targets:
        await db.delete(target)
        await audit_service.log_action(
            db,
            actor_user_id=None,
            action="line.campus_target.update",
            target_type="campus",
            target_id=target.campus_key,
            campus_key=target.campus_key,
            metadata={"before": target_id, "after": None, "reason": "line_group_rejoined"},
        )


async def _handle_group_events(request: Request, db: AsyncSession, events: list[dict]) -> None:
    settings = request.app.state.settings
    now = datetime.now(timezone.utc)
    unnamed: set[str] = set()
    for event in events:
        found = _target(event)
        if found is None:
            continue
        source_type, target_id = found
        group = await db.get(LineGroup, target_id)
        if event.get("type") == "leave":
            if group is not None and group.left_at is None:
                group.left_at = now
            # 離開就不再是總部群組：之後有人再把官方帳號拉回來，不會默默恢復收五校卡片與按鈕寫入權，
            # 要總管理者在後台重新設定。其他開關（種類、摘要、@所有人）照留。校區綁定在回來時才解除
            # （_unbind_rejoined_group）。
            setting = await db.get(LineGroupSetting, target_id)
            if setting is not None and setting.is_hq:
                setting.is_hq = False
                setting.updated_at = now
                setting.updated_by = None
            continue
        if event.get("type") not in _SEEN_EVENTS:
            continue
        if group is None:
            group = LineGroup(
                target_id=target_id, source_type=source_type, first_seen_at=now, last_seen_at=now
            )
            db.add(group)
        elif _is_rejoin(event, group):
            await _reset_rejoined_group(db, group, now)
        group.last_seen_at = now
        group.left_at = None
        if group.name is None and source_type == "group":
            unnamed.add(target_id)
        if group.verified_at is None:
            code = await _matching_code(db, settings.session_secret, event, now)
            if code is not None:
                # 一次性：用掉之後同一個碼貼到別的群組不會再通過。
                code.used_at = now
                code.used_target_id = target_id
                group.verified_at = now
                await audit_service.log_action(
                    db,
                    actor_user_id=code.created_by,
                    action="line.group.verify",
                    target_type="line_group",
                    target_id=target_id,
                    metadata={"verification_code_id": str(code.id), "source_type": source_type},
                )
    await db.commit()

    # 群組名稱只是方便後台辨認，拿不到就算了；放在 commit 之後，LINE API
    # 慢或失敗都不影響已記下的群組。
    if unnamed:
        async with _client(request) as client:
            for target_id in unnamed:
                name = await client.group_name(target_id)
                if name:
                    group = await db.get(LineGroup, target_id)
                    if group is not None and group.name is None:
                        group.name = name
        await db.commit()


async def _handle_user_events(
    request: Request, db: AsyncSession, account: LineAccountCredentials, events: list[dict]
) -> None:
    """一對一事件：綁定代碼、「我的預約」、加好友／封鎖、卡片按鈕（會準時到、取消預約，2026-11-25，
    line_parent_actions）。回覆（reply）不計則數，放在 commit 之後送，LINE 慢或失敗都不影響已寫入的資料。"""
    settings = request.app.state.settings
    now = datetime.now(timezone.utc)
    replies: list[tuple[str, str, list[dict]]] = []  # (reply token, userId, messages)
    bound: list[tuple[str, str]] = []  # (reply token, userId)：綁定成功、回覆前要查是不是好友
    for event in events:
        user_id = _user(event)
        if user_id is None:
            continue
        kind = event.get("type")
        if kind in ("follow", "unfollow"):
            await line_parent.set_follow_state(db, account.key, user_id, following=kind == "follow", now=now)
            continue
        token = _reply_token(event)
        if kind == "postback":
            parsed = line_parent_actions.parse(event)
            if parsed is None or token is None:
                continue
            try:
                await ratelimit.limiter(request).check(PARENT_MESSAGE_LIMIT, f"{account.key}:{user_id}")
            except ratelimit.RateLimited:
                continue
            # 先 commit 前面事件的寫入（加好友狀態、綁定）：按鈕各自鎖列、各自 commit 或 rollback。
            await db.commit()
            message = await line_parent_actions.respond(request, db, account, user_id, *parsed, now)
            if message is not None:
                replies.append((token, user_id, [message]))
            continue
        text = _event_text(event)
        if text is None:
            continue
        looked_like_code = bool(line_api.parent_code_candidates(text))
        if looked_like_code or line_parent.is_my_visits_request(text):
            try:
                await ratelimit.limiter(request).check(PARENT_MESSAGE_LIMIT, f"{account.key}:{user_id}")
            except ratelimit.RateLimited:
                continue
        if looked_like_code:
            _, visit_request = await line_parent.consume_code(db, settings, account.key, text, user_id, now)
            if visit_request is None:
                if token:
                    replies.append((token, user_id, [line_api.text_message(CODE_INVALID_REPLY)]))
                continue
            await audit_service.log_action(
                db,
                actor_user_id=None,
                action="line.parent.link",
                target_type="visit_request",
                target_id=str(visit_request.id),
                campus_key=visit_request.campus_key,
                metadata={"account_key": account.key},
            )
            if token:
                replies.append((token, user_id, [line_api.text_message(await _linked_text(db, visit_request))]))
                bound.append((token, user_id))
            continue
        if line_parent.is_my_visits_request(text) and token:
            replies.append((token, user_id, await _my_visits_messages(request, db, account.key, user_id, now)))
    await db.commit()
    if not replies:
        return
    bound_tokens = dict(bound)
    async with _client(request, account) as client:
        for token, user_id, messages in replies:
            if token in bound_tokens and await client.is_friend(user_id) is False:
                messages = [*messages, line_api.text_message(NOT_FRIEND_REPLY)]
            try:
                await client.reply(token, messages)
            except (line_api.LinePushError, httpx.HTTPError) as exc:
                logger.warning("LINE 回覆失敗：account=%s error=%s", account.key, exc)


async def _linked_text(db: AsyncSession, visit_request: VisitRequest) -> str:
    campus = await campus_display_name(db, visit_request.campus_key)
    slot = visit_request.slot
    when = f"\n{visit_when(slot.slot_date, slot.start_time)}" if slot is not None else ""
    return (
        f"已開啟 LINE 通知\n常春藤{campus}{when}\n\n"
        "之後的參觀提醒、改期與取消通知都會傳到這裡。想查看預約，隨時輸入「我的預約」。"
    )


async def _my_visits_messages(
    request: Request, db: AsyncSession, account_key: str, user_id: str, now: datetime
) -> list[dict]:
    settings = request.app.state.settings
    visits = await line_parent.linked_upcoming_visits(db, account_key, user_id, now)
    if not visits:
        return [line_api.text_message(NO_VISITS_REPLY)]
    origin = (settings.parent_origin or "").rstrip("/") or None
    items = []
    for visit in visits:
        path = await access_service.current_manage_path(db, visit.id, secret=settings.session_secret) if origin else None
        # 「取消預約」只在線上異動期限內（停課日不受限，同官網家長頁）；過了改寫請來電（2026-11-25）。
        hours = await change_deadline_hours(db, visit.campus_key)
        change_open = parent_change_open(visit, hours, day_closed=await day_closed(db, visit))
        items.append({
            "campus_name": f"常春藤{await campus_display_name(db, visit.campus_key)}",
            "when": visit_when(visit.slot.slot_date, visit.slot.start_time),
            "manage_url": f"{origin}{path}" if origin and path else None,
            "note": "請勿把修改連結轉給他人。" if origin and path else None,
            "cancel_data": line_parent_actions.cancel_data(visit.id) if change_open else None,
            "deadline_note": (
                None if change_open else line_parent_actions.deadline_text(await campus_phone(db, visit.campus_key))
            ),
        })
    return [line_flex.my_visits_carousel(items)]


class LineGroupOut(BaseModel):
    target_id: str
    source_type: str
    name: str | None
    first_seen_at: datetime
    last_seen_at: datetime
    left_at: datetime | None
    # 在群組裡貼過後台驗證碼的時間；NULL 的群組不能被選為校區推播目標
    # （已經綁定的照常推播）。
    verified_at: datetime | None
    # 每群組的通知設定（沒有設定列＝預設值，由 _settings_out 補上）。
    kinds: list[str] = list(STAFF_KINDS)
    digest_enabled: bool = True
    mention_all_same_day: bool = True
    is_hq: bool = False


class LineGroupSettingsUpdate(BaseModel):
    kinds: list[str]
    digest_enabled: bool
    mention_all_same_day: bool
    is_hq: bool

    @field_validator("kinds")
    @classmethod
    def _known_kinds(cls, value: list[str]) -> list[str]:
        unknown = [kind for kind in value if kind not in GROUP_KINDS]
        if unknown:
            raise ValueError(f"未知的通知種類：{', '.join(unknown)}")
        return [kind for kind in GROUP_KINDS if kind in value]


class LineCampusTargetOut(BaseModel):
    campus_key: str
    campus_name: str
    target_id: str | None


class LineQuotaOut(BaseModel):
    # None＝這個帳號沒有設上限（LINE 回 type none）。
    limit: int | None
    used: int
    warning: bool


class LineAccountOut(BaseModel):
    """一個設好的官方帳號（2026-11-16）。key：main＝園方群組推播帳號，hq＝總部／品牌帳號（2026-11-25），
    其餘是校區鍵（該校自己的帳號）。"""

    key: str
    webhook_url: str | None
    display_name: str | None
    basic_id: str | None
    quota: LineQuotaOut | None
    # 查不到額度：LINE 回的 HTTP 狀態碼（401＝金鑰失效）；連不上時為 0。
    quota_error_status: int | None = None
    # LINE 已開通通知型訊息（列在 WEBSITE_LINE_PNP_ACCOUNTS，2026-11-25）。
    pnp_available: bool = False


class LineParentCampusOut(BaseModel):
    campus_key: str
    campus_name: str
    # 家長 LINE 通知用的帳號鍵；None＝沒開。選的帳號金鑰已拿掉時也回 None。
    account_key: str | None
    # 這校目前綁了 LINE 通知、還沒結束的預約數（看有沒有家長在用）。
    linked_upcoming: int
    # 沒留 Email、也沒綁 LINE 的家長改用通知型訊息送（2026-11-25）。選的帳號沒開通時回 False。
    pnp_enabled: bool = False


class LineSettingsOut(BaseModel):
    enabled: bool
    webhook_url: str | None
    groups: list[LineGroupOut]
    targets: list[LineCampusTargetOut]
    accounts: list[LineAccountOut] = []
    parent_campuses: list[LineParentCampusOut] = []


class LineParentCampusUpdate(BaseModel):
    account_key: str | None
    # 通知型訊息（2026-11-25）：只有選的帳號已開通（WEBSITE_LINE_PNP_ACCOUNTS）才能打開；沒帶＝關。
    pnp_enabled: bool = False


class LineCampusTargetUpdate(BaseModel):
    target_id: str | None


class LineVerificationCodeOut(BaseModel):
    # 只在產生時回傳這一次，資料庫只存雜湊。
    code: str
    expires_at: datetime


def _group_out(group: LineGroup, setting: LineGroupSetting | None) -> LineGroupOut:
    out = LineGroupOut.model_validate(group, from_attributes=True)
    if setting is not None:
        out.kinds = list(setting.kinds or [])
        out.digest_enabled = setting.digest_enabled
        out.mention_all_same_day = setting.mention_all_same_day
        out.is_hq = setting.is_hq
    return out


async def _settings_out(request: Request, db: AsyncSession) -> LineSettingsOut:
    settings = request.app.state.settings
    groups = (await db.execute(select(LineGroup).order_by(LineGroup.first_seen_at))).scalars().all()
    # 依全站固定順序（義華、明華、崇德、國際、仁武），不照 key 的字母排。
    order = {key: index for index, key in enumerate(CAMPUS_KEYS)}
    campuses = sorted(
        (await db.execute(select(Campus))).scalars().all(), key=lambda c: (order.get(c.key, len(order)), c.key)
    )
    group_settings = {
        row.target_id: row for row in (await db.execute(select(LineGroupSetting))).scalars().all()
    }
    mapping = dict((await db.execute(select(LineCampusTarget.campus_key, LineCampusTarget.target_id))).all())
    parent_rows = {row.campus_key: row for row in (await db.execute(select(LineParentCampusAccount))).scalars().all()}
    parent_mapping = {key: row.account_key for key, row in parent_rows.items()}
    configured = settings.line_accounts
    linked = await _linked_upcoming_counts(db)
    # 查 LINE 之前先結束這次的讀取交易，不握著連線等外部 API。
    await db.commit()
    statuses = await line_accounts.all_statuses(settings, getattr(request.app.state, "line_transport", None))
    return LineSettingsOut(
        enabled=settings.line_messaging_enabled,
        webhook_url=f"{settings.admin_origin.rstrip('/')}{WEBHOOK_PATH}" if settings.admin_origin else None,
        groups=[_group_out(g, group_settings.get(g.target_id)) for g in groups],
        targets=[
            LineCampusTargetOut(campus_key=c.key, campus_name=c.name, target_id=mapping.get(c.key))
            for c in campuses
        ],
        accounts=[_account_out(status_, settings) for status_ in statuses],
        parent_campuses=[
            LineParentCampusOut(
                campus_key=c.key,
                campus_name=c.name,
                account_key=parent_mapping.get(c.key) if parent_mapping.get(c.key) in configured else None,
                linked_upcoming=linked.get(c.key, 0),
                pnp_enabled=(
                    c.key in parent_rows
                    and parent_rows[c.key].pnp_enabled
                    and parent_mapping[c.key] in configured
                    and parent_mapping[c.key] in settings.line_pnp_account_keys
                ),
            )
            for c in campuses
        ],
    )


def _account_out(account: line_accounts.AccountStatus, settings) -> LineAccountOut:
    quota = None
    if account.quota_used is not None:
        quota = LineQuotaOut(limit=account.quota_limit, used=account.quota_used, warning=account.quota_warning)
    return LineAccountOut(
        key=account.key,
        webhook_url=account.webhook_url,
        display_name=account.display_name,
        basic_id=account.basic_id,
        quota=quota,
        quota_error_status=(account.quota_error_status or 0) if account.quota_error else None,
        pnp_available=account.key in settings.line_pnp_account_keys,
    )


async def _linked_upcoming_counts(db: AsyncSession) -> dict[str, int]:
    rows = (
        await db.execute(
            select(VisitRequest.campus_key, func.count())
            .join(LineParentLink, LineParentLink.visit_request_id == VisitRequest.id)
            .join(VisitSlot, VisitSlot.id == VisitRequest.slot_id)
            .where(
                LineParentLink.unfollowed_at.is_(None),
                VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
                VisitSlot.slot_date >= today_local(),
            )
            .group_by(VisitRequest.campus_key)
        )
    ).all()
    return {campus_key: count for campus_key, count in rows}


@router.put("/admin/line/parent-accounts/{campus_key}", response_model=LineSettingsOut)
async def update_line_parent_account(
    campus_key: str,
    payload: LineParentCampusUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LineSettingsOut:
    """選這校的家長 LINE 通知用哪個官方帳號（None＝關閉）。只能選設好金鑰的帳號；
    main、hq（總部帳號）以外只能選這校自己的帳號（別校的帳號不能拿來發這校的通知）。
    關閉或換帳號時，已綁定的家長之後不再收到 LINE（綁在舊帳號上的 userId 換了帳號也推不到）。
    pnp_enabled（2026-11-25）：沒留 Email、也沒綁 LINE 的家長改用通知型訊息送；選的帳號要 LINE 已開通。"""
    require_scope(current_user, "notifications.manage")
    await _campus(db, campus_key)
    settings = request.app.state.settings
    if payload.account_key is not None and (
        payload.account_key not in settings.line_accounts
        or payload.account_key not in (*LINE_SHARED_ACCOUNT_KEYS, campus_key)
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "LINE_ACCOUNT_UNAVAILABLE", "message": "這個官方帳號還沒設定金鑰，或不能用在這個校區"},
        )
    if payload.pnp_enabled and (payload.account_key is None or payload.account_key not in settings.line_pnp_account_keys):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "LINE_PNP_UNAVAILABLE", "message": "這個官方帳號還沒開通 LINE 通知型訊息"},
        )
    existing = await db.get(LineParentCampusAccount, campus_key, with_for_update=True)
    before = existing.account_key if existing else None
    before_pnp = bool(existing and existing.pnp_enabled)
    dropped = 0
    if before != payload.account_key:
        dropped = await line_parent.drop_campus_links(db, campus_key, keep_account=payload.account_key)
    if payload.account_key is None:
        if existing is not None:
            await db.delete(existing)
    elif existing is None:
        db.add(
            LineParentCampusAccount(
                campus_key=campus_key,
                account_key=payload.account_key,
                pnp_enabled=payload.pnp_enabled,
                updated_at=datetime.now(timezone.utc),
                updated_by=current_user.id,
            )
        )
    else:
        existing.account_key = payload.account_key
        existing.pnp_enabled = payload.pnp_enabled
        existing.updated_at = datetime.now(timezone.utc)
        existing.updated_by = current_user.id
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="line.parent_account.update",
        target_type="campus",
        target_id=campus_key,
        campus_key=campus_key,
        metadata={
            "before": before,
            "after": payload.account_key,
            "dropped_links": dropped,
            "pnp_before": before_pnp,
            "pnp_after": payload.pnp_enabled,
        },
    )
    await db.commit()
    return await _settings_out(request, db)


@router.get("/admin/line", response_model=LineSettingsOut)
async def get_line_settings(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LineSettingsOut:
    require_scope(current_user, "notifications.manage")
    return await _settings_out(request, db)


async def _campus(db: AsyncSession, campus_key: str) -> Campus:
    campus = (await db.execute(select(Campus).where(Campus.key == campus_key))).scalar_one_or_none()
    if campus is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個校區")
    return campus


@router.put("/admin/line/campus-targets/{campus_key}", response_model=LineSettingsOut)
async def update_line_campus_target(
    campus_key: str,
    payload: LineCampusTargetUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LineSettingsOut:
    require_scope(current_user, "notifications.manage")
    await _campus(db, campus_key)
    existing = await db.get(LineCampusTarget, campus_key, with_for_update=True)
    before = existing.target_id if existing else None
    if payload.target_id is None:
        if existing is not None:
            await db.delete(existing)
    else:
        group = await db.get(LineGroup, payload.target_id)
        if group is None or group.left_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "LINE_GROUP_UNAVAILABLE", "message": "官方帳號不在這個群組裡，請重新把它拉進群組"},
            )
        # 重存目前的設定照常放行：修補前綁好的群組沒有驗證紀錄，不因此被擋。
        if group.verified_at is None and group.target_id != before:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "LINE_GROUP_UNVERIFIED",
                    "message": "這個群組還沒驗證：請先產生驗證碼，貼到要綁定的 LINE 群組裡，再選這個群組",
                },
            )
        now = datetime.now(timezone.utc)
        if existing is None:
            db.add(
                LineCampusTarget(
                    campus_key=campus_key, target_id=group.target_id, updated_at=now, updated_by=current_user.id
                )
            )
        else:
            existing.target_id = group.target_id
            existing.updated_at = now
            existing.updated_by = current_user.id
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="line.campus_target.update",
        target_type="campus",
        target_id=campus_key,
        campus_key=campus_key,
        metadata={"before": before, "after": payload.target_id},
    )
    await db.commit()
    return await _settings_out(request, db)


@router.put("/admin/line/groups/{target_id}", response_model=LineSettingsOut)
async def update_line_group_settings(
    target_id: str,
    payload: LineGroupSettingsUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LineSettingsOut:
    """每個群組的通知種類、每日摘要、當天異動 @所有人，以及是否為總部群組（收全部校區）。"""
    require_scope(current_user, "notifications.manage")
    group = await db.get(LineGroup, target_id)
    if group is None or group.left_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個群組")
    if payload.is_hq and group.verified_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "LINE_GROUP_UNVERIFIED",
                "message": "這個群組還沒驗證：請先產生驗證碼，貼到要綁定的 LINE 群組裡，再設為總部群組",
            },
        )
    setting = await db.get(LineGroupSetting, target_id, with_for_update=True)
    if setting is None:
        setting = LineGroupSetting(target_id=target_id, updated_at=datetime.now(timezone.utc))
        db.add(setting)
    setting.kinds = payload.kinds
    setting.digest_enabled = payload.digest_enabled
    setting.mention_all_same_day = payload.mention_all_same_day
    setting.is_hq = payload.is_hq
    setting.updated_at = datetime.now(timezone.utc)
    setting.updated_by = current_user.id
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="line.group.settings.update",
        target_type="line_group",
        target_id=target_id,
        metadata={
            "kinds": payload.kinds,
            "digest_enabled": payload.digest_enabled,
            "mention_all_same_day": payload.mention_all_same_day,
            "is_hq": payload.is_hq,
        },
    )
    await db.commit()
    return await _settings_out(request, db)


@router.post(
    "/admin/line/verification-codes",
    response_model=LineVerificationCodeOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_line_verification_code(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LineVerificationCodeOut:
    """產生一次性驗證碼。把它貼到要綁定的 LINE 群組，webhook 收到後把那個群組
    標記為已驗證，之後才能選為校區推播目標。10 分鐘內有效、只能用一次。"""
    require_scope(current_user, "notifications.manage")
    settings = request.app.state.settings
    if not settings.line_messaging_enabled:
        # 沒有 webhook 就收不到群組裡的訊息，驗證碼沒有用處。
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "LINE_NOT_CONFIGURED", "message": "尚未設定 LINE 官方帳號的 Messaging API 金鑰"},
        )
    try:
        await ratelimit.limiter(request).check(VERIFICATION_CODE_LIMIT, str(current_user.id))
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "驗證碼產生太多次了，請稍後再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

    code = line_api.new_verification_code()
    now = datetime.now(timezone.utc)
    row = LineGroupVerificationCode(
        id=uuid.uuid4(),
        code_hash=line_api.verification_code_hash(settings.session_secret, code),
        created_by=current_user.id,
        created_at=now,
        expires_at=now + VERIFICATION_CODE_TTL,
    )
    db.add(row)
    # 稽核只記是哪一筆與到期時間，不記驗證碼本身。
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="line.verification_code.create",
        target_type="line_verification_code",
        target_id=str(row.id),
        metadata={"expires_at": row.expires_at.isoformat()},
    )
    await db.commit()
    return LineVerificationCodeOut(code=code, expires_at=row.expires_at)


@router.post("/admin/line/campus-targets/{campus_key}/test", status_code=status.HTTP_204_NO_CONTENT)
async def send_line_test_message(
    campus_key: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """送一則測試訊息到這校指定的群組，確認設定真的通。"""
    require_scope(current_user, "notifications.manage")
    settings = request.app.state.settings
    if not settings.line_messaging_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "LINE_NOT_CONFIGURED", "message": "尚未設定 LINE 官方帳號的 Messaging API 金鑰"},
        )
    campus = await _campus(db, campus_key)
    target = await campus_line_target(db, campus_key)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "LINE_TARGET_MISSING", "message": "這個校區還沒有指定 LINE 群組"},
        )
    try:
        await ratelimit.limiter(request).check(TEST_PUSH_LIMIT, str(current_user.id))
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "測試訊息送太多次了，請稍後再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

    message = staff_line_message("LINE 通知測試", campus.name, None, None)
    message["contents"]["body"]["contents"].append(
        {"type": "text", "text": "之後這校的參觀案件通知會送到這個群組。", "wrap": True, "size": "sm", "margin": "md"}
    )
    try:
        async with _client(request) as client:
            await client.push(target, [message], key=uuid.uuid4())
    except (line_api.LinePushError, httpx.HTTPError) as exc:
        logger.warning("LINE 測試推播失敗：%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "LINE_PUSH_FAILED", "message": "LINE 推播失敗，請確認金鑰與官方帳號仍在群組裡"},
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="line.test_push",
        target_type="campus",
        target_id=campus_key,
        campus_key=campus_key,
    )
    await db.commit()


# --- 家長頁：用 LINE 接收通知（2026-11-16，規格 §4）--------------------------------------------
# 都要家長 session（點過修改連結、或預約完成頁用回應裡的連結換過）；寫入另要 X-Ivy-Parent（同其他家長端點）。

# 同一筆預約 10 分鐘內最多產生 10 組代碼。
PARENT_CODE_LIMIT = ratelimit.Limit("line_parent_code", window_seconds=600, max_per_window=10)


class ParentLineNotifyOut(BaseModel):
    # 這校有開家長 LINE 通知、而且這筆預約還能收通知（已確認、沒結束）。
    available: bool
    # 這筆預約已經綁了 LINE（家長沒封鎖官方帳號）。
    linked: bool
    account_name: str | None = None
    basic_id: str | None = None
    add_friend_url: str | None = None


class ParentLineCodeOut(BaseModel):
    code: str
    expires_at: datetime
    # 手機點了開 LINE、預填文字的網址；桌機拿來畫 QR code。
    message_url: str
    # 預填的整句文字（桌機不能掃 QR 時，手動加好友後照打）。
    text: str
    basic_id: str
    account_name: str | None = None
    add_friend_url: str


async def _notify_state(
    request: Request, db: AsyncSession, visit_request: VisitRequest
) -> tuple[str | None, line_api.BotInfo | None]:
    """(帳號鍵, 帳號資訊)；這筆預約不能開 LINE 通知時帳號鍵是 None。"""
    settings = request.app.state.settings
    if visit_request.status != VisitRequestStatus.CONFIRMED.value or visit_request.anonymized_at is not None:
        return None, None
    slot = visit_request.slot
    if slot is None or slot_start_utc(slot.slot_date, slot.end_time) <= datetime.now(timezone.utc):
        return None, None
    key = await line_parent.parent_account_key(db, settings, visit_request.campus_key)
    if key is None:
        return None, None
    info = await line_parent.bot_info(settings.line_accounts[key], getattr(request.app.state, "line_transport", None))
    # 查不到 LINE ID 就組不出開聊天室的網址，當作暫時不能開。
    if info is None or not info.basic_id:
        return None, None
    return key, info


@router.get("/public/visit-manage/line-notify", response_model=ParentLineNotifyOut)
async def get_parent_line_notify(
    request: Request,
    response: Response,
    visit_request_id: uuid.UUID | None = Query(None, description="畫面上的案件；對不上目前 session 的案件就拒絕"),
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> ParentLineNotifyOut:
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    _require_same_visit_request(visit_request, visit_request_id)
    current = await line_parent.parent_account_key(db, request.app.state.settings, visit_request.campus_key)
    # 只認綁在這校目前帳號上的（後台換帳號後的舊綁定推不到，不能顯示「已開啟」）。
    linked = current is not None and await line_parent.active_link(db, visit_request.id, current) is not None
    await db.commit()
    key, info = await _notify_state(request, db, visit_request)
    if key is None or info is None:
        return ParentLineNotifyOut(available=False, linked=linked)
    return ParentLineNotifyOut(
        available=True,
        linked=linked,
        account_name=info.display_name,
        basic_id=info.basic_id,
        add_friend_url=line_parent.add_friend_url(info.basic_id),
    )


@router.post(
    "/public/visit-manage/line-notify/code",
    response_model=ParentLineCodeOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_parent_request)],
)
async def create_parent_line_code(
    request: Request,
    response: Response,
    visit_request_id: uuid.UUID | None = Query(None, description="畫面上的案件；對不上目前 session 的案件就拒絕"),
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> ParentLineCodeOut:
    """產生一次性綁定代碼（30 分鐘、用一次）。家長把它傳給官方帳號就完成綁定。"""
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    _require_same_visit_request(visit_request, visit_request_id)
    await db.commit()
    key, info = await _notify_state(request, db, visit_request)
    if key is None or info is None or not info.basic_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "LINE_NOTIFY_UNAVAILABLE", "message": "這筆預約目前不能用 LINE 接收通知"},
        )
    try:
        await ratelimit.limiter(request).check(PARENT_CODE_LIMIT, str(visit_request.id))
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "代碼產生太多次了，請稍後再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    issued = await line_parent.issue_code(db, request.app.state.settings, visit_request, key)
    await db.commit()
    return ParentLineCodeOut(
        code=issued.code,
        expires_at=issued.expires_at,
        message_url=line_parent.message_url(info.basic_id, issued.code),
        text=line_parent.PREFILL_TEXT.format(code=issued.code),
        basic_id=info.basic_id,
        account_name=info.display_name,
        add_friend_url=line_parent.add_friend_url(info.basic_id),
    )


@router.delete(
    "/public/visit-manage/line-notify",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_parent_request)],
)
async def delete_parent_line_notify(
    visit_request_id: uuid.UUID | None = Query(None, description="畫面上的案件；對不上目前 session 的案件就拒絕"),
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """不再用 LINE 接收這筆預約的通知（Email 照舊）。"""
    visit_request = await _require_parent_session(db, session_token)
    _require_same_visit_request(visit_request, visit_request_id)
    if await line_parent.unlink(db, visit_request.id):
        await audit_service.log_action(
            db,
            actor_user_id=None,
            action="line.parent.unlink",
            target_type="visit_request",
            target_id=str(visit_request.id),
            campus_key=visit_request.campus_key,
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers={"Cache-Control": "private, no-store"})
