from __future__ import annotations

import time
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
    近似，真正要精準得換 Redis／DB，見 README 的限制章節。"""

    window_seconds: int
    max_per_window: int
    _hits: dict[str, list[float]] = field(default_factory=dict)

    def check(self, key: str) -> None:
        now = time.monotonic()
        hits = [t for t in self._hits.get(key, []) if now - t < self.window_seconds]
        self._hits[key] = hits
        if len(hits) >= self.max_per_window:
            raise RateLimited(retry_after_seconds=int(self.window_seconds - (now - hits[0])) + 1)
        hits.append(now)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)

    def clear(self) -> None:
        self._hits.clear()


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
