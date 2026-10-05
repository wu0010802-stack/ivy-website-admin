"""2026-09-29 資安稽核修正（platform）：連線池與限流隔離、DB 例外不落個資、
IPv6 限流聚合、access log 不含 query string、production 關閉 API 文件、
後台／登入回應 no-store、production 設定檢查、migration 專用連線。

限流獨立小池、uvicorn 存取紀錄去查詢字串、production 關閉 API 文件在
PR #14（系統設計審查第一批修正）已先上線，這裡的測試改成驗同一套實作
（app/db.py、app/logging_config.py）上本分支補強的行為。"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine
from starlette.requests import Request

from app.common import ratelimit
from app.common.ratelimit import Limit, RateLimited, RateLimiter
from app.config import Settings
from app.logging_config import RedactDatabaseErrorDetail, configure_logging
from app import db as app_db
from app.db import create_engine, create_session_factory
from app.main import create_app

API = "/api/website/v1"
BACKEND = Path(__file__).resolve().parents[1]
TEST_DB_URL = os.environ.get("WEBSITE_TEST_DATABASE_URL", "postgresql+asyncpg://localhost/ivy_website_test")
# 看起來像隨機值、不含任何佔位字眼的 production 秘密（測試專用）。
PROD_SECRET = "q7Yv2mXk9LrT4wZp8sNc3HbJ6dFg"
EXAMPLE_SECRET = "change-me-generate-a-random-32-byte-value"


def _prod_settings(**overrides) -> Settings:
    values = {
        "environment": "production",
        "database_url": TEST_DB_URL,
        "session_secret": PROD_SECRET,
        "admin_origin": "https://admin.example.org",
        **overrides,
    }
    return Settings(**values)


def _with(app, **changes) -> Settings:
    return app.state.settings.model_copy(update=changes)


# ------------------------------------------------------------------ 連線池與限流


async def test_rate_limiter_uses_its_own_small_pool(app):
    engine = app.state.rate_limit_engine
    assert engine is not app.state.engine
    assert app.state.rate_limiter._engine is engine
    pool = engine.pool
    assert pool.size() == app_db.RATE_LIMIT_POOL_SIZE == 3
    assert pool._max_overflow == app_db.RATE_LIMIT_MAX_OVERFLOW == 2
    assert pool._timeout == app_db.RATE_LIMIT_POOL_TIMEOUT_SECONDS == 5


async def test_request_pool_follows_settings(app):
    settings = _with(app, db_pool_size=4, db_max_overflow=2, db_pool_timeout_seconds=7)
    engine = create_engine(settings)
    try:
        assert engine.pool.size() == 4
        assert engine.pool._max_overflow == 2
        assert engine.pool._timeout == 7
    finally:
        await engine.dispose()


async def test_rate_limit_check_does_not_wait_for_exhausted_request_pool(app):
    """請求 session 的池被占滿（例如等列鎖的送單）時，限流仍拿得到連線。
    原本共用同一個池：這裡會等到 pool_timeout 後丟 TimeoutError。"""
    starving = create_app(_with(app, db_pool_size=1, db_max_overflow=0, db_pool_timeout_seconds=1))
    try:
        async with starving.state.engine.connect() as held:
            await held.execute(text("SELECT 1"))
            started = time.monotonic()
            await starving.state.rate_limiter.check(Limit("secfix_pool", 60, 5), "visitor")
            assert time.monotonic() - started < 1
    finally:
        await starving.state.engine.dispose()
        await starving.state.rate_limit_engine.dispose()


async def test_rate_limiter_fails_closed_when_its_pool_is_exhausted(app):
    """限流拿不到連線時：檢查類（check／is_limited）一律當作超限，不讓灌爆
    限流池的人趁機繞過上限；記帳類（record／reset）盡力而為，不讓已經做完的
    請求因此變成 500。"""
    engine = create_async_engine(TEST_DB_URL, pool_size=1, max_overflow=0, pool_timeout=0.2)
    limiter = RateLimiter(engine, "test-only-secret-please-rotate")
    limit = Limit("secfix_fail_closed", 60, 5)
    try:
        async with engine.connect() as held:
            await held.execute(text("SELECT 1"))
            with pytest.raises(RateLimited) as excinfo:
                await limiter.check(limit, "visitor")
            assert excinfo.value.retry_after_seconds >= 1
            assert await limiter.is_limited(limit, "visitor") is True
            await limiter.record(limit, "visitor")
            await limiter.reset(limit, "visitor")
        # 連線歸還後恢復正常。
        await limiter.check(limit, "visitor")
        assert await limiter.is_limited(limit, "visitor") is False
    finally:
        await engine.dispose()


async def test_bootstrap_admin_survives_slow_password_entry(app, db_session, monkeypatch):
    """bootstrap-admin 原本開著查詢交易等人輸入密碼；執行期連線帶 idle_in_transaction
    逾時，輸入得比逾時慢，最後的 commit 就會失敗。"""
    from app import cli
    from app.auth.models import User

    engine = create_engine(_with(app, db_idle_in_transaction_timeout_ms=200))

    async def factory():
        return create_session_factory(engine)

    def slow_getpass(prompt=""):
        time.sleep(0.4)
        return "slow-admin-password-123"

    monkeypatch.setattr(cli, "_session_factory", factory)
    monkeypatch.setattr("builtins.input", lambda prompt="": "Slow.Admin@ivy.example")
    monkeypatch.setattr(cli.getpass, "getpass", slow_getpass)
    try:
        await cli.bootstrap_admin()
    finally:
        await engine.dispose()

    emails = (await db_session.execute(select(User.email).where(User.email == "slow.admin@ivy.example"))).scalars()
    assert list(emails) == ["slow.admin@ivy.example"]


async def test_lifespan_disposes_request_and_rate_limit_engines(app):
    disposed: list[str] = []

    class _Spy:
        def __init__(self, name: str) -> None:
            self.name = name

        async def dispose(self) -> None:
            disposed.append(self.name)

    real = (app.state.engine, app.state.rate_limit_engine)
    app.state.engine, app.state.rate_limit_engine = _Spy("request"), _Spy("rate_limit")
    try:
        async with app.router.lifespan_context(app):
            pass
    finally:
        app.state.engine, app.state.rate_limit_engine = real
    assert sorted(disposed) == ["rate_limit", "request"]


_TIMEOUTS_SQL = text(
    "SELECT name, setting FROM pg_settings WHERE name IN "
    "('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')"
)


async def test_engines_set_lock_and_idle_in_transaction_timeouts(app):
    """lock／idle 逾時跟 PR #14 的 statement_timeout 一起帶在每條執行期連線上。"""
    settings = app.state.settings
    assert settings.db_lock_timeout_ms > 0 and settings.db_idle_in_transaction_timeout_ms > 0
    expected = {
        "statement_timeout": str(app_db.STATEMENT_TIMEOUT_MS),
        "lock_timeout": str(settings.db_lock_timeout_ms),
        "idle_in_transaction_session_timeout": str(settings.db_idle_in_transaction_timeout_ms),
    }
    for engine in (app.state.engine, app.state.rate_limit_engine):
        async with engine.connect() as conn:
            assert dict((await conn.execute(_TIMEOUTS_SQL)).all()) == expected


