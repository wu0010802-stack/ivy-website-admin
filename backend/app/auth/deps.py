from __future__ import annotations

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import Session, User
from app.auth.service import get_session_by_token

SESSION_COOKIE_NAME = "ivy_admin_session"
CSRF_HEADER_NAME = "x-csrf-token"

_MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


async def get_db_session(request: Request) -> AsyncSession:
    async with request.app.state.session_factory() as session:
        yield session


async def get_current_session(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> Session:
    if session_token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登入")
    session = await get_session_by_token(db, session_token)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登入")
    return session


def check_csrf_and_origin(request: Request, session: Session, csrf_header: str | None) -> None:
    if request.method not in _MUTATING_METHODS:
        return
    settings = request.app.state.settings
    if settings.admin_origin:
        origin = request.headers.get("origin")
        if origin is not None and origin != settings.admin_origin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Origin 不符")
    if csrf_header is None or csrf_header != session.csrf_token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token 無效")


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    csrf_header: str | None = Header(default=None, alias=CSRF_HEADER_NAME),
) -> User:
    session = await get_current_session(request, db, session_token)
    check_csrf_and_origin(request, session, csrf_header)
    result = await db.execute(
        select(User)
        .options(selectinload(User.campus_scopes))
        .where(User.id == session.user_id)
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登入")
    return user
