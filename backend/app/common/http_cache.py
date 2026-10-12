"""HTTP 快取驗證用的小工具。"""

from __future__ import annotations


def etag_matches(header: str | None, etag: str) -> bool:
    """If-None-Match 是否涵蓋這個 ETag：值可以是 *、多個以逗號分隔的值，或帶 W/ 的弱比對值
    （If-None-Match 一律用弱比較，RFC 9110 §13.1.2）。header 沒帶或是空字串回 False。"""
    if not header:
        return False
    for candidate in header.split(","):
        candidate = candidate.strip()
        if candidate == "*" or candidate.removeprefix("W/") == etag:
            return True
    return False