async def test_zero_timeouts_are_left_to_the_server_default(app):
    from app.db import _server_settings

    statement = str(app_db.STATEMENT_TIMEOUT_MS)
    zero = _with(app, db_lock_timeout_ms=0, db_idle_in_transaction_timeout_ms=0)
    assert _server_settings(zero) == {"statement_timeout": statement}
    assert _server_settings(_with(app, db_lock_timeout_ms=0)) == {
        "statement_timeout": statement,
        "idle_in_transaction_session_timeout": str(app.state.settings.db_idle_in_transaction_timeout_ms),
    }
    engine = create_engine(zero)
    try:
        async with engine.connect() as conn:
            assert dict((await conn.execute(_TIMEOUTS_SQL)).all()) == {
                "statement_timeout": statement, "lock_timeout": "0", "idle_in_transaction_session_timeout": "0",
            }
    finally:
        await engine.dispose()


async def test_db_error_logs_never_include_bound_parameters(app, caplog):
    """資料層例外會 logger.exception 整段堆疊；SQLAlchemy 預設把綁定參數
    （家長姓名、手機…）附在例外訊息裡，一起寫進 log。"""
    pii = "0912999888-secfix-parent"

    @app.get(f"{API}/_secfix_db_error")
    async def _db_error() -> dict:
        async with app.state.session_factory() as db:
            await db.execute(text("SELECT 1 / 0 WHERE :phone = :phone"), {"phone": pii})
        return {}

    caplog.set_level(logging.INFO)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(f"{API}/_secfix_db_error")
    assert response.status_code == 500
    assert pii not in response.text
    logged = []
    for record in caplog.records:
        logged.append(record.getMessage())
        if record.exc_info:
            logged.extend(traceback.format_exception(*record.exc_info))
    assert any("division by zero" in line for line in logged), "應該要有資料層例外的 log"
    assert not any(pii in line for line in logged)


