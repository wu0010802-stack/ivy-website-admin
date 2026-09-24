from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from passlib.context import CryptContext
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Role, Session, User, UserCampusScope
from app.common import ratelimit

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SESSION_TTL = timedelta(hours=12)
_TOKEN_BYTES = 32

# 簡易登入限流：同一 process 記憶體內滑動窗口。單一 process 有效；
# 若日後水平擴充需搬到 Redis/DB 共享儲存，此處先標記限制。
#
# 刻意分成兩個桶，因為它們防的是不同的攻擊：
# - 來源桶（IP）在驗證「之前」檢查，擋的是拿 bcrypt 當 CPU 消耗武器。
# - 帳號桶只在「密碼錯誤」之後累計，且正確密碼一律放行並清零——否則
#   任何未認證的人都能連續打錯密碼，把指定管理者永久鎖在門外。
LOGIN_WINDOW_SECONDS = 300
LOGIN_MAX_ATTEMPTS = 10
LOGIN_SOURCE_WINDOW_SECONDS = 300
# 放寬到 100：後台登入一律經代理進來，沒設定 trusted_client_ip_header 時
# 全體員工會共用同一個桶。這個數字對十來個園方帳號綽綽有餘，但仍然會
# 掐掉自動化的密碼嘗試迴圈。
LOGIN_SOURCE_MAX_ATTEMPTS = 100
# 用有界的限流器：匿名者可以拿任意 email 打錯密碼，每個 email 都是新 key。
_LOGIN_ATTEMPTS = ratelimit.SlidingWindowLimiter(
    window_seconds=LOGIN_WINDOW_SECONDS, max_per_window=LOGIN_MAX_ATTEMPTS
)
_LOGIN_SOURCE_ATTEMPTS = ratelimit.SlidingWindowLimiter(
    window_seconds=LOGIN_SOURCE_WINDOW_SECONDS, max_per_window=LOGIN_SOURCE_MAX_ATTEMPTS
)


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
    if _LOGIN_ATTEMPTS.is_limited(_rate_limit_key(email)):
        raise LoginRateLimited()


def check_login_source_rate_limit(client_key: str) -> None:
    try:
        _LOGIN_SOURCE_ATTEMPTS.check(client_key)
    except ratelimit.RateLimited as exc:
        raise LoginRateLimited() from exc


def record_login_attempt(email: str) -> None:
    _LOGIN_ATTEMPTS.record(_rate_limit_key(email))


def clear_login_attempts(email: str) -> None:
    _LOGIN_ATTEMPTS.reset(_rate_limit_key(email))


def reset_login_rate_limits() -> None:
    """測試用：清掉兩個記憶體桶，避免測試之間互相污染。"""
    _LOGIN_ATTEMPTS.clear()
    _LOGIN_SOURCE_ATTEMPTS.clear()


# 帳號不存在時也要付出一次 bcrypt 的成本，否則「查無此人」會在毫秒級
# 回來、而密碼錯誤要等兩百多毫秒，光看回應時間就能枚舉出哪些 email 是
# 真的管理者帳號。只在 import 時算一次。
_DUMMY_PASSWORD_HASH = _pwd_context.hash(secrets.token_urlsafe(32))


async def authenticate(
    db: AsyncSession, email: str, password: str, *, client_key: str | None = None
) -> User:
    if client_key:
        check_login_source_rate_limit(client_key)

    normalized = email.strip().lower()
    # 用 limit(1) 而不是 scalar_one_or_none()：萬一資料庫裡已經存在大小寫
    # 不同的重複 email（舊資料），也只會登入失敗，不會整支端點 500。
    result = await db.execute(
        select(User)
        .where(func.lower(User.email) == normalized)
        .order_by(User.created_at.asc(), User.id.asc())
        .limit(1)
    )
    user = result.scalars().first()

    password_ok = verify_password(
        password, user.password_hash if user is not None else _DUMMY_PASSWORD_HASH
    )

    if user is not None and password_ok:
        if not user.is_active:
            record_login_attempt(normalized)
            raise AccountInactive()
        # 密碼正確就放行並清零：帳號桶不能變成別人可以遠端觸發的鎖。
        clear_login_attempts(normalized)
        return user

    record_login_attempt(normalized)
    check_login_rate_limit(normalized)
    raise InvalidCredentials()


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
        # 兩個請求同時停權僅存的兩位總管理者時，各自都會看到「另一位還在」。
        # 用交易層級的 advisory lock 讓所有停權總管理者的操作排隊，拿到鎖
        # 之後才計數（READ COMMITTED 下這次查詢看得到前一筆已提交的停權）。
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('super-admin-invariant'))"))
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
