"""限流計數存在 PostgreSQL：多個 worker／副本共用、重新部署不歸零。

每個測試用可控的時鐘，窗口邊界不受實際執行時間影響。"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import func, select, text

from app.common.models import RateLimitCounter
from app.common.ratelimit import Limit, RateLimited, RateLimiter

SECRET = "test-only-secret-please-rotate"
LIMIT = Limit("test_bucket", window_seconds=60, max_per_window=3)
# 剛好落在窗口起點，方便推算加權。
WINDOW_START = 1_800_000_000 - (1_800_000_000 % 60)


class Clock:
    def __init__(self, now: float) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock(WINDOW_START + 1)


@pytest.fixture
def limiter(app, clock) -> RateLimiter:
    return RateLimiter(app.state.engine, SECRET, clock=clock)


async def test_check_allows_up_to_limit_and_does_not_count_rejected_hits(limiter, db_session):
    for _ in range(3):
        await limiter.check(LIMIT, "visitor")
    with pytest.raises(RateLimited) as excinfo:
        await limiter.check(LIMIT, "visitor")
    assert 1 <= excinfo.value.retry_after_seconds <= 60

    hits = (await db_session.execute(select(func.sum(RateLimitCounter.hits)))).scalar_one()
    assert hits == 3, "被擋下的請求不該計入，否則持續重試的人會被無限延長封鎖"


async def test_keys_are_independent(limiter):
    for _ in range(3):
        await limiter.check(LIMIT, "a")
    await limiter.check(LIMIT, "b")


async def test_limit_is_shared_across_workers(app, clock):
    """兩個 RateLimiter 實例＝兩個 worker 或兩個副本，上限不能倍增。"""
    worker_a = RateLimiter(app.state.engine, SECRET, clock=clock)
    worker_b = RateLimiter(app.state.engine, SECRET, clock=clock)
    await worker_a.check(LIMIT, "visitor")
    await worker_b.check(LIMIT, "visitor")
    await worker_a.check(LIMIT, "visitor")
    with pytest.raises(RateLimited):
        await worker_b.check(LIMIT, "visitor")


async def test_concurrent_checks_never_exceed_limit(limiter):
    results = await asyncio.gather(
        *(limiter.check(LIMIT, "burst") for _ in range(12)), return_exceptions=True
    )
    allowed = [r for r in results if r is None]
    rejected = [r for r in results if isinstance(r, RateLimited)]
    assert len(allowed) == 3
    assert len(rejected) == 9


async def test_previous_window_is_weighted_like_a_sliding_window(limiter, clock):
    """前窗次數視為平均分布，依還重疊的比例帶進本窗。時間點刻意避開
    估計值剛好等於上限的邊界，避免浮點誤差讓測試忽過忽不過。"""
    limit = Limit("test_sliding", window_seconds=60, max_per_window=10)
    for _ in range(10):
        await limiter.check(limit, "visitor")

    # 下一窗第 3 秒：前窗權重 57/60，帶過來 9.5 → 只剩 1 次。
    clock.now = WINDOW_START + 60 + 3
    await limiter.check(limit, "visitor")
    with pytest.raises(RateLimited):
        await limiter.check(limit, "visitor")

    # 下一窗第 33 秒：前窗權重 27/60，帶過來 4.5；本窗已有 1 次 → 再 5 次。
    clock.now = WINDOW_START + 60 + 33
    for _ in range(5):
        await limiter.check(limit, "visitor")
    with pytest.raises(RateLimited):
        await limiter.check(limit, "visitor")

    # 隔兩個窗口，前窗沒有紀錄，完全重來。
    clock.now = WINDOW_START + 180 + 1
    for _ in range(10):
        await limiter.check(limit, "visitor")


async def test_record_is_limited_and_reset(limiter):
    assert not await limiter.is_limited(LIMIT, "account")
    for _ in range(3):
        await limiter.record(LIMIT, "account")
    assert await limiter.is_limited(LIMIT, "account")
    await limiter.reset(LIMIT, "account")
    assert not await limiter.is_limited(LIMIT, "account")


async def test_keys_are_not_stored_in_plaintext(limiter, db_session):
    await limiter.check(LIMIT, "0912345678")
    await limiter.record(LIMIT, "parent@example.com")
    dump = (await db_session.execute(text("SELECT string_agg(key_hash, ',') FROM rate_limit_counters"))).scalar_one()
    assert "0912345678" not in dump
    assert "parent@example.com" not in dump


async def test_purge_expired_only_removes_rows_no_longer_read(limiter, clock, db_session):
    await limiter.check(LIMIT, "old")
    clock.now = WINDOW_START + 60 + 1
    await limiter.check(LIMIT, "recent")

    # 「old」那列還要當前一個窗口被加權，現在不能刪。
    assert await limiter.purge_expired() == 0

    clock.now = WINDOW_START + 120 + 1
    assert await limiter.purge_expired() == 1
    remaining = (await db_session.execute(select(func.count()).select_from(RateLimitCounter))).scalar_one()
    assert remaining == 1


async def test_failed_logins_are_counted_even_though_request_rolls_back(app, db_session):
    """登入失敗時請求本身不 commit；計數走獨立交易，還是要被記下來。"""
    from app.auth import service

    limiter = app.state.rate_limiter
    # 第 N 次失敗記下後就達上限，所以前 N−1 次是一般的帳密錯誤。
    for _ in range(service.LOGIN_MAX_ATTEMPTS - 1):
        with pytest.raises(service.InvalidCredentials):
            await service.authenticate(db_session, "nobody@ivy.example", "wrong-password", limiter=limiter)
        await db_session.rollback()
    with pytest.raises(service.LoginRateLimited):
        await service.authenticate(db_session, "nobody@ivy.example", "wrong-password", limiter=limiter)
