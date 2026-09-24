from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.access_models import ParentAccessToken, ParentSession, RescheduleRequest
from app.booking import slot_service
from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot

TOKEN_TTL = timedelta(days=14)
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


async def create_access_token(db: AsyncSession, visit_request_id: uuid.UUID) -> str:
    raw_token = secrets.token_urlsafe(_TOKEN_BYTES)
    now = datetime.now(timezone.utc)
    db.add(
        ParentAccessToken(
            id=uuid.uuid4(),
            visit_request_id=visit_request_id,
            token_hash=_hash(raw_token),
            created_at=now,
            expires_at=now + TOKEN_TTL,
        )
    )
    await db.flush()
    return raw_token


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


class RescheduleNotAllowed(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


async def create_reschedule_request(
    db: AsyncSession, visit_request: VisitRequest, requested_slot_id: uuid.UUID
) -> RescheduleRequest:
    """只建立待核准紀錄，不動任何時段——真正改期要等園方在 admin 端核准。

    但「不動時段」不代表可以不驗證：原本直接把家長傳來的 UUID 寫進去，
    不存在的 slot 會撞 FK 變成 500，別校的 slot 則會建立一筆永遠卡在
    pending、園方核准時才炸的申請。驗證條件與初次預約共用同一份判準。"""
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        raise RescheduleNotAllowed(
            "INVALID_TRANSITION", f"狀態 {visit_request.status} 的案件不能申請改期"
        )

    result = await db.execute(select(VisitSlot).where(VisitSlot.id == requested_slot_id))
    slot = result.scalar_one_or_none()
    if slot is None or slot.campus_key != visit_request.campus_key:
        # 不區分「不存在」與「別校的」，避免用回應差異探測其他校的時段。
        raise RescheduleNotAllowed("SLOT_NOT_FOUND", "找不到這個時段")
    if not slot_service.is_publicly_bookable(slot):
        raise RescheduleNotAllowed("SLOT_NOT_BOOKABLE", "這個時段目前無法預約")
    if slot.id == visit_request.slot_id:
        raise RescheduleNotAllowed("SAME_SLOT", "這就是目前的參觀時段")

    # 鎖住案件列，讓同一案件的並行申請排隊；否則兩個交易都看不到對方
    # 尚未提交的 pending，會各自建立一筆。
    await db.execute(
        select(VisitRequest.id).where(VisitRequest.id == visit_request.id).with_for_update()
    )
    existing = await db.execute(
        select(RescheduleRequest).where(
            RescheduleRequest.visit_request_id == visit_request.id,
            RescheduleRequest.status == "pending",
        )
    )
    if existing.scalars().first() is not None:
        raise RescheduleNotAllowed("RESCHEDULE_PENDING", "已經有一筆改期申請正在等待園方確認")

    record = RescheduleRequest(
        id=uuid.uuid4(),
        visit_request_id=visit_request.id,
        requested_slot_id=requested_slot_id,
        status="pending",
        created_at=datetime.now(timezone.utc),
    )
    db.add(record)
    await db.flush()
    return record