async def test_db_error_logs_never_include_row_values(app, caplog):
    """hide_parameters 只藏綁定參數。PostgreSQL 的 DETAIL（違反 NOT NULL／CHECK 時整列
    內容、唯一鍵衝突的鍵值）在 asyncpg 例外字串裡，SQLAlchemy 又包進自己的訊息，照樣
    整段寫進平台日誌（2026-10-04 資安掃描 #12）。錯誤種類與資料表名稱要留著除錯。"""
    pii = "0912999777-secfix-row"

    @app.get(f"{API}/_secfix_db_detail")
    async def _db_detail() -> dict:
        async with app.state.session_factory() as db:
            await db.execute(text("CREATE TEMP TABLE secfix_rows (phone text, n int NOT NULL)"))
            await db.execute(text("INSERT INTO secfix_rows VALUES (:phone, NULL)"), {"phone": pii})
        return {}

    caplog.set_level(logging.INFO)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(f"{API}/_secfix_db_detail")
    assert response.status_code == 500
    [record] = [r for r in caplog.records if r.exc_info]

    # 用正式站的 handler 設定格式化（configure_logging 掛在每個平台 handler 上的過濾器）。
    out = io.StringIO()
    handler = logging.StreamHandler(out)
    handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    handler.addFilter(RedactDatabaseErrorDetail())
    handler.handle(record)
    logged = out.getvalue()
    assert "violates not-null constraint" in logged and "secfix_rows" in logged
    assert "NotNullViolationError" in logged
    assert pii not in logged


def test_db_error_redaction_covers_client_side_argument_errors():
    """asyncpg 在送出前編碼參數失敗時，訊息直接帶參數值（不經 DETAIL）。"""
    import asyncpg

    pii = "0912999666-secfix-arg"
    try:
        try:
            raise asyncpg.exceptions.DataError(f"invalid input for query argument $2: {pii!r} (expected int)")
        except asyncpg.exceptions.DataError as exc:
            raise RuntimeError("wrapped") from exc
    except RuntimeError:
        record = logging.LogRecord("app", logging.ERROR, __file__, 0, "boom", None, sys.exc_info())
    RedactDatabaseErrorDetail().filter(record)
    assert "query argument $2" in record.exc_text
    assert pii not in record.exc_text


def test_configure_logging_installs_redaction_on_platform_handlers(monkeypatch):
    """root 的 handler 與 uvicorn 自己的 handler（ASGI 未處理例外由 uvicorn.error 記）都要掛。"""
    root_handler = logging.StreamHandler(io.StringIO())
    uvicorn_handler = logging.StreamHandler(io.StringIO())
    monkeypatch.setattr(logging.getLogger(), "handlers", [root_handler])
    monkeypatch.setattr(logging.getLogger("uvicorn"), "handlers", [uvicorn_handler])
    configure_logging()
    configure_logging()
    for handler in (root_handler, uvicorn_handler):
        assert [type(f) for f in handler.filters].count(RedactDatabaseErrorDetail) == 1


# ------------------------------------------------------------------ IPv6 限流鍵


def _request(header: str | None = None, peer: str | None = "10.0.0.2") -> Request:
    headers = [(b"x-website-client-ip", header.encode())] if header is not None else []
    scope = {
        "type": "http",
        "headers": headers,
        "client": (peer, 1234) if peer else None,
        "app": SimpleNamespace(state=SimpleNamespace(settings=SimpleNamespace(trusted_client_ip_header="x-website-client-ip"))),
    }
    return Request(scope)


