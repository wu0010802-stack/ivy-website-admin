from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import service
from app.auth.deps import (
    CSRF_HEADER_NAME,
    SESSION_COOKIE_NAME,
    check_csrf_and_origin,
    get_current_session,
    get_current_user,
    get_db_session,
)
from app.auth.models import Session as AuthSession
from app.auth.models import Role, User, V1_CREATABLE_ROLES
from app.auth.permissions import require_scope
from app.auth.schemas import (
    LoginRequest,
    LoginResponse,
    MeResponse,
    UserCreateRequest,
    UserOut,
    UserUpdateActiveRequest,
    UserUpdateScopeRequest,
)
from app.common import ratelimit
from app.config import Settings
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["auth"])


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        campus_keys=sorted(scope.campus_key for scope in user.campus_scopes),
    )


def _set_session_cookie(response: Response, settings: Settings, raw_token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        max_age=int(service.SESSION_TTL.total_seconds()),
        path="/",
    )


@router.post("/auth/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db_session),
) -> LoginResponse:
    settings: Settings = request.app.state.settings
    try:
        user = await service.authenticate(
            db, payload.email, payload.password, client_key=ratelimit.client_key(request)
        )
    except service.LoginRateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="登入嘗試次數過多，請稍後再試"
        ) from exc
    except (service.InvalidCredentials, service.AccountInactive) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="帳號或密碼錯誤") from exc

    raw_token, csrf_token = await service.create_session(db, user)
    await db.commit()
    _set_session_cookie(response, settings, raw_token)

    result = await db.execute(
        select(User).options(selectinload(User.campus_scopes)).where(User.id == user.id)
    )
    user = result.scalar_one()
    return LoginResponse(csrf_token=csrf_token, user=_user_out(user))


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db_session),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    csrf_header: str | None = Header(default=None, alias=CSRF_HEADER_NAME),
) -> None:
    """登出跟其他會改狀態的請求一樣要過 CSRF／Origin 檢查；否則任何外站
    表單都能讓管理員的瀏覽器收到清除 cookie 的回應而被迫登出。沒有有效
    session 時什麼都不做（也不送清除 cookie）。"""
    if session_token is None:
        return
    session = await service.get_session_by_token(db, session_token)
    if session is None:
        # 已過期或已撤銷：cookie 沒有用了，清掉不會造成傷害。
        response.delete_cookie(SESSION_COOKIE_NAME, path="/")
        return
    check_csrf_and_origin(request, session, csrf_header)
    await service.revoke_session(db, session_token)
    await db.commit()
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


@router.get("/auth/me", response_model=MeResponse)
async def me(
    current_user: User = Depends(get_current_user),
    session: AuthSession = Depends(get_current_session),
) -> MeResponse:
    # 回傳目前 session 的 csrf_token，讓前端重新整理頁面後也能恢復
    # mutating 請求所需的 CSRF header，不用強迫使用者重新登入。
    return MeResponse(csrf_token=session.csrf_token, user=_user_out(current_user))


@router.get("/admin/users", response_model=list[UserOut])
async def list_users(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[UserOut]:
    require_scope(current_user, "users.manage")
    result = await db.execute(select(User).options(selectinload(User.campus_scopes)))
    return [_user_out(u) for u in result.scalars()]


@router.post("/admin/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> UserOut:
    require_scope(current_user, "users.manage")
    if payload.role not in V1_CREATABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="階段 B 第一版只能建立 super_admin 或 campus_admin",
        )
    # UserCreateRequest 已把 email 正規化成小寫，這裡仍用 lower() 比對，
    # 讓既有的大小寫混雜資料也能被擋下（DB 端另有 lower(email) 唯一索引兜底）。
    existing = await db.execute(select(User).where(func.lower(User.email) == payload.email))
    if existing.scalars().first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email 已被使用")

    user = User(
        id=uuid.uuid4(),
        email=payload.email,
        password_hash=service.hash_password(payload.password),
        role=payload.role,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.flush()
    if payload.role == Role.CAMPUS_ADMIN:
        await service.set_campus_scopes(db, user, payload.campus_keys)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="user.create",
        target_type="user",
        target_id=str(user.id),
        metadata={"role": payload.role.value, "campus_keys": sorted(payload.campus_keys)},
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        # lower(email) 唯一索引擋下的併發重複建立：兩個請求都通過了上面的
        # SELECT 檢查，DB 才是最後一道防線。
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email 已被使用") from exc

    result = await db.execute(
        select(User).options(selectinload(User.campus_scopes)).where(User.id == user.id)
    )
    return _user_out(result.scalar_one())


@router.patch("/admin/users/{user_id}/active", response_model=UserOut)
async def update_user_active(
    user_id: uuid.UUID,
    payload: UserUpdateActiveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> UserOut:
    require_scope(current_user, "users.manage")
    result = await db.execute(
        select(User).options(selectinload(User.campus_scopes)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個使用者")
    try:
        await service.set_user_active(db, user, payload.is_active)
    except service.LastSuperAdminProtected as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="不能停權最後一位總管理者"
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="user.set_active",
        target_type="user",
        target_id=str(user_id),
        metadata={"is_active": payload.is_active},
    )
    await db.commit()
    return _user_out(user)


@router.patch("/admin/users/{user_id}/scope", response_model=UserOut)
async def update_user_scope(
    user_id: uuid.UUID,
    payload: UserUpdateScopeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> UserOut:
    require_scope(current_user, "users.manage")
    result = await db.execute(
        select(User).options(selectinload(User.campus_scopes)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個使用者")
    if user.role != Role.CAMPUS_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="只有 campus_admin 需要設定校區範圍"
        )
    await service.set_campus_scopes(db, user, payload.campus_keys)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="user.set_scope",
        target_type="user",
        target_id=str(user_id),
        metadata={"campus_keys": sorted(payload.campus_keys)},
    )
    await db.commit()
    result = await db.execute(
        select(User).options(selectinload(User.campus_scopes)).where(User.id == user_id)
    )
    return _user_out(result.scalar_one())
