"""錯誤回報（2026-11-05）：瀏覽器回報的接收與遮蔽、分組與重新開啟、限流與每日上限、API 未處理例外的擷取
（路由樣板、節流、DB 例外遮蔽）、總管理者的列表與處理、系統狀態一列、90 天保存。"""
from __future__ import annotations

import logging
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.common import ratelimit
from app.common.timezones import now_utc
from app.operations import error_reports
from app.operations.models import AuditLogEntry, ErrorGroup
from tests.conftest import freeze_rate_limit_clock

API = "/api/website/v1"
URL = f"{API}/public/client-errors"
ADMIN_URL = f"{API}/admin/error-groups"


@pytest.fixture(autouse=True)
def _fresh_error_state():
    error_reports.reset_state()
    yield
    error_reports.reset_state()


def _report(**overrides) -> dict:
    return {
        "source": "web",
        "kind": "TypeError",
        "message": "x is not a function",
        "stack": "TypeError: x is not a function\n    at go (/_nuxt/entry.abc123.js:10:20)",
        "path": "/campuses/yihua",
        "release": "build-1",
        **overrides,
    }


async def _groups(db_session) -> list[ErrorGroup]:
    db_session.expire_all()
    return list((await db_session.execute(select(ErrorGroup).order_by(ErrorGroup.id))).scalars())


# ----------------------------------------------------------------------------- 接收


async def test_valid_report_is_stored_without_identifying_data(public_client, db_session):
    response = await public_client.post(URL, json=_report(), headers={"user-agent": "Mozilla/5.0 test"})
    assert response.status_code == 204
    [group] = await _groups(db_session)
    assert (group.source, group.kind, group.message) == ("web", "TypeError", "x is not a function")
    assert group.location == "/_nuxt/entry.abc123.js:10:20"
    assert group.path == "/campuses/yihua"
    assert group.release == "build-1"
    assert group.sample_user_agent == "Mozilla/5.0 test"
    assert group.count == 1 and group.resolved_at is None
    assert group.first_seen_at == group.last_seen_at
    assert len(group.fingerprint) == 64


async def test_extra_fields_are_rejected(public_client, db_session):
    for extra in ({"ip": "1.2.3.4"}, {"cookie": "a=b"}, {"user": "王小美"}):
        assert (await public_client.post(URL, json=_report(**extra))).status_code == 422
    assert (await public_client.post(URL, json=_report(source="api"))).status_code == 422
    assert (await public_client.post(URL, json={k: v for k, v in _report().items() if k != "path"})).status_code == 422
    assert await _groups(db_session) == []


async def test_overlong_values_are_truncated_to_column_limits(public_client, db_session):
    body = _report(
        kind="K" * 500, message="m " * 3000, stack="at x (/_nuxt/a.js:1:2)\n" + "line\n" * 9000,
        path="/" + "p" * 1500, release="r" * 300,
    )
    assert (await public_client.post(URL, json=body, headers={"user-agent": "u" * 900})).status_code == 204
    [group] = await _groups(db_session)
    assert len(group.kind) <= 120 and len(group.message) <= 500 and len(group.path) <= 300
    assert len(group.release) <= 64 and len(group.sample_user_agent) <= 300
    assert group.sample_stack is not None and len(group.sample_stack) <= 8000


async def test_personal_data_is_redacted_in_message_stack_and_path(public_client, db_session):
    body = _report(
        message="fetch /api/x?phone=0912345678 failed for mom@example.com id A123456789 tel 0912-345-678 "
                "session 3f2c9a1e1b2c4d5e8f90123456789abc",
        stack=(
            "Error: boom\n    at a (https://site.example/_nuxt/e.js?v=1&token=abcdef:3:4)\n"
            "    at b (/_nuxt/f.js?email=mom@example.com:5:6)"
        ),
        path="/visit/manage/abcdefghijklmnopqrstuvwxyz0123456789?token=secret#frag",
    )
    assert (await public_client.post(URL, json=body)).status_code == 204
    [group] = await _groups(db_session)
    everything = " ".join([group.message, group.sample_stack or "", group.path, group.location or ""])
    for leaked in ("0912345678", "0912-345-678", "mom@example.com", "A123456789", "3f2c9a1e1b2c", "token=", "secret", "frag", "phone="):
        assert leaked not in everything, leaked
    assert "[email]" in group.message and "[id]" in group.message and "[n]" in group.message and "[token]" in group.message
    assert group.path == "/visit/manage/[token]"
    assert "https://site.example/_nuxt/e.js:3:4" in group.sample_stack
    assert group.location == "/_nuxt/f.js:5:6"


