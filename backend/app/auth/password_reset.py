"""總管理者寄給同事的重設密碼連結（2026-10-03 使用者裁定：只做總管理者寄連結，
登入頁不開放自助「忘記密碼」）。

- token 只存 SHA-256；原始 token 只出現在這次寄出的信裡，不進 DB、稽核或 log。
- 30 分鐘內有效、只能用一次；寄新的會讓同一人還沒用的舊連結作廢。本人改密碼、
  總管理者直接設新密碼、帳號停用也會作廢（見 routes.py 與 password_reset_routes.py）。
- 信在寄出請求裡同步寄，不走 outbox：outbox_messages 綁的是參觀案件
  （visit_request_id NOT NULL），而且連結 30 分鐘就過期，排隊重試沒有意義；同步寄出，
  總管理者當場就知道有沒有寄出去。
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import PasswordResetToken, User
from app.common import ratelimit
from app.common.timezones import OPERATING_TZ
from app.notifications.email_adapter import EmailAdapter, get_email_adapter

RESET_LINK_TTL = timedelta(minutes=30)
_TOKEN_BYTES = 32
_TOKEN_MAX_CHARS = 128
# 同一個帳號 15 分鐘內最多寄 3 封：手滑連按，或有人拿總管理者的 session 灌爆對方信箱。
SEND_LIMIT = ratelimit.Limit("password_reset_send", 900, 3)
# 打開連結、送出新密碼：每個來源 5 分鐘 30 次。token 有 256 bits 猜不到，這裡擋的是
# 拿這兩支不用登入的端點當 DB 查詢洪泛。
OPEN_SOURCE_LIMIT = ratelimit.Limit("password_reset_source", 300, 30)

REJECT_UNKNOWN = "link_unknown"
REJECT_EXPIRED = "link_expired"
REJECT_USED = "link_used"
REJECT_REVOKED = "link_revoked"
REJECT_INACTIVE = "inactive"

_WEEKDAYS = "一二三四五六日"


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def email_enabled(settings) -> bool:
    """能不能寄重設連結：要有後台網址（信裡的連結）而且有寄信管道。正式環境只認
    SMTP；其他環境另外接受本機 sink（開發與 stack e2e 讀信用）。"""
    if not settings.admin_origin:
        return False
    if settings.smtp_host:
        return True
    return settings.environment != "production" and bool(settings.notification_email_sink_dir)


def mail_adapter(settings) -> EmailAdapter:
    """寄信管道；測試用 monkeypatch 換成記錄用的 adapter。"""
    return get_email_adapter(settings.notification_email_sink_dir, settings)


def reset_url(admin_origin: str, raw_token: str) -> str:
    # token 放在 # 後面：fragment 不會送到伺服器，不進 access log，也不會出現在 Referer。
    return f"{admin_origin.rstrip('/')}/admin/reset-password#token={raw_token}"


@dataclass(frozen=True)
class IssuedLink:
    token_id: uuid.UUID
    raw_token: str
    expires_at: datetime
    replaced_previous: bool


async def revoke_outstanding(db: AsyncSession, user_id: uuid.UUID, *, now: datetime | None = None) -> int:
    """讓這個人還沒用、還沒過期的連結作廢；回傳作廢了幾條（已過期的不算，本來就不能用）。"""
    now = now or datetime.now(timezone.utc)
    result = await db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user_id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.revoked_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .values(revoked_at=now)
    )
    return result.rowcount or 0


async def revoke_token(db: AsyncSession, token_id: uuid.UUID) -> None:
    """寄送失敗時作廢這一條：信沒寄到，不能留一條沒人拿得到、卻仍然有效的連結。"""
    await db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.id == token_id, PasswordResetToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )


async def issue(db: AsyncSession, user: User, *, actor_id: uuid.UUID) -> IssuedLink:
    """建一條新連結，並作廢這個人還有效的舊連結。呼叫端要先鎖住 user 列
    （SELECT … FOR UPDATE），兩位總管理者同時寄時才不會各留一條有效連結。"""
    now = datetime.now(timezone.utc)
    replaced = await revoke_outstanding(db, user.id, now=now) > 0
    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    token = PasswordResetToken(
        id=uuid.uuid4(),
        user_id=user.id,
        token_hash=hash_token(raw),
        created_by=actor_id,
        created_at=now,
        expires_at=now + RESET_LINK_TTL,
    )
    db.add(token)
    await db.flush()
    return IssuedLink(token_id=token.id, raw_token=raw, expires_at=token.expires_at, replaced_previous=replaced)


async def find_token(db: AsyncSession, raw: str) -> PasswordResetToken | None:
    if not raw or len(raw) > _TOKEN_MAX_CHARS:
        return None
    result = await db.execute(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(raw)))
    return result.scalar_one_or_none()


def rejection(token: PasswordResetToken, user: User | None, now: datetime) -> str | None:
    """連結不能用的原因；能用回 None。順序：用過 → 作廢 → 過期 → 帳號停用，
    越前面的越能說明「下一步該怎麼做」。"""
    if token.used_at is not None:
        return REJECT_USED
    if token.revoked_at is not None:
        return REJECT_REVOKED
    if token.expires_at <= now:
        return REJECT_EXPIRED
    if user is None or not user.is_active:
        return REJECT_INACTIVE
    return None


def build_email(*, user: User, actor: User, url: str, expires_at: datetime) -> tuple[str, str]:
    """純文字信：帳號、寄的人、幾點前有效、連結。不放密碼，也不放其他同事的資料。"""
    local = expires_at.astimezone(OPERATING_TZ)
    deadline = f"{local:%m/%d}（{_WEEKDAYS[local.weekday()]}）{local:%H:%M}"
    name = user.display_name or user.email
    actor_name = actor.display_name or actor.email
    subject = "【常春藤官網後台】重設密碼連結"
    lines = [
        f"{name} 您好：",
        "",
        f"總管理者 {actor_name} 替您的官網後台帳號（{user.email}）寄出重設密碼連結。",
        f"請在 {deadline} 前開啟下面的連結設定新密碼，連結只能使用一次：",
        url,
        "",
        "設定完成後，原本登入中的裝置都會登出，請用新密碼重新登入。",
        "如果您沒有要重設密碼，不用理會這封信，原本的密碼照常可用；也請告訴總管理者。",
        "請勿把這封信轉給他人。",
        "",
        "這封信由系統自動寄出，請勿直接回覆。",
    ]
    return subject, "\n".join(lines)
