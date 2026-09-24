from __future__ import annotations

import hashlib
import hmac
import math
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy import delete, literal, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession

from app.common.models import RateLimitCounter


class RateLimited(Exception):
    """超過窗口上限。呼叫端負責轉成 429，並帶上 Retry-After。"""

    def __init__(self, retry_after_seconds: int) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__("請求太頻繁")


@dataclass(frozen=True)
class Limit:
    """一種限流規則。`bucket` 是 DB 裡的命名空間，同一個 bucket 不能拿去
    宣告兩組不同的窗口或上限。"""

    bucket: str
    window_seconds: int
    max_per_window: int


class RateLimiter:
    """存在 PostgreSQL 的限流計數，所有 worker／副本共用，重新部署也不歸零。

    每個 key 在每個固定窗口一列；判斷時把前一個窗口的次數依「還重疊多少」
    加權，近似滑動窗口：
        估計值 = 前窗次數 × (1 − 已進入本窗的比例) + 本窗次數
    比逐筆記錄省空間（一個來源一個窗口只有一列），誤差只在窗口交界，對
    限流來說足夠。

    「檢查＋累加」在同一條 upsert 內完成（ON CONFLICT … WHERE），多個請求
    同時打進來也不會一起越過上限。每次操作用自己的短交易、獨立連線：計數
    不能跟著請求本身的交易 rollback，否則失敗的登入不會被記下來。"""

    def __init__(
        self, engine: AsyncEngine, secret: str, *, clock: Callable[[], float] = time.time
    ) -> None:
        self._engine = engine
        self._secret = secret.encode("utf-8")
        self._clock = clock

    def _key_hash(self, limit: Limit, key: str) -> str:
        return hmac.new(self._secret, f"{limit.bucket}\0{key}".encode("utf-8"), hashlib.sha256).hexdigest()

    def _window(self, limit: Limit) -> tuple[int, float]:
        now = self._clock()
        window_start = int(now // limit.window_seconds) * limit.window_seconds
        return window_start, now - window_start

    @staticmethod
    def _previous_weight(limit: Limit, elapsed: float) -> float:
        return max(0.0, (limit.window_seconds - elapsed) / limit.window_seconds)

    @staticmethod
    def _retry_after(limit: Limit, elapsed: float) -> int:
        return max(1, math.ceil(limit.window_seconds - elapsed))

    @staticmethod
    def _expires_at(limit: Limit, window_start: int) -> datetime:
        # 窗口結束後還要當「前一個窗口」被加權一整個窗口。
        return datetime.fromtimestamp(window_start + 2 * limit.window_seconds, tz=timezone.utc)

    def _increment(self, limit: Limit, key_hash: str, window_start: int):
        table = RateLimitCounter.__table__
        return pg_insert(table).values(
            bucket=limit.bucket,
            key_hash=key_hash,
            window_start=window_start,
            hits=1,
            expires_at=self._expires_at(limit, window_start),
        )

    async def _counts(
        self, conn: AsyncConnection, limit: Limit, key_hash: str, window_start: int
    ) -> tuple[int, int]:
        rows = await conn.execute(
            select(RateLimitCounter.window_start, RateLimitCounter.hits).where(
                RateLimitCounter.bucket == limit.bucket,
                RateLimitCounter.key_hash == key_hash,
                RateLimitCounter.window_start.in_([window_start, window_start - limit.window_seconds]),
            )
        )
        by_window = dict(rows.all())
        return by_window.get(window_start - limit.window_seconds, 0), by_window.get(window_start, 0)

    async def check(self, limit: Limit, key: str) -> None:
        """未超過上限就記一次命中；超過則丟 RateLimited（被擋下的那次不計）。"""
        key_hash = self._key_hash(limit, key)
        window_start, elapsed = self._window(limit)
        table = RateLimitCounter.__table__
        async with self._engine.begin() as conn:
            previous, _ = await self._counts(conn, limit, key_hash, window_start)
            carried = previous * self._previous_weight(limit, elapsed)
            if carried >= limit.max_per_window:
                raise RateLimited(self._retry_after(limit, elapsed))
            stmt = (
                self._increment(limit, key_hash, window_start)
                .on_conflict_do_update(
                    index_elements=[table.c.bucket, table.c.key_hash, table.c.window_start],
                    set_={"hits": table.c.hits + 1},
                    where=(table.c.hits + literal(carried)) < limit.max_per_window,
                )
                .returning(table.c.hits)
            )
            if (await conn.execute(stmt)).first() is None:
                raise RateLimited(self._retry_after(limit, elapsed))

    async def is_limited(self, limit: Limit, key: str) -> bool:
        """只看不記：給「失敗之後才累計」的桶用。"""
        key_hash = self._key_hash(limit, key)
        window_start, elapsed = self._window(limit)
        async with self._engine.connect() as conn:
            previous, current = await self._counts(conn, limit, key_hash, window_start)
        return previous * self._previous_weight(limit, elapsed) + current >= limit.max_per_window

    async def record(self, limit: Limit, key: str) -> None:
        key_hash = self._key_hash(limit, key)
        window_start, _ = self._window(limit)
        table = RateLimitCounter.__table__
        stmt = self._increment(limit, key_hash, window_start).on_conflict_do_update(
            index_elements=[table.c.bucket, table.c.key_hash, table.c.window_start],
            set_={"hits": table.c.hits + 1},
        )
        async with self._engine.begin() as conn:
            await conn.execute(stmt)

    async def reset(self, limit: Limit, key: str) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                delete(RateLimitCounter).where(
                    RateLimitCounter.bucket == limit.bucket,
                    RateLimitCounter.key_hash == self._key_hash(limit, key),
                )
            )

    async def purge_expired(self) -> int:
        async with self._engine.begin() as conn:
            return await purge_expired_counters(conn, datetime.fromtimestamp(self._clock(), tz=timezone.utc))


async def purge_expired_counters(db: AsyncConnection | AsyncSession, now: datetime) -> int:
    """刪掉已經不會再被讀到的列；由定期工作呼叫（app/workers/maintenance.py）。"""
    result = await db.execute(delete(RateLimitCounter).where(RateLimitCounter.expires_at < now))
    return result.rowcount or 0


def limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


def client_key(request: Request) -> str:
    """限流要綁「訪客」而不是「代理」。公開 API 一律經 Nuxt 的
    server route 轉進來，`request.client.host` 恆為代理的內網位址，
    所有訪客會共用同一個桶。改成優先採信代理刻意帶進來的自家 header
    （由 settings.trusted_client_ip_header 指定），沒有才退回 peer。

    這個 header 只有在請求真的來自信任代理時才有意義，所以部署上必須
    確保 API 不直接對外（見 deploy/README.md）；否則任何人都能偽造。"""
    settings = getattr(request.app.state, "settings", None)
    header_name = getattr(settings, "trusted_client_ip_header", None)
    if header_name:
        forwarded = request.headers.get(header_name)
        if forwarded:
            # 只取第一段並限制長度，避免超長 header 灌進 key。
            return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"
