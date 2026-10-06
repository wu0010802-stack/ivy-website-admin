from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.booking import history, slot_service
from app.booking.access_models import ParentAccessToken, ParentSession, RescheduleRequest
from app.booking.history import Actor
from app.booking.models import BookingConfig, BookingMode, VisitRequest, VisitRequestEvent, VisitRequestStatus, VisitSlot
from app.campuses.models import Campus
from app.common.timezones import slot_start_utc

SESSION_TTL = timedelta(hours=2)
# 同一案件同時有效的家長 session 上限。連結可以重複兌換，每次都會新增
# 一列；不設上限的話持有連結的人能無限累積資料列。家長正常使用（手機、
# 電腦各開幾次）遠低於這個數字，超過時刪除最舊的。
MAX_ACTIVE_SESSIONS_PER_REQUEST = 10
_TOKEN_BYTES = 32


class TokenInvalid(Exception):
    pass


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# 修改連結的有效期：至少 14 天；參觀日較遠時延到參觀開始後 7 天。
TOKEN_MIN_TTL = timedelta(days=14)
TOKEN_AFTER_VISIT = timedelta(days=7)
_ACCESS_KEY_LABEL = b"ivy-parent-access-v1"


def _derive_raw(secret: str, token_id: uuid.UUID) -> str:
    """原始 token 由伺服器密鑰與 token 列 id 算出：DB 只存雜湊，送單重播與寄信時
    仍能重算出同一條連結；只有 DB 沒有密鑰算不出來。"""
    key = hmac.new(secret.encode("utf-8"), _ACCESS_KEY_LABEL, hashlib.sha256).digest()
    digest = hmac.new(key, token_id.bytes, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def token_expiry(slot: VisitSlot | None, now: datetime) -> datetime:
    floor = now + TOKEN_MIN_TTL
    if slot is None:
        return floor
    return max(floor, slot_start_utc(slot.slot_date, slot.start_time) + TOKEN_AFTER_VISIT)


def manage_path(raw_token: str) -> str:
    return f"/visit/manage#token={raw_token}"


async def create_access_token(
    db: AsyncSession, visit_request_id: uuid.UUID, *, secret: str, slot: VisitSlot | None
) -> tuple[str, datetime]:
    """建一條修改連結，回傳 (原始 token, 到期時間)。呼叫端負責先撤銷舊連結。"""
    now = datetime.now(timezone.utc)
    token_id = uuid.uuid4()
    raw_token = _derive_raw(secret, token_id)
    expires_at = token_expiry(slot, now)
    db.add(
        ParentAccessToken(
            id=token_id,
            visit_request_id=visit_request_id,
            token_hash=_hash(raw_token),
            created_at=now,
            expires_at=expires_at,
        )
    )
    await db.flush()
    return raw_token, expires_at


async def issue_access_token(
    db: AsyncSession, visit_request_id: uuid.UUID, *, secret: str, slot: VisitSlot | None
) -> tuple[str, datetime]:
    await revoke_access_for_visit_request(db, visit_request_id)
    return await create_access_token(db, visit_request_id, secret=secret, slot=slot)


async def current_manage_path(db: AsyncSession, visit_request_id: uuid.UUID, *, secret: str) -> str | None:
    """目前有效連結的站內路徑；已撤銷、已過期，或是 2026-09-30 以前隨機產生（重算不出來）
    的連結，回傳 None。"""
    token = await active_access_token(db, visit_request_id)
    if token is None:
        return None
    raw_token = _derive_raw(secret, token.id)
    if not hmac.compare_digest(_hash(raw_token), token.token_hash):
        return None
    return manage_path(raw_token)


async def original_manage_path(db: AsyncSession, visit_request_id: uuid.UUID, *, secret: str) -> str | None:
    """送單重播（同一個 Idempotency-Key 再送一次）要回的修改連結：只有送單時發的那條
    還是唯一一條時才回。園方因為連結外流而「重新產生」之後，手上有原始請求的人重送
    不能拿到新連結（2026-10-06 稽核）。"""
    issued = await db.scalar(
        select(func.count()).select_from(ParentAccessToken).where(ParentAccessToken.visit_request_id == visit_request_id)
    )
    if issued != 1:
        return None
    return await current_manage_path(db, visit_request_id, secret=secret)


async def ensure_access_token(
    db: AsyncSession, visit_request_id: uuid.UUID, *, secret: str, slot: VisitSlot | None, actor: Actor
) -> None:
    """確保案件有一條系統重算得出來的修改連結（補登、重寄確認信用）。

    - 已有可重算的連結：沿用，有場次時依場次延長效期（不縮短）。
    - 有效連結是 2026-09-30 以前隨機產生、或密鑰更換前發的（重算不出來，信裡放不進去）：
      撤銷換新，並記一筆歷程——家長手上的舊連結會失效，園方要查得到是誰、何時換的。
    - 沒有有效連結：發一條。"""
    if await current_manage_path(db, visit_request_id, secret=secret) is not None:
        if slot is not None:
            await extend_token_expiry(db, visit_request_id, slot)
        return
    replaced = await active_access_token(db, visit_request_id) is not None
    _, expires_at = await issue_access_token(db, visit_request_id, secret=secret, slot=slot)
    if replaced:
        # 只記到期時間，原始 token 不進歷程。
        history.record_event(
            db,
            visit_request_id,
            "access_link_created",
            actor=actor,
            after={"expires_at": expires_at.isoformat(), "replaced_previous": True},
        )


async def extend_token_expiry(db: AsyncSession, visit_request_id: uuid.UUID, slot: VisitSlot) -> None:
    """改到較晚的場次時，連結跟著延長；不縮短已發出的期限。"""
    token = await active_access_token(db, visit_request_id)
    if token is not None:
        token.expires_at = max(token.expires_at, token_expiry(slot, datetime.now(timezone.utc)))
        await db.flush()


async def revoke_access_for_visit_request(db: AsyncSession, visit_request_id: uuid.UUID) -> None:
    """撤銷某個案件底下所有尚未撤銷的分享 token 與受限 session。

    案件走到終態（取消／完成／未到場）之後，那條連結就不該再開得起來；
    規格 6.4 明文要求 token「可撤銷」。這是唯一的撤銷寫入點，workflow
    的終態轉換都會呼叫它。"""
    now = datetime.now(timezone.utc)
    await db.execute(
        update(ParentAccessToken)
        .where(
            ParentAccessToken.visit_request_id == visit_request_id,
            ParentAccessToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    await db.execute(
        update(ParentSession)
        .where(
            ParentSession.visit_request_id == visit_request_id,
            ParentSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    await db.flush()


async def exchange_token(db: AsyncSession, raw_token: str) -> tuple[str, VisitRequest]:
    """驗證分享連結 token → 換發 2 小時的受限 session。

    token 刻意**不是一次性**：家長會重複點 email 裡的同一條連結，session
    過期後還要能再進來（規格 6.4 要的是「有期限、可撤銷」，不是用一次就
    廢）。原本的 docstring 宣稱「撤銷用過的 token（一次性）」，但程式從來
    沒有寫過 revoked_at——語意與實作不符會讓人以為外流的連結會自動失效。
    真正的撤銷路徑是 `revoke_access_for_visit_request`（終態時呼叫）與
    admin 的撤銷端點。"""
    # 鎖住 token 列：撤銷會先 UPDATE 同一列，兩者因此序列化。撤銷先提交
    # → 這裡等鎖後重讀到 revoked_at；這裡先提交 → 撤銷在 token 之後才更新
    # session，看得到這次新增的 session。否則並行交換可在撤銷後留下一個
    # 有效 session。
    result = await db.execute(
        select(ParentAccessToken)
        .where(ParentAccessToken.token_hash == _hash(raw_token))
        .with_for_update()
    )
    token = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if token is None or token.revoked_at is not None or token.expires_at < now:
        raise TokenInvalid()

    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .where(VisitRequest.id == token.visit_request_id)
    )
    visit_request = result.scalar_one_or_none()
    if visit_request is None:
        raise TokenInvalid()

    await _prune_sessions(db, visit_request.id, now)

    raw_session_token = secrets.token_urlsafe(_TOKEN_BYTES)
    db.add(
        ParentSession(
            id=_hash(raw_session_token),
            visit_request_id=visit_request.id,
            created_at=now,
            expires_at=now + SESSION_TTL,
        )
    )
    await db.flush()
    return raw_session_token, visit_request


async def _prune_sessions(db: AsyncSession, visit_request_id: uuid.UUID, now: datetime) -> None:
    """刪掉已過期或已撤銷的 session，並把有效 session 壓到上限以下
    （保留最新的，留一個位子給即將新增的這筆）。"""
    await db.execute(
        delete(ParentSession).where(
            ParentSession.visit_request_id == visit_request_id,
            or_(ParentSession.revoked_at.is_not(None), ParentSession.expires_at < now),
        )
    )
    overflow = await db.execute(
        select(ParentSession.id)
        .where(ParentSession.visit_request_id == visit_request_id)
        .order_by(ParentSession.created_at.desc())
        .offset(MAX_ACTIVE_SESSIONS_PER_REQUEST - 1)
    )
    overflow_ids = [row[0] for row in overflow.all()]
    if overflow_ids:
        await db.execute(delete(ParentSession).where(ParentSession.id.in_(overflow_ids)))


async def get_visit_request_for_session(db: AsyncSession, raw_session_token: str) -> VisitRequest | None:
    result = await db.execute(
        select(ParentSession).where(ParentSession.id == _hash(raw_session_token))
    )
    session = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if session is None or session.revoked_at is not None or session.expires_at < now:
        return None
    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .where(VisitRequest.id == session.visit_request_id)
    )
    return result.scalar_one_or_none()


# 家長每案每日直接改期的上限（路由的限流器與案件列鎖內的計數共用）。
PARENT_RESCHEDULES_PER_DAY = 5


class RescheduleNotAllowed(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


async def validate_parent_reschedule(
    db: AsyncSession, visit_request: VisitRequest, requested_slot_id: uuid.UUID
) -> VisitSlot:
    """家長直接改期前的檢查（名額與鎖在 workflow_service.reschedule 內再驗一次）。"""
    await db.refresh(visit_request, attribute_names=["status", "slot_id"], with_for_update=True)
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        raise RescheduleNotAllowed("INVALID_TRANSITION", f"狀態 {visit_request.status} 的案件不能改期")
    campus = await db.get(Campus, visit_request.campus_key)
    if campus is not None and not campus.active:
        raise RescheduleNotAllowed("BOOKING_UNAVAILABLE", "本校目前暫停受理線上參觀預約，請來電洽詢")
    # 預約方式改成暫停、LINE、電話…時官網沒有場次可選，家長也不能線上改場次（取消照常）。
    config = await db.get(BookingConfig, visit_request.campus_key)
    if config is None or config.mode != BookingMode.SLOTS:
        raise RescheduleNotAllowed("BOOKING_UNAVAILABLE", "本校目前暫停線上預約，要改時間請來電")
    slot = (await db.execute(select(VisitSlot).where(VisitSlot.id == requested_slot_id))).scalar_one_or_none()
    if slot is None or slot.campus_key != visit_request.campus_key:
        # 不區分「不存在」與「別校的」，避免用回應差異探測其他校的時段。
        raise RescheduleNotAllowed("SLOT_NOT_FOUND", "找不到這個時段")
    if slot.closed:
        raise RescheduleNotAllowed("SLOT_CLOSED", "這個時段已停止申請")
    if not slot_service.is_publicly_bookable(slot, **slot_service.window_for(config)):
        raise RescheduleNotAllowed("SLOT_NOT_BOOKABLE", "這個時段目前無法預約")
    if slot.id == visit_request.slot_id:
        raise RescheduleNotAllowed("SAME_SLOT", "這就是目前的參觀時段")
    # 每案每日上限在案件列鎖內再數一次：路由上的限流器是「先看、成功後才記」，同時
    # 送出的改期都會先通過那一關（2026-10-06 稽核），每次改期又會通知園方。
    since = datetime.now(timezone.utc) - timedelta(days=1)
    done_today = await db.scalar(
        select(func.count())
        .select_from(VisitRequestEvent)
        .where(
            VisitRequestEvent.visit_request_id == visit_request.id,
            VisitRequestEvent.event_type == "rescheduled",
            VisitRequestEvent.source == history.PARENT.source,
            VisitRequestEvent.created_at > since,
        )
    )
    if (done_today or 0) >= PARENT_RESCHEDULES_PER_DAY:
        raise RescheduleNotAllowed("RATE_LIMITED", "這筆預約今天已經修改很多次了，請明天再試，或直接聯絡園所")
    return slot


async def close_pending_reschedules(
    db: AsyncSession,
    visit_request_id: uuid.UUID,
    *,
    resolved_by: uuid.UUID | None,
    keep_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """案件結案（取消／完成／未到場）或園方直接改期時，還在等核准的改期申請
    跟著失效：否則它會一直留在待核准清單與側欄數字裡，結案後按核准只會被拒；
    改期後按核准更會把案件搬回家長當初申請的時段，蓋掉園方剛談好的時間。

    keep_id 是正在核准的那一筆，由呼叫端自己標成 approved。回傳每筆失效
    申請原本要改到的時段 id，給呼叫端記歷程。"""
    stmt = update(RescheduleRequest).where(
        RescheduleRequest.visit_request_id == visit_request_id,
        RescheduleRequest.status == "pending",
    )
    if keep_id is not None:
        stmt = stmt.where(RescheduleRequest.id != keep_id)
    result = await db.execute(
        stmt.values(status="closed", resolved_at=datetime.now(timezone.utc), resolved_by=resolved_by)
        .returning(RescheduleRequest.requested_slot_id)
    )
    return list(result.scalars())


async def active_access_token(db: AsyncSession, visit_request_id: uuid.UUID) -> ParentAccessToken | None:
    """目前還能用的家長管理連結（未撤銷、未過期）中最新的一條；後台只顯示有沒有、
    何時到期。原始連結不存資料庫，要用時由密鑰重算（current_manage_path）；2026-09-30
    以前隨機產生、或密鑰更換前發的連結重算不出來。"""
    result = await db.execute(
        select(ParentAccessToken)
        .where(
            ParentAccessToken.visit_request_id == visit_request_id,
            ParentAccessToken.revoked_at.is_(None),
            ParentAccessToken.expires_at > datetime.now(timezone.utc),
        )
        .order_by(ParentAccessToken.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()
