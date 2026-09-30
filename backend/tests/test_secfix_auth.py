"""2026-09-29 資安稽核修補（auth 工作包）的迴歸測試。

對應稽核項目：login-account-bucket-no-effect、session-hijack-persistence-no-reauth、
login-audit-gaps／login-events-not-audited、session-persistent-no-idle-timeout、
bcrypt-truncation-no-max-length，以及 bcrypt-event-loop-blocking。LINE／Google
專屬的部分寫在 test_line_oauth.py、test_google_oauth.py。
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import create_async_engine

from app.auth import deps, service
from app.auth.models import Role, User
from app.auth.models import Session as AuthSession
from app.common.ratelimit import RateLimiter
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client, _test_settings

API = "/api/website/v1"
LOGIN = f"{API}/auth/login"
ADMIN_EMAIL = "admin@ivy.example"
ADMIN_PASSWORD = "super-admin-password-123"
STAFF_EMAIL = "staff@ivy.example"
STAFF_PASSWORD = "staff-password-123"


class Clock:
    def __init__(self, now: float) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _login(client, email=STAFF_EMAIL, password=STAFF_PASSWORD) -> httpx.Response:
    return await client.post(LOGIN, json={"email": email, "password": password})


async def _audits(db_session, action: str) -> list[AuditLogEntry]:
    db_session.expire_all()
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars())


async def _sessions_of(db_session, user_id) -> list[AuthSession]:
    # 注意：expire_all 之後再讀 ORM 物件的屬性會觸發同步 lazy load，呼叫端先記下 id。
    db_session.expire_all()
    result = await db_session.execute(select(AuthSession).where(AuthSession.user_id == user_id))
    return list(result.scalars())


async def _age_sessions(db_session, user_id, *, created_ago: timedelta, expires_in: timedelta | None = None) -> None:
    now = datetime.now(timezone.utc)
    values = {"created_at": now - created_ago}
    if expires_in is not None:
        values["expires_at"] = now + expires_in
    await db_session.execute(update(AuthSession).where(AuthSession.user_id == user_id).values(**values))
    await db_session.commit()


def _session_cookie_header(response: httpx.Response) -> str:
    [cookie] = [c for c in response.headers.get_list("set-cookie") if c.startswith("ivy_admin_session=")]
    return cookie.lower()


def _use_clock(app, start: float = 1_900_000_000.0) -> Clock:
    clock = Clock(start)
    app.state.rate_limiter = RateLimiter(app.state.engine, app.state.settings.session_secret, clock=clock)
    return clock


@pytest.fixture(autouse=True)
def _frozen_rate_limit_clock(request):
    """這個檔案的測試都在數帳號額度（錯 10 次鎖定、併發搶額度）。限流是固定窗口
    加權近似，一批請求剛好跨過 5 分鐘窗口交界時前一窗的次數會被打折、多放行一次
    （main CI run 36654096211 的 test_queued_burst_cannot_outrun_the_lock 驗了 11
    次）。用到 app 的測試一律先換成凍結時鐘；要推進時間的測試自己再呼叫 _use_clock。"""
    if "app" in request.fixturenames:
        _use_clock(request.getfixturevalue("app"))


def _count_bcrypt(monkeypatch) -> list[int]:
    """記下每次 bcrypt 是在哪個執行緒跑的（事件迴圈執行緒 vs worker）。"""
    calls: list[int] = []
    real_verify = service._pwd_context.verify
    real_hash = service._pwd_context.hash

    def verify(*args, **kwargs):
        calls.append(threading.get_ident())
        return real_verify(*args, **kwargs)

    def hash_(*args, **kwargs):
        calls.append(threading.get_ident())
        return real_hash(*args, **kwargs)

    monkeypatch.setattr(service._pwd_context, "verify", verify)
    monkeypatch.setattr(service._pwd_context, "hash", hash_)
    return calls


# ------------------------------------------------------------ 帳號鎖定


async def test_ten_failures_lock_password_login_before_bcrypt(app, db_session, monkeypatch):
    """業主裁定：5 分鐘內錯 10 次，鎖該帳號密碼登入 15 分鐘；鎖定中連正確密碼也
    拒絕，而且在 bcrypt 之前就擋下。"""
    await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    async with _client(app) as client:
        statuses = [(await _login(client, password="wrong-password-xx")).status_code for _ in range(10)]
        assert statuses[:9] == [401] * 9
        assert statuses[9] == 429

        calls = _count_bcrypt(monkeypatch)
        locked = await _login(client)
        assert locked.status_code == 429
        # 帳號鎖跟「來源限流／系統忙碌」分開代碼，後台才不會把後者講成鎖 15 分鐘。
        assert locked.json()["detail"]["code"] == "LOGIN_LOCKED"
        assert int(locked.headers["Retry-After"]) > 0
        assert calls == [], "鎖定期間不該跑 bcrypt"
        assert client.cookies.get("ivy_admin_session") is None


async def test_lock_lasts_fifteen_minutes_then_correct_password_works(app, db_session):
    clock = _use_clock(app)
    await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    async with _client(app) as client:
        for _ in range(10):
            await _login(client, password="wrong-password-xx")
        clock.now += 14 * 60
        assert (await _login(client)).status_code == 429
        clock.now += 60 + 1
        assert (await _login(client)).status_code == 200


async def test_failures_below_threshold_do_not_lock_and_success_resets(app, db_session):
    await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    async with _client(app) as client:
        for _ in range(9):
            assert (await _login(client, password="wrong-password-xx")).status_code == 401
        assert (await _login(client)).status_code == 200
        # 成功登入後計數歸零：再錯 9 次仍然只是 401。
        for _ in range(9):
            assert (await _login(client, password="wrong-password-xx")).status_code == 401


async def test_inactive_account_with_correct_password_is_indistinguishable(app, db_session):
    """原本：帳號桶超限後，停權帳號的正確密碼回 401、錯誤密碼回 429，可以分辨。"""
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    user.is_active = False
    await db_session.commit()
    async with _client(app) as client:
        for _ in range(9):
            assert (await _login(client, password="wrong-password-xx")).status_code == 401
        # 第 10 次失敗（這次密碼其實正確，但帳號停權）一樣開始鎖定。
        assert (await _login(client)).status_code == 429
        assert (await _login(client, password="wrong-password-xx")).status_code == 429
        assert (await _login(client)).status_code == 429


async def test_unknown_email_is_locked_the_same_way(app):
    async with _client(app) as client:
        statuses = [
            (await _login(client, email="nobody@ivy.example", password="wrong-password-xx")).status_code
            for _ in range(11)
        ]
    assert statuses == [401] * 9 + [429, 429]


async def test_lock_does_not_end_existing_sessions(app, admin_client):
    async with _client(app) as attacker:
        for _ in range(10):
            await _login(attacker, email=ADMIN_EMAIL, password="wrong-password-xx")
        assert (await _login(attacker, email=ADMIN_EMAIL, password=ADMIN_PASSWORD)).status_code == 429
    assert (await admin_client.get(f"{API}/auth/me")).status_code == 200


async def test_lock_markers_fail_closed_when_rate_limit_pool_is_exhausted(app):
    """限流專用池拿不到連線時：帳號鎖當作鎖定中、一次性標記當作已用過，
    跟 RateLimiter 的 check／is_limited 一樣擋下，而不是丟 TimeoutError 變成 500。"""
    engine = create_async_engine(
        app.state.settings.active_database_url(), pool_size=1, max_overflow=0, pool_timeout=0.2
    )
    limiter = RateLimiter(engine, "test-only-secret-please-rotate")
    try:
        async with engine.connect() as held:
            await held.execute(text("SELECT 1"))
            with pytest.raises(service.LoginRateLimited) as blocked:
                await service.check_login_lock(limiter, STAFF_EMAIL)
            # 擋下，但講的是「系統忙碌」而不是「帳號鎖定」。
            assert blocked.value.locked is False
            assert await limiter.consume_marker(service.LOGIN_LOCK, "secfix-marker") is False
        # 連線歸還後恢復正常：標記第一次放得進去，帳號沒有被鎖。
        assert await limiter.consume_marker(service.LOGIN_LOCK, "secfix-marker") is True
        assert await limiter.consume_marker(service.LOGIN_LOCK, "secfix-marker") is False
        await service.check_login_lock(limiter, STAFF_EMAIL)
    finally:
        await engine.dispose()


# ------------------------------------------------------------ 稽核


async def test_password_login_success_failure_lock_and_logout_are_audited(app, db_session):
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    user_id = user.id
    async with _client(app) as client:
        ok = await _login(client)
        assert ok.status_code == 200
        [success] = await _audits(db_session, "user.login_password")
        assert success.actor_user_id == user_id and success.target_id == str(user_id)

        client.headers["x-csrf-token"] = ok.json()["csrf_token"]
        assert (await client.post(f"{API}/auth/logout")).status_code == 204
        [logout] = await _audits(db_session, "user.logout")
        assert logout.actor_user_id == user_id and logout.target_id == str(user_id)

        for _ in range(10):
            await _login(client, password="wrong-password-xx")
        # 鎖定中的嘗試不再寫稽核（否則任何人都能灌爆稽核表）。
        for _ in range(3):
            assert (await _login(client, password="wrong-password-xx")).status_code == 429

    failed = await _audits(db_session, "user.login_password_failed")
    assert len(failed) == 10
    for entry in failed:
        assert entry.target_type == "user" and entry.target_id == str(user_id)
        # 失敗時送出請求的人不一定是本人，actor 留空。
        assert entry.actor_user_id is None
        dumped = json.dumps(entry.metadata_json, ensure_ascii=False)
        assert STAFF_EMAIL not in dumped and "127.0.0.1" not in dumped and "wrong-password" not in dumped
        assert entry.metadata_json["reason"] == "wrong_password"
    [locked] = await _audits(db_session, "user.login_locked")
    assert locked.target_id == str(user_id)
    assert locked.metadata_json["lock_minutes"] == 15


async def test_failed_login_for_unknown_email_is_not_audited(app, db_session):
    async with _client(app) as client:
        for _ in range(10):
            await _login(client, email="nobody@ivy.example", password="wrong-password-xx")
    assert await _audits(db_session, "user.login_password_failed") == []
    assert await _audits(db_session, "user.login_locked") == []


# ------------------------------------------------------------ bcrypt 不卡事件迴圈


async def test_password_checks_run_off_the_event_loop(app, admin_client, db_session, monkeypatch):
    """原本：authenticate 與建立帳號、重設／變更密碼在事件迴圈上同步跑 bcrypt，
    每次登入整個 API 停住約 250 ms。"""
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    loop_thread = threading.get_ident()
    calls = _count_bcrypt(monkeypatch)

    async with _client(app) as client:
        assert (await _login(client, password="wrong-password-xx")).status_code == 401
        assert (await _login(client, email="nobody@ivy.example")).status_code == 401
        ok = await _login(client)
        assert ok.status_code == 200
        client.headers["x-csrf-token"] = ok.json()["csrf_token"]
        changed = await client.post(
            f"{API}/auth/change-password",
            json={"current_password": STAFF_PASSWORD, "new_password": "brand-new-password-1"},
        )
        assert changed.status_code == 204, changed.text
    created = await admin_client.post(
        f"{API}/admin/users",
        json={"email": "fresh@ivy.example", "password": "fresh-password-123", "role": "super_admin"},
    )
    assert created.status_code == 201, created.text
    reset = await admin_client.post(f"{API}/admin/users/{user.id}/password", json={"password": "reset-password-123"})
    assert reset.status_code == 204, reset.text

    assert len(calls) >= 7
    assert loop_thread not in calls, "bcrypt 不能在事件迴圈的執行緒上跑"


async def test_bcrypt_concurrency_is_bounded(monkeypatch):
    active = 0
    peak = 0
    lock = threading.Lock()

    def slow_hash(password):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.05)
        with lock:
            active -= 1
        return "hashed"

    monkeypatch.setattr(service._pwd_context, "hash", slow_hash)
    results = await asyncio.gather(*(service.hash_password_async("x") for _ in range(12)))
    assert results == ["hashed"] * 12
    assert 1 < peak <= service.BCRYPT_CONCURRENCY


async def test_login_bcrypt_concurrency_is_bounded(app, monkeypatch):
    """登入路徑（名額內還會查鎖、扣額度、查帳號）一樣受同一組名額限制。"""
    active = 0
    peak = 0
    lock = threading.Lock()

    def slow_verify(password, password_hash):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.05)
        with lock:
            active -= 1
        return False

    monkeypatch.setattr(service._pwd_context, "verify", slow_verify)
    async with _client(app) as client:
        responses = await asyncio.gather(
            *(_login(client, email=f"nobody{i}@ivy.example", password="wrong-password-xx") for i in range(12))
        )
    assert [r.status_code for r in responses] == [401] * 12
    assert 1 < peak <= service.BCRYPT_CONCURRENCY


def _gated_verify(monkeypatch) -> tuple[list[str], threading.Event]:
    """bcrypt 卡在 release 之前（在 worker thread 裡等），用來把請求停在「已經進
    名額、正在驗」的狀態。回傳 (每次驗的密碼, release)。"""
    calls: list[str] = []
    release = threading.Event()
    real_verify = service._pwd_context.verify

    def gated(password, password_hash):
        calls.append(password)
        release.wait(timeout=15)
        return real_verify(password, password_hash)

    monkeypatch.setattr(service._pwd_context, "verify", gated)
    return calls, release


async def _until(condition, *, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline, "等候逾時"
        await asyncio.sleep(0.01)


async def test_queued_burst_cannot_outrun_the_lock(app, db_session, monkeypatch):
    """稽核 login-lock-bypass-concurrent-burst：原本只在排隊等 bcrypt 名額之前看
    一次鎖，同一帳號併發 40 組錯誤密碼加 1 組正確密碼，bcrypt 驗了 41 次、正確
    密碼仍回 200。現在名額內重查鎖並原子地扣帳號額度：整批最多驗
    LOGIN_MAX_ATTEMPTS 次，排在後面的正確密碼不驗、回 429。"""
    await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    calls, release = _gated_verify(monkeypatch)
    slots = service._bcrypt_slots._slots()
    try:
        async with _client(app) as client:
            wrong = [
                asyncio.create_task(_login(client, password=f"wrong-password-{i:02d}"))
                for i in range(12)
            ]
            # 4 個在驗、8 個在排隊：全部都已經過了排隊前的鎖檢查（那時還沒鎖）。
            await _until(lambda: len(calls) == service.BCRYPT_CONCURRENCY and slots.waiting == 8)
            correct = asyncio.create_task(_login(client))
            await _until(lambda: slots.waiting == 9)
            release.set()
            wrong_statuses = [(await task).status_code for task in wrong]
            locked = await correct
    finally:
        release.set()

    assert len(calls) == service.LOGIN_MAX_ATTEMPTS, calls
    assert STAFF_PASSWORD not in calls, "上鎖後排隊的請求不該跑 bcrypt"
    # 第 10 次之後的錯誤密碼不驗、直接 429；前面的失敗依完成順序是 401 或 429
    # （同一批還在驗的也算進額度）。
    assert set(wrong_statuses) <= {401, 429} and wrong_statuses.count(429) >= 2, wrong_statuses
    assert locked.status_code == 429
    assert locked.json()["detail"]["code"] == "LOGIN_LOCKED"
    async with _client(app) as client:
        assert (await _login(client)).status_code == 429


async def test_login_waiting_queue_is_bounded(app, monkeypatch):
    """名額用完、排隊也滿了：新的登入直接 429（系統忙碌），不無限排隊。"""
    calls, release = _gated_verify(monkeypatch)
    slots = service._bcrypt_slots._slots()
    capacity = service.BCRYPT_CONCURRENCY + service.BCRYPT_MAX_WAITERS
    try:
        async with _client(app) as client:
            queued = [
                asyncio.create_task(_login(client, email=f"nobody{i}@ivy.example", password="wrong-password-xx"))
                for i in range(capacity)
            ]
            await _until(
                lambda: len(calls) == service.BCRYPT_CONCURRENCY and slots.waiting == service.BCRYPT_MAX_WAITERS
            )
            overflow = await _login(client, email="late@ivy.example", password="wrong-password-xx")
            release.set()
            statuses = [(await task).status_code for task in queued]
    finally:
        release.set()
    assert overflow.status_code == 429
    assert overflow.json()["detail"]["code"] == "LOGIN_RATE_LIMITED"
    assert statuses == [401] * capacity


async def test_login_releases_main_pool_connection_while_verifying(db_session, monkeypatch):
    """稽核 login-burst-starves-main-db-pool：原本查完帳號就握著主連線池的連線去
    排 bcrypt，亂打 email 的登入洪泛就能讓所有需要 DB 的請求逾時（500）。主池
    只有一條連線時，登入正在驗密碼，公開端點仍拿得到連線。"""
    await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    small = create_app(
        _test_settings().model_copy(update={"db_pool_size": 1, "db_max_overflow": 0, "db_pool_timeout_seconds": 1})
    )
    calls, release = _gated_verify(monkeypatch)
    try:
        async with _client(small) as client:
            login = asyncio.create_task(_login(client))
            await _until(lambda: len(calls) == 1)
            public = await client.get(f"{API}/public/booking-config/yihua")
            assert public.status_code == 200, public.text
            release.set()
            assert (await login).status_code == 200
    finally:
        release.set()
        await small.state.engine.dispose()
        await small.state.rate_limit_engine.dispose()


# ------------------------------------------------------------ session 閒置逾時


async def test_session_cookie_is_a_browser_session_cookie(app, db_session):
    await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    async with _client(app) as client:
        response = await _login(client)
    cookie = _session_cookie_header(response)
    assert "max-age" not in cookie and "expires" not in cookie
    assert "httponly" in cookie


async def test_new_session_expires_after_idle_minutes(app, db_session):
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    user_id = user.id
    async with _client(app) as client:
        assert (await _login(client)).status_code == 200
    [session] = await _sessions_of(db_session, user_id)
    idle = timedelta(minutes=app.state.settings.session_idle_minutes)
    assert session.expires_at - session.created_at == idle


async def test_activity_slides_expiry_on_get_and_is_capped_at_twelve_hours(app, db_session):
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    user_id = user.id
    idle = timedelta(minutes=app.state.settings.session_idle_minutes)
    client = await _logged_in_client(app, STAFF_EMAIL, STAFF_PASSWORD)
    try:
        # 登入一小時、離閒置到期只剩一分鐘：一個 GET 就要把到期時間往後推。
        await _age_sessions(db_session, user_id, created_ago=timedelta(hours=1), expires_in=timedelta(minutes=1))
        before = datetime.now(timezone.utc)
        assert (await client.get(f"{API}/auth/me")).status_code == 200
        [session] = await _sessions_of(db_session, user_id)
        assert session.expires_at >= before + idle - timedelta(seconds=5)

        # 剛延長過：下一個請求不再寫 DB（到期時間不變）。
        extended = session.expires_at
        assert (await client.get(f"{API}/auth/me")).status_code == 200
        [session] = await _sessions_of(db_session, user_id)
        assert session.expires_at == extended

        # 絕對上限：離登入滿 12 小時只剩 30 分鐘，延長只能到 created_at + 12h。
        await _age_sessions(
            db_session, user_id, created_ago=timedelta(hours=12) - timedelta(minutes=30), expires_in=timedelta(minutes=1)
        )
        assert (await client.get(f"{API}/auth/me")).status_code == 200
        [session] = await _sessions_of(db_session, user_id)
        assert session.expires_at == session.created_at + service.SESSION_TTL
    finally:
        await client.aclose()


async def test_idle_or_absolute_expiry_logs_out(app, db_session):
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    user_id = user.id
    client = await _logged_in_client(app, STAFF_EMAIL, STAFF_PASSWORD)
    try:
        await _age_sessions(db_session, user_id, created_ago=timedelta(hours=1), expires_in=timedelta(seconds=-1))
        assert (await client.get(f"{API}/auth/me")).status_code == 401
    finally:
        await client.aclose()

    client = await _logged_in_client(app, STAFF_EMAIL, STAFF_PASSWORD)
    try:
        # 就算 expires_at 還沒到，登入超過 12 小時一律失效。
        await _age_sessions(
            db_session, user_id, created_ago=timedelta(hours=12, seconds=1), expires_in=timedelta(minutes=30)
        )
        assert (await client.get(f"{API}/auth/me")).status_code == 401
    finally:
        await client.aclose()


async def test_legacy_twelve_hour_session_is_pulled_back_to_idle_window(app, db_session):
    """上線前發出的 session（expires_at = 建立＋12 小時）第一次使用就改成閒置窗口。"""
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    user_id = user.id
    idle = timedelta(minutes=app.state.settings.session_idle_minutes)
    client = await _logged_in_client(app, STAFF_EMAIL, STAFF_PASSWORD)
    try:
        await _age_sessions(db_session, user_id, created_ago=timedelta(hours=1), expires_in=timedelta(hours=11))
        before = datetime.now(timezone.utc)
        assert (await client.get(f"{API}/auth/me")).status_code == 200
        [session] = await _sessions_of(db_session, user_id)
        assert before + idle - timedelta(seconds=5) <= session.expires_at <= before + idle + timedelta(seconds=5)
    finally:
        await client.aclose()


async def test_session_refresh_skips_instead_of_500_when_main_pool_is_exhausted(db_session):
    """稽核 CQ-1／session-refresh-second-pool-connection：延長 session 時請求已經
    握著主池一條連線，再向同一個池要第二條；拿不到時原本整個請求 500。延長只是
    盡力而為，拿不到就這次不延長。"""
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    user_id = user.id
    small = create_app(
        _test_settings().model_copy(update={"db_pool_size": 1, "db_max_overflow": 0, "db_pool_timeout_seconds": 1})
    )
    try:
        client = await _logged_in_client(small, STAFF_EMAIL, STAFF_PASSWORD)
        try:
            await _age_sessions(db_session, user_id, created_ago=timedelta(hours=1), expires_in=timedelta(minutes=1))
            [before] = await _sessions_of(db_session, user_id)
            expires_before = before.expires_at
            me = await client.get(f"{API}/auth/me")
            assert me.status_code == 200, me.text
            [after] = await _sessions_of(db_session, user_id)
            assert after.expires_at == expires_before, "拿不到第二條連線時這次不延長"
        finally:
            await client.aclose()
    finally:
        await small.state.engine.dispose()
        await small.state.rate_limit_engine.dispose()


async def test_session_refresh_never_commits_pending_route_work(app, db_session):
    """延長到期時間用獨立的短交易：請求本身還沒 commit 的東西不會被一起寫進去。"""
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    user_id = user.id
    client = await _logged_in_client(app, STAFF_EMAIL, STAFF_PASSWORD)
    token = client.cookies.get("ivy_admin_session")
    await client.aclose()
    await _age_sessions(db_session, user_id, created_ago=timedelta(hours=1), expires_in=timedelta(minutes=1))

    async with app.state.session_factory() as db:
        db.add(AuditLogEntry(
            id=uuid.uuid4(), actor_user_id=None, action="test.pending_route_work", target_type="test",
            target_id="x", metadata_json={}, created_at=datetime.now(timezone.utc),
        ))
        await db.flush()
        session = await deps.get_current_session(SimpleNamespace(app=app), db, token)
        assert session.user_id == user_id
        await db.rollback()

    assert await _audits(db_session, "test.pending_route_work") == []
    [stored] = await _sessions_of(db_session, user_id)
    assert stored.expires_at > datetime.now(timezone.utc) + timedelta(minutes=30)


async def test_password_login_revokes_the_session_it_replaces(app, db_session):
    await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    async with _client(app) as client:
        assert (await _login(client)).status_code == 200
        previous = client.cookies.get("ivy_admin_session")
        assert (await _login(client)).status_code == 200
        assert client.cookies.get("ivy_admin_session") != previous
    assert await service.get_session_by_token(db_session, previous) is None


# ------------------------------------------------------------ 重新驗證與管理者處置


async def _admin_id(admin_client) -> str:
    return (await admin_client.get(f"{API}/auth/me")).json()["user"]["id"]


async def test_google_unlink_requires_recent_login_or_current_password(admin_client, db_session):
    admin_id = uuid.UUID(await _admin_id(admin_client))
    user = await db_session.get(User, admin_id)
    user.google_sub = "google-person-123"
    await db_session.commit()
    await _age_sessions(db_session, admin_id, created_ago=timedelta(minutes=11))

    denied = await admin_client.delete(f"{API}/auth/google/link")
    assert denied.status_code == 403
    assert denied.json()["detail"]["code"] == "REAUTH_REQUIRED"
    wrong = await admin_client.request("DELETE", f"{API}/auth/google/link", json={"current_password": "not-my-password"})
    assert wrong.status_code == 403
    assert wrong.json()["detail"]["code"] == "REAUTH_REQUIRED"
    db_session.expire_all()
    assert (await db_session.get(User, admin_id)).google_sub == "google-person-123"
    # 重新驗證打錯也算一次密碼失敗（跟登入共用帳號鎖）。
    [failure] = await _audits(db_session, "user.login_password_failed")
    assert failure.target_id == str(admin_id)

    ok = await admin_client.request("DELETE", f"{API}/auth/google/link", json={"current_password": ADMIN_PASSWORD})
    assert ok.status_code == 204, ok.text
    db_session.expire_all()
    assert (await db_session.get(User, admin_id)).google_sub is None


async def test_reauth_password_is_subject_to_the_account_lock(app, admin_client, db_session):
    admin_id = uuid.UUID(await _admin_id(admin_client))
    user = await db_session.get(User, admin_id)
    user.google_sub = "google-person-123"
    await db_session.commit()
    await _age_sessions(db_session, admin_id, created_ago=timedelta(minutes=11))
    async with _client(app) as attacker:
        for _ in range(10):
            await _login(attacker, email=ADMIN_EMAIL, password="wrong-password-xx")
    locked = await admin_client.request("DELETE", f"{API}/auth/google/link", json={"current_password": ADMIN_PASSWORD})
    assert locked.status_code == 429


async def test_change_password_current_password_counts_toward_lock(app, db_session):
    await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    client = await _logged_in_client(app, STAFF_EMAIL, STAFF_PASSWORD)
    try:
        statuses = [
            (await client.post(
                f"{API}/auth/change-password",
                json={"current_password": "not-my-password", "new_password": "brand-new-password-1"},
            )).status_code
            for _ in range(10)
        ]
        assert statuses == [400] * 9 + [429]
        ok_but_locked = await client.post(
            f"{API}/auth/change-password",
            json={"current_password": STAFF_PASSWORD, "new_password": "brand-new-password-1"},
        )
        assert ok_but_locked.status_code == 429
    finally:
        await client.aclose()
    async with _client(app) as other:
        assert (await _login(other)).status_code == 429


async def test_admin_password_reset_cannot_target_self(admin_client):
    admin_id = await _admin_id(admin_client)
    response = await admin_client.post(f"{API}/admin/users/{admin_id}/password", json={"password": "self-reset-pw-123"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "USE_CHANGE_PASSWORD"
    assert (await admin_client.get(f"{API}/auth/me")).status_code == 200


async def test_deactivation_clears_external_logins(admin_client, db_session):
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    user_id = user.id
    user.line_sub = "U" + "a" * 32
    user.google_sub = "google-person-123"
    await db_session.commit()

    off = await admin_client.patch(f"{API}/admin/users/{user_id}/active", json={"is_active": False})
    assert off.status_code == 200, off.text
    assert off.json()["line_linked"] is False and off.json()["google_linked"] is False
    db_session.expire_all()
    stored = await db_session.get(User, user_id)
    assert stored.line_sub is None and stored.google_sub is None

    on = await admin_client.patch(f"{API}/admin/users/{user_id}/active", json={"is_active": True})
    assert on.status_code == 200
    entries = await _audits(db_session, "user.set_active")
    assert [e.metadata_json for e in entries] == [
        {"is_active": False, "line_unlinked": True, "google_unlinked": True},
        {"is_active": True},
    ]
    assert "U" + "a" * 32 not in json.dumps([e.metadata_json for e in entries])


async def test_super_admin_can_clear_someone_elses_external_logins(app, admin_client, minghua_client, db_session):
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    user_id = user.id
    user.line_sub = "U" + "b" * 32
    await db_session.commit()
    victim = await _logged_in_client(app, STAFF_EMAIL, STAFF_PASSWORD)
    path = f"{API}/admin/users/{user_id}/clear-external-logins"
    try:
        assert (await minghua_client.post(path)).status_code == 403
        assert (await admin_client.post(f"{API}/admin/users/{uuid.uuid4()}/clear-external-logins")).status_code == 404
        cleared = await admin_client.post(path)
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["line_linked"] is False and cleared.json()["google_linked"] is False
        assert (await victim.get(f"{API}/auth/me")).status_code == 401
    finally:
        await victim.aclose()
    db_session.expire_all()
    stored = await db_session.get(User, user_id)
    assert stored.line_sub is None and stored.google_sub is None and stored.is_active
    [entry] = await _audits(db_session, "user.clear_external_logins")
    assert entry.target_id == str(user_id)
    assert entry.metadata_json == {"line_unlinked": True, "google_unlinked": False, "revoked_sessions": 1}

    own = await admin_client.post(f"{API}/admin/users/{await _admin_id(admin_client)}/clear-external-logins")
    assert own.status_code == 409
    assert own.json()["detail"]["code"] == "USE_ACCOUNT_PAGE"


# ------------------------------------------------------------ 密碼長度


async def test_overlong_login_password_is_422_not_500(app, db_session):
    await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    async with _client(app) as client:
        assert (await _login(client, password="a" * 129)).status_code == 422
        assert (await _login(client, password="a" * 5000)).status_code == 422
        assert (await _login(client, password="a" * 128)).status_code == 401


@pytest.mark.parametrize(
    ("password", "status"),
    [
        ("密" * 24, 201),  # 剛好 72 bytes
        ("密" * 25, 422),  # 75 bytes：bcrypt 會默默截掉後面
        ("a" * 72, 201),
        ("a" * 73, 422),
        ("a" * 129, 422),
    ],
    ids=["cjk-72-bytes", "cjk-75-bytes", "ascii-72", "ascii-73", "ascii-129"],
)
async def test_new_password_must_fit_in_bcrypt(admin_client, password, status):
    response = await admin_client.post(
        f"{API}/admin/users",
        json={"email": f"len{len(password.encode())}@ivy.example", "password": password, "role": "super_admin"},
    )
    assert response.status_code == status, response.text
    if status == 422 and len(password) <= 128:
        assert "72" in json.dumps(response.json(), ensure_ascii=False)


async def test_reset_and_change_reject_passwords_bcrypt_would_truncate(app, admin_client, db_session):
    user = await _create_user(db_session, STAFF_EMAIL, STAFF_PASSWORD, Role.CAMPUS_ADMIN, ["yihua"])
    too_long = "密" * 25
    reset = await admin_client.post(f"{API}/admin/users/{user.id}/password", json={"password": too_long})
    assert reset.status_code == 422
    client = await _logged_in_client(app, STAFF_EMAIL, STAFF_PASSWORD)
    try:
        changed = await client.post(
            f"{API}/auth/change-password", json={"current_password": STAFF_PASSWORD, "new_password": too_long}
        )
        assert changed.status_code == 422
        overlong_current = await client.post(
            f"{API}/auth/change-password", json={"current_password": "a" * 129, "new_password": "brand-new-password-1"}
        )
        assert overlong_current.status_code == 422
    finally:
        await client.aclose()