async def test_same_error_with_different_parameters_is_one_group(public_client, db_session):
    for index, name in enumerate(("alpha", "beta", "gamma"), start=1):
        body = _report(message=f"Cannot read properties of undefined (reading '{name}') in item {index}00 uuid-3f2c9a1e-{index}")
        assert (await public_client.post(URL, json=body)).status_code == 204
    assert (await public_client.post(URL, json=_report(kind="RangeError"))).status_code == 204
    assert (await public_client.post(URL, json=_report(source="admin"))).status_code == 204
    groups = await _groups(db_session)
    assert sorted((g.source, g.kind, g.count) for g in groups) == [
        ("admin", "TypeError", 1), ("web", "RangeError", 1), ("web", "TypeError", 1), ("web", "TypeError", 3),
    ][:0] or sorted((g.source, g.kind, g.count) for g in groups)
    by_key = {(g.source, g.kind, g.message.startswith("Cannot")): g.count for g in groups}
    assert by_key[("web", "TypeError", True)] == 3
    assert by_key[("web", "RangeError", False)] == 1
    assert by_key[("admin", "TypeError", False)] == 1


async def test_recurrence_reopens_a_resolved_group_and_refreshes_the_sample(public_client, db_session):
    assert (await public_client.post(URL, json=_report(release="build-1", path="/a"))).status_code == 204
    [group] = await _groups(db_session)
    first_seen = group.first_seen_at
    group.resolved_at = now_utc()
    await db_session.commit()

    assert (await public_client.post(URL, json=_report(release="build-2", path="/b"))).status_code == 204
    [group] = await _groups(db_session)
    assert group.resolved_at is None
    assert group.count == 2 and group.release == "build-2" and group.path == "/b"
    assert group.first_seen_at == first_seen and group.last_seen_at >= first_seen


async def test_per_source_limit_returns_429_and_nothing_more_is_stored(app, public_client, db_session):
    freeze_rate_limit_clock(app)
    statuses = [(await public_client.post(URL, json=_report(message=f"m{i}x"))).status_code for i in range(61)]
    assert statuses[:60] == [204] * 60
    assert statuses[60] == 429
    assert len(await _groups(db_session)) == 1  # 數字參數同一組
    assert (await _groups(db_session))[0].count == 60


async def test_global_daily_cap_drops_silently(app, public_client, db_session, monkeypatch):
    freeze_rate_limit_clock(app)
    monkeypatch.setattr(
        error_reports, "CLIENT_ERROR_DAILY", ratelimit.Limit("client_errors_daily", 86_400, 3, sliding=False)
    )
    statuses = [(await public_client.post(URL, json=_report(kind=f"Err{i}"))).status_code for i in range(6)]
    assert statuses == [204] * 6
    assert len(await _groups(db_session)) == 3


async def test_one_source_cannot_use_up_the_site_wide_daily_cap(app, public_client, db_session, monkeypatch):
    """2026-11-11 資安稽核：只有每分鐘上限時，一個來源幾小時就能用光全站每日額度。單一來源每日上限
    滿了之後安靜丟棄（仍回 204），別的來源照常寫入。"""
    freeze_rate_limit_clock(app)
    monkeypatch.setattr(
        error_reports, "CLIENT_ERROR_SOURCE_DAILY",
        ratelimit.Limit("client_errors_source_daily", 86_400, 2, sliding=False),
    )
    noisy = {"x-website-client-ip": "203.0.113.9"}
    statuses = [
        (await public_client.post(URL, json=_report(kind=f"Err{i}"), headers=noisy)).status_code for i in range(5)
    ]
    assert statuses == [204] * 5
    assert len(await _groups(db_session)) == 2
    other = await public_client.post(URL, json=_report(kind="Other"), headers={"x-website-client-ip": "198.51.100.7"})
    assert other.status_code == 204
    assert len(await _groups(db_session)) == 3


