from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from passlib.context import CryptContext
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from app.auth.models import Role, Session, User, UserCampusScope
from app.common import ratelimit
from app.common.concurrency import SlotsBusy, ThreadSlots, run_in_thread
from app.operations import audit_service

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
logger = logging.getLogger("app.auth")

# 後台 session 的絕對上限：不管多活躍，登入滿 12 小時一律重新登入。
# 閒置逾時另見 settings.session_idle_minutes；expires_at 存的是「滑動」的
# 到期時間（最後一次活動＋閒置分鐘數，但不超過 created_at＋SESSION_TTL）。
SESSION_TTL = timedelta(hours=12)


def session_max_expiry(session: Session) -> datetime:
    """登入滿 12 小時的時間：閒置延長推不過這個上限（_sliding_expiry）。"""
    return session.created_at + SESSION_TTL


# 每個請求都寫一次 DB 太浪費：到期時間至少能往後推這麼多（且不超過閒置
# 窗口的四分之一）才寫。代價是實際閒置逾時最多提早這麼多分鐘，可以接受。
SESSION_REFRESH_STEP = timedelta(minutes=5)
_TOKEN_BYTES = 32

# 登入限流：計數存在 PostgreSQL（app/common/ratelimit.py），重新部署不歸零。
#
# 分成三個桶，防的是不同的攻擊：
# - 來源桶（IP）在驗證「之前」檢查，擋的是拿 bcrypt 當 CPU 消耗武器。
# - 帳號嘗試桶：同一個 email 在 5 分鐘內最多驗 10 次密碼。「先扣再驗」：進了
#   bcrypt 名額、真的要驗之前才原子地扣一次（RateLimiter.check），成功登入再
#   歸零，所以等同「失敗次數」；同時送進來的一批請求最多 10 個能跑到 bcrypt
#   （稽核 login-lock-bypass-concurrent-burst：原本只在排隊前看一次鎖，排隊中
#   的請求在上鎖後照樣驗密碼，正確密碼還是登得進去）。第 10 次失敗開始帳號鎖。
# - 帳號鎖：鎖該帳號的「密碼登入」15 分鐘，排隊前與進名額後各查一次、成功
#   之前再查一次，鎖定中連正確密碼也拒絕（2026-09-29 業主裁定）。原本為了
#   「不讓人遠端把管理者鎖在門外」讓正確密碼一律放行，結果帳號桶完全擋不到
#   分散來源的暴力破解（稽核 login-account-bucket-no-effect）。現在的取捨：
#   被鎖的人仍可用 Google／LINE 登入（不看這把鎖），已登入的 session 也不受
#   影響；鎖有期限，失敗與開始鎖定都寫稽核，總管理者看得到有人在猜密碼。
LOGIN_WINDOW_SECONDS = 300
LOGIN_MAX_ATTEMPTS = 10
LOGIN_LOCK_SECONDS = 900
LOGIN_SOURCE_WINDOW_SECONDS = 300
# 放寬到 100：後台登入一律經代理進來，沒設定 trusted_client_ip_header 時
# 全體員工會共用同一個桶。這個數字對十來個園方帳號綽綽有餘；真正擋住
# 針對單一帳號猜密碼的是上面的帳號鎖。
LOGIN_SOURCE_MAX_ATTEMPTS = 100
LOGIN_ACCOUNT_LIMIT = ratelimit.Limit("login_account", LOGIN_WINDOW_SECONDS, LOGIN_MAX_ATTEMPTS)
LOGIN_SOURCE_LIMIT = ratelimit.Limit("login_source", LOGIN_SOURCE_WINDOW_SECONDS, LOGIN_SOURCE_MAX_ATTEMPTS)
# 帳號鎖不用 RateLimiter 的滑動窗口近似：窗口交界會讓「鎖 15 分鐘」變成
# 幾秒到 30 分鐘不等。改用同一張 rate_limit_counters 表放一列「到期時間明確」
# 的標記（RateLimiter.consume_marker），到期後由既有的定期清理刪掉。
LOGIN_LOCK = ratelimit.Limit("login_lock", LOGIN_LOCK_SECONDS, 1)

