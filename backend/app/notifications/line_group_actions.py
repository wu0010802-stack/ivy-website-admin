"""LINE 群組卡片按鈕的 postback：資料編碼與處理（2026-11-17，docs/specs/2026-11-17-line-group-interactions-design.md §4.3、§5）。

格式 `ivy:<動作>:<參數>…`；LINE postback data 上限 300 字元，這裡保守限 290。

已到場／未到場（§5）是兩段式：按「已到場」「未到場」只回確認卡、不寫入；確認卡的「確認」帶無狀態 token
（HMAC-SHA256，綁動作與案件 id，5 分鐘到期，什麼都不存），按了才走 workflow_service 寫入（同一個交易的
招生訪視、廣告轉換回傳、分析事件照舊）。
- 授權：事件來自群組或多人聊天室（兩者都能被選為推播目標），而且這個群組**貼過後台驗證碼**
  （`verified_at` 不為空；2026-09-29 以前綁定、沒驗證過的舊群組照常收卡片、查名單，但按鈕不回應），
  並且目前服務這筆案件的校區（`campuses_served`：校區群組或總部群組、未離開）。
  群組沒驗證、沒有服務任何校區、資料不是我們編的 → 不回應；別校的案件 → 回「沒有權限」。
- 群組服務哪些校區在處理這批事件前讀一次。確認時先驗 token、在上鎖前先擋別校案件，再鎖案件列重讀狀態與場次，
  用同一份校區清單重做校區、狀態、時間檢查（鎖內新的作用是狀態與時間）；兩個人同時按，後到的只會看到目前狀態。
- 回覆一律 reply（不計則數），在 commit 之後送；送不出去只記 log、不回滾。log 不記 userId 與訊息內容。
  帶家長稱呼的回覆一律用卡片（altText 不放稱呼），不用純文字（純文字的通知預覽會直接顯示整句）。

到場後的招生結果欄位（§5.1，`rf*` 動作，參數是招生訪視 id，原因與分類再帶索引、交通車帶 1／0）：
- 每次都鎖招生訪視列重讀（records.get_visit_for_update），先驗授權（訪視校區在群組服務的校區內），再驗
  招生入學開著、未匿名化、未退出、由官網預約建立。未預繳原因、來源分類、交通車不做二次確認，同一欄可再按來更正。
- 已預繳走漏斗轉換（funnel.transition，同後台「標記預繳」），不直接改 has_deposit；LINE 不提供取消預繳。
  轉換會排預繳的廣告轉換回傳（送出就收不回），所以同已到場要二次確認：按「已預繳」只回確認卡（不寫入），
  確認卡的「確認」（rfdok）帶同一種無狀態 token（綁 rfdok 與招生訪視 id），驗過才鎖列重驗、寫入。
  其餘欄位走 records.update_visit。招生歷程由這兩支照常寫（actor_user_id 為空，不另加東西）。
- 樂觀鎖用當下讀到的 version；VersionConflict 重讀一次再試，仍衝突回「請再按一次」。
- 稽核 metadata 只記欄位名、值的代碼（原因記索引）、群組 id 與按的人的 userId，不記任何文字。
  群組 id 與 userId 只有 notifications.manage 看得到（operations/audit_service.LINE_GROUP_ACTIONS）。"""

from __future__ import annotations

import hashlib
import hmac
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.admissions import constants as admissions_constants
from app.admissions import funnel, records
from app.admissions.models import RecruitmentVisit
from app.booking import slot_service, workflow_service
from app.booking.history import Actor
from app.booking.models import VisitRequest, VisitRequestStatus
from app.common import ratelimit
from app.common.timezones import today_local
from app.notifications import line as line_api
from app.notifications.line_group_settings import campuses_served
from app.operations import audit_service

logger = logging.getLogger("app.line")

PREFIX = "ivy:"
DATA_MAX = 290

ATTEND_ASK = "att"
NOSHOW_ASK = "nos"
ATTEND_OK = "attok"
NOSHOW_OK = "nosok"
CANCEL = "no"
RF_DEPOSIT = "rfd"
RF_DEPOSIT_OK = "rfdok"
RF_NODEP_ASK = "rfn"
RF_NODEP = "rfnr"
RF_SOURCE_ASK = "rfs"
RF_SOURCE = "rfsc"
RF_BUS = "rfb"

