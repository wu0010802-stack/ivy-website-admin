"""重設密碼連結的端點（2026-10-03）：總管理者寄出（後台），同事確認連結、設定新密碼
（不需要登入）。規則見 app/auth/password_reset.py。"""
from __future__ import annotations

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import password_reset
from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.auth.schemas import PasswordResetLinkOut
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
