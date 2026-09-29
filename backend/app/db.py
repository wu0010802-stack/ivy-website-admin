from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import Settings

# 每條執行期連線的 statement_timeout（毫秒）：單一慢查詢或等列鎖的語句不會
# 無限期占住連線。另外兩個逾時由設定決定，見 _server_settings。
STATEMENT_TIMEOUT_MS = 30_000

# 限流專用的小池：每次操作只是一兩句的短交易，幾條連線就夠；拿不到連線
# 最多等這麼久，之後由 RateLimiter 依「檢查一律當超限」處理（見 ratelimit.py）。
RATE_LIMIT_POOL_SIZE = 3
RATE_LIMIT_MAX_OVERFLOW = 2
RATE_LIMIT_POOL_TIMEOUT_SECONDS = 5


class Base(DeclarativeBase):
    pass


def _server_settings(settings: Settings) -> dict[str, str]:
    """每條執行期連線建立時就設好的 session 參數（毫秒）；0 代表沿用 DB 預設，不送。

    - statement_timeout（固定 30 秒）：慢查詢不會無限期占住連線；
    - lock_timeout（WEBSITE_DB_LOCK_TIMEOUT_MS）：等列鎖的請求最多卡這麼久，
      不會和連線池互等下去；
    - idle_in_transaction_session_timeout（WEBSITE_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS）：
      忘了結束交易（例如邊送檔邊握著 session）的連線被 DB 收回。

    migration 用 migrations/env.py 自己的 engine，不套這些值：改表時等鎖逾時會讓
    部署失敗。刻意長時間排隊的素材上傳配額鎖在 media/service.py 以 SET LOCAL
    放寬，定期工作刻意閒置的持鎖交易在 workers/maintenance.py 關掉 idle 逾時。"""
    values = {
        "statement_timeout": STATEMENT_TIMEOUT_MS,
        "lock_timeout": settings.db_lock_timeout_ms,
        "idle_in_transaction_session_timeout": settings.db_idle_in_transaction_timeout_ms,
    }
    return {name: str(value) for name, value in values.items() if value}


def _pool_options(settings: Settings, url: URL, *, pool_size: int, max_overflow: int, pool_timeout: int) -> dict:
    # 連線池大小與 server_settings 只對 PostgreSQL（asyncpg）有意義；SQLite 測試用預設。
    if url.get_backend_name() != "postgresql":
        return {}
    options: dict = {"pool_size": pool_size, "max_overflow": max_overflow, "pool_timeout": pool_timeout}
    server_settings = _server_settings(settings)
    if url.get_driver_name() == "asyncpg" and server_settings:
        options["connect_args"] = {"server_settings": server_settings}
    return options


def _create(settings: Settings, *, pool_size: int, max_overflow: int, pool_timeout: int) -> AsyncEngine:
    url = make_url(settings.active_database_url())
    # hide_parameters：DB 例外會被 logger.exception 整段寫進 log，預設會附上
    # 綁定參數（家長姓名、手機、Email…），一律隱藏。
    return create_async_engine(
        url,
        pool_pre_ping=True,
        hide_parameters=True,
        **_pool_options(settings, url, pool_size=pool_size, max_overflow=max_overflow, pool_timeout=pool_timeout),
    )


def create_engine(settings: Settings) -> AsyncEngine:
    """請求、後台與定期工作共用的主連線池。明寫大小與等候上限（WEBSITE_DB_POOL_SIZE／
    _MAX_OVERFLOW／_POOL_TIMEOUT_SECONDS，預設 10＋10、等 10 秒）：SQLAlchemy 預設的
    30 秒等候會讓連線池一吃緊，整站請求都卡半分鐘才失敗。"""
    return _create(
        settings,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
    )


def create_rate_limit_engine(settings: Settings) -> AsyncEngine:
    """限流專用的小連線池。

    限流計數要用獨立交易（不能跟著請求 rollback），而呼叫限流時請求自己的
    session 往往已經握著一條連線（預約送單甚至握著校區設定列鎖）。若向同一個
    連線池借第二條，十幾個併發請求就會全部「握一條、等一條」而卡死，限流
    本身也擋不住（稽核 visit-submit-pool-starvation）。獨立的池子不會跟請求
    互等；每次限流只是一條短 upsert。"""
    return _create(
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
