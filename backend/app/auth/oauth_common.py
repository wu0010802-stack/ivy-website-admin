"""Google 與 LINE 登入共用的 OAuth 小工具。"""
from __future__ import annotations

from urllib.parse import unquote, urlsplit

from fastapi import Request, Response

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


def started_from_another_site(request: Request) -> bool:
    """OAuth 登入的起點（/google/login、/line/login）只該由後台登入頁同源導過來（Sec-Fetch-Site:
    same-origin），或使用者自己開網址（none；舊瀏覽器不送這個 header）。

    其他網站帶過來的 GET（cross-site，連同 www 等同網域的子網域 same-site）一律不處理、不計入登入的
    來源限流：起點與密碼登入共用同一個「每個來源 5 分鐘 100 次」，外站網頁只要在員工的瀏覽器裡用
    <img> 打一百次，同一個 IP 的所有人密碼、Google、LINE 都登不進來（2026-11-26 資安檢查）。也順帶
    擋掉從外站連結預先勾好「記住這台裝置」。"""
    return request.headers.get("sec-fetch-site", "").strip().lower() in {"cross-site", "same-site"}


def private(response: Response) -> Response:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response
