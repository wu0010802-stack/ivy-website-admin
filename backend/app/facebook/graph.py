"""Meta Graph API 的最小用法：換 Page token、讀粉專貼文、下載貼文照片。

token 只放在 Authorization header 送給 graph.facebook.com，不放網址（httpx 的 INFO 紀錄會印完整
網址，2026-11-10 本機實測曾因此把 token 寫進 log），也不寫進任何例外訊息：
GraphError 只帶 HTTP 狀態與 Meta 的錯誤代碼（docs/specs/2026-10-28-facebook-news-sync-design.md §4）。"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit

import httpx

from app.config import Settings

GRAPH_HOST = "graph.facebook.com"
# 不帶任何帳號或信箱（外部請求不帶使用者身分）。
USER_AGENT = "Mozilla/5.0 (compatible; ivy-website-facebook-sync/1.0)"
POST_FIELDS = "id,message,created_time,permalink_url,full_picture"
POST_LIMIT = 25
# Graph 回應很小；超過就當異常，不整包讀進記憶體。
_MAX_JSON_BYTES = 2 * 1024 * 1024
_TIMEOUT = httpx.Timeout(20.0, connect=10.0)


class GraphError(Exception):
    """對外只說得出「哪一步、HTTP 幾號、Meta 錯誤代碼」。"""

    def __init__(self, step: str, *, status: int | None = None, code: int | None = None, reason: str | None = None):
        self.step = step
        self.status = status
        self.code = code
        self.reason = reason
        details = [
            *([f"HTTP {status}"] if status is not None else []),
            *([f"code {code}"] if code is not None else []),
            *([reason] if reason else []),
        ]
        super().__init__(f"{step}（{'、'.join(details)}）" if details else step)


class PictureError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class GraphPost:
    post_id: str
    message: str | None
    posted_at: datetime
    permalink_url: str | None
    picture_url: str | None


async def _require_https(request: httpx.Request) -> None:
    if request.url.scheme != "https":
        raise httpx.UnsupportedProtocol("只允許 https")


def new_client(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    # 不跟隨轉址：Graph 不會轉址，照片若被轉到別的主機也不跟（見 is_facebook_cdn）。
    return httpx.AsyncClient(
        timeout=_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=False,
        event_hooks={"request": [_require_https]},
        transport=transport,
    )


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _proof_params(settings: Settings, token: str) -> dict[str, str]:
    """appsecret_proof 是 token 的 HMAC，推不回 token，可以放網址。"""
    if not settings.facebook_app_secret:
        return {}
    return {"appsecret_proof": hmac.new(settings.facebook_app_secret.encode(), token.encode(), hashlib.sha256).hexdigest()}


async def _get_json(client: httpx.AsyncClient, step: str, url: str, params: dict[str, str], token: str) -> dict:
    try:
        response = await client.get(url, params=params, headers=_auth_headers(token))
    except httpx.HTTPError as exc:
        raise GraphError(step, reason=type(exc).__name__) from None
    body = response.content[:_MAX_JSON_BYTES + 1]
    if len(body) > _MAX_JSON_BYTES:
        raise GraphError(step, status=response.status_code, reason="回應過大")
    try:
        data = response.json()
    except ValueError:
        raise GraphError(step, status=response.status_code, reason="回應不是 JSON") from None
    if response.status_code != 200 or not isinstance(data, dict):
        code = None
        if isinstance(data, dict) and isinstance(data.get("error"), dict):
            raw = data["error"].get("code")
            code = raw if isinstance(raw, int) else None
        raise GraphError(step, status=response.status_code, code=code)
    return data


def _graph_url(settings: Settings, path: str) -> str:
    return f"https://{GRAPH_HOST}/{settings.facebook_graph_version}/{path}"


async def page_token(client: httpx.AsyncClient, settings: Settings, page_id: str) -> str:
    """系統使用者 token 換成這個粉專的 Page token。設定的本來就是 Page token 時，
    Graph 會回同一個粉專的 token（2026-11-10 v27.0 實測）；沒回就沿用原本的。"""
    assert settings.facebook_access_token
    data = await _get_json(
        client, "取得粉專權杖", _graph_url(settings, page_id),
        {"fields": "access_token", **_proof_params(settings, settings.facebook_access_token)},
        settings.facebook_access_token,
    )
    token = data.get("access_token")
    return token if isinstance(token, str) and token else settings.facebook_access_token


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        # Graph 的格式是 2026-10-27T08:30:00+0000。
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S%z")
    except ValueError:
        return None


def _https_or_none(value: object, limit: int) -> str | None:
    if not isinstance(value, str) or len(value) > limit:
        return None
    parts = urlsplit(value)
    return value if parts.scheme == "https" and parts.hostname else None


async def page_posts(client: httpx.AsyncClient, settings: Settings, page_id: str, token: str) -> list[GraphPost]:
    data = await _get_json(
        client, "讀取貼文", _graph_url(settings, f"{page_id}/published_posts"),
        {"fields": POST_FIELDS, "limit": str(POST_LIMIT), **_proof_params(settings, token)},
        token,
    )
    rows = data.get("data")
    if not isinstance(rows, list):
        raise GraphError("讀取貼文", status=200, reason="格式不對")
    posts: list[GraphPost] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        post_id, posted_at = row.get("id"), _parse_time(row.get("created_time"))
        if not isinstance(post_id, str) or not 0 < len(post_id) <= 64 or posted_at is None:
            continue
        message = row.get("message") if isinstance(row.get("message"), str) else None
        picture = _https_or_none(row.get("full_picture"), 4000)
        # 沒字也沒照片（例如只換封面）的貼文不當消息候選。
        if not (message and message.strip()) and picture is None:
            continue
        posts.append(GraphPost(
            post_id=post_id,
            message=message,
            posted_at=posted_at,
            permalink_url=_https_or_none(row.get("permalink_url"), 500),
            picture_url=picture,
        ))
    return posts


def is_facebook_cdn(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and parts.username is None and (host == "fbcdn.net" or host.endswith(".fbcdn.net"))


_PICTURE_TYPES = {"image/jpeg", "image/png", "image/webp"}


async def download_picture(client: httpx.AsyncClient, url: str, max_bytes: int) -> tuple[bytes, str]:
    """下載貼文照片，回 (內容, content-type)。只收 FB CDN、不跟轉址、超過上限中止。
    網址過期時 FB CDN 回 403／404／410，對應 PictureError("FACEBOOK_PICTURE_EXPIRED")。"""
    if not is_facebook_cdn(url):
        raise PictureError("FACEBOOK_PICTURE_UNTRUSTED", "照片網址不是 Facebook 的圖片主機")
    try:
        async with client.stream("GET", url) as response:
            if response.status_code in (403, 404, 410):
                raise PictureError("FACEBOOK_PICTURE_EXPIRED", "照片連結已過期，請先按「立即同步」再試一次")
            if response.status_code != 200:
                raise PictureError("FACEBOOK_PICTURE_FAILED", f"下載照片失敗（HTTP {response.status_code}）")
            content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if content_type not in _PICTURE_TYPES:
                raise PictureError("FACEBOOK_PICTURE_FAILED", "照片格式不支援")
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise PictureError("FACEBOOK_PICTURE_TOO_LARGE", "照片超過上傳上限")
                chunks.append(chunk)
    except httpx.HTTPError as exc:
        raise PictureError("FACEBOOK_PICTURE_FAILED", f"下載照片失敗（{type(exc).__name__}）") from None
    return b"".join(chunks), content_type
