"""「限制同時在 thread 裡跑幾件」的共用實作：bcrypt（app/auth/service.py）與
素材解碼／ffmpeg（app/media/processing.py）共用同一套語意。

API 是單一 uvicorn 程序、單一 event loop：吃 CPU 的工作同步做會卡住所有請求，
全丟 thread 又沒有上限時，一波請求就能把 CPU、記憶體與執行緒池吃光。
"""
from __future__ import annotations

import asyncio
import weakref
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TypeVar

_T = TypeVar("_T")


class SlotsBusy(Exception):
    """名額用完、排隊的人數也到上限：呼叫端轉成「稍後再試」（例如 429）。"""


@dataclass
class _LoopSlots:
    semaphore: asyncio.Semaphore
    waiting: int = 0


class ThreadSlots:
    """同時最多 limit 件；其餘在 event loop 上排隊（排隊時不佔 thread）。

    一個 event loop 一個 Semaphore：正式環境只有一個 loop，等於程序層級的上限；
    測試每個案例各自一個 loop，而 asyncio.Semaphore 綁過一個 loop 就不能換。"""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self._by_loop: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, _LoopSlots] = weakref.WeakKeyDictionary()

    def _slots(self) -> _LoopSlots:
        loop = asyncio.get_running_loop()
        slots = self._by_loop.get(loop)
        if slots is None:
            slots = self._by_loop[loop] = _LoopSlots(asyncio.Semaphore(self.limit))
        return slots

    @asynccontextmanager
    async def slot(self, *, max_waiters: int | None = None) -> AsyncIterator[None]:
        """持有一個名額。max_waiters 有值時，名額用完且已有這麼多人在排隊就
        直接丟 SlotsBusy，不讓匿名洪泛在 event loop 上無限排隊。

        名額內除了跑 thread，也可以先做幾個短的 await（例如登入在驗密碼前
        重查帳號鎖）；那些 await 同樣受這個上限約束。"""
        slots = self._slots()
        if max_waiters is not None and slots.semaphore.locked() and slots.waiting >= max_waiters:
            raise SlotsBusy()
        slots.waiting += 1
        try:
            await slots.semaphore.acquire()
        finally:
            slots.waiting -= 1
        try:
            yield
        finally:
            slots.semaphore.release()

    async def run(self, func: Callable[..., _T], /, *args) -> _T:
        """取得名額後在 thread 裡跑 func。"""
        async with self.slot():
            return await run_in_thread(func, *args)


async def run_in_thread(func: Callable[..., _T], /, *args) -> _T:
    """在 thread 裡跑完 func。呼叫端被取消時 thread 停不下來：等它真的跑完才把
    取消往上丟，呼叫端握著的名額才不會提早讓出（上限才算數）。要讓 func 提早結束
    得由 func 自己的機制處理（例如轉檔的 processing.terminate_running_transcodes）。"""
    job = asyncio.ensure_future(asyncio.to_thread(func, *args))
    try:
        return await asyncio.shield(job)
    except asyncio.CancelledError:
        await asyncio.wait({job})
        # 結果已經沒人要（取消優先）；把例外取走，不然 asyncio 會記一筆
        # 「Task exception was never retrieved」（停機中止轉檔時每次都會有）。
        if not job.cancelled():
            job.exception()
        raise
