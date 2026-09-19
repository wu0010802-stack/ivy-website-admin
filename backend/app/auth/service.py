from __future__ import annotations

import hashlib
import secrets
import time
from datetime import datetime, timedelta, timezone

from passlib.context import CryptContext
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Role, Session, User, UserCampusScope

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SESSION_TTL = timedelta(hours=12)
_TOKEN_BYTES = 32

# 簡易登入限流：同一 process 記憶體內滑動窗口。單一 process 有效；
# 若日後水平擴充需搬到 Redis/DB 共享儲存，此處先標記限制。
_LOGIN_ATTEMPTS: dict[str, list[float]] = {}
LOGIN_WINDOW_SECONDS = 300
LOGIN_MAX_ATTEMPTS = 10


class LoginRateLimited(Exception):
    pass


class InvalidCredentials(Exception):
    pass


class AccountInactive(Exception):
    pass


class LastSuperAdminProtected(Exception):
    pass


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd_context.verify(password, password_hash)


def _rate_limit_key(email: str) -> str:
    return email.strip().lower()


def check_login_rate_limit(email: str) -> None:
    key = _rate_limit_key(email)
    now = time.monotonic()
    attempts = [t for t in _LOGIN_ATTEMPTS.get(key, []) if now - t < LOGIN_WINDOW_SECONDS]
    _LOGIN_ATTEMPTS[key] = attempts
    if len(attempts) >= LOGIN_MAX_ATTEMPTS:
        raise LoginRateLimited()


def record_login_attempt(email: str) -> None:
    key = _rate_limit_key(email)
    _LOGIN_ATTEMPTS.setdefault(key, []).append(time.monotonic())


def clear_login_attempts(email: str) -> None:
    _LOGIN_ATTEMPTS.pop(_rate_limit_key(email), None)


async def authenticate(db: AsyncSession, email: str, password: str) -> User:
    check_login_rate_limit(email)
    result = await db.execute(select(User).where(func.lower(User.email) == email.strip().lower()))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        record_login_attempt(email)
        raise InvalidCredentials()
    if not user.is_active:
        record_login_attempt(email)
        raise AccountInactive()
    clear_login_attempts(email)
    return user


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def create_session(db: AsyncSession, user: User) -> tuple[str, str]:
    """回傳 (raw_token, csrf_token)；raw_token 只在這裡出現一次，存庫的是 hash。"""
    raw_token = secrets.token_urlsafe(_TOKEN_BYTES)
    csrf_token = secrets.token_urlsafe(_TOKEN_BYTES)
    now = datetime.now(timezone.utc)
    session = Session(
        id=_hash_token(raw_token),
        user_id=user.id,
        csrf_token=csrf_token,
        created_at=now,
        expires_at=now + SESSION_TTL,
    )
    db.add(session)
    await db.flush()
    return raw_token, csrf_token


async def get_session_by_token(db: AsyncSession, raw_token: str) -> Session | None:
    session_id = _hash_token(raw_token)
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        return None
    now = datetime.now(timezone.utc)
    if session.revoked_at is not None or session.expires_at < now:
        return None
    return session


async def revoke_session(db: AsyncSession, raw_token: str) -> None:
    session_id = _hash_token(raw_token)
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if session is not None and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        await db.flush()


async def count_active_super_admins(db: AsyncSession, exclude_user_id=None) -> int:
    stmt = select(func.count()).select_from(User).where(
        User.role == Role.SUPER_ADMIN, User.is_active.is_(True)
    )
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    result = await db.execute(stmt)
    return result.scalar_one()


async def set_user_active(db: AsyncSession, user: User, active: bool) -> None:
    if not active and user.role == Role.SUPER_ADMIN:
        remaining = await count_active_super_admins(db, exclude_user_id=user.id)
        if remaining == 0:
            raise LastSuperAdminProtected()
    user.is_active = active
    await db.flush()
    if not active:
        # 停權立即失效：撤銷該使用者所有現行 session。
        result = await db.execute(select(Session).where(Session.user_id == user.id))
        now = datetime.now(timezone.utc)
        for session in result.scalars():
            if session.revoked_at is None:
                session.revoked_at = now
        await db.flush()


async def set_campus_scopes(db: AsyncSession, user: User, campus_keys: list[str]) -> None:
    result = await db.execute(select(UserCampusScope).where(UserCampusScope.user_id == user.id))
    for scope in result.scalars():
        await db.delete(scope)
    await db.flush()
    for key in campus_keys:
        db.add(UserCampusScope(user_id=user.id, campus_key=key))
    await db.flush()
