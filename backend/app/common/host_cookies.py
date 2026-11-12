"""正式環境的登入相關 cookie 一律加 __Host- 前綴（2026-11-12 資安強化）。

官網在 www.ivykidschool.com，同一個網域底下還有其他子網域（寄信、舊站、日後的後台子網域）。
任何一個子網域被拿下，都能對 .ivykidschool.com 寫 cookie（cookie tossing）：把攻擊者自己的
session 或 OAuth 握手 cookie 塞進管理者的瀏覽器，造成 login CSRF。__Host- 前綴的 cookie
瀏覽器只收「Secure、Path=/、沒有 Domain」的寫法，子網域寫不進來，也蓋不掉。

做法是最外層的 ASGI middleware，程式其他地方照舊用原本的名稱（Cookie(alias=...)、
request.cookies.get(...)、set_cookie(...)）：

- 進來的 Cookie：`__Host-<名稱>` 換回 `<名稱>`；沒有前綴的同名 cookie 一律丟掉（那可能是
  子網域塞進來的，或是改版前的舊 cookie），並在回應裡把它清掉。
- 送出的 Set-Cookie：這幾個名稱加上前綴，Path 改成 /、補上 Secure、拿掉 Domain。
  OAuth 握手 cookie 原本只限 /api/website/v1/auth/... 路徑，改成 / 之後十分鐘內每個請求都會帶，
  內容是簽章過的短期資料，沒有影響。

只在 production 開（其他環境沒有 https，Secure cookie 送不回來）。上線那一刻舊的
ivy_admin_session 會被丟掉，所有人要重新登入一次；家長改期連結的 session 也要重新點一次連結。
"""
from __future__ import annotations

import re

from starlette.types import ASGIApp, Message, Receive, Scope, Send

HOST_PREFIX = "__Host-"

# 後台 session（auth/deps.py）、家長改期連結 session（booking/access_routes.py）、
# LINE 與 Google 的 OAuth 握手（auth/line.py、auth/google.py）。
HOST_PREFIXED_COOKIES = frozenset({"ivy_admin_session", "ivy_parent_session", "ivy_line_oauth", "ivy_google_oauth"})

_PATH_ATTR = re.compile(r";\s*path=[^;]*", re.IGNORECASE)
_DOMAIN_ATTR = re.compile(r";\s*domain=[^;]*", re.IGNORECASE)
_SECURE_ATTR = re.compile(r";\s*secure\s*(?:;|$)", re.IGNORECASE)


def rewrite_request_cookie(header: str) -> tuple[str, set[str]]:
    """回傳（改寫後的 Cookie header, 被丟掉的沒有前綴的名稱）。"""
    kept: list[str] = []
    dropped: set[str] = set()
    prefixed: dict[str, str] = {}
    for part in header.split(";"):
        item = part.strip()
        if not item:
            continue
        name, sep, value = item.partition("=")
        name = name.strip()
        if name in HOST_PREFIXED_COOKIES:
            dropped.add(name)
            continue
        if name.startswith(HOST_PREFIX) and name[len(HOST_PREFIX):] in HOST_PREFIXED_COOKIES:
            # 同名出現兩次時用第一個（瀏覽器把路徑較長、較早建立的排前面）。
            prefixed.setdefault(name[len(HOST_PREFIX):], value)
            continue
        kept.append(f"{name}{sep}{value}")
    kept.extend(f"{name}={value}" for name, value in prefixed.items())
    return "; ".join(kept), dropped


def rewrite_set_cookie(header: str) -> str:
    """登入相關 cookie 改成 __Host- 寫法；其他 cookie 原樣。"""
    name, sep, rest = header.partition("=")
    if not sep or name.strip() not in HOST_PREFIXED_COOKIES:
        return header
    value = f"{HOST_PREFIX}{name.strip()}={rest}"
    value = _DOMAIN_ATTR.sub("", value)
    value = _PATH_ATTR.sub("", value)
    value = f"{value}; Path=/"
    if not _SECURE_ATTR.search(value):
        value = f"{value}; Secure"
    return value


def _expire_legacy(name: str) -> bytes:
    return f"{name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax".encode("latin-1")


class HostPrefixCookieMiddleware:
    def __init__(self, app: ASGIApp, enabled: bool) -> None:
        self.app = app
        self.enabled = enabled

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self.enabled or scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        dropped: set[str] = set()
        headers: list[tuple[bytes, bytes]] = []
        for name, value in scope.get("headers", []):
            if name == b"cookie":
                rewritten, seen = rewrite_request_cookie(value.decode("latin-1"))
                dropped |= seen
                if rewritten:
                    headers.append((name, rewritten.encode("latin-1")))
                continue
            headers.append((name, value))
        scope = {**scope, "headers": headers}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                out: list[tuple[bytes, bytes]] = []
                for key, value in message.get("headers", []):
                    if key.lower() == b"set-cookie":
                        value = rewrite_set_cookie(value.decode("latin-1")).encode("latin-1")
                    out.append((key, value))
                # 沒有前綴的舊 cookie（改版前留下的、或子網域塞的）順手清掉，免得每次都帶著。
                out.extend((b"set-cookie", _expire_legacy(name)) for name in sorted(dropped))
                message = {**message, "headers": out}
            await send(message)

        await self.app(scope, receive, send_wrapper)
