"""變更「自己的登入方式」前的重新驗證。

拿到別人一次 session（共用電腦沒登出、同源 XSS）的人，原本不用密碼就能把自己
的 LINE 綁到對方帳號上，之後就算對方重設密碼、撤銷 session 也趕不走（稽核
session-hijack-persistence-no-reauth）。綁定／解除 LINE、解除 Google 改成要嘛
session 是 10 分鐘內剛登入的（Google／LINE 重新登入也算，OAuth 流程照常），
要嘛本文帶正確的目前密碼；密碼打錯跟登入共用帳號鎖。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.models import Session, User
from app.common.ratelimit import limiter

REAUTH_WINDOW = timedelta(minutes=10)
LOGIN_LOCKED_MESSAGE = "密碼錯誤次數過多，這個帳號的密碼登入暫停 15 分鐘"
LOGIN_RATE_LIMITED_MESSAGE = "嘗試太頻繁或系統忙碌，請稍候再試"


def login_rate_limited(exc: service.LoginRateLimited) -> HTTPException:
    """密碼登入／驗證的 429：detail 用 {code, message} 分開「這個帳號鎖定中」
    （LOGIN_LOCKED）與「來源限流、排隊已滿、系統忙碌」（LOGIN_RATE_LIMITED），
    並帶 Retry-After。不存在的 email 一樣會鎖，分開不會洩漏帳號是否存在。"""
    code, message = (
        ("LOGIN_LOCKED", LOGIN_LOCKED_MESSAGE) if exc.locked else ("LOGIN_RATE_LIMITED", LOGIN_RATE_LIMITED_MESSAGE)
    )
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail={"code": code, "message": message},
        headers={"Retry-After": str(exc.retry_after)},
    )


def _reauth_required(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail={"code": "REAUTH_REQUIRED", "message": message}
    )


async def require_recent_auth(
    request: Request, db: AsyncSession, user: User, session: Session, current_password: str | None
) -> None:
    if session.created_at > datetime.now(timezone.utc) - REAUTH_WINDOW:
        return
    if not current_password:
        raise _reauth_required("為了安全，請輸入目前的密碼（或重新登入後 10 分鐘內）再變更登入方式")
    try:
        await service.verify_current_password(
            db, user, current_password, limiter=limiter(request), context="reauth"
        )
    except service.LoginRateLimited as exc:
        raise login_rate_limited(exc) from exc
    except service.InvalidCredentials as exc:
        raise _reauth_required("目前的密碼不正確") from exc
