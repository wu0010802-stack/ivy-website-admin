"""每個請求一個 request id（規格 L335）：回應帶 X-Request-ID、錯誤本文帶
request_id、log 也記同一個值，園方回報「畫面上的錯誤代碼」時才對得到 log。

上游（web 的同源代理、負載平衡）已經帶了 X-Request-ID 就沿用，否則自己產生。
只接受短的英數字串：這個值會原樣寫進 log 與回應 header，不能讓呼叫端塞
換行或超長字串進來。

access log 也由這裡記（每個請求一行：方法、路徑、狀態、耗時、request id）。
uvicorn 內建的 access log 會連 query string 一起記，後台案件搜尋的 `?q=`
常常就是家長姓名或手機，所以正式站以 `--no-access-log` 關掉它
（deploy/api-start.py），改記這裡這一行：不含 query string。"""

from __future__ import annotations

import logging
import re
import time
import uuid
from contextvars import ContextVar

from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
_VALID = re.compile(r"^[A-Za-z0-9._:-]{8,64}$")
_UNPRINTABLE = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_MAX_LOGGED_PATH = 300
access_logger = logging.getLogger("app.access")
_current: ContextVar[str | None] = ContextVar("request_id", default=None)


def new_request_id() -> str:
    return uuid.uuid4().hex


def accept_request_id(value: str | None) -> str:
    """上游帶來的值合格就沿用，否則產生新的。"""
    if value and _VALID.fullmatch(value):
        return value
    return new_request_id()


def current_request_id() -> str | None:
    return _current.get()


def _loggable_path(path: str) -> str:
    """路徑是解碼過的，呼叫端可以塞 %0A 之類偽造 log 行：控制字元一律換掉，
    長度也截斷。只記路徑，不記 query string。"""
    cleaned = _UNPRINTABLE.sub(lambda m: f"\\x{ord(m.group()):02x}", path)
    return cleaned if len(cleaned) <= _MAX_LOGGED_PATH else cleaned[:_MAX_LOGGED_PATH] + "…"


def request_id_of(request: Request) -> str | None:
    """例外處理器用：ServerErrorMiddleware 在中介層外面，contextvar 可能已經
    還原，改從 request.state 讀。"""
    return getattr(request.state, "request_id", None) or current_request_id()


class RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = None
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                incoming = value.decode("latin-1")
                break
        request_id = accept_request_id(incoming)
        scope.setdefault("state", {})["request_id"] = request_id
        token = _current.set(request_id)
        started = time.perf_counter()
        # 沒送出回應就拋出例外的，外層 ServerErrorMiddleware 會回 500。
        status_code = 500

        async def send_with_header(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers = [
                    (k, v) for k, v in message.get("headers", []) if k.lower() != b"x-request-id"
                ]
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        finally:
            access_logger.info(
                "%s %s %s %.1fms request_id=%s",
                scope.get("method", "-"),
                _loggable_path(scope.get("path", "")),
                status_code,
                (time.perf_counter() - started) * 1000,
                request_id,
            )
            _current.reset(token)

