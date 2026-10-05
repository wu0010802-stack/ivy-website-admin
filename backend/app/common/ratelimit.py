from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
import math
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import delete, literal, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import TimeoutError as PoolTimeout
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession

from app.common.models import RateLimitCounter

logger = logging.getLogger("app.ratelimit")

# 限流池拿不到連線時，這次檢查當作超限，請對方隔這麼久再試。
UNAVAILABLE_RETRY_AFTER_SECONDS = 5


class RateLimited(Exception):
    """超過窗口上限。呼叫端負責轉成 429，並帶上 Retry-After。"""

    def __init__(self, retry_after_seconds: int) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__("請求太頻繁")


class RateLimiterUnavailable(RateLimited):
    """限流專用連線池在時限內拿不到連線（DB 忙或被刻意灌爆）。沿用
    RateLimited，所有呼叫端照原本的方式回 429＋Retry-After，不必個別處理。"""


@dataclass(frozen=True)
class Limit:
    """一種限流規則。`bucket` 是 DB 裡的命名空間，同一個 bucket 不能拿去
    宣告兩組不同的窗口或上限。

    sliding=False 改用單純的固定窗口：只看本窗次數、不把前一窗加權帶進來。
    給「每個 UTC 日各自計數」這類上限用（前一天灌滿不會連帶壓低隔天）。"""

    bucket: str
    window_seconds: int
    max_per_window: int
    sliding: bool = True