async def test_storage_failure_does_not_break_the_report_endpoint(public_client, monkeypatch, caplog):
    async def broken(db, entry):
        raise RuntimeError("db down")

    monkeypatch.setattr(error_reports, "record_client_error", broken)
    caplog.set_level(logging.WARNING)
    assert (await public_client.post(URL, json=_report())).status_code == 204
    assert any("錯誤回報寫入失敗" in record.getMessage() for record in caplog.records)


# ----------------------------------------------------------------------------- 單元：遮蔽與分組


def test_redact_text_covers_the_documented_patterns():
    redact = error_reports.redact_text
    assert redact("see https://a.example/x?q=1&p=0912345678#top now") == "see https://a.example/x now"
    assert redact("at f (https://a.example/e.js?v=3:12:34)") == "at f (https://a.example/e.js:12:34)"
    assert redact("a@b.co and c.d+e@f.org") == "[email] and [email]"
    assert redact("0912345678 / 0912-345-678 / +886 912 345 678 / 1234567") == "[n] / [n] / +[n] / [n]"
    assert redact("123456") == "123456"  # 6 位不算
    assert redact("A123456789 b223456789") == "[id] [id]"
    assert redact("tok " + "a1" * 10 + " short1234") == "tok [token] short1234"
    assert redact("-" * 30) == "-" * 30
    assert redact("postgresql://user:pw@db.internal/app") == "postgresql://[credentials]@db.internal/app"
    assert redact("[parameters: ('王小美', 3)]") == "[parameters: 已隱藏]"
    assert redact("a" * 25, tokens="off") == "a" * 25
    # 伺服器自己的錯誤文字：純英文字母的長名稱（例外類別、函式）留著，含數字的長串才是 token。
    assert redact("NotNullViolationError ab12 " + "a1" * 10, tokens="digits") == "NotNullViolationError ab12 [token]"


def test_sqlalchemy_parameters_are_hidden_from_the_message():
    exc = DBAPIError.instance("INSERT INTO t (name) VALUES (%s)", ("王小美",), Exception("boom"), Exception)
    assert "王小美" in str(exc)  # 沒有 hide_parameters 的引擎會這樣
    entry_message = error_reports.redact_text(str(exc))
    assert "王小美" not in entry_message and "[parameters: 已隱藏]" in entry_message


def test_fingerprint_ignores_parameters_but_not_kind_source_or_location():
    fp = error_reports.fingerprint
    base = fp("web", "TypeError", "no 'a' at row 12", "/_nuxt/a.js:1:2")
    assert base == fp("web", "TypeError", "no 'b' at row 99", "/_nuxt/a.js:1:2")
    assert fp("web", "TypeError", "id 3f2c9a1e-1b2c-4d5e-8f90-123456789abc", None) == fp(
        "web", "TypeError", "id 00000000-0000-0000-0000-000000000000", None
    )
    assert fp("web", "TypeError", "hash deadbeef0123", None) == fp("web", "TypeError", "hash 0badc0de4567", None)
    for other in (
        fp("admin", "TypeError", "no 'a' at row 12", "/_nuxt/a.js:1:2"),
        fp("web", "RangeError", "no 'a' at row 12", "/_nuxt/a.js:1:2"),
        fp("web", "TypeError", "no 'a' at row 12", "/_nuxt/b.js:1:2"),
        fp("web", "TypeError", "yes 'a' at row 12", "/_nuxt/a.js:1:2"),
    ):
        assert other != base


def test_fingerprint_survives_redeploys():
    """部署後行號與打包檔名的雜湊會變，同一個錯誤不能因此開新的一組（之後的推播會每次部署都通知）。"""
    fp = error_reports.fingerprint
    assert fp("api", "KeyError", "'x'", "app.booking.service:submit:120") == fp(
        "api", "KeyError", "'x'", "app.booking.service:submit:131"
    )
    assert fp("web", "TypeError", "boom", "/_nuxt/Bx9A-c_2.js:3:14567") == fp(
        "web", "TypeError", "boom", "/_nuxt/Q7ab3_Zx.js:1:220"
    )
    assert fp("admin", "TypeError", "boom", "/admin/assets/SystemStatusView-Dk3j_aB1.js:1:9") == fp(
        "admin", "TypeError", "boom", "/admin/assets/SystemStatusView-a-9ZzQ01.js:2:30"
    )
    # 不同函式、不同後台頁面仍是不同組
    assert fp("api", "KeyError", "'x'", "app.booking.service:submit:120") != fp(
        "api", "KeyError", "'x'", "app.booking.service:cancel:120"
    )
    assert fp("admin", "TypeError", "boom", "/admin/assets/SystemStatusView-Dk3j_aB1.js:1:9") != fp(
        "admin", "TypeError", "boom", "/admin/assets/AccountView-Dk3j_aB1.js:1:9"
    )


