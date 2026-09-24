"""Google 與 LINE 登入共用的 OAuth 小工具。"""
from __future__ import annotations

from urllib.parse import unquote, urlsplit

from fastapi import Response

OAUTH_TTL_SECONDS = 600


def safe_admin_path(value: str | None) -> str:
    if not value or not value.startswith("/") or value.startswith("//"):
        return "/"
    decoded = value
    for _ in range(3):
        decoded = unquote(decoded)
    if "\\" in decoded or any(ord(char) < 32 or ord(char) == 127 for char in decoded):
        return "/"
    parsed = urlsplit(decoded)
    if (
        parsed.netloc or parsed.scheme or "%" in parsed.path
        or parsed.path.startswith("//") or parsed.path.rstrip("/") == "/login"
        or any(part in {".", ".."} for part in parsed.path.split("/"))
    ):
        return "/"
    return value


def private(response: Response) -> Response:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response
