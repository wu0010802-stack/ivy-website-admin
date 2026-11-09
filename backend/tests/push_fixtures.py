"""手機推播測試共用的 fixture：開啟推播的 app（假推播服務）與各角色的已登入用戶端。
在測試檔裡 `from tests.push_fixtures import ...  # noqa: F401` 引入即可使用。"""

from __future__ import annotations

import httpx
import pytest_asyncio

from app.auth.models import Role
from app.main import create_app
from tests.conftest import _create_user, _logged_in_client
from tests.push_helpers import FakePushService, push_settings


@pytest_asyncio.fixture
async def push_app():
    application = create_app(push_settings())
    application.state.fake_push = FakePushService()
    application.state.push_transport = application.state.fake_push.transport()
    yield application
    await application.state.rate_limit_engine.dispose()
    await application.state.engine.dispose()


async def login(application, email: str, role: Role, campuses: list[str] | None = None) -> httpx.AsyncClient:
    async with application.state.session_factory() as db:
        await _create_user(db, email, "push-route-password-123", role, campuses)
    return await _logged_in_client(application, email, "push-route-password-123")


@pytest_asyncio.fixture
async def admin(push_app):
    client = await login(push_app, "push-admin@ivy.example", Role.SUPER_ADMIN)
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def campus_admin(push_app):
    client = await login(push_app, "push-minghua@ivy.example", Role.CAMPUS_ADMIN, ["minghua"])
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def reception(push_app):
    client = await login(push_app, "push-desk@ivy.example", Role.RECEPTION, ["yihua"])
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def editor(push_app):
    client = await login(push_app, "push-editor@ivy.example", Role.EDITOR, ["yihua"])
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def readonly(push_app):
    client = await login(push_app, "push-readonly@ivy.example", Role.READONLY, ["yihua"])
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def clients(admin, campus_admin, reception, editor, readonly):
    return {"admin": admin, "campus_admin": campus_admin, "reception": reception, "editor": editor, "readonly": readonly}