def test_client_key_aggregates_ipv6_to_its_64_prefix():
    same_a = ratelimit.client_key(_request("2001:db8:1:2::1"))
    same_b = ratelimit.client_key(_request("2001:0db8:0001:0002:ffff:eeee:dddd:9"))
    other = ratelimit.client_key(_request("2001:db8:1:3::1"))
    assert same_a == same_b == "2001:db8:1:2::/64"
    assert other != same_a


def test_client_key_keeps_ipv4_and_unwraps_ipv4_mapped_ipv6():
    assert ratelimit.client_key(_request("203.0.113.5")) == "203.0.113.5"
    assert ratelimit.client_key(_request("::ffff:203.0.113.5")) == "203.0.113.5"
    # 多段時仍只取第一段（代理已經算好訪客 IP）。
    assert ratelimit.client_key(_request("198.51.100.7, 10.0.0.1")) == "198.51.100.7"


def test_client_key_peer_fallback_also_aggregates_ipv6():
    assert ratelimit.client_key(_request(None, peer="2001:db8:aa:bb:1::5")) == "2001:db8:aa:bb::/64"
    assert ratelimit.client_key(_request(None, peer="192.0.2.10")) == "192.0.2.10"
    assert ratelimit.client_key(_request(None, peer=None)) == "unknown"


def test_client_key_non_ip_values_stay_bounded():
    assert ratelimit.client_key(_request("not-an-ip" * 20)) == ("not-an-ip" * 20)[:64]


# ------------------------------------------------------------------ access log
#
# 存取紀錄只有 uvicorn 這一份（deploy/api-start.py 不再 --no-access-log），查詢字串
# 由 app/logging_config.py 的 StripQueryString 拿掉（PR #14）；過濾器本身的單元
# 測試在 test_logging_config.py，這裡驗正式啟動時真的裝上、而且對 uvicorn 實際
# 產生的路徑也成立。


def _uvicorn_access_record(scope: dict) -> logging.LogRecord:
    from uvicorn.protocols.utils import get_path_with_query_string

    return logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 0, '%s - "%s %s HTTP/%s" %d',
        ("10.0.0.1:5000", "GET", get_path_with_query_string(scope), "1.1", 404), None,
    )


def test_access_log_has_no_query_string_and_no_forged_lines():
    from app.logging_config import StripQueryString

    record = _uvicorn_access_record({
        "path": f"{API}/admin/visit-requests\nforged line", "query_string": b"q=0912345678&email=parent@example.com",
    })
    assert StripQueryString().filter(record)
    line = record.getMessage()
    assert f"{API}/admin/visit-requests" in line and '" 404' in line
    # uvicorn 先 percent-encode 路徑，控制字元進不了 log。
    assert "\n" not in line and "%0A" in line
    assert "0912345678" not in line and "parent@example.com" not in line and "?" not in line


def test_server_logging_installs_query_filter_and_splits_stdout_stderr(capsys):
    """uvicorn 只設定自己的 logger；不另外設定時 app.* 的 INFO 會被 Python 預設的
    lastResort（WARNING 以上）吞掉。INFO 走 stdout、WARNING 以上走 stderr，平台
    log 的嚴重度分類才不會把每一行 INFO 都當成錯誤。"""
    from app.logging_config import StripQueryString, configure_logging

    root = logging.getLogger()
    access = logging.getLogger("uvicorn.access")
    saved = (list(root.handlers), root.level, list(access.filters))
    root.handlers.clear()
    try:
        configure_logging()
        configure_logging()  # 重複呼叫不會重複加 handler 或過濾器
        assert len(root.handlers) == 2
        assert sum(isinstance(f, StripQueryString) for f in access.filters) == 1
        logging.getLogger("app.workers").info("secfix-info")
        logging.getLogger("app").error("secfix-problem")
        out, err = capsys.readouterr()
        assert "secfix-info" in out and "secfix-problem" not in out
        assert "secfix-problem" in err and "secfix-info" not in err
    finally:
        root.handlers[:] = saved[0]
        root.setLevel(saved[1])
        access.filters[:] = saved[2]


# ------------------------------------------------------------------ production：API 文件
#
# PR #14 已先關閉；測試合併進 test_logging_config.py::test_api_docs_are_off_in_production
# （另外補上 HTTP 層的 404 與 /docs/oauth2-redirect）。


