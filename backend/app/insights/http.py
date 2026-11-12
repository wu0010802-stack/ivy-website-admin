"""兩個 Google 查詢共用的 HTTP 小工具。

錯誤只說得出「哪一步、HTTP 幾號」或「例外型別」（比照 app/facebook/graph.py 的 GraphError），
絕不帶 Google 回應內容：error_description 與錯誤訊息裡可能有服務帳戶信箱、資源名稱、金鑰片段。"""

from __future__ import annotations

import httpx

SEARCH_CONSOLE_USER_AGENT = "Mozilla/5.0 (compatible; ivy-website-search-insights/1.0)"
CRUX_USER_AGENT = "Mozilla/5.0 (compatible; ivy-website-crux/1.0)"

# 回應很小（25 列、或兩個裝置的時間序列）；超過就當異常。
MAX_JSON_BYTES = 2 * 1024 * 1024
_TIMEOUT = httpx.Timeout(20.0, connect=10.0)


class GoogleApiError(Exception):
    """str(exc) 就是給後台看的那一行：「<步驟>（HTTP n）」或「<步驟>（<原因>）」。"""

    def __init__(self, step: str, *, status: int | None = None, reason: str | None = None):
        self.step = step
        self.status = status
        self.reason = reason
        details = [*([f"HTTP {status}"] if status is not None else []), *([reason] if reason else [])]
        super().__init__(f"{step}（{'、'.join(details)}）" if details else step)


async def _require_https(request: httpx.Request) -> None:
    if request.url.scheme != "https":
        raise httpx.UnsupportedProtocol("只允許 https")


def new_client(user_agent: str, transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    """不跟隨轉址、只連 https。transport 給測試注入 httpx.MockTransport。"""
    return httpx.AsyncClient(
        timeout=_TIMEOUT,
        headers={"User-Agent": user_agent},
        follow_redirects=False,
        event_hooks={"request": [_require_https]},
        transport=transport,
    )


async def post_json(client: httpx.AsyncClient, step: str, url: str, **kwargs) -> tuple[int, object]:
    """POST 後回 (HTTP 狀態, 解析後的 JSON 或 None)。連線失敗只記例外型別；呼叫端決定哪些狀態可以接受。"""
    try:
        response = await client.post(url, **kwargs)
    except httpx.HTTPError as exc:
        raise GoogleApiError(step, reason=type(exc).__name__) from None
    if len(response.content) > MAX_JSON_BYTES:
        raise GoogleApiError(step, status=response.status_code, reason="回應過大")
    try:
        data = response.json()
    except ValueError:
        data = None
    return response.status_code, data
