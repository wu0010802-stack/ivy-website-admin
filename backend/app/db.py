from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import Settings


class Base(DeclarativeBase):
    pass


# 請求、後台與定期工作共用的主連線池。明寫大小與等候上限：預設的
# 30 秒等候會讓連線池一吃緊，整站請求都卡半分鐘才失敗。
# statement_timeout 讓單一慢查詢或等列鎖的語句不會無限期占住連線
# （migration 用 migrations/env.py 自己的連線，不受影響；刻意長時間排隊的
# 素材上傳配額鎖在 media/service.py 以 SET LOCAL 放寬）。
_SERVER_SETTINGS = {"statement_timeout": "30000"}


def _pool_options(url: str, *, pool_size: int, max_overflow: int, pool_timeout: int) -> dict:
    # 連線池大小與 server_settings 只對 PostgreSQL（asyncpg）有意義；SQLite 測試用預設。
    if not url.startswith("postgresql"):
        return {}
    return {
        "pool_size": pool_size,
        "max_overflow": max_overflow,
        "pool_timeout": pool_timeout,
        "connect_args": {"server_settings": _SERVER_SETTINGS},
    }


def create_engine(settings: Settings) -> AsyncEngine:
    url = settings.active_database_url()
    return create_async_engine(
        url, pool_pre_ping=True, **_pool_options(url, pool_size=10, max_overflow=10, pool_timeout=10)
    )


def create_rate_limit_engine(settings: Settings) -> AsyncEngine:
    """限流專用的小連線池。

    限流計數要用獨立交易（不能跟著請求 rollback），而呼叫限流時請求自己的
    session 往往已經握著一條連線（預約送單甚至握著校區設定列鎖）。若向同一個
    連線池借第二條，十幾個併發請求就會全部「握一條、等一條」而卡死，限流
    本身也擋不住。獨立的池子不會跟請求互等；每次限流只是一條短 upsert。"""
    url = settings.active_database_url()
    return create_async_engine(
        url, pool_pre_ping=True, **_pool_options(url, pool_size=3, max_overflow=2, pool_timeout=5)
    )


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_db_session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session
