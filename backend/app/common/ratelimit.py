from __future__ import annotations

import time
from collections import OrderedDict
from dataclasses import dataclass, field

from fastapi import Request


class RateLimited(Exception):
    """超過窗口上限。呼叫端負責轉成 429，並帶上 Retry-After。"""

    def __init__(self, retry_after_seconds: int) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__("請求太頻繁")


@dataclass
class SlidingWindowLimiter:
    """單一 process 記憶體內的滑動窗口。多 worker 部署時每個 process
    各有一份，等於實際上限是 workers × max_per_window——這是刻意接受的
    近似，真正要精準得換 Redis／DB，見 README 的限制章節。

    key 由訪客控制（來源 IP、email、手機），所以記憶體必須有界：
    `_hits` 依「最後一次命中」排序，每次操作順手丟掉開頭已閒置超過窗口
    的 key；總數超過 `max_keys` 時淘汰最久沒動的。淘汰代表那個 key 的
    計數歸零，是用「偶爾放寬」換「不會被灌爆記憶體」。"""

    window_seconds: int
    max_per_window: int
    max_keys: int = 10_000
    _hits: OrderedDict[str, list[float]] = field(default_factory=OrderedDict)

    def _live_hits(self, key: str, now: float) -> list[float]:
        # 先清開頭的閒置 key：它們的最後命中最舊，遇到仍在窗口內的就停。
        while self._hits:
            oldest_key, oldest_hits = next(iter(self._hits.items()))
            if oldest_hits and now - oldest_hits[-1] < self.window_seconds:
                break
            del self._hits[oldest_key]
        return [t for t in self._hits.get(key, ()) if now - t < self.window_seconds]

    def _store(self, key: str, hits: list[float]) -> None:
        if not hits:
            self._hits.pop(key, None)
            return
        self._hits[key] = hits
        self._hits.move_to_end(key)
        while len(self._hits) > self.max_keys:
            self._hits.popitem(last=False)

    def check(self, key: str) -> None:
        """未超過上限就記一次命中；超過則丟 RateLimited。"""
        now = time.monotonic()
        hits = self._live_hits(key, now)
        if len(hits) >= self.max_per_window:
            raise RateLimited(retry_after_seconds=int(self.window_seconds - (now - hits[0])) + 1)
        hits.append(now)
        self._store(key, hits)

    def is_limited(self, key: str) -> bool:
        """只看不記：給「失敗之後才累計」的桶用。"""
        return len(self._live_hits(key, time.monotonic())) >= self.max_per_window

    def record(self, key: str) -> None:
        now = time.monotonic()
        hits = self._live_hits(key, now)
        hits.append(now)
        self._store(key, hits)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)

    def clear(self) -> None:
        self._hits.clear()

    def __len__(self) -> int:
        return len(self._hits)


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
            # 只取第一段並限制長度，避免超長 header 撐爆記憶體中的 key。
            return forwarded.split(",")[0].strip()[:64]
    return request.client.host if request.client else "unknown"