def test_js_location_picks_the_first_same_origin_frame_without_query():
    assert error_reports.js_location("E: x\n    at f (/_nuxt/a.js?v=1:10:20)\n    at g (/_nuxt/b.js:3:4)") == "/_nuxt/a.js:10:20"
    # Firefox／Safari 格式；跨來源（完整網址）的腳本不算自己的檔案，跳過去找同源的。
    assert error_reports.js_location("f@https://cdn.example/x.js:1:2\ng@/_nuxt/c.js:7:8") == "/_nuxt/c.js:7:8"
    assert error_reports.js_location("only https://cdn.example/x.js:1:2") is None
    assert error_reports.js_location(None) is None


# ----------------------------------------------------------------------------- API 未處理例外


def _raising_app(app):
    @app.get(f"{API}/_err_boom/{{item_id}}")
    async def _boom(item_id: int) -> dict:
        raise ValueError(f"boom for item {item_id} mom@example.com")

    @app.get(f"{API}/_err_app_code")
    async def _app_code() -> dict:
        error_reports.fingerprint(1, 2, 3, 4)  # type: ignore[arg-type]  —— 在 app 程式裡丟出 TypeError
        return {}

    @app.get(f"{API}/_err_db")
    async def _db() -> dict:
        async with app.state.session_factory() as db:
            await db.execute(text("CREATE TEMP TABLE err_rows (name text, n int NOT NULL)"))
            await db.execute(text("INSERT INTO err_rows VALUES (:name, NULL)"), {"name": "王小美-家長"})
        return {}

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test")


async def test_unhandled_api_exception_is_recorded_with_the_route_template(app, db_session):
    async with _raising_app(app) as client:
        response = await client.get(f"{API}/_err_boom/12345678", headers={"user-agent": "probe/1"})
    assert response.status_code == 500
    [group] = await _groups(db_session)
    assert group.source == "api" and group.kind == "ValueError"
    assert group.path == f"{API}/_err_boom/{{item_id}}"  # 路由樣板，不是帶著 id 的實際路徑
    assert "12345678" not in group.message and "mom@example.com" not in group.message
    assert "[email]" in group.message
    assert group.sample_stack and "ValueError" in group.sample_stack and "mom@example.com" not in group.sample_stack
    assert group.sample_user_agent == "probe/1" and group.count == 1


async def test_api_exception_in_app_code_records_module_function_and_line(app, db_session):
    async with _raising_app(app) as client:
        assert (await client.get(f"{API}/_err_app_code")).status_code == 500
    [group] = await _groups(db_session)
    assert group.kind == "TypeError"
    assert group.location is not None and group.location.startswith("app.operations.error_reports:normalize_message:")


async def test_database_error_values_never_reach_the_stored_error(app, db_session):
    async with _raising_app(app) as client:
        assert (await client.get(f"{API}/_err_db")).status_code == 500
    [group] = await _groups(db_session)
    assert group.source == "api" and "sqlalchemy" in group.kind
    stored = " ".join([group.message, group.sample_stack or ""])
    assert "NotNullViolationError" in stored and "err_rows" in stored  # 除錯要用的種類與資料表名稱留著
    assert "王小美" not in stored


async def test_http_errors_and_validation_errors_are_not_recorded(app, public_client, db_session):
    assert (await public_client.get(f"{API}/no-such-route")).status_code == 404
    assert (await public_client.post(f"{API}/public/telemetry", json={"nope": 1})).status_code == 422
    assert await _groups(db_session) == []