class RateLimiter:
    """存在 PostgreSQL 的限流計數，所有 worker／副本共用，重新部署也不歸零。

    每個 key 在每個固定窗口一列；判斷時把前一個窗口的次數依「還重疊多少」
    加權，近似滑動窗口：
        估計值 = 前窗次數 × (1 − 已進入本窗的比例) + 本窗次數
    比逐筆記錄省空間（一個來源一個窗口只有一列），誤差只在窗口交界，對
    限流來說足夠。

    「檢查＋累加」在同一條 upsert 內完成（ON CONFLICT … WHERE），多個請求
    同時打進來也不會一起越過上限。每次操作用自己的短交易、獨立連線：計數
    不能跟著請求本身的交易 rollback，否則失敗的登入不會被記下來。

    engine 是限流專用的小池（app/db.py 的 create_rate_limit_engine），不和
    請求 session 共用。池子在時限內拿不到連線時：
    - check／is_limited（放不放行的判斷）一律當作超限。放行等於讓灌爆限流池
      的人趁機繞過所有上限（登入猜密碼、公開送單），寧可短暫誤擋；
    - record／reset（事後記帳）只記 warning 不丟例外：請求本身已經做完，
      不能因為記帳失敗變成 500；少記一次的影響遠小於前者。"""

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
        if not limit.sliding:
            return 0.0
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

    async def _hit(self, conn: AsyncConnection, limit: Limit, key: str) -> int | None:
        """在 conn 上做一次「檢查＋累加」；放行回 None，超過上限回 Retry-After
        秒數（那次不計）。check 與 check_chain 共用，SQL 與語意只有這一份。"""
        key_hash = self._key_hash(limit, key)
        window_start, elapsed = self._window(limit)
        table = RateLimitCounter.__table__
        previous, _ = await self._counts(conn, limit, key_hash, window_start)
        carried = previous * self._previous_weight(limit, elapsed)
        if carried >= limit.max_per_window:
            return self._retry_after(limit, elapsed)
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
            return self._retry_after(limit, elapsed)
        return None

    async def check(self, limit: Limit, key: str) -> None:
        """未超過上限就記一次命中；超過則丟 RateLimited（被擋下的那次不計）。"""
        try:
            async with self._engine.begin() as conn:
                retry_after = await self._hit(conn, limit, key)
        except PoolTimeout as exc:
            logger.warning("限流連線池已滿，這次檢查當作超限：bucket=%s", limit.bucket)
            raise RateLimiterUnavailable(UNAVAILABLE_RETRY_AFTER_SECONDS) from exc
        if retry_after is not None:
            raise RateLimited(retry_after)

    async def check_chain(self, checks: Sequence[tuple[Limit, str]]) -> tuple[int, RateLimited] | None:
        """依序做多次 check，全部放在同一個交易、同一條連線（一次取連線、一次
        commit），取代逐個呼叫 check 的 N 個交易。全部放行回 None；第一個被擋
        的回 (序號, RateLimited)，之後的不再檢查。語意與逐個 check 相同：被擋
        之前已放行的照常計數並 commit（所以被擋時不 rollback）、被擋的與其後
        的都不計。拿不到連線時沒有任何一項被檢查，回 (0, RateLimiterUnavailable)。

        鎖：每次累加會鎖住該列到 commit，所以呼叫端要以固定順序傳入（公開事件
        一律是 gate → 全站每分鐘 → 每來源每日 → 全站每日），不同呼叫端的 bucket
        互不重疊，不會形成互等。"""
        if not checks:
            return None
        blocked: tuple[int, RateLimited] | None = None
        try:
            async with self._engine.begin() as conn:
                for index, (limit, key) in enumerate(checks):
                    retry_after = await self._hit(conn, limit, key)
                    if retry_after is not None:
                        blocked = (index, RateLimited(retry_after))
                        break
        except PoolTimeout:
            logger.warning("限流連線池已滿，這次檢查當作超限：bucket=%s", checks[0][0].bucket)
            return 0, RateLimiterUnavailable(UNAVAILABLE_RETRY_AFTER_SECONDS)
        return blocked

    async def is_limited(self, limit: Limit, key: str) -> bool:
        """只看不記：判斷目前是否已達上限（例如登入失敗後決定要不要開始帳號鎖）。"""
        key_hash = self._key_hash(limit, key)
        window_start, elapsed = self._window(limit)
        try:
            async with self._engine.connect() as conn:
                previous, current = await self._counts(conn, limit, key_hash, window_start)
        except PoolTimeout:
            logger.warning("限流連線池已滿，這次查詢當作超限：bucket=%s", limit.bucket)
            return True
        return previous * self._previous_weight(limit, elapsed) + current >= limit.max_per_window

    async def record(self, limit: Limit, key: str) -> None:
        key_hash = self._key_hash(limit, key)
        window_start, _ = self._window(limit)
        table = RateLimitCounter.__table__
        stmt = self._increment(limit, key_hash, window_start).on_conflict_do_update(
            index_elements=[table.c.bucket, table.c.key_hash, table.c.window_start],
            set_={"hits": table.c.hits + 1},
        )
        try:
            async with self._engine.begin() as conn:
                await conn.execute(stmt)
        except PoolTimeout:
            logger.warning("限流連線池已滿，這次沒有記到：bucket=%s", limit.bucket)

    async def reset(self, limit: Limit, key: str) -> None:
        try:
            async with self._engine.begin() as conn:
                await conn.execute(
                    delete(RateLimitCounter).where(
                        RateLimitCounter.bucket == limit.bucket,
                        RateLimitCounter.key_hash == self._key_hash(limit, key),
                    )
                )
        except PoolTimeout:
            logger.warning("限流連線池已滿，這次沒有清掉：bucket=%s", limit.bucket)

    # ---------------------------------------------------------------- 一次性標記
    #
    # 需要「精確到期時間」的場合（帳號鎖、OAuth state 只能用一次）不用上面的
    # 固定窗口加權（窗口交界會提早放行或多鎖）。改在同一張表放一列帶明確
    # expires_at 的標記：window_start 固定為 0，一個 key 只佔一列，key 一樣以
    # HMAC 落地，到期後由既有的定期清理（purge_expired）刪掉。Limit 只借用
    # bucket 與 window_seconds（標記的存活秒數），max_per_window 用不到。

    def _now(self) -> datetime:
        return datetime.fromtimestamp(self._clock(), tz=timezone.utc)

    async def consume_marker(self, marker: Limit, key: str) -> bool:
        """放一列「marker.window_seconds 秒後到期」的標記。第一次（或上一個
        標記已到期）回 True；標記還在時回 False，不延長。

        限流池在時限內拿不到連線時回 False（當作標記已存在）並記 warning：
        OAuth state 因此被當成重送而拒絕，帳號鎖這次不寫開始鎖定的稽核（呼叫端
        仍依失敗計數回 429）。寧可擋下，也不要變成 500 或放行。"""
        now = self._now()
        table = RateLimitCounter.__table__
        insert = pg_insert(table).values(
            bucket=marker.bucket,
            key_hash=self._key_hash(marker, key),
            window_start=0,
            hits=1,
            expires_at=now + timedelta(seconds=marker.window_seconds),
        )
        stmt = insert.on_conflict_do_update(
            index_elements=[table.c.bucket, table.c.key_hash, table.c.window_start],
            set_={"hits": 1, "expires_at": insert.excluded.expires_at},
            where=table.c.expires_at <= now,
        ).returning(table.c.expires_at)
        try:
            async with self._engine.begin() as conn:
                return (await conn.execute(stmt)).first() is not None
        except PoolTimeout:
            logger.warning("限流連線池已滿，一次性標記當作已存在：bucket=%s", marker.bucket)
            return False

    async def marker_active(self, marker: Limit, key: str) -> bool:
        """標記是否還沒到期。

        限流池在時限內拿不到連線時丟 RateLimiterUnavailable（跟 check 一樣
        fail-closed），呼叫端一律當作擋下；跟「標記確實存在」分開，呼叫端才
        能告訴使用者是「帳號鎖定中」還是「系統忙碌，幾秒後再試」。"""
        now = self._now()
        try:
            async with self._engine.connect() as conn:
                row = await conn.execute(
                    select(RateLimitCounter.expires_at).where(
                        RateLimitCounter.bucket == marker.bucket,
                        RateLimitCounter.key_hash == self._key_hash(marker, key),
                        RateLimitCounter.window_start == 0,
                        RateLimitCounter.expires_at > now,
                    )
                )
                return row.first() is not None
        except PoolTimeout as exc:
            logger.warning("限流連線池已滿，標記當作仍有效：bucket=%s", marker.bucket)
            raise RateLimiterUnavailable(UNAVAILABLE_RETRY_AFTER_SECONDS) from exc

    async def purge_expired(self) -> int:
        async with self._engine.begin() as conn:
            return await purge_expired_counters(conn, self._now())


