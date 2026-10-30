"""tests/route_cache.py 真的讓每個 router 的路由只建一次。

快取漏掉一個 router 不會讓任何測試失敗，只會讓每個測試的準備變慢：2026-10-29 發現預約的
router（自己 include 了三個子 router）一直沒進快取，27 條路由每次 `create_app` 都重建
（約 54 ms，修好後約 3 ms）。
"""

from fastapi.routing import APIRoute

from app.main import create_app
from tests.conftest import _test_settings


async def test_second_app_reuses_every_router_route(app):
    second = create_app(_test_settings())
    try:
        reused = {id(route) for route in app.router.routes}
        rebuilt = [
            route.path for route in second.router.routes
            if isinstance(route, APIRoute) and id(route) not in reused
        ]
    finally:
        await second.state.rate_limit_engine.dispose()
        await second.state.engine.dispose()
    # 只有 create_app 裡直接 @app.get 的 health 是每個 app 自己的；其餘都該來自快取。
    assert rebuilt == ["/api/website/v1/health"], "這些路由沒有進 tests/route_cache.py 的快取"