# 詢問動作 → 確認卡上「確認」的動作；每種動作的參數個數（不符就當作不是我們編的，不回應）。
_OK_FOR = {ATTEND_ASK: ATTEND_OK, NOSHOW_ASK: NOSHOW_OK}
_CONFIRMS = (ATTEND_OK, NOSHOW_OK)
_PART_COUNTS = {
    ATTEND_ASK: 1, NOSHOW_ASK: 1, ATTEND_OK: 2, NOSHOW_OK: 2, CANCEL: 0,
    RF_DEPOSIT: 1, RF_DEPOSIT_OK: 2, RF_NODEP_ASK: 1, RF_NODEP: 2, RF_SOURCE_ASK: 1, RF_SOURCE: 2, RF_BUS: 2,
}
_RF_ACTIONS = (RF_DEPOSIT, RF_DEPOSIT_OK, RF_NODEP_ASK, RF_NODEP, RF_SOURCE_ASK, RF_SOURCE, RF_BUS)

TOKEN_TTL_SECONDS = 300
_TOKEN_SIG_LENGTH = 16
ACTION_LIMIT = ratelimit.Limit("line_group_action", window_seconds=60, max_per_window=30)

NO_PERMISSION_REPLY = "這個群組沒有權限處理這筆"
GONE_REPLY = "找不到這筆預約"
EXPIRED_REPLY = "這個確認已過期，請重新按一次"
# 只說「已取消」會讀成預約被取消；這裡是確認卡的「取消」，什麼都沒寫入。
CANCEL_REPLY = "已取消這次標記，沒有寫入"
FUTURE_DAY_REPLY = "要到參觀當天才能標記"
NOSHOW_TOO_EARLY_REPLY = "參觀時段開始後才能標記未到場"
STATUS_REPLIES = {
    VisitRequestStatus.COMPLETED.value: "已標記已到場",
    VisitRequestStatus.NO_SHOW.value: "已標記未到場",
    VisitRequestStatus.CANCELLED.value: "這筆預約已取消",
}
# 家長稱呼清理後是空的（或已匿名化）時，確認卡與結果寫這個。
NAMELESS = "這筆預約"

# 招生結果欄位（§5.1）
CANNOT_FILL_REPLY = "這筆已不能在群組填寫"
ALREADY_DEPOSITED_REPLY = "已是預繳狀態"
DEPOSITED_FIX_IN_ADMIN_REPLY = "已是預繳狀態，要更正請到後台"
INVALID_CHOICE_REPLY = "這個選項已失效，請重新選擇"
DEPOSIT_NOT_ALLOWED_REPLY = "目前不能標記預繳"
VERSION_CONFLICT_REPLY = "資料剛被更新，請再按一次"
RECORDED_REPLY = "已記錄：{label} {value}"
FIELD_LABELS = {
    "has_deposit": "預繳結果",
    "no_deposit_reason": "未預繳原因",
    "source_category": "來源分類",
    "rides_bus": "搭交通車",
}
_BUS_CHOICES = {"1": (True, "搭"), "0": (False, "不搭")}


def encode(action: str, *parts: str) -> str:
    data = PREFIX + ":".join([action, *parts])
    if len(data) > DATA_MAX:
        raise ValueError("postback data 過長")
    return data


def decode(data: str) -> tuple[str, list[str]] | None:
    if not isinstance(data, str) or not data.startswith(PREFIX):
        return None
    pieces = data[len(PREFIX):].split(":")
    if not pieces[0]:
        return None
    return pieces[0], pieces[1:]


# ---- 確認 token（無狀態；設計 §5 第 7 點）----


def _signature(secret: str, action: str, receipt_id: str, exp: int) -> str:
    message = f"line-group-confirm\0{action}\0{receipt_id}\0{exp}"
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()[:_TOKEN_SIG_LENGTH]