# bcrypt（rounds 12）一次約 250 ms。API 是單一 uvicorn process、單一事件
# 迴圈，同步呼叫會讓整個 API 在每次登入時停住；改丟到 worker thread，並限制
# 同時跑的數量，免得一波登入請求把 CPU 與執行緒池吃光。
BCRYPT_CONCURRENCY = 4
# 驗密碼（登入、改密碼前的目前密碼）排隊的上限：名額用完且已有這麼多人在排，
# 新的請求直接 429，不在 event loop 上無限排隊（稽核 login-burst-starves-main-db-pool）。
# 4 個名額 × 約 250 ms，排 16 個約等 1 秒。建帳號、重設密碼的 hash 由已登入的
# 管理者觸發，不設排隊上限。
BCRYPT_MAX_WAITERS = 16
_bcrypt_slots = ThreadSlots(BCRYPT_CONCURRENCY)


class LoginRateLimited(Exception):
    """密碼登入／驗證被擋下（429）。locked 分開兩種情況，後台才不會把「系統
    忙碌、幾秒後再試」講成「帳號鎖 15 分鐘」：
    - locked=True：這個帳號的密碼驗證暫停（鎖定中、或 5 分鐘內的額度用完）；
    - locked=False：來源限流、驗證排隊已滿、限流連線池忙碌。
    不存在的 email 也會鎖，所以兩種分開不會洩漏帳號是否存在。"""

    def __init__(self, *, locked: bool, retry_after: int) -> None:
        self.locked = locked
        self.retry_after = max(1, int(retry_after))
        super().__init__("login rate limited")


def _account_locked() -> LoginRateLimited:
    return LoginRateLimited(locked=True, retry_after=LOGIN_LOCK_SECONDS)


def _busy(retry_after: int = ratelimit.UNAVAILABLE_RETRY_AFTER_SECONDS) -> LoginRateLimited:
    return LoginRateLimited(locked=False, retry_after=retry_after)


class InvalidCredentials(Exception):
    pass


class AccountInactive(Exception):
    pass


class LastSuperAdminProtected(Exception):
    pass


def hash_password(password: str) -> str:
    """同步版本只給 CLI 與測試建資料用；API 路徑一律用 hash_password_async。"""
    return _pwd_context.hash(password)


async def hash_password_async(password: str) -> str:
    return await _bcrypt_slots.run(_pwd_context.hash, password)


def _rate_limit_key(email: str) -> str:
    return email.strip().lower()


async def check_login_lock(limiter: ratelimit.RateLimiter, email: str) -> None:
    """帳號鎖定中就直接拒絕；呼叫端必須在 bcrypt 之前呼叫。限流連線池忙碌時
    一樣擋下（fail-closed），但回的是「系統忙碌」而不是「帳號鎖定」。"""
    try:
        locked = await limiter.marker_active(LOGIN_LOCK, _rate_limit_key(email))
    except ratelimit.RateLimiterUnavailable as exc:
        raise _busy(exc.retry_after_seconds) from exc
    if locked:
        raise _account_locked()


async def check_login_source_rate_limit(limiter: ratelimit.RateLimiter, client_key: str) -> None:
    try:
        await limiter.check(LOGIN_SOURCE_LIMIT, client_key)
    except ratelimit.RateLimited as exc:
        raise _busy(exc.retry_after_seconds) from exc


async def clear_login_attempts(limiter: ratelimit.RateLimiter, email: str) -> None:
    await limiter.reset(LOGIN_ACCOUNT_LIMIT, _rate_limit_key(email))


async def _claim_password_attempt(limiter: ratelimit.RateLimiter, key: str) -> None:
    """已經拿到 bcrypt 名額、真的要驗密碼之前呼叫：再查一次帳號鎖（排隊期間
    可能已經鎖了），再原子地扣一次帳號額度（檢查＋累加在同一條 upsert）。
    額度用完就不驗，連正確密碼也一樣。"""
    await check_login_lock(limiter, key)
    try:
        await limiter.check(LOGIN_ACCOUNT_LIMIT, key)
    except ratelimit.RateLimiterUnavailable as exc:
        raise _busy(exc.retry_after_seconds) from exc
    except ratelimit.RateLimited as exc:
        raise _account_locked() from exc


