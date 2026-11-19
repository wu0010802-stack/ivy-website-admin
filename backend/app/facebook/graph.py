"""Meta Graph API 的最小用法：換 Page token、讀粉專貼文與粉專連結的 Instagram 貼文、下載貼文照片與影片。

token 只放在 Authorization header 送給 graph.facebook.com，不放網址（httpx 的 INFO 紀錄會印完整
網址，2026-11-10 本機實測曾因此把 token 寫進 log），也不寫進任何例外訊息：
GraphError 只帶 HTTP 狀態與 Meta 的錯誤代碼（docs/specs/2026-10-28-facebook-news-sync-design.md §4）。
Instagram 用同一把 Page token（docs/specs/2026-11-12-external-integrations-design.md §2）。"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from app.config import Settings

GRAPH_HOST = "graph.facebook.com"
# 不帶任何帳號或信箱（外部請求不帶使用者身分）。
USER_AGENT = "Mozilla/5.0 (compatible; ivy-website-facebook-sync/1.0)"
# attachments 只為了影片貼文（含 Reel）的影片檔網址；這種貼文的 full_picture 是影片的某一格。
POST_FIELDS = "id,message,created_time,permalink_url,full_picture,attachments{media_type,media{source}}"
POST_LIMIT = 25
# Instagram：照片貼文的 media_url 是照片；影片（含 Reels）的 media_url 是影片檔、thumbnail_url 是封面；
# 相簿（CAROUSEL_ALBUM）取 children 裡第一張圖片。
INSTAGRAM_MEDIA_FIELDS = (
    "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,"
    "children{media_type,media_url,thumbnail_url}"
)
# 缺少權限時 Graph 回的錯誤代碼：10＝權限被拒、200＝缺少需要的權限（例如 instagram_basic）。
PERMISSION_ERROR_CODES = (10, 200)
# Instagram 的帳號與貼文 ID 是純數字；ID 會放進網址路徑，格式不對就當沒有。
_INSTAGRAM_ID = re.compile(r"[0-9A-Za-z_-]{1,40}")
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


class DownloadError(Exception):
    """下載貼文照片或影片失敗；code 是 FACEBOOK_PICTURE_* 或 FACEBOOK_VIDEO_*（Instagram 貼文也用這組），
    結尾是 UNTRUSTED（不是 Meta 的 CDN）、EXPIRED（連結過期，重新同步就好）、UNSUPPORTED（格式不收）、
    TOO_LARGE（超過上限）或 FAILED（其他，可重試）。"""

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
    video_url: str | None = None
    # 貼文來自哪裡（facebook_page_posts.source）；Instagram 的 post_id 另外加 ig_ 前綴。
    source: str = "facebook"


async def _require_https(request: httpx.Request) -> None:
    if request.url.scheme != "https":
        raise httpx.UnsupportedProtocol("只允許 https")


def new_client(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    # 不跟隨轉址：Graph 不會轉址，照片若被轉到別的主機也不跟（見 is_meta_cdn）。
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


def _video_source(row: dict) -> str | None:
    """影片貼文第一個影片附件的檔案網址。相簿裡夾的影片（subattachments）不取。"""
    attachments = row.get("attachments")
    items = attachments.get("data") if isinstance(attachments, dict) else None
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and item.get("media_type") == "video":
            media = item.get("media")
            return _https_or_none(media.get("source"), 4000) if isinstance(media, dict) else None
    return None


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
            video_url=_video_source(row),
        ))
    return posts


def _first_https(*values: object) -> str | None:
    """第一個合法的 https 網址。"""
    return next((url for value in values if (url := _https_or_none(value, 4000)) is not None), None)


def _instagram_media(row: dict) -> tuple[str | None, str | None]:
    """回 (照片網址, 影片網址)。相簿只取第一張圖片（全是影片時退而用第一支影片的封面），不取相簿裡的影片。"""
    media_type = row.get("media_type")
    if media_type == "IMAGE":
        return _first_https(row.get("media_url")), None
    if media_type == "VIDEO":
        return _first_https(row.get("thumbnail_url")), _first_https(row.get("media_url"))
    if media_type == "CAROUSEL_ALBUM":
        children = row.get("children")
        items = children.get("data") if isinstance(children, dict) else None
        kids = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
        image = next((url for kid in kids if kid.get("media_type") == "IMAGE" and (url := _first_https(kid.get("media_url")))), None)
        return image or _first_https(*(kid.get("thumbnail_url") for kid in kids)), None
    return None, None


async def instagram_account(client: httpx.AsyncClient, settings: Settings, page_id: str, token: str) -> str | None:
    """粉專連結的 Instagram 專業帳號 ID；沒連結回 None。缺權限時 Graph 回錯誤（GraphError，code 10／200）。"""
    data = await _get_json(
        client, "取得 Instagram 帳號", _graph_url(settings, page_id),
        {"fields": "instagram_business_account", **_proof_params(settings, token)}, token,
    )
    account = data.get("instagram_business_account")
    account_id = account.get("id") if isinstance(account, dict) else None
    return account_id if isinstance(account_id, str) and _INSTAGRAM_ID.fullmatch(account_id) else None


async def instagram_media(
    client: httpx.AsyncClient, settings: Settings, ig_user_id: str, token: str
) -> list[GraphPost]:
    """該 Instagram 帳號最近 25 則貼文，轉成跟粉專貼文同一個形狀（post_id 加 ig_ 前綴避免撞號）。"""
    data = await _get_json(
        client, "讀取 Instagram 貼文", _graph_url(settings, f"{ig_user_id}/media"),
        {"fields": INSTAGRAM_MEDIA_FIELDS, "limit": str(POST_LIMIT), **_proof_params(settings, token)},
        token,
    )
    rows = data.get("data")
    if not isinstance(rows, list):
        raise GraphError("讀取 Instagram 貼文", status=200, reason="格式不對")
    posts: list[GraphPost] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        media_id, posted_at = row.get("id"), _parse_time(row.get("timestamp"))
        if not isinstance(media_id, str) or not _INSTAGRAM_ID.fullmatch(media_id) or posted_at is None:
            continue
        message = row.get("caption") if isinstance(row.get("caption"), str) else None
        picture, video = _instagram_media(row)
        # 沒字也沒照片的貼文不當消息候選（跟粉專貼文同一條規則）。
        if not (message and message.strip()) and picture is None:
            continue
        posts.append(GraphPost(
            post_id=f"ig_{media_id}",
            message=message,
            posted_at=posted_at,
            permalink_url=_https_or_none(row.get("permalink"), 500),
            picture_url=picture,
            video_url=video,
            source="instagram",
        ))
    return posts


# 貼文照片與影片的下載白名單：Facebook 的 fbcdn.net，Instagram 的 cdninstagram.com（有些 Instagram
# 檔案也在 fbcdn.net）。只接受這兩個網域本身與它的子網域，不認「結尾剛好一樣」的別人網域。
_META_CDN_DOMAINS = ("fbcdn.net", "cdninstagram.com")


def is_meta_cdn(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return (
        parts.scheme == "https"
        and parts.username is None
        and any(host == domain or host.endswith(f".{domain}") for domain in _META_CDN_DOMAINS)
    )


@dataclass(frozen=True)
class _DownloadKind:
    code: str
    noun: str
    host_noun: str
    types: frozenset[str]


_PICTURE = _DownloadKind("FACEBOOK_PICTURE", "照片", "圖片", frozenset({"image/jpeg", "image/png", "image/webp"}))
_VIDEO = _DownloadKind("FACEBOOK_VIDEO", "影片", "影片", frozenset({"video/mp4"}))


async def _download(
    client: httpx.AsyncClient, url: str, max_bytes: int, kind: _DownloadKind, write: Callable[[bytes], Awaitable[object]]
) -> str:
    """把檔案逐塊交給 write，回 content-type。只收 Meta CDN（Facebook、Instagram）、不跟轉址、超過上限中止。
    網址過期時 CDN 回 403／404／410，對應 <code>_EXPIRED。"""
    if not is_meta_cdn(url):
        raise DownloadError(f"{kind.code}_UNTRUSTED", f"{kind.noun}網址不是 Facebook 或 Instagram 的{kind.host_noun}主機")
    try:
        async with client.stream("GET", url) as response:
            if response.status_code in (403, 404, 410):
                raise DownloadError(f"{kind.code}_EXPIRED", f"{kind.noun}連結已過期，請先按「立即同步」再試一次")
            if response.status_code != 200:
                raise DownloadError(f"{kind.code}_FAILED", f"下載{kind.noun}失敗（HTTP {response.status_code}）")
            content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if content_type not in kind.types:
                raise DownloadError(f"{kind.code}_UNSUPPORTED", f"{kind.noun}格式不支援")
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise DownloadError(f"{kind.code}_TOO_LARGE", f"{kind.noun}超過上傳上限")
                await write(chunk)
    except httpx.HTTPError as exc:
        raise DownloadError(f"{kind.code}_FAILED", f"下載{kind.noun}失敗（{type(exc).__name__}）") from None
    return content_type


async def download_picture(client: httpx.AsyncClient, url: str, max_bytes: int) -> tuple[bytes, str]:
    """下載貼文照片，回 (內容, content-type)。"""
    chunks: list[bytes] = []

    async def keep(chunk: bytes) -> None:
        chunks.append(chunk)

    content_type = await _download(client, url, max_bytes, _PICTURE, keep)
    return b"".join(chunks), content_type


async def download_video(client: httpx.AsyncClient, url: str, max_bytes: int, target: Path) -> None:
    """下載貼文影片（mp4）寫進 target，不整份進記憶體；失敗時 target 的內容不能用，呼叫端負責刪檔。"""
    with target.open("wb") as out:

        async def write(chunk: bytes) -> None:
            await asyncio.to_thread(out.write, chunk)

        await _download(client, url, max_bytes, _VIDEO, write)