def make_token(secret: str, action: str, receipt_id: str, *, now: datetime) -> str:
    """`<到期 epoch 秒>.<HMAC 前 16 個 hex>`；action 是要確認的動作（ATTEND_OK／NOSHOW_OK）。"""
    exp = int(now.timestamp()) + TOKEN_TTL_SECONDS
    return f"{exp}.{_signature(secret, action, receipt_id, exp)}"


def check_token(secret: str, action: str, receipt_id: str, token: str, *, now: datetime) -> bool:
    """格式不對、簽章不符（換了動作、案件或密鑰）、已過期都回 False。比對用常數時間。"""
    if not isinstance(token, str) or len(token) > 40:
        return False
    exp_text, dot, sig = token.partition(".")
    if not dot or not (exp_text.isascii() and exp_text.isdigit()) or len(sig) != _TOKEN_SIG_LENGTH:
        return False
    exp = int(exp_text)
    if not hmac.compare_digest(sig.encode(), _signature(secret, action, receipt_id, exp).encode()):
        return False
    return now.timestamp() <= exp


# ---- postback 處理 ----


def _parse(event: dict) -> tuple[str, list[str]] | None:
    postback = event.get("postback")
    decoded = decode(postback.get("data")) if isinstance(postback, dict) else None
    if decoded is None:
        return None
    action, parts = decoded
    if _PART_COUNTS.get(action) != len(parts):
        return None
    return action, parts


def _line_user(event: dict) -> str | None:
    """群組 postback 不保證有 userId（LINE 文件只保證訊息事件有）；有就記在稽核，不寫 log。"""
    source = event.get("source")
    user_id = source.get("userId") if isinstance(source, dict) else None
    return user_id if isinstance(user_id, str) and line_api.USER_ID_RE.match(user_id) else None


async def _allowed(request: Request, target_id: str) -> bool:
    try:
        await ratelimit.limiter(request).check(ACTION_LIMIT, target_id)
    except ratelimit.RateLimited:
        return False
    return True


async def _load(db: AsyncSession, receipt_id: str) -> VisitRequest | None:
    try:
        visit_id = uuid.UUID(receipt_id)
    except ValueError:
        return None
    result = await db.execute(
        select(VisitRequest).options(selectinload(VisitRequest.slot)).where(VisitRequest.id == visit_id)
    )
    return result.scalar_one_or_none()


def _refusal(visit_request: VisitRequest, served: list[str], *, attend: bool) -> str | None:
    """不能在這個群組標記的原因（回覆文字）；可以就回 None。先看授權，別校案件不透露狀態。
    時間規則同後台：已到場要場次是今天或之前（今天還沒開始＝提早到）；未到場要場次已開始。"""
    if visit_request.campus_key not in served:
        return NO_PERMISSION_REPLY
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        return STATUS_REPLIES.get(visit_request.status, GONE_REPLY)
    slot = visit_request.slot
    if attend:
        if slot is not None and slot.slot_date > today_local():
            return FUTURE_DAY_REPLY
    elif slot is not None and not slot_service.has_started(slot):
        return NOSHOW_TOO_EARLY_REPLY
    return None


def _who(visit_request: VisitRequest) -> str:
    from app.notifications.service import line_parent_name

    return line_parent_name(visit_request.parent_name) or NAMELESS


def _ask(request: Request, visit_request: VisitRequest, served: list[str], action: str) -> dict:
    """按「已到場」「未到場」：不寫入，檢查過就回確認卡。"""
    from app.notifications import line_flex
    from app.notifications.service import push_slot_text

    refusal = _refusal(visit_request, served, attend=action == ATTEND_ASK)
    if refusal is not None:
        return line_api.text_message(refusal)
    receipt_id = str(visit_request.id)
    ok = _OK_FOR[action]
    token = make_token(request.app.state.settings.session_secret, ok, receipt_id, now=datetime.now(timezone.utc))
    when = f" {push_slot_text(visit_request.slot)} " if visit_request.slot is not None else ""
    return line_flex.confirm_message(action, receipt_id, _who(visit_request), when, token)