# ------------------------------------------------------------------ no-store


async def test_admin_and_auth_responses_are_not_cacheable(app, admin_client, public_client):
    for response in (
        await admin_client.get(f"{API}/admin/visit-requests"),
        await admin_client.get(f"{API}/auth/me"),
        await public_client.get(f"{API}/admin/visit-requests"),  # 401 也不能被快取
    ):
        assert response.headers.get("Cache-Control") == "private, no-store", (response.request.url, response.status_code)
    # 路由自己已設 no-store（OAuth 入口）的維持原值。
    providers = await public_client.get(f"{API}/auth/providers")
    assert "no-store" in providers.headers["Cache-Control"]


async def test_route_cache_control_is_kept_and_public_paths_untouched(app, public_client):
    @app.get(f"{API}/admin/_secfix_cached")
    async def _cached():
        from fastapi.responses import JSONResponse

        return JSONResponse({}, headers={"Cache-Control": "private, max-age=60"})

    kept = await public_client.get(f"{API}/admin/_secfix_cached")
    assert kept.headers["Cache-Control"] == "private, max-age=60"
    health = await public_client.get(f"{API}/health")
    assert "Cache-Control" not in health.headers


# ------------------------------------------------------------------ production 設定檢查


@pytest.mark.parametrize("origin", [None, "", "http://admin.example.org", "https://", "https://admin.example.org/admin", "https://u:p@admin.example.org"])
def test_production_requires_https_admin_origin(origin):
    with pytest.raises(ValidationError, match="WEBSITE_ADMIN_ORIGIN"):
        _prod_settings(admin_origin=origin)


@pytest.mark.parametrize("secret", [EXAMPLE_SECRET, "CHANGEME-please-0123456789", "change_me_to_something_long", "my-example-secret-value-1234", "placeholder-session-secret-99"])
def test_production_rejects_placeholder_session_secret(secret):
    with pytest.raises(ValidationError, match="WEBSITE_SESSION_SECRET") as excinfo:
        _prod_settings(session_secret=secret)
    assert secret not in str(excinfo.value)


def test_production_accepts_real_values_and_keeps_16_char_minimum():
    settings = _prod_settings(admin_origin="https://web-production-04caa.up.railway.app/", session_secret="a8Kd02nQ7xLm4vZ1")
    assert settings.environment == "production"
    # 開發環境照常可以用 .env.example 的值。
    Settings(environment="development", database_url="postgresql://localhost/ivy_website_dev", session_secret=EXAMPLE_SECRET)


# ------------------------------------------------------------------ migration 專用連線


def _alembic_env(**extra) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("WEBSITE_")}
    env.update(
        WEBSITE_ENVIRONMENT="development",
        # 執行期連線故意指向不存在的庫：migration 若沒改用專用連線就會失敗。
        WEBSITE_DATABASE_URL="postgresql+asyncpg://localhost/ivy_website_secfix_no_such_db",
        WEBSITE_MIGRATION_DATABASE_URL=TEST_DB_URL,
        WEBSITE_SESSION_SECRET="test-only-secret-please-rotate",
        WEBSITE_SKIP_DEFAULT_APP="1",
        **extra,
    )
    return env


def test_alembic_uses_migration_database_url():
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "current"], cwd=BACKEND, env=_alembic_env(),
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    assert "ivy_website_secfix_no_such_db" not in result.stderr


async def test_schema_guard_reads_through_migration_database_url(monkeypatch):
    import importlib.util

    import app.config as config_module

    spec = importlib.util.spec_from_file_location("secfix_check_schema", BACKEND.parent / "deploy" / "check_schema.py")
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    seen: list[list[str]] = []
    monkeypatch.setattr(guard, "validate_revision", lambda actual, expected: seen.append(actual))
    monkeypatch.setattr(
        config_module, "get_settings",
        lambda: Settings(
            environment="development",
            database_url="postgresql+asyncpg://localhost/ivy_website_secfix_no_such_db",
            migration_database_url=TEST_DB_URL,
            session_secret="test-only-secret-please-rotate",
        ),
    )
    monkeypatch.chdir(BACKEND)
    await asyncio.wait_for(guard.check(), timeout=30)
    assert seen and len(seen[0]) == 1
