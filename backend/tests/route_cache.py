"""測試用：同一個 router 的路由只建一次，之後每個 app 直接重用。

每個測試都會 `create_app()` 一次（conftest 的 `app` fixture，另有 29 個測試檔自己建），
FastAPI 的 `include_router` 每次都把 850 條路由重新建一遍（逐條重做 pydantic 驗證器），
2026-10-16 本機實測一次 `create_app` 約 130 ms，佔每個測試準備時間的三分之一以上。

路由物件只跟 router 的定義有關，跟哪個 app 掛它無關：請求處理時拿的是
`request.app.state`（Starlette 在每個請求把 scope["app"] 設成當下的 app），
所以多個 app 共用同一批路由物件，行為與各自重建相同。

唯一的例外是 `app.dependency_overrides`：FastAPI 建路由時就把「去哪個 app 找
覆寫」綁死在處理函式裡，共用的路由只會看第一個 app。目前沒有測試用它；
conftest 的 `app` fixture 收尾時會檢查，哪天有人用了就直接失敗並指到這裡，
不會默默沒有生效。要用的話，在那個測試裡呼叫 `uncached_create_app()`。
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, FastAPI

_original_include_router = FastAPI.include_router
_DEFAULT_LIFESPAN = type(APIRouter().lifespan_context)
# id(router) → (router, 路由)。留著 router 本身，id 才不會被回收後重用。
_cache: dict[int, tuple[APIRouter, list]] = {}
_enabled = False


def _cacheable(router: APIRouter, kwargs: dict) -> bool:
    # 帶 prefix／dependencies 等參數、或 router 自己有啟動／關閉事件、lifespan 的，
    # 照原本的方式掛（include_router 除了加路由還會合併這些）；本專案目前都沒有。
    return (
        not kwargs
        and not router.on_startup
        and not router.on_shutdown
        and type(router.lifespan_context) is _DEFAULT_LIFESPAN
    )


def _include_router(self: FastAPI, router: APIRouter, **kwargs) -> None:
    if not _enabled or not _cacheable(router, kwargs):
        _original_include_router(self, router, **kwargs)
        return
    hit = _cache.get(id(router))
    if hit is None:
        start = len(self.router.routes)
        _original_include_router(self, router)
        _cache[id(router)] = (router, self.router.routes[start:])
        return
    self.router.routes.extend(hit[1])


def install() -> None:
    global _enabled
    _enabled = True
    FastAPI.include_router = _include_router


def uncached_create_app(factory: Callable[..., FastAPI], *args, **kwargs) -> FastAPI:
    """暫時關掉快取建一個 app：需要 `dependency_overrides` 的測試用。"""
    global _enabled
    previous, _enabled = _enabled, False
    try:
        return factory(*args, **kwargs)
    finally:
        _enabled = previous