async def _confirm(
    request: Request, db: AsyncSession, event: dict, group_id: str, served: list[str], action: str, visit_request: VisitRequest
) -> dict:
    from app.notifications import line_flex
    from app.notifications.service import admin_visit_url

    settings = request.app.state.settings
    attend = action == ATTEND_OK
    # 上鎖前先擋別校：不讓其他群組鎖住別校的案件列。
    if visit_request.campus_key not in served:
        return line_api.text_message(NO_PERMISSION_REPLY)
    # 同後台 admin_visit_routes._lock_for_transition：鎖住案件列重讀狀態與場次，再重做所有檢查。
    await workflow_service.lock_status(db, visit_request)
    loaded_slot_id = visit_request.slot.id if visit_request.slot is not None else None
    if loaded_slot_id != visit_request.slot_id:
        await db.refresh(visit_request, attribute_names=["slot"])
    refusal = _refusal(visit_request, served, attend=attend)
    if refusal is not None:
        await db.rollback()  # 放掉列鎖
        return line_api.text_message(refusal)
    who = _who(visit_request)
    receipt_id = str(visit_request.id)
    try:
        if attend:
            await workflow_service.mark_completed(
                db,
                visit_request,
                actor=Actor.line_group(),
                admissions_enabled=settings.admissions_enabled,
                early=workflow_service.arrives_early(visit_request.slot),
            )
        else:
            await workflow_service.mark_no_show(db, visit_request, actor=Actor.line_group())
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        return line_api.text_message(exc.message)
    line_user_id = _line_user(event)
    await audit_service.log_action(
        db,
        actor_user_id=None,
        action="line.group.visit_attend" if attend else "line.group.visit_no_show",
        target_type="visit_request",
        target_id=receipt_id,
        campus_key=visit_request.campus_key,
        metadata={
            "group_id": group_id,
            "from_status": VisitRequestStatus.CONFIRMED.value,
            "to_status": visit_request.status,
            **({"line_user_id": line_user_id} if line_user_id else {}),
        },
    )
    recruitment_visit_id = None
    if attend and settings.admissions_enabled:
        recruitment_visit_id = await db.scalar(
            select(RecruitmentVisit.id).where(RecruitmentVisit.visit_request_id == visit_request.id)
        )
    await db.commit()
    if not attend:
        return line_flex.no_show_result_message(who)
    return line_flex.attended_result_message(
        who,
        recruitment_visit_id=str(recruitment_visit_id) if recruitment_visit_id else None,
        receipt_id=receipt_id,
        admin_url=admin_visit_url(settings.admin_origin, receipt_id, external_browser=True),
        already_deposited=False,
    )


# ---- 招生結果欄位（§5.1）----


@dataclass(frozen=True)
class _FieldWrite:
    """這次按鈕要寫的一個欄位。"""

    field: str  # 欄位名（稽核的 field）
    value: object  # 寫進欄位的值
    code: object  # 稽核的 value：代碼、布林或索引，不放文字
    shown: str  # 回覆「已記錄」裡的值


def _choice_index(text: str | None, size: int) -> int | None:
    """選擇卡按鈕帶的索引：只認 str(i) 的寫法且 0 <= i < size；負數、前置 0、全形數字、非數字都不算。"""
    if text is None or not (text.isascii() and text.isdigit()):
        return None
    index = int(text)
    return index if str(index) == text and index < size else None


async def _field_visit(db: AsyncSession, visit_id: uuid.UUID, served: list[str]) -> RecruitmentVisit | str:
    """鎖住招生訪視列、讀最新值（populate_existing，重試時也拿得到別人剛寫的版本），檢查這個群組能不能填；
    不能就放掉列鎖、回覆文字。先看授權：別校的訪視不透露它是否已匿名化或退出。"""
    visit = await records.get_visit_for_update(db, visit_id)
    if visit is None:
        refusal = CANNOT_FILL_REPLY
    elif visit.campus_key not in served:
        refusal = NO_PERMISSION_REPLY
    elif visit.anonymized_at is not None or visit.withdrawn_at is not None or visit.visit_request_id is None:
        refusal = CANNOT_FILL_REPLY
    else:
        return visit
    await db.rollback()
    return refusal