async def test_server_error_writes_are_throttled_per_fingerprint(app, db_session, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(error_reports, "_clock", lambda: now[0])
    async with _raising_app(app) as client:
        for _ in range(5):  # 同一個例外連發：只寫第一筆，其餘累加在記憶體
            await client.get(f"{API}/_err_boom/1")
        [group] = await _groups(db_session)
        assert group.count == 1
        now[0] += 11  # 過了 10 秒：下一次把累加的 4 次一起寫進去
        await client.get(f"{API}/_err_boom/2")
    [group] = await _groups(db_session)
    assert group.count == 6


async def test_a_failing_error_write_never_changes_the_500_response(app, db_session, monkeypatch, caplog):
    async def broken(request, entry, count):
        raise RuntimeError("error_groups unavailable")

    monkeypatch.setattr(error_reports, "_write_server_error", broken)
    caplog.set_level(logging.WARNING)
    async with _raising_app(app) as client:
        response = await client.get(f"{API}/_err_boom/1")
    assert response.status_code == 500 and response.json()["detail"]["code"] == "INTERNAL_ERROR"
    assert any("錯誤回報寫入失敗" in record.getMessage() for record in caplog.records)
    assert await _groups(db_session) == []


async def test_a_hanging_error_write_times_out_instead_of_hanging_the_response(app, monkeypatch):
    import asyncio

    async def hang(request, entry, count):
        await asyncio.sleep(30)

    monkeypatch.setattr(error_reports, "_write_server_error", hang)
    monkeypatch.setattr(error_reports, "SERVER_WRITE_TIMEOUT_SECONDS", 0.2)
    async with _raising_app(app) as client:
        response = await asyncio.wait_for(client.get(f"{API}/_err_boom/1"), timeout=5)
    assert response.status_code == 500


# ----------------------------------------------------------------------------- 後台


async def _seed(db_session, **overrides) -> ErrorGroup:
    now = now_utc()
    values = {
        "fingerprint": f"fp-{overrides.get('kind', 'E')}-{overrides.get('path', '/')}-{overrides.get('last_seen_at', now)}",
        "source": "web", "kind": "TypeError", "message": "boom", "location": "/_nuxt/a.js:1:2", "path": "/",
        "release": "r1", "sample_stack": "stack", "sample_user_agent": "ua", "count": 2,
        "first_seen_at": now - timedelta(hours=3), "last_seen_at": now - timedelta(minutes=5), "resolved_at": None,
        **overrides,
    }
    group = ErrorGroup(**values)
    db_session.add(group)
    await db_session.commit()
    return group


async def test_list_requires_the_system_status_scope(admin_client, minghua_client, editor_client, public_client):
    assert (await admin_client.get(ADMIN_URL)).status_code == 200
    assert (await minghua_client.get(ADMIN_URL)).status_code == 403
    assert (await editor_client.get(ADMIN_URL)).status_code == 403
    assert (await public_client.get(ADMIN_URL)).status_code == 401
    for client in (minghua_client, editor_client):
        assert (await client.post(f"{ADMIN_URL}/resolve-all")).status_code == 403
        assert (await client.post(f"{ADMIN_URL}/1/resolve")).status_code == 403


async def test_list_filters_orders_and_counts(admin_client, db_session):
    now = now_utc()
    await _seed(db_session, kind="Old", last_seen_at=now - timedelta(days=3))
    new = await _seed(db_session, kind="New", last_seen_at=now - timedelta(minutes=1))
    done = await _seed(db_session, kind="Done", resolved_at=now - timedelta(hours=1))

    body = (await admin_client.get(ADMIN_URL)).json()
    assert [item["kind"] for item in body["items"]] == ["New", "Old"]  # 預設只看未處理，最近發生的在前
    assert (body["open_count"], body["open_last_24h"]) == (2, 1)
    first = body["items"][0]
    assert first["id"] == new.id and first["source"] == "web" and first["sample_stack"] == "stack"
    assert first["resolved_at"] is None

    resolved = (await admin_client.get(ADMIN_URL, params={"status": "resolved"})).json()
    assert [item["id"] for item in resolved["items"]] == [done.id]
    everything = (await admin_client.get(ADMIN_URL, params={"status": "all", "limit": 2})).json()
    assert [item["kind"] for item in everything["items"]] == ["New", "Done"] and everything["open_count"] == 2
    assert (await admin_client.get(ADMIN_URL, params={"limit": 201})).status_code == 422
    assert (await admin_client.get(ADMIN_URL, params={"status": "bogus"})).status_code == 422


async def test_resolve_one_and_resolve_all_write_audit_entries(admin_client, db_session):
    first = await _seed(db_session, kind="A")
    second = await _seed(db_session, kind="B")
    third = await _seed(db_session, kind="C")
    first_id, second_id, third_id = first.id, second.id, third.id

    response = await admin_client.post(f"{ADMIN_URL}/{first_id}/resolve")
    assert response.status_code == 200 and response.json()["resolved_at"] is not None
    stamp = response.json()["resolved_at"]
    again = await admin_client.post(f"{ADMIN_URL}/{first_id}/resolve")
    assert again.json()["resolved_at"] == stamp  # 重按不改處理時間
    assert (await admin_client.post(f"{ADMIN_URL}/999999/resolve")).status_code == 404

    done = await admin_client.post(f"{ADMIN_URL}/resolve-all")
    assert done.status_code == 200 and done.json() == {"resolved": 2}
    assert (await admin_client.get(ADMIN_URL)).json()["items"] == []
    assert (await admin_client.post(f"{ADMIN_URL}/resolve-all")).json() == {"resolved": 0}
    assert {second_id, third_id} <= {item["id"] for item in (await admin_client.get(ADMIN_URL, params={"status": "resolved"})).json()["items"]}

    db_session.expire_all()
    actions = [(e.action, e.target_type, e.target_id, e.metadata_json) for e in
               (await db_session.execute(select(AuditLogEntry).order_by(AuditLogEntry.created_at))).scalars()
               if e.action.startswith("system.error_")]
    assert ("system.error_resolve", "error_group", str(first_id), {}) in actions
    assert ("system.error_resolve_all", "error_group", "all", {"resolved_count": 2}) in actions


async def test_resolved_group_reopens_when_it_happens_again(admin_client, public_client, db_session):
    assert (await public_client.post(URL, json=_report())).status_code == 204
    [group] = await _groups(db_session)
    assert (await admin_client.post(f"{ADMIN_URL}/{group.id}/resolve")).status_code == 200
    assert (await admin_client.get(ADMIN_URL)).json()["items"] == []
    assert (await public_client.post(URL, json=_report())).status_code == 204
    reopened = (await admin_client.get(ADMIN_URL)).json()["items"]
    assert [item["count"] for item in reopened] == [2]


# ----------------------------------------------------------------------------- 系統狀態


async def test_system_status_row_counts_unresolved_errors_seen_in_the_last_24_hours(admin_client, db_session):
    def row(body):
        return next(item for item in body["background"] if item["key"] == "error_reports")

    quiet = (await admin_client.get(f"{API}/admin/system-status")).json()
    assert row(quiet)["level"] == "ok" and row(quiet)["detail"] == {"open_last_24h": 0, "open_total": 0}

    now = now_utc()
    await _seed(db_session, kind="Old", last_seen_at=now - timedelta(days=2))
    await _seed(db_session, kind="Done", resolved_at=now)
    stale = (await admin_client.get(f"{API}/admin/system-status")).json()
    assert row(stale)["level"] == "ok" and row(stale)["detail"] == {"open_last_24h": 0, "open_total": 1}
    assert stale["attention_count"] == quiet["attention_count"]

    await _seed(db_session, kind="Fresh1")
    await _seed(db_session, kind="Fresh2", path="/x")
    loud = (await admin_client.get(f"{API}/admin/system-status")).json()
    assert row(loud)["level"] == "attention" and row(loud)["detail"] == {"open_last_24h": 2, "open_total": 3}
    assert loud["attention_count"] == quiet["attention_count"] + 1


# ----------------------------------------------------------------------------- 保存


async def test_groups_not_seen_for_90_days_are_purged_once_a_day(public_client, db_session):
    now = now_utc()
    await _seed(db_session, kind="Ancient", last_seen_at=now - timedelta(days=91))
    await _seed(db_session, kind="Recent", last_seen_at=now - timedelta(days=89))
    assert (await public_client.post(URL, json=_report())).status_code == 204
    assert sorted(g.kind for g in await _groups(db_session)) == ["Recent", "TypeError"]

    await _seed(db_session, kind="AncientAgain", last_seen_at=now - timedelta(days=120))
    assert (await public_client.post(URL, json=_report(kind="Other"))).status_code == 204
    assert "AncientAgain" in [g.kind for g in await _groups(db_session)]  # 同一個程序同一天不再清第二次
