"""這個請求是從哪裡、用什麼裝置來的：給操作紀錄記 IP 與 User-Agent。

用 contextvar 放（同 request_id.py），audit_service.log_action 自己讀，呼叫端
不必把 request 一路傳下去。背景工作、CLI 不在請求裡，讀到的是空的。

IP 只採信官網代理帶進來的自家 header（settings.trusted_client_ip_header），
取法同 ratelimit.client_key：只看第一段。沒有、或不是 IP 就是 None，不退回
request.client——正式環境那是代理的內網位址，記了反而誤導。IPv6 由代理聚合
成 /64 的網段位址（例如 2001:db8:1:2::）再帶進來，這裡照存。"""

from __future__ import annotations

import ipaddress
import re
from contextvars import ContextVar
from dataclasses import dataclass

from starlette.types import ASGIApp, Receive, Scope, Send

USER_AGENT_MAX_LENGTH = 512
# PostgreSQL 的 text 不收 NUL，其他控制字元也沒有意義；HTTP parser 理應先擋，
# 這裡再濾一次，免得一個怪 header 讓整個請求寫不進稽核而 500。
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


@dataclass(frozen=True)
class ClientInfo:
    ip_address: str | None
    user_agent: str | None


_NONE = ClientInfo(ip_address=None, user_agent=None)
_current: ContextVar[ClientInfo] = ContextVar("client_info", default=_NONE)


def current_client_info() -> ClientInfo:
    return _current.get()


def user_agent_or_none(raw: bytes) -> str | None:
    return _CONTROL_CHARS.sub("", raw.decode("latin-1"))[:USER_AGENT_MAX_LENGTH].strip() or None


def _ip_or_none(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(value.split(",")[0].strip()[:64]))
    except ValueError:
        return None


class ClientInfoMiddleware:
    def __init__(self, app: ASGIApp, ip_header: str | None) -> None:
        self.app = app
        self.ip_header = ip_header.lower().encode("latin-1") if ip_header else None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        forwarded_ip = user_agent = None
        for name, value in scope.get("headers", []):
            if self.ip_header is not None and name == self.ip_header:
                forwarded_ip = value.decode("latin-1")
            elif name == b"user-agent":
                user_agent = user_agent_or_none(value)
        token = _current.set(ClientInfo(ip_address=_ip_or_none(forwarded_ip), user_agent=user_agent))
        try:
            await self.app(scope, receive, send)
        finally:
            _current.reset(token)