def _field_step(action: str, visit: RecruitmentVisit, arg: str | None) -> _FieldWrite | dict:
    """這次要寫的欄位；不寫入的（選擇卡、已預繳、選項無效）直接回覆訊息。"""
    from app.notifications import line_flex

    rv = str(visit.id)
    if action in (RF_DEPOSIT, RF_DEPOSIT_OK):  # 詢問與確認做同樣的檢查；詢問的不寫入由 _fill 處理
        if visit.has_deposit:
            return line_api.text_message(ALREADY_DEPOSITED_REPLY)
        # 只做「已訪視 → 已預繳」：不讓群組按鈕走到取消註冊之類的轉換。
        if funnel.derive_stage(visit) != "visited":
            return line_api.text_message(DEPOSIT_NOT_ALLOWED_REPLY)
        return _FieldWrite("has_deposit", True, True, "已預繳")
    if action in (RF_NODEP_ASK, RF_NODEP) and visit.has_deposit:
        return line_api.text_message(DEPOSITED_FIX_IN_ADMIN_REPLY)
    if action == RF_NODEP_ASK:
        return line_flex.reasons_message(rv)
    if action == RF_SOURCE_ASK:
        return line_flex.sources_message(rv)
    if action == RF_NODEP:
        reasons = admissions_constants.NO_DEPOSIT_REASONS
        index = _choice_index(arg, len(reasons))
        if index is None:
            return line_api.text_message(INVALID_CHOICE_REPLY)
        return _FieldWrite("no_deposit_reason", reasons[index], index, reasons[index])
    if action == RF_SOURCE:
        # 索引對 LINE_SOURCE_CHOICES（後台表單同樣的六項，2026-10-06 裁定），寫進去的是九類代碼之一。
        choices = admissions_constants.LINE_SOURCE_CHOICES
        index = _choice_index(arg, len(choices))
        if index is None:
            return line_api.text_message(INVALID_CHOICE_REPLY)
        code, label = choices[index]
        return _FieldWrite("source_category", code, code, label)
    choice = _BUS_CHOICES.get(arg or "")
    if choice is None:
        return line_api.text_message(INVALID_CHOICE_REPLY)
    return _FieldWrite("rides_bus", choice[0], choice[0], choice[1])


async def _deposit_confirm(request: Request, db: AsyncSession, visit: RecruitmentVisit) -> dict:
    """「已預繳」的確認卡：稱呼同到場結果卡（案件的家長稱呼，清理後是空的就寫「這筆預約」）。"""
    from app.notifications import line_flex
    from app.notifications.service import line_parent_name

    parent_name = await db.scalar(select(VisitRequest.parent_name).where(VisitRequest.id == visit.visit_request_id))
    who = line_parent_name(parent_name) or NAMELESS
    rv = str(visit.id)
    token = make_token(request.app.state.settings.session_secret, RF_DEPOSIT_OK, rv, now=datetime.now(timezone.utc))
    return line_flex.confirm_message(RF_DEPOSIT, rv, who, "", token)


