from __future__ import annotations

import re
from http.cookies import SimpleCookie

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.auth.deps import SESSION_COOKIE_NAME
from app.auth.service import get_session_by_token
from app.media.validation import MAX_VIDEO_BYTES

# 素材上傳（multipart，含欄位與邊界的額外位元組）以外，API 本文都是小 JSON。
MEDIA_UPLOAD_BODY_LIMIT = MAX_VIDEO_BYTES + 5 * 1024 * 1024
DEFAULT_BODY_LIMIT = 1024 * 1024

_MEDIA_UPLOAD_PATH = re.compile(r"^/api/website/v1/admin/media(?:/[0-9a-fA-F-]{36}/replace)?/?$")
_PAYLOAD_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _too_large() -> HTTPException:
    return HTTPException(status_code=413, detail={"code": "BODY_TOO_LARGE", "message": "請求內容太大"})


class BodySizeLimitMiddleware:
    """在任何解析之前限制請求本文大小。

    FastAPI 會先把 multipart 整個解析完（大檔寫進暫存檔）才執行登入依賴與
    路由裡的大小檢查，所以沒登入的人也能讓 API 先吃下任意大的本文。這裡：
    - Content-Length 超過上限直接 413，一個位元組都不讀；
    - 串流計數，實際讀到的超過上限就中止（對付沒有 Content-Length 的本文）；
    - 素材上傳路徑先確認帶的是有效後台 session，沒有就 401，不讀本文。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in _PAYLOAD_METHODS:
            await self.app(scope, receive, send)
            return

        path = scope["path"]
        is_media_upload = scope["method"] == "POST" and bool(_MEDIA_UPLOAD_PATH.match(path))
        limit = MEDIA_UPLOAD_BODY_LIMIT if is_media_upload else DEFAULT_BODY_LIMIT
        headers = {key.lower(): value for key, value in scope["headers"]}

        declared = headers.get(b"content-length")
        if declared is not None:
            try:
                too_large = int(declared) > limit
            except ValueError:
                await JSONResponse({"detail": "Content-Length 無效"}, status_code=400)(scope, receive, send)
                return
            if too_large:
                await JSONResponse({"detail": _too_large().detail}, status_code=413)(scope, receive, send)
                return

        if is_media_upload and not await self._has_valid_session(scope, headers):
            await JSONResponse({"detail": "未登入"}, status_code=401)(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # FastAPI 解析本文時遇到 HTTPException 會原樣往外丟，
                    # 由例外處理轉成 413。
                    raise _too_large()
            return message

        await self.app(scope, limited_receive, send)

    async def _has_valid_session(self, scope: Scope, headers: dict[bytes, bytes]) -> bool:
        raw_cookie = headers.get(b"cookie")
        if not raw_cookie:
            return False
        cookie = SimpleCookie()
        try:
            cookie.load(raw_cookie.decode("latin-1"))
        except Exception:
            return False
        morsel = cookie.get(SESSION_COOKIE_NAME)
        if morsel is None or not morsel.value:
            return False
        app = scope["app"]
        async with app.state.session_factory() as db:
            return await get_session_by_token(db, morsel.value) is not None
