from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import Settings

# 限流專用的小池：每次操作只是一兩句的短交易，幾條連線就夠；拿不到連線
# 最多等這麼久，之後由 RateLimiter 依「檢查一律當超限」處理（見 ratelimit.py）。
RATE_LIMIT_POOL_SIZE = 2
RATE_LIMIT_MAX_OVERFLOW = 3
RATE_LIMIT_POOL_TIMEOUT_SECONDS = 3


class Base(DeclarativeBase):
    pass


def _server_settings(settings: Settings) -> dict[str, str]:
    """每條連線建立時就設好的 session 參數（毫秒）；0 代表沿用 DB 預設，不送。

    lock_timeout 讓等列鎖的請求最多卡這麼久，不會和連線池互等下去；
    idle_in_transaction_session_timeout 讓忘了結束交易（例如邊送檔邊握著
    session）的連線被 DB 收回。alembic 另建自己的 engine（migrations/env.py），
    不套這些值：改表時等鎖逾時會讓部署失敗。"""
    values = {
        "lock_timeout": settings.db_lock_timeout_ms,
        "idle_in_transaction_session_timeout": settings.db_idle_in_transaction_timeout_ms,
    }
    return {name: str(value) for name, value in values.items() if value}


def _build_engine(settings: Settings, *, pool_size: int, max_overflow: int, pool_timeout: float) -> AsyncEngine:
    url = make_url(settings.active_database_url())
    # hide_parameters：DB 例外會被 logger.exception 整段寫進 log，預設會附上
    # 綁定參數（家長姓名、手機、Email…），一律隱藏。
    options: dict = {"pool_pre_ping": True, "hide_parameters": True}
    if url.get_backend_name() == "postgresql":
        options.update(pool_size=pool_size, max_overflow=max_overflow, pool_timeout=pool_timeout)
        server_settings = _server_settings(settings)
        if url.get_driver_name() == "asyncpg" and server_settings:
            options["connect_args"] = {"server_settings": server_settings}
    return create_async_engine(url, **options)


def create_engine(settings: Settings) -> AsyncEngine:
    """請求 session 與背景工作共用的主連線池（大小與等待時間由設定決定）。"""
    return _build_engine(
        settings,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
    )


def create_rate_limit_engine(settings: Settings) -> AsyncEngine:
    """限流計數專用的獨立小池。和請求 session 共用一個池時，握著列鎖與連線
    的送單請求再去要一條連線做限流，匿名併發就能把池卡死（稽核
    visit-submit-pool-starvation）；分開之後兩邊互不拖累。"""
    return _build_engine(
        settings,
        pool_size=RATE_LIMIT_POOL_SIZE,
        max_overflow=RATE_LIMIT_MAX_OVERFLOW,
        pool_timeout=RATE_LIMIT_POOL_TIMEOUT_SECONDS,
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_db_session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session