async def _fill(
    request: Request, db: AsyncSession, event: dict, group_id: str, served: list[str], action: str, parts: list[str]
) -> dict | None:
    """結果欄位按鈕。招生訪視 id 不是 UUID → 不是我們編的，不回應。
    已預繳的確認（rfdok）先驗 token，過期或偽造的連訪視都不查。"""
    if action == RF_DEPOSIT_OK:
        secret = request.app.state.settings.session_secret
        if not check_token(secret, RF_DEPOSIT_OK, parts[0], parts[1], now=datetime.now(timezone.utc)):
            return line_api.text_message(EXPIRED_REPLY)
    try:
        visit_id = uuid.UUID(parts[0])
    except ValueError:
        return None
    # 招生入學關閉時後台的招生 API 是 404，舊卡片上的按鈕也不能繞過開關寫入。
    if not request.app.state.settings.admissions_enabled:
        return line_api.text_message(CANNOT_FILL_REPLY)
    arg = parts[1] if len(parts) > 1 else None
    for _attempt in range(2):  # VersionConflict 重讀一次再試
        found = await _field_visit(db, visit_id, served)
        if isinstance(found, str):
            return line_api.text_message(found)
        visit = found
        step = _field_step(action, visit, arg)
        if not isinstance(step, _FieldWrite):
            await db.rollback()  # 放掉列鎖
            return step
        if action == RF_DEPOSIT:
            # 檢查都過了：回確認卡，不寫入（預繳會排廣告轉換回傳，送出就收不回）。
            message = await _deposit_confirm(request, db, visit)
            await db.rollback()
            return message
        try:
            if step.field == "has_deposit":
                # 同後台「標記預繳」：走漏斗轉換（寫 deposit_added、排預繳廣告回傳、進編班表），不直接改 has_deposit。
                await funnel.transition(
                    db, visit, to_stage="deposited", expected_version=visit.version, actor_user_id=None
                )
                changed = True
            else:
                changed = bool(
                    await records.update_visit(
                        db, visit, changes={step.field: step.value}, expected_version=visit.version, actor_user_id=None
                    )
                )
        except records.VersionConflict:
            continue  # 兩支都在改任何欄位之前就丟，訪視原封不動
        except funnel.TransitionNotAllowed:
            await db.rollback()
            return line_api.text_message(DEPOSIT_NOT_ALLOWED_REPLY)
        if changed:
            line_user_id = _line_user(event)
            await audit_service.log_action(
                db,
                actor_user_id=None,
                action="line.group.recruitment_field",
                target_type="recruitment_visit",
                target_id=str(visit.id),
                campus_key=visit.campus_key,
                metadata={
                    "field": step.field,
                    "value": step.code,
                    "group_id": group_id,
                    **({"line_user_id": line_user_id} if line_user_id else {}),
                },
            )
            await db.commit()
        else:
            await db.rollback()  # 值沒變：不加版本、不寫歷程與稽核，照樣回已記錄
        return line_api.text_message(RECORDED_REPLY.format(label=FIELD_LABELS[step.field], value=step.shown))
    await db.rollback()
    return line_api.text_message(VERSION_CONFLICT_REPLY)


async def _respond(
    request: Request, db: AsyncSession, event: dict, group_id: str, served: list[str], action: str, parts: list[str]
) -> dict | None:
    if action == CANCEL:
        return line_api.text_message(CANCEL_REPLY)
    if action in _RF_ACTIONS:
        return await _fill(request, db, event, group_id, served, action, parts)
    if action in _CONFIRMS:  # 先驗 token，過期或偽造的連案件都不查
        secret = request.app.state.settings.session_secret
        if not check_token(secret, action, parts[0], parts[1], now=datetime.now(timezone.utc)):
            return line_api.text_message(EXPIRED_REPLY)
    visit_request = await _load(db, parts[0])
    if visit_request is None:
        return line_api.text_message(GONE_REPLY)
    if action in _CONFIRMS:
        return await _confirm(request, db, event, group_id, served, action, visit_request)
    return _ask(request, visit_request, served, action)


async def handle(request: Request, db: AsyncSession, events: list[dict]) -> None:
    """main 帳號 webhook 的群組／多人聊天室 postback（已到場／未到場／取消、招生結果欄位）。每筆寫入各自一個
    交易；回覆最後一起送。"""
    # line_routes 會 import 本模組，helper 在函式內才取，避免循環 import。
    from app.notifications.line_routes import _client, _reply_token, _target

    replies: list[tuple[str, dict]] = []
    for event in events:
        if event.get("type") != "postback":
            continue
        found = _target(event)  # 群組（groupId）或多人聊天室（roomId）；一對一回 None
        if found is None:
            continue
        reply_token = _reply_token(event)
        parsed = _parse(event)
        if reply_token is None or parsed is None:
            continue
        group_id = found[1]  # 稽核 metadata 的 group_id；多人聊天室時是 roomId
        if not await _allowed(request, group_id):
            continue
        # 按鈕會寫入：只認貼過驗證碼的群組（設計 §5 第 4 點的前提）。
        served = await campuses_served(db, group_id, require_verified=True)
        if served is None:
            continue
        action, parts = parsed
        message = await _respond(request, db, event, group_id, served, action, parts)
        if message is not None:
            replies.append((reply_token, message))
    if not replies:
        return
    async with _client(request) as client:
        for reply_token, message in replies:
            try:
                await client.reply(reply_token, [message])
            except (line_api.LinePushError, httpx.HTTPError) as exc:
                logger.warning("LINE 群組按鈕回覆失敗：error=%s", exc)