async def purge_expired_counters(db: AsyncConnection | AsyncSession, now: datetime) -> int:
    """刪掉已經不會再被讀到的列；由定期工作呼叫（app/workers/maintenance.py）。"""
    result = await db.execute(delete(RateLimitCounter).where(RateLimitCounter.expires_at < now))
    return result.rowcount or 0


def limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


def _address_bucket(value: str) -> str:
    """同一個訪客換位址不能換桶。IPv6 用戶通常拿到整段 /64（2^64 個位址），
    逐一換來源就能無限開新桶，所以 IPv6 一律聚合成所在的 /64；IPv4 維持
    原樣，IPv4-mapped IPv6（::ffff:a.b.c.d）視同對應的 IPv4。不是 IP 的值
    （理論上代理不會送）照舊截斷後直接當 key。"""
    candidate = value.strip()
    try:
        # 去掉 zone id（fe80::1%eth0）再解析。
        address = ipaddress.ip_address(candidate.split("%", 1)[0])
    except ValueError:
        return candidate[:64]
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return str(ipaddress.IPv6Network((address, 64), strict=False))
    return str(address)


def trusted_client_ip(request: Request) -> str | None:
    """代理（Nuxt server route）帶進來的訪客 IP header 原值；沒設定或沒帶為 None。

    「每來源」的上限（占位、每校送單、telemetry 每日）只在有這個值時套用：
    沒有時 client_key 退回代理的位址，全站訪客會共用同一個桶，上限就變成
    全站上限而誤擋正常流量。正式環境 API 只經代理對外，header 一定在。"""
    settings = getattr(request.app.state, "settings", None)
    header_name = getattr(settings, "trusted_client_ip_header", None)
    if not header_name:
        return None
    return request.headers.get(header_name) or None


def client_key(request: Request) -> str:
    """限流要綁「訪客」而不是「代理」。公開 API 一律經 Nuxt 的
    server route 轉進來，`request.client.host` 恆為代理的內網位址，
    所有訪客會共用同一個桶。改成優先採信代理刻意帶進來的自家 header
    （由 settings.trusted_client_ip_header 指定），沒有才退回 peer。
    IPv6 聚合到 /64，見 _address_bucket。

    這個 header 只有在請求真的來自信任代理時才有意義，所以部署上必須
    確保 API 不直接對外（見 deploy/README.md）；否則任何人都能偽造。"""
    settings = getattr(request.app.state, "settings", None)
    header_name = getattr(settings, "trusted_client_ip_header", None)
    if header_name:
        forwarded = request.headers.get(header_name)
        if forwarded:
            # 只取第一段並限制長度，避免超長 header 灌進 key。
            return _address_bucket(forwarded.split(",")[0].strip()[:64])
    return _address_bucket(request.client.host) if request.client else "unknown"