async def _verify_password_bounded(
    limiter: ratelimit.RateLimiter, key: str, password: str, load_hash
) -> tuple[bool, object]:
    """取 bcrypt 名額（排隊有上限）→ 名額內重查帳號鎖並扣額度 → load_hash()
    取得要比對的雜湊 → 在 thread 裡驗。回傳 (密碼是否正確, load_hash 的附帶值)。"""
    try:
        async with _bcrypt_slots.slot(max_waiters=BCRYPT_MAX_WAITERS):
            await _claim_password_attempt(limiter, key)
            password_hash, extra = await load_hash()
            ok = await run_in_thread(_pwd_context.verify, password, password_hash)
    except SlotsBusy as exc:
        raise _busy() from exc
    return ok, extra


async def _finish_success(limiter: ratelimit.RateLimiter, key: str) -> None:
    """密碼正確：回應之前再查一次鎖。同一批併發請求裡有人打錯第 10 次、在這
    次驗證途中開始鎖定時，這次一樣拒絕（鎖定中連正確密碼也不放行）。"""
    await check_login_lock(limiter, key)
    await clear_login_attempts(limiter, key)


async def record_password_failure(
    db: AsyncSession,
    limiter: ratelimit.RateLimiter,
    email: str,
    user: User | None,
    *,
    reason: str,
    context: str,
    actor_user_id=None,
) -> bool:
    """記一次密碼錯誤；回傳這個帳號是否已達上限（已鎖定）。

    這次嘗試在驗證前已經扣過帳號額度（_claim_password_attempt），這裡不再
    計數，只判斷是否到頂、到頂就開始帳號鎖。email 對得到帳號才寫稽核（target
    是那個帳號；metadata 不放 email、IP）：不存在的 email 也照樣計數與鎖定
    （回應才一樣，不能拿來枚舉帳號），但不寫稽核，免得任何人都能用亂打的
    email 灌爆稽核表。鎖定中或額度用完的嘗試在 bcrypt 之前就被擋掉、不會走到
    這裡，所以一個帳號每 20 分鐘最多 10 筆失敗稽核。會 commit 呼叫端的 db
    （登入失敗的請求本身不會 commit）。"""
    key = _rate_limit_key(email)
    over_limit = await limiter.is_limited(LOGIN_ACCOUNT_LIMIT, key)
    lock_started = over_limit and await limiter.consume_marker(LOGIN_LOCK, key)
    if user is not None:
        await audit_service.log_action(
            db,
            actor_user_id=actor_user_id,
            action="user.login_password_failed",
            target_type="user",
            target_id=str(user.id),
            metadata={"reason": reason, "context": context},
        )
        if lock_started:
            await audit_service.log_action(
                db,
                actor_user_id=actor_user_id,
                action="user.login_locked",
                target_type="user",
                target_id=str(user.id),
                metadata={"lock_minutes": LOGIN_LOCK_SECONDS // 60, "failed_attempts": LOGIN_MAX_ATTEMPTS},
            )
        await db.commit()
    return over_limit


# 帳號不存在時也要付出一次 bcrypt 的成本，否則「查無此人」會在毫秒級
# 回來、而密碼錯誤要等兩百多毫秒，光看回應時間就能枚舉出哪些 email 是
# 真的管理者帳號。只在 import 時算一次。
_DUMMY_PASSWORD_HASH = _pwd_context.hash(secrets.token_urlsafe(32))


async def _load_login_user(db: AsyncSession, normalized: str) -> User | None:
    """查帳號，然後立刻結束讀取交易、把連線還回主連線池：接下來的 bcrypt
    （約 250 ms）不佔主池的連線（稽核 login-burst-starves-main-db-pool：原本
    查完帳號就握著連線排 bcrypt，亂打 email 的登入洪泛就能讓所有需要 DB 的
    請求逾時）。回傳的 User 已從 session 移出，只用它已載入的欄位。"""
    # 用 limit(1) 而不是 scalar_one_or_none()：萬一資料庫裡已經存在大小寫
    # 不同的重複 email（舊資料），也只會登入失敗，不會整支端點 500。
    result = await db.execute(
        select(User)
        .where(func.lower(User.email) == normalized)
        .order_by(User.created_at.asc(), User.id.asc())
        .limit(1)
    )
    user = result.scalars().first()
    if user is not None:
        db.expunge(user)
    await db.rollback()
    return user


async def authenticate(
    db: AsyncSession,
    email: str,
    password: str,
    *,
    limiter: ratelimit.RateLimiter,
    client_key: str | None = None,
) -> User:
    """密碼登入。順序：來源限流 → 帳號鎖（不用排隊就能擋掉的先擋）→ 取 bcrypt
    名額（排隊有上限）→ 名額內重查帳號鎖、扣帳號額度 → 查帳號並歸還連線 →
    驗密碼 → 成功前再查一次鎖。

    會結束呼叫端 db 的交易（呼叫前不該有未提交的變更）；失敗時另外 commit
    失敗稽核。"""
    if client_key:
        await check_login_source_rate_limit(limiter, client_key)

    normalized = _rate_limit_key(email)
    # 帳號鎖在 bcrypt 之前：鎖定中連正確密碼也不驗。
    await check_login_lock(limiter, normalized)

    async def load_hash():
        found = await _load_login_user(db, normalized)
        return (found.password_hash if found is not None else _DUMMY_PASSWORD_HASH), found

    password_ok, user = await _verify_password_bounded(limiter, normalized, password, load_hash)

    if user is not None and password_ok and user.is_active:
        await _finish_success(limiter, normalized)
        return user

    # 停權帳號的正確密碼也算一次失敗、回應跟錯誤密碼一樣（401，達上限一樣
    # 429），不能拿來分辨停權帳號的密碼對不對。登入失敗時請求者不一定是
    # 本人，稽核的 actor 留空。
    inactive = user is not None and password_ok
    if await record_password_failure(
        db, limiter, normalized, user,
        reason="inactive" if inactive else "wrong_password", context="login",
    ):
        raise _account_locked()
    if inactive:
        raise AccountInactive()
    raise InvalidCredentials()


async def verify_current_password(
    db: AsyncSession, user: User, password: str, *, limiter: ratelimit.RateLimiter, context: str
) -> None:
    """已登入的人再輸入一次目前的密碼（改密碼、變更自己的登入方式）。跟密碼
    登入共用帳號鎖與額度：鎖定中不驗（LoginRateLimited），打錯也算一次失敗。
    user 是請求 session 裡的物件（呼叫端之後還要用），這裡不歸還連線；這條
    路徑要先有有效的 session，不是匿名洪泛的入口。"""
    key = _rate_limit_key(user.email)
    await check_login_lock(limiter, key)
    password_hash = user.password_hash

    async def load_hash():
        return password_hash, None

    password_ok, _ = await _verify_password_bounded(limiter, key, password, load_hash)
    if password_ok:
        await _finish_success(limiter, key)
        return
    if await record_password_failure(
        db, limiter, key, user, reason="wrong_password", context=context, actor_user_id=user.id
    ):
        raise _account_locked()
    raise InvalidCredentials()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_idle(settings) -> timedelta:
    return timedelta(minutes=settings.session_idle_minutes)


def _sliding_expiry(session: Session, now: datetime, idle: timedelta) -> datetime:
    return min(session.created_at + SESSION_TTL, now + idle)


async def create_session(db: AsyncSession, user: User, *, idle: timedelta) -> tuple[str, str]:
    """回傳 (raw_token, csrf_token)；raw_token 只在這裡出現一次，存庫的是 hash。"""
    raw_token = secrets.token_urlsafe(_TOKEN_BYTES)
    csrf_token = secrets.token_urlsafe(_TOKEN_BYTES)
    now = datetime.now(timezone.utc)
    session = Session(
        id=_hash_token(raw_token),
        user_id=user.id,
        csrf_token=csrf_token,
        created_at=now,
        expires_at=min(now + SESSION_TTL, now + idle),
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
    if (
        session.revoked_at is not None
        or session.expires_at <= now
        # 絕對上限另外再檢查一次：上線前發出的 session 的 expires_at 不一定對。
        or session.created_at + SESSION_TTL <= now
    ):
        return None
    return session


async def refresh_session_expiry(
    engine: AsyncEngine, session: Session, *, idle: timedelta, now: datetime | None = None
) -> bool:
    """有效 session 被使用時把閒置到期時間往後推（不超過絕對上限）。

    用獨立連線、自己的短交易寫：這在 dependency 裡跑，請求本身的交易還
    沒開始做事，也絕不能替它 commit 半套的變更。GET 一樣會延長。只在能往
    後推至少 SESSION_REFRESH_STEP 時才寫，避免每個請求一次 UPDATE。上線前
    發出的 12 小時 session 第一次使用時拉回閒置窗口。

    延長只是盡力而為：請求本身已經握著主池一條連線，這裡再要第二條；池子
    滿了（尖峰或被灌）拿不到時記 warning、這次不延長（回 False），下一個
    請求再延長，不讓整個請求變成 500。不改用限流專用池：那個池的檢查是
    fail-closed，多了這裡的寫入會讓公開送單更容易吃 429。"""
    now = now or datetime.now(timezone.utc)
    target = _sliding_expiry(session, now, idle)
    step = min(SESSION_REFRESH_STEP, idle / 4)
    if not (target - session.expires_at >= step or target < session.expires_at):
        return False
    try:
        async with engine.begin() as conn:
            await conn.execute(
                update(Session)
                .where(Session.id == session.id, Session.revoked_at.is_(None))
                .values(expires_at=target)
            )
    except ratelimit.PoolTimeout:
        logger.warning("主連線池已滿，這次沒有延長 session 閒置期限")
        return False
    # 請求自己的 ORM 物件同步成新值，但不標成待寫（不會在請求的交易裡再寫一次）。
    set_committed_value(session, "expires_at", target)
    return True


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


def clear_external_logins(user: User) -> dict[str, bool]:
    """解除 LINE／Google 綁定；回傳原本有沒有綁（稽核只記這兩個旗標，不記 sub）。"""
    flags = {"line_unlinked": user.line_sub is not None, "google_unlinked": user.google_sub is not None}
    user.line_sub = None
    user.google_sub = None
    return flags


async def set_user_active(db: AsyncSession, user: User, active: bool) -> dict[str, bool]:
    """停權時一併解除 LINE／Google 綁定並撤銷所有 session，回傳解除了哪些綁定
    （給稽核用）；啟用時回傳空 dict。停權是處理帳號被盜用的標準動作，綁定若
    留著，之後復權時攻擊者綁上去的 LINE 會跟著回來。"""
    if not active and user.role == Role.SUPER_ADMIN:
        # 兩個請求同時停權僅存的兩位總管理者時，各自都會看到「另一位還在」。
        # 用交易層級的 advisory lock 讓所有停權總管理者的操作排隊，拿到鎖
        # 之後才計數（READ COMMITTED 下這次查詢看得到前一筆已提交的停權）。
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('super-admin-invariant'))"))
        remaining = await count_active_super_admins(db, exclude_user_id=user.id)
        if remaining == 0:
            raise LastSuperAdminProtected()
    user.is_active = active
    unlinked = {} if active else clear_external_logins(user)
    await db.flush()
    if not active:
        # 停權立即失效：撤銷該使用者所有現行 session。
        result = await db.execute(select(Session).where(Session.user_id == user.id))
        now = datetime.now(timezone.utc)
        for session in result.scalars():
            if session.revoked_at is None:
                session.revoked_at = now
        await db.flush()
    return unlinked


async def revoke_user_sessions(db: AsyncSession, user_id, *, keep_session_id: str | None = None) -> int:
    """撤銷某人的所有 session（改密碼、重設密碼後舊裝置一律登出）。
    keep_session_id 用在本人改密碼：目前這個分頁不要被登出。"""
    result = await db.execute(select(Session).where(Session.user_id == user_id))
    now = datetime.now(timezone.utc)
    revoked = 0
    for session in result.scalars():
        if session.revoked_at is None and session.id != keep_session_id:
            session.revoked_at = now
            revoked += 1
    await db.flush()
    return revoked


async def change_role(db: AsyncSession, user: User, role: Role) -> None:
    """降級總管理者前一樣要確認不是最後一位（與停權同一把鎖）。"""
    if user.role == Role.SUPER_ADMIN and role != Role.SUPER_ADMIN and user.is_active:
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('super-admin-invariant'))"))
        if await count_active_super_admins(db, exclude_user_id=user.id) == 0:
            raise LastSuperAdminProtected()
    user.role = role
    await db.flush()


async def set_campus_scopes(db: AsyncSession, user: User, campus_keys: list[str]) -> None:
    result = await db.execute(select(UserCampusScope).where(UserCampusScope.user_id == user.id))
    for scope in result.scalars():
        await db.delete(scope)
    await db.flush()
    for key in campus_keys:
        db.add(UserCampusScope(user_id=user.id, campus_key=key))
    await db.flush()
