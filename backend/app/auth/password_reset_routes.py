"""重設密碼連結的端點（2026-10-03）：總管理者寄出（後台），同事確認連結、設定新密碼
（不需要登入）。規則見 app/auth/password_reset.py。"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import password_reset, service
from app.auth.deps import get_current_user, get_db_session
from app.auth.models import PasswordResetToken, User
from app.auth.oauth_common import private
from app.auth.permissions import require_scope
from app.auth.schemas import (
    PasswordResetCompleteRequest,
    PasswordResetLinkOut,
    PasswordResetTokenRequest,
    PasswordResetVerifyOut,
)
from app.common import ratelimit
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["auth"])
logger = logging.getLogger("app.auth")


def _error(status_code: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **extra})


@router.post("/admin/users/{user_id}/password-reset-link", response_model=PasswordResetLinkOut)
async def send_password_reset_link(
    user_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> PasswordResetLinkOut:
    """總管理者替同事寄重設密碼連結。先提交連結再寄信（信寄到時連結就要能用）；
    寄送失敗就作廢這條連結、回 502 並附錯誤類別，總管理者可以改用直接設定新密碼。
    寄出不影響原本的密碼：對方設好新密碼之前，舊密碼照常可用。"""
    require_scope(current_user, "users.manage")
    if user_id == current_user.id:
        raise _error(
            status.HTTP_409_CONFLICT, "USE_CHANGE_PASSWORD", "要改自己的密碼，請到「我的帳號」輸入目前的密碼後變更"
        )
    settings = request.app.state.settings
    if not password_reset.email_enabled(settings):
        raise _error(
            status.HTTP_409_CONFLICT, "RESET_EMAIL_DISABLED", "尚未設定寄信，無法寄出重設連結；請改用「直接設定新密碼」"
        )
    # 鎖住帳號列：兩位總管理者同時寄時排隊，第二封才看得到第一條並作廢它。
    # 鎖的順序一律「帳號 → 連結」，和設定新密碼那邊一致，兩邊同時發生不會互等。
    user = (await db.execute(select(User).where(User.id == user_id).with_for_update())).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個使用者")
    if not user.is_active:
        raise _error(status.HTTP_409_CONFLICT, "USER_INACTIVE", "帳號已停用，請先恢復帳號再寄重設連結")
    try:
        await ratelimit.limiter(request).check(password_reset.SEND_LIMIT, str(user.id))
    except ratelimit.RateLimiterUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RESET_LINK_BUSY", "message": "系統忙碌，請稍候再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "RESET_LINK_RATE_LIMITED",
                "message": "這個帳號 15 分鐘內已經寄過 3 次，請稍後再試，或改用「直接設定新密碼」",
            },
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

    issued = await password_reset.issue(db, user, actor_id=current_user.id)
    subject, body = password_reset.build_email(
        user=user,
        actor=current_user,
        url=password_reset.reset_url(settings.admin_origin, issued.raw_token),
        expires_at=issued.expires_at,
    )
    await db.commit()

    try:
        adapter = password_reset.mail_adapter(settings)
        await asyncio.to_thread(adapter.send, to=user.email, subject=subject, body=body)
    except Exception as exc:  # noqa: BLE001 —— 任何寄送失敗都要作廢連結並如實回報
        error_code = type(exc).__name__
        logger.warning("重設密碼連結寄送失敗：%s", error_code)
        await password_reset.revoke_token(db, issued.token_id)
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="user.password_reset_link_failed",
            target_type="user",
            target_id=str(user_id),
            metadata={"error_code": error_code},
        )
        await db.commit()
        raise _error(
            status.HTTP_502_BAD_GATEWAY,
            "RESET_EMAIL_FAILED",
            "重設連結沒有寄出，請稍後再試，或改用「直接設定新密碼」",
            error_code=error_code,
        ) from exc

    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="user.password_reset_link_sent",
        target_type="user",
        target_id=str(user_id),
        metadata={"expires_at": issued.expires_at.isoformat(), "replaced_previous": issued.replaced_previous},
    )
    await db.commit()
    return PasswordResetLinkOut(
        sent_to=user.email, expires_at=issued.expires_at, replaced_previous=issued.replaced_previous
    )


# 連結不能用時給本人看的話：每一種都說下一步。
_INVALID_MESSAGES = {
    password_reset.REJECT_UNKNOWN: "這個重設連結無效。請直接點信裡的連結，或請總管理者重新寄一次。",
    password_reset.REJECT_EXPIRED: "這個重設連結已過期（30 分鐘內有效），請總管理者重新寄一次。",
    password_reset.REJECT_USED: "這個重設連結已經用過了。密碼已更新，請直接登入；忘記新密碼請總管理者重新寄一次。",
    password_reset.REJECT_REVOKED: "這個重設連結已失效：之後又寄了新的連結，或密碼已經變更。請使用最新一封信裡的連結。",
    password_reset.REJECT_INACTIVE: "這個帳號已停用，無法重設密碼，請聯絡總管理者。",
}


def _invalid(reason: str) -> HTTPException:
    return _error(status.HTTP_410_GONE, "RESET_LINK_INVALID", _INVALID_MESSAGES[reason], reason=reason)


def _check_origin(request: Request) -> None:
    """不用登入的端點沒有 CSRF token 可比；Origin 一樣要對（比照 deps.check_csrf_and_origin）。"""
    admin_origin = request.app.state.settings.admin_origin
    origin = request.headers.get("origin")
    if admin_origin and origin is not None and origin != admin_origin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Origin 不符")


async def _check_source_limit(request: Request) -> None:
    try:
        await ratelimit.limiter(request).check(password_reset.OPEN_SOURCE_LIMIT, ratelimit.client_key(request))
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RESET_LINK_SOURCE_LIMITED", "message": "嘗試太頻繁或系統忙碌，請稍候再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc


@router.post("/auth/password-reset/verify", response_model=PasswordResetVerifyOut)
async def verify_password_reset_link(
    payload: PasswordResetTokenRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db_session),
) -> PasswordResetVerifyOut:
    """打開重設連結時先確認還能不能用，能用就回帳號與期限。只讀不寫：不消耗連結，
    也不寫稽核（送出新密碼時才寫，test_audit_coverage 有列例外）。"""
    private(response)
    _check_origin(request)
    await _check_source_limit(request)
    token = await password_reset.find_token(db, payload.token)
    if token is None:
        raise _invalid(password_reset.REJECT_UNKNOWN)
    user = await db.get(User, token.user_id)
    reason = password_reset.rejection(token, user, datetime.now(timezone.utc))
    if reason is not None:
        raise _invalid(reason)
    return PasswordResetVerifyOut(email=user.email, expires_at=token.expires_at)


@router.post("/auth/password-reset/complete", status_code=status.HTTP_204_NO_CONTENT)
async def complete_password_reset(
    payload: PasswordResetCompleteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """用重設連結設定新密碼：連結標成已用、其他還有效的連結作廢、所有 session 登出、
    解除密碼登入暫停。不自動登入，前端導回登入頁。

    無效的 token 不跑 bcrypt；有效的先算好雜湊（約 250 ms）再上鎖，鎖住期間不做慢的事。
    鎖的順序跟寄連結一樣「帳號 → 連結」。等鎖期間連結可能被用掉或作廢，上鎖後再判斷一次。"""
    _check_origin(request)
    await _check_source_limit(request)
    token = await password_reset.find_token(db, payload.token)
    if token is None:
        raise _invalid(password_reset.REJECT_UNKNOWN)
    user = await db.get(User, token.user_id)
    reason = password_reset.rejection(token, user, datetime.now(timezone.utc))
    new_hash = None
    if reason is None:
        new_hash = await service.hash_password_async(payload.new_password)
        await db.execute(
            select(User).where(User.id == token.user_id).with_for_update().execution_options(populate_existing=True)
        )
        await db.execute(
            select(PasswordResetToken)
            .where(PasswordResetToken.id == token.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        reason = password_reset.rejection(token, user, datetime.now(timezone.utc))
    if reason is not None:
        # 對得到帳號才寫稽核（亂打的 token 上面就回了，不會走到這裡）。
        await audit_service.log_action(
            db,
            actor_user_id=None,
            action="user.password_reset_link_rejected",
            target_type="user",
            target_id=str(token.user_id),
            metadata={"reason": reason},
        )
        await db.commit()
        raise _invalid(reason)

    now = datetime.now(timezone.utc)
    user.password_hash = new_hash
    token.used_at = now
    await password_reset.revoke_outstanding(db, user.id, now=now)
    revoked = await service.revoke_user_sessions(db, user.id)
    await audit_service.log_action(
        db,
        actor_user_id=user.id,
        action="user.password_reset_completed",
        target_type="user",
        target_id=str(user.id),
        metadata={"revoked_sessions": revoked},
    )
    await db.commit()
    await service.clear_login_lock(ratelimit.limiter(request), user.email)
