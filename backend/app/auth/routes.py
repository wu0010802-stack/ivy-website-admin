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
from app.auth.models import CREATABLE_ROLES, GRANTABLE_CAPABILITIES, GRANTABLE_ROLES, Role, User
from app.auth.permissions import require_scope
from app.auth.oauth_common import private
from app.auth.schemas import (
    AuthProviders,
    LoginRequest,
    LoginResponse,
    MeResponse,
    UserCreateRequest,
    UserOut,
    UserUpdateActiveRequest,
    UserUpdateScopeRequest,
    UserUpdateRoleRequest,
    UserCapabilitiesRequest,
    PasswordChangeRequest,
    PasswordResetRequest,
)
from app.common import ratelimit
from app.config import Settings
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["auth"])


def _require_scope_for_role(role: Role, campus_keys: list[str]) -> None:
    """除了總管理者，每個角色都一定要有校區範圍：沒有範圍的分校管理者、
    編輯、櫃台、唯讀帳號什麼都看不到，建出來只會讓人以為系統壞了。"""
    if role != Role.SUPER_ADMIN and not campus_keys:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="請至少指定一個校區")


def _clean_capabilities(role: Role, capabilities: list[str]) -> list[str]:
    """只接受已知的授權，而且只給會用到的角色（分校管理者、內容編輯）。
    總管理者本來就涵蓋全部，存了也沒意義。"""
    unknown = [c for c in capabilities if c not in GRANTABLE_CAPABILITIES]
    if unknown:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"不支援的授權：{', '.join(unknown)}")
    if capabilities and role.value not in GRANTABLE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="只有分校管理者與內容編輯可以授予這項權限"
        )
    return sorted(set(capabilities))


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        campus_keys=sorted(scope.campus_key for scope in user.campus_scopes),
        capabilities=list(user.capabilities or []),
        line_linked=user.line_sub is not None,
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


@router.get("/auth/providers", response_model=AuthProviders)
async def providers(request: Request, response: Response) -> AuthProviders:
    private(response)
    settings: Settings = request.app.state.settings
    return AuthProviders(google=settings.google_oauth_enabled, line=settings.line_oauth_enabled)


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
            db,
            payload.email,
            payload.password,
            limiter=ratelimit.limiter(request),
            client_key=ratelimit.client_key(request),
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
    if payload.role not in CREATABLE_ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支援的角色")
    _require_scope_for_role(payload.role, payload.campus_keys)
    capabilities = _clean_capabilities(payload.role, payload.capabilities)
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
        capabilities=capabilities,
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.flush()
    if payload.role != Role.SUPER_ADMIN:
        await service.set_campus_scopes(db, user, payload.campus_keys)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="user.create",
        target_type="user",
        target_id=str(user.id),
        metadata={"role": payload.role.value, "campus_keys": sorted(payload.campus_keys), "capabilities": capabilities},
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
    if user.role == Role.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="總管理者不需要設定校區範圍"
        )
    _require_scope_for_role(user.role, payload.campus_keys)
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


async def _load_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    result = await db.execute(
        select(User).options(selectinload(User.campus_scopes)).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個使用者")
    return user


@router.patch("/admin/users/{user_id}/role", response_model=UserOut)
async def update_user_role(
    user_id: uuid.UUID,
    payload: UserUpdateRoleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> UserOut:
    require_scope(current_user, "users.manage")
    user = await _load_user(db, user_id)
    _require_scope_for_role(payload.role, payload.campus_keys)
    before = {"role": user.role.value, "campus_keys": sorted(s.campus_key for s in user.campus_scopes)}
    try:
        await service.change_role(db, user, payload.role)
    except service.LastSuperAdminProtected as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="不能降級最後一位總管理者") from exc
    await service.set_campus_scopes(db, user, [] if payload.role == Role.SUPER_ADMIN else payload.campus_keys)
    if payload.role.value not in GRANTABLE_ROLES:
        # 改成總管理者、櫃台或唯讀時，授權不再適用，清掉免得日後改回來時意外復活。
        user.capabilities = []
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="user.set_role",
        target_type="user",
        target_id=str(user_id),
        metadata={"before": before, "after": {"role": payload.role.value, "campus_keys": sorted(payload.campus_keys)}},
    )
    await db.commit()
    db.expire_all()
    return _user_out(await _load_user(db, user_id))


@router.post("/admin/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_user_password(
    user_id: uuid.UUID,
    payload: PasswordResetRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """總管理者替同事重設密碼（忘記密碼時）。新密碼由總管理者另行告知，
    對方所有已登入的裝置立即登出。不寄信、不在紀錄裡留密碼。"""
    require_scope(current_user, "users.manage")
    user = await _load_user(db, user_id)
    user.password_hash = service.hash_password(payload.password)
    revoked = await service.revoke_user_sessions(db, user.id)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="user.reset_password",
        target_type="user",
        target_id=str(user_id),
        metadata={"revoked_sessions": revoked},
    )
    await db.commit()


@router.post("/auth/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_own_password(
    payload: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    session: AuthSession = Depends(get_current_session),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """本人改密碼：先驗證目前密碼；成功後其他裝置登出，這個分頁保留。"""
    if not service.verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="目前的密碼不正確")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新密碼不能跟目前的一樣")
    user = await db.get(User, current_user.id)
    user.password_hash = service.hash_password(payload.new_password)
    await service.revoke_user_sessions(db, user.id, keep_session_id=session.id)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="user.change_password",
        target_type="user",
        target_id=str(current_user.id),
        metadata={},
    )
    await db.commit()


@router.patch("/admin/users/{user_id}/capabilities", response_model=UserOut)
async def update_user_capabilities(
    user_id: uuid.UUID,
    payload: UserCapabilitiesRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> UserOut:
    """規格 7：全站內容編輯是明確授權，只有總管理者可以授予或收回。"""
    require_scope(current_user, "users.manage")
    user = await _load_user(db, user_id)
    before = list(user.capabilities or [])
    user.capabilities = _clean_capabilities(user.role, payload.capabilities)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="user.set_capabilities",
        target_type="user",
        target_id=str(user_id),
        metadata={"before": before, "after": user.capabilities},
    )
    await db.commit()
    db.expire_all()
    return _user_out(await _load_user(db, user_id))
