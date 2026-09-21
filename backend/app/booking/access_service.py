from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.access_models import ParentAccessToken, ParentSession, RescheduleRequest
from app.booking.models import VisitRequest

TOKEN_TTL = timedelta(days=14)
SESSION_TTL = timedelta(hours=2)
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


async def exchange_token(db: AsyncSession, raw_token: str) -> tuple[str, VisitRequest]:
    """驗證分享連結 token → 撤銷用過的 token（一次性）→ 換發受限
    session。回傳 (raw_session_token, visit_request)。"""
    result = await db.execute(
        select(ParentAccessToken).where(ParentAccessToken.token_hash == _hash(raw_token))
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


async def create_reschedule_request(
    db: AsyncSession, visit_request_id: uuid.UUID, requested_slot_id: uuid.UUID
) -> RescheduleRequest:
    """只建立待核准紀錄，不動任何時段——真正改期要等園方在 admin 端核准。"""
    record = RescheduleRequest(
        id=uuid.uuid4(),
        visit_request_id=visit_request_id,
        requested_slot_id=requested_slot_id,
        status="pending",
        created_at=datetime.now(timezone.utc),
    )
    db.add(record)
    await db.flush()
    return record
