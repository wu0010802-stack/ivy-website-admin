"""程序記憶體快取：固定存活時間、同一個 key 同時只算一次。

Search Console 與 CrUX 的結果每天最多變一兩次，後台頁面每次開啟都打 Google 既慢又吃配額。
失敗不快取（下次再試）；同一個 key 同時來很多個請求時，其餘的等第一個算完直接用它的結果。
API 只啟動一個 uvicorn 程序（deploy/api-start.py），所以不需要跨程序共用快取；多開程序時只是各自快取、多問 Google 幾次。"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Generic, Hashable, TypeVar

T = TypeVar("T")


@dataclass(frozen=True)
class Cached(Generic[T]):
    value: T
    fetched_at: datetime


class TtlCache(Generic[T]):
    def __init__(self, ttl_seconds: float, clock: Callable[[], float] = time.monotonic, max_entries: int = 256):
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self.max_entries = max_entries
        self._entries: dict[Hashable, tuple[float, Cached[T]]] = {}
        self._locks: dict[Hashable, asyncio.Lock] = {}

    def _fresh(self, key: Hashable) -> Cached[T] | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        if self.clock() >= entry[0]:
            del self._entries[key]
            return None
        return entry[1]

    def _store(self, key: Hashable, value: T) -> Cached[T]:
        now = self.clock()
        for stale in [k for k, (expires, _) in self._entries.items() if now >= expires]:
            del self._entries[stale]
        while len(self._entries) >= self.max_entries:
            del self._entries[next(iter(self._entries))]
        cached = Cached(value, datetime.now(timezone.utc))
        self._entries[key] = (now + self.ttl_seconds, cached)
        self._forget_idle_locks()
        return cached

    def _forget_idle_locks(self) -> None:
        for key in [k for k, lock in self._locks.items() if k not in self._entries and not lock.locked()]:
            del self._locks[key]

    async def get(self, key: Hashable, compute: Callable[[], Awaitable[T]]) -> Cached[T]:
        """有新鮮的就直接回；沒有就算一次（同 key 同時只有一個在算）。compute 丟例外時什麼都不存。"""
        hit = self._fresh(key)
        if hit is not None:
            return hit
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._fresh(key)
            if hit is not None:
                return hit
            try:
                value = await compute()
            except BaseException:
                self._forget_idle_locks()
                raise
            return self._store(key, value)
