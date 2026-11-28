"""再接六個 LINE API 的後端部分（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §2、§3、§5、§6）：
檢查 webhook 連線、已讀＋等待動畫、群組成員與按鈕是誰按的、好友輪廓。

LINE API 全部用 httpx.MockTransport 模擬，不連真的 LINE、不發真的訊息。"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select

from app.common.timezones import today_local
from app.insights import line_insights
from app.notifications import line_group_actions as actions
from app.notifications import line_parent, line_parent_actions, line_tools_routes
from app.notifications.line_group_actions import STATS_MUTE, encode
from app.notifications.models import LineGroup
from app.operations.audit_service import LINE_GROUP_PRIVATE_KEYS, LINE_GROUP_SEARCH_KEYS, visible_metadata
from app.operations.models import AuditLogEntry
from tests.test_line_group_attend import (
    FREE_GROUP, HQ_GROUP, MEMBER, YIHUA_GROUP, _audits, _case, _groups, _ok, _postback, _press,
)
from tests.test_line_integrations_20261116 import (
    MAIN_TOKEN, PARENT, YIHUA_TOKEN, FakeLine, _said, _webhook, fake_line,  # noqa: F401  (fixtures)
)

API = "/api/website/v1"
ADMIN_ORIGIN = "https://admin.ivy.example"
MAIN_HOOK = f"{ADMIN_ORIGIN}/api/website/v1/line/webhook"
YIHUA_HOOK = f"{ADMIN_ORIGIN}/api/website/v1/line/webhook/yihua"
ROOM = "R" + "d" * 32


def _uid(n: int) -> str:
    return "U" + f"{n:032x}"


class ToolsLine(FakeLine):
    """FakeLine 加上這一輪的端點：webhook 設定、已讀、等待動畫、群組成員、好友輪廓。"""

    def __init__(self) -> None:
        super().__init__()
        self.webhook: dict[str, dict | None] = {"main": {"endpoint": MAIN_HOOK, "active": True}, "yihua": None}
        self.endpoint_status: dict[str, int] = {}
        self.test_calls: list[str] = []
        self.test_body: dict = {"success": True, "timestamp": "2026-11-28T00:00:00Z", "statusCode": 200, "reason": "OK", "detail": "200"}
        self.test_status = 200
        self.unreachable = False
        self.loadings: list[dict] = []
        self.reads: list[dict] = []
        self.read_status = 200
        self.loading_status = 202
        self.read_mode = {"main": "auto", "yihua": "manual"}
        self.members: dict[str, str] = {}
        self.count_status = 200
        self.ids_status = 200
        self.name_status = 200
        self.member_paths: list[str] = []
        self.in_flight = 0
        self.max_in_flight = 0
        self.demographics: dict[str, dict] = {}
        self.demographic_status = 200
        self.demographic_calls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        account = self.account(request)
        path = request.url.path
        if path == "/v2/bot/info":
            response = super().handler(request)
            data = response.json()
            data["markAsReadMode"] = self.read_mode[account]
            data["chatMode"] = "chat"
            return httpx.Response(200, json=data)
        if path == "/v2/bot/channel/webhook/endpoint":
            if self.unreachable:
                raise httpx.ConnectError("down")
            if account in self.endpoint_status:
                return httpx.Response(self.endpoint_status[account], json={})
            current = self.webhook.get(account)
            return httpx.Response(200, json=current) if current else httpx.Response(404, json={})
        if path == "/v2/bot/channel/webhook/test":
            self.test_calls.append(account)
            return httpx.Response(self.test_status, json=self.test_body)
        if path == "/v2/bot/chat/loading/start":
            self.loadings.append(json.loads(request.content))
            return httpx.Response(self.loading_status, json={})
        if path == "/v2/bot/chat/markAsRead":
            self.reads.append(json.loads(request.content))
            return httpx.Response(self.read_status, json={})
        if path == "/v2/bot/insight/demographic":
            self.demographic_calls += 1
            if self.demographic_status != 200:
                return httpx.Response(self.demographic_status, json={})
            return httpx.Response(200, json=self.demographics.get(account, {"available": False}))
        parts = path.split("/")
        if len(parts) >= 7 and parts[3] in ("group", "room") and parts[5] in ("member", "members"):
            self.member_paths.append(path)
            return self._members(request, parts)
        return super().handler(request)

    def _members(self, request: httpx.Request, parts: list[str]) -> httpx.Response:
        if parts[5] == "members" and parts[6] == "count":
            if self.count_status != 200:
                return httpx.Response(self.count_status, json={})
            return httpx.Response(200, json={"count": len(self.members)})
        if parts[5] == "members" and parts[6] == "ids":
            if self.ids_status != 200:
                return httpx.Response(self.ids_status, json={})
            ids = list(self.members)
            start = int(request.url.params.get("start", 0))
            page = ids[start : start + 100]
            body: dict = {"memberIds": page}
            if start + 100 < len(ids):
                body["next"] = str(start + 100)
            return httpx.Response(200, json=body)
        if parts[5] == "member":
            if self.name_status != 200:
                return httpx.Response(self.name_status, json={})
            name = self.members.get(parts[6])
            return httpx.Response(200, json={"displayName": name}) if name else httpx.Response(404, json={})
        return httpx.Response(404, json={})

    def transport(self) -> httpx.MockTransport:
        async def handle(request: httpx.Request) -> httpx.Response:
            # 非同步版本：讓同時進行的請求真的重疊，量得出最多同時幾個。
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
            try:
                await asyncio.sleep(0.005)
                return self.handler(request)
            finally:
                self.in_flight -= 1

        return httpx.MockTransport(handle)


@pytest.fixture
def line(app, fake_line) -> ToolsLine:
    fake = ToolsLine()
    fake.friends = fake_line.friends
    app.state.line_transport = fake.transport()
    line_tools_routes.clear_members_cache()
    actions.clear_name_cache()
    line_insights.clear_demographic_cache()
    line_parent.clear_bot_info_cache()
    return fake


# --- §2 檢查 webhook 連線 ---------------------------------------------------------------------------


def _check(client, key: str = "main"):
    return client.post(f"{API}/admin/line/accounts/{key}/webhook-check")


async def test_webhook_check_ok(app, line, admin_client, db_session):
    audits_before = await db_session.scalar(select(func.count()).select_from(AuditLogEntry))
    response = await _check(admin_client)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "account_key": "main",
        "expected_url": MAIN_HOOK,
        "endpoint": MAIN_HOOK,
        "active": True,
        "matches": True,
        "test": {"success": True, "status_code": 200, "reason": "OK"},
        "error_status": None,
    }
    assert line.test_calls == ["main"]
    # 只讀，不寫稽核。
    assert await db_session.scalar(select(func.count()).select_from(AuditLogEntry)) == audits_before


async def test_webhook_check_endpoint_not_filled_skips_the_test(app, line, admin_client):
    body = (await _check(admin_client, "yihua")).json()
    assert body["endpoint"] is None and body["active"] is None and body["matches"] is None
    assert body["test"] is None and body["error_status"] is None
    assert body["expected_url"] == YIHUA_HOOK
    assert line.test_calls == []


async def test_webhook_check_other_url_and_switch_off(app, line, admin_client):
    line.webhook["main"] = {"endpoint": "https://old.example/hook", "active": False}
    body = (await _check(admin_client)).json()
    assert body["matches"] is False and body["active"] is False
    assert body["endpoint"] == "https://old.example/hook"
    assert body["test"]["success"] is True  # 照樣測 LINE 後台填的那個網址


async def test_webhook_check_ignores_trailing_slash_and_missing_origin(app, line, admin_client):
    line.webhook["main"] = {"endpoint": MAIN_HOOK + "/", "active": True}
    assert (await _check(admin_client)).json()["matches"] is True
    app.state.settings.admin_origin = None
    body = (await _check(admin_client)).json()
    assert body["expected_url"] is None and body["matches"] is None and body["endpoint"] == MAIN_HOOK + "/"


async def test_webhook_check_reports_failed_test(app, line, admin_client):
    line.test_body = {"success": False, "timestamp": "x", "statusCode": 500, "reason": "ERROR_STATUS_CODE", "detail": "500"}
    body = (await _check(admin_client)).json()
    assert body["test"] == {"success": False, "status_code": 500, "reason": "ERROR_STATUS_CODE"}
    assert body["error_status"] is None


async def test_webhook_check_line_errors_carry_status(app, line, admin_client):
    line.endpoint_status["main"] = 401
    body = (await _check(admin_client)).json()
    assert body["error_status"] == 401 and body["endpoint"] is None and body["test"] is None

    line.endpoint_status.clear()
    line.test_status = 429  # 測試端點被 LINE 擋（每小時 60 次）：endpoint 已查到，test 為 None
    body = (await _check(admin_client)).json()
    assert body["error_status"] == 429 and body["test"] is None and body["endpoint"] == MAIN_HOOK

    line.unreachable = True
    assert (await _check(admin_client)).json()["error_status"] == 0


async def test_webhook_check_permission_unknown_account_and_rate_limit(app, line, admin_client, minghua_client):
    assert (await _check(minghua_client)).status_code == 403
    assert (await _check(admin_client, "renwu")).status_code == 404  # 沒設金鑰
    assert (await _check(admin_client, "not-an-account")).status_code == 404
    from tests.conftest import freeze_rate_limit_clock

    freeze_rate_limit_clock(app)
    for _ in range(10):
        assert (await _check(admin_client)).status_code == 200
    limited = await _check(admin_client)
    assert limited.status_code == 429 and limited.json()["detail"]["code"] == "RATE_LIMITED"
    assert "retry-after" in limited.headers


# --- §5.1 群組成員 -------------------------------------------------------------------------------------


async def _group(app, target: str = YIHUA_GROUP, source_type: str = "group", left: bool = False) -> None:
    now = datetime.now(timezone.utc)
    async with app.state.session_factory() as db:
        db.add(
            LineGroup(
                target_id=target, source_type=source_type, first_seen_at=now, last_seen_at=now,
                left_at=now if left else None,
            )
        )
        await db.commit()


def _members(client, target: str = YIHUA_GROUP):
    return client.get(f"{API}/admin/line/groups/{target}/members")


async def test_members_lists_count_and_sorted_names_without_user_ids(app, line, admin_client):
    await _group(app)
    line.members = {_uid(1): "王老師", _uid(2): "Amy", _uid(3): "李主任"}
    response = await _members(admin_client)
    assert response.status_code == 200, response.text
    assert response.json() == {"count": 3, "names": sorted(["王老師", "Amy", "李主任"]), "names_unavailable": None, "truncated": False}
    assert _uid(1) not in response.text
    # 用 main 帳號查。
    assert line.member_paths and all(path.startswith(f"/v2/bot/group/{YIHUA_GROUP}/") for path in line.member_paths)


async def test_members_unverified_account_returns_count_only(app, line, admin_client):
    await _group(app)
    line.members = {_uid(1): "王老師"}
    line.ids_status = 403
    body = (await _members(admin_client)).json()
    assert body == {"count": 1, "names": None, "names_unavailable": "unverified", "truncated": False}
    # 403 是帳號等級造成的，會一直是 403：照樣快取，不重複打 LINE。
    calls = len(line.member_paths)
    await _members(admin_client)
    assert len(line.member_paths) == calls


async def test_members_line_error_is_reported_and_not_cached(app, line, admin_client):
    await _group(app)
    line.members = {_uid(1): "王老師"}
    line.ids_status = 500
    body = (await _members(admin_client)).json()
    assert body["names"] is None and body["names_unavailable"] == "error" and body["count"] == 1
    line.ids_status = 200
    again = (await _members(admin_client)).json()
    assert again["names"] == ["王老師"] and again["names_unavailable"] is None


async def test_members_count_failure_still_lists_names_and_is_not_cached(app, line, admin_client):
    await _group(app)
    line.members = {_uid(1): "王老師"}
    line.count_status = 500
    body = (await _members(admin_client)).json()
    assert body["count"] is None and body["names"] == ["王老師"]
    line.count_status = 200
    assert (await _members(admin_client)).json()["count"] == 1


async def test_members_are_cached_for_ten_minutes(app, line, admin_client):
    await _group(app)
    line.members = {_uid(1): "王老師"}
    await _members(admin_client)
    calls = len(line.member_paths)
    line.members[_uid(2)] = "新來的"
    assert (await _members(admin_client)).json()["count"] == 1
    assert len(line.member_paths) == calls
    line_tools_routes.clear_members_cache()
    assert (await _members(admin_client)).json()["count"] == 2


async def test_members_over_two_hundred_is_truncated_and_names_fetched_five_at_a_time(app, line, admin_client):
    await _group(app)
    line.members = {_uid(i): f"成員{i:03d}" for i in range(1, 206)}
    body = (await _members(admin_client)).json()
    assert body["truncated"] is True and len(body["names"]) == 200 and body["count"] == 205
    name_calls = [p for p in line.member_paths if "/member/" in p]
    assert len(name_calls) == 200
    # 名稱請求最多同時 5 個（另外最多同時有一個其他請求）。
    assert line.max_in_flight <= 5


async def test_members_room_uses_room_endpoints(app, line, admin_client):
    await _group(app, ROOM, "room")
    line.members = {_uid(1): "王老師"}
    assert (await _members(admin_client, ROOM)).json()["names"] == ["王老師"]
    assert all(path.startswith(f"/v2/bot/room/{ROOM}/") for path in line.member_paths)


async def test_members_missing_left_unconfigured_and_forbidden(app, line, admin_client, minghua_client):
    assert (await _members(admin_client, FREE_GROUP)).status_code == 404
    await _group(app, left=True)
    assert (await _members(admin_client)).status_code == 404
    await _group(app, HQ_GROUP)
    assert (await _members(minghua_client, HQ_GROUP)).status_code == 403
    app.state.settings.line_messaging_access_token = None
    app.state.settings.line_messaging_channel_secret = None
    unconfigured = await _members(admin_client, HQ_GROUP)
    assert unconfigured.status_code == 409 and unconfigured.json()["detail"]["code"] == "LINE_NOT_CONFIGURED"


# --- §5.2 按鈕是誰按的 ---------------------------------------------------------------------------------


async def test_button_press_records_the_display_name(app, line, admin_client, public_client):
    await _groups(app)
    line.members = {MEMBER: "王老師"}
    receipt = await _case(app, admin_client, public_client)
    await _press(app, _postback(actions.encode(actions.ATTEND_ASK, receipt)))
    assert [p for p in line.member_paths if "/member/" in p] == []  # 只回確認卡、不寫入：不查名稱
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, receipt)))
    [audit] = await _audits(app, "line.group.visit_attend")
    assert audit.metadata_json["line_display_name"] == "王老師" and audit.metadata_json["line_user_id"] == MEMBER
    assert set(audit.metadata_json) <= set(LINE_GROUP_SEARCH_KEYS) | LINE_GROUP_PRIVATE_KEYS
    assert "line_display_name" in LINE_GROUP_SEARCH_KEYS and "line_display_name" not in LINE_GROUP_PRIVATE_KEYS
    # 名字不是私密鍵：沒有 notifications.manage 的人也看得到「按的人」。
    assert visible_metadata(audit.action, audit.metadata_json, show_line_ids=False)["line_display_name"] == "王老師"


async def test_display_name_is_looked_up_once_per_group_and_person(app, line, admin_client, public_client):
    await _groups(app)
    line.members = {MEMBER: "王老師"}
    first = await _case(app, admin_client, public_client, key="a")
    second = await _case(app, admin_client, public_client, key="b")
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, first)))
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, second)))
    assert len([p for p in line.member_paths if "/member/" in p]) == 1
    assert {a.metadata_json["line_display_name"] for a in await _audits(app, "line.group.visit_attend")} == {"王老師"}


async def test_display_name_missing_is_simply_not_recorded(app, line, admin_client, public_client):
    await _groups(app)
    receipt = await _case(app, admin_client, public_client)
    # 不在群組裡（LINE 回 404）：照常寫入，只是不記名字。
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, receipt)))
    [audit] = await _audits(app, "line.group.visit_attend")
    assert "line_display_name" not in audit.metadata_json and audit.metadata_json["line_user_id"] == MEMBER


async def test_display_name_lookup_failure_does_not_block_the_action(app, line, admin_client, public_client):
    await _groups(app)
    line.members = {MEMBER: "王老師"}
    line.name_status = 500
    receipt = await _case(app, admin_client, public_client)
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, receipt)))
    [audit] = await _audits(app, "line.group.visit_attend")
    assert "line_display_name" not in audit.metadata_json
    # 失敗不快取：LINE 好了之後下一次就查得到。
    line.name_status = 200
    other = await _case(app, admin_client, public_client, key="b")
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, other)))
    names = {a.target_id: a.metadata_json.get("line_display_name") for a in await _audits(app, "line.group.visit_attend")}
    assert names[other] == "王老師"


async def test_event_without_user_id_skips_the_lookup(app, line, admin_client, public_client):
    await _groups(app)
    line.members = {MEMBER: "王老師"}
    receipt = await _case(app, admin_client, public_client)
    await _press(app, _postback(_ok(app, actions.ATTEND_OK, receipt), user=None))
    assert line.member_paths == []
    [audit] = await _audits(app, "line.group.visit_attend")
    assert "line_display_name" not in audit.metadata_json and "line_user_id" not in audit.metadata_json


async def test_stats_mute_records_the_display_name(app, line, admin_client):
    await _groups(app)
    line.members = {MEMBER: "王老師"}
    day = (today_local() - timedelta(days=1)).strftime("%Y%m%d")
    await _press(app, _postback(encode(STATS_MUTE, day, "engagement_low"), HQ_GROUP))
    [audit] = await _audits(app, "line.group.stats_health_mute")
    assert audit.metadata_json["line_display_name"] == "王老師" and audit.metadata_json["line_user_id"] == MEMBER


async def test_httpx_log_filter_hides_member_and_user_urls():
    from app.notifications.line import _HideUserIdUrls

    def record(url: str) -> logging.LogRecord:
        return logging.LogRecord("httpx", logging.INFO, "", 0, 'HTTP Request: %s %s "%s"', ("GET", url, "200 OK"), None)

    hide = _HideUserIdUrls()
    assert not hide.filter(record(f"https://api.line.me/v2/bot/group/{YIHUA_GROUP}/member/{_uid(1)}"))
    assert not hide.filter(record(f"https://api.line.me/v2/bot/room/{ROOM}/member/{_uid(1)}"))
    assert not hide.filter(record(f"https://api.line.me/v2/bot/user/{_uid(1)}/richmenu/richmenu-1"))
    assert hide.filter(record(f"https://api.line.me/v2/bot/group/{YIHUA_GROUP}/members/count"))


# --- §3 已讀＋等待動畫 ---------------------------------------------------------------------------------


def _with_token(event: dict, token: str | None = "read-token-1") -> dict:
    if token is not None:
        event["message"]["markAsReadToken"] = token
    return event


def _sticker(user: str = PARENT, token: str | None = "sticker-token") -> dict:
    event = _said("x", user)
    event["message"] = {"type": "sticker", "id": "s", "packageId": "1", "stickerId": "1"}
    return _with_token(event, token)


async def test_my_visits_shows_loading_then_replies_then_marks_read(app, line, admin_client):
    await _webhook(app, [_with_token(_said("我的預約"))])
    assert line.loadings == [{"chatId": PARENT, "loadingSeconds": 5}]
    assert len(line.replies) == 1 and line.replies[0]["account"] == "yihua"
    assert line.reads == [{"markAsReadToken": "read-token-1"}]


async def test_code_message_gets_loading_and_read_even_when_the_code_is_invalid(app, line, admin_client):
    await _webhook(app, [_with_token(_said("LN-AAAAAAAA"))])
    assert line.loadings == [{"chatId": PARENT, "loadingSeconds": 5}]
    assert len(line.replies) == 1 and line.reads == [{"markAsReadToken": "read-token-1"}]


async def test_code_buried_in_a_question_is_processed_but_not_marked_read(app, line, admin_client):
    # 代碼夾在別的文字裡：照樣回覆代碼的結果，但那句話可能還要園方回，不能標已讀，之後的「我的預約」也不能。
    await _webhook(app, [_with_token(_said("我的代碼 LN-AAAAAAAA 沒辦法用，請問怎麼辦？"))])
    assert len(line.replies) == 1 and line.reads == []
    await _webhook(app, [_with_token(_said("我的預約"), "later-token")])
    assert len(line.replies) == 2 and line.reads == []


def test_plain_code_message_is_only_the_code_or_the_prefilled_sentence():
    assert line_parent.is_plain_code_message("LN-AAAAAAAA")
    assert line_parent.is_plain_code_message(" ln-aaaaaaaa \n")
    assert line_parent.is_plain_code_message(line_parent.PREFILL_TEXT.format(code="LN-AAAAAAAA"))
    assert not line_parent.is_plain_code_message("LN-AAAAAAAA 沒辦法用")
    assert not line_parent.is_plain_code_message("LN-AAAAAAAA LN-BBBBBBBB")
    assert not line_parent.is_plain_code_message("我的預約")


async def test_read_needs_manual_mode(app, line, admin_client):
    line.read_mode["yihua"] = "auto"
    await _webhook(app, [_with_token(_said("我的預約"))])
    assert len(line.replies) == 1 and line.reads == []
    assert len(line.loadings) == 1  # 等待動畫不看模式


async def test_read_skipped_when_bot_info_unavailable(app, line, admin_client, monkeypatch):
    async def none(*_a, **_k):
        return None

    monkeypatch.setattr(line_parent, "bot_info", none)
    await _webhook(app, [_with_token(_said("我的預約"))])
    assert len(line.replies) == 1 and line.reads == []


async def test_read_needs_a_valid_token(app, line, admin_client):
    for token in (None, "", "x" * 501):
        await _webhook(app, [_with_token(_said("我的預約"), token)])
    assert line.reads == []
    assert len(line.replies) == 3
    await _webhook(app, [_with_token(_said("我的預約"), "x" * 500)])
    assert len(line.reads) == 1


async def test_unhandled_message_blocks_later_reads_for_that_person_only(app, line, admin_client):
    await _webhook(app, [_with_token(_said("請問學費多少"))])
    assert line.replies == [] and line.loadings == [] and line.reads == []
    await _webhook(app, [_with_token(_said("我的預約"))])
    assert len(line.replies) == 1 and line.reads == []  # 先前那句問題還沒人看過：不能一起標已讀
    # 別人不受影響。
    other = "U" + "5" * 32
    await _webhook(app, [_with_token(_said("我的預約", other), "other-token")])
    assert line.reads == [{"markAsReadToken": "other-token"}]


@pytest.mark.parametrize("make", [lambda: _sticker(), lambda: _with_token(_said("嗨"))])
async def test_any_unhandled_message_type_sets_the_marker(app, line, admin_client, make):
    await _webhook(app, [make()])
    await _webhook(app, [_with_token(_said("我的預約"))])
    assert len(line.replies) == 1 and line.reads == []


async def test_batch_order_decides_which_messages_block_the_read(app, line, admin_client):
    # 先來的未處理訊息擋住後面那則的已讀；後來的不影響前面那則。
    await _webhook(app, [_with_token(_said("我的預約"), "first"), _sticker(), _with_token(_said("我的預約"), "second")])
    assert [r["markAsReadToken"] for r in line.reads] == ["first"]
    assert len(line.replies) == 2


async def test_rate_limited_message_is_neither_replied_nor_marked_as_unhandled(app, line, admin_client):
    from tests.conftest import freeze_rate_limit_clock

    freeze_rate_limit_clock(app)
    await _webhook(app, [_with_token(_said("我的預約"), f"t{i}") for i in range(11)])
    assert len(line.replies) == 10 and len(line.reads) == 10 and len(line.loadings) == 10
    # 第 11 則被限流略過，不算「程式沒處理的訊息」：之後超過一分鐘窗口再來仍可標已讀。
    app.state.rate_limiter._clock = lambda: time.time() + 3600  # 一小時後：計數窗口早已過去，7 天的標記還在
    await _webhook(app, [_with_token(_said("我的預約"), "later")])
    assert line.reads[-1] == {"markAsReadToken": "later"}


async def test_marker_check_failure_means_no_read(app, line, admin_client, monkeypatch):
    from app.common import ratelimit

    async def unavailable(self, *_a, **_k):
        raise ratelimit.RateLimiterUnavailable(5)

    monkeypatch.setattr(ratelimit.RateLimiter, "marker_active", unavailable)
    await _webhook(app, [_with_token(_said("我的預約"))])
    assert len(line.replies) == 1 and line.reads == []


async def test_loading_and_read_failures_do_not_break_the_reply(app, line, admin_client, caplog):
    line.loading_status = 500
    line.read_status = 500
    with caplog.at_level(logging.WARNING, logger="app.line"):
        response = await _webhook(app, [_with_token(_said("我的預約"))])
    assert response.status_code == 200 and len(line.replies) == 1
    assert line.loadings and line.reads  # 都有試過
    assert PARENT not in caplog.text


async def test_button_press_shows_loading(app, line, admin_client):
    await _webhook(app, [{
        "type": "postback", "source": {"type": "user", "userId": PARENT}, "replyToken": uuid.uuid4().hex,
        "timestamp": 0, "webhookEventId": uuid.uuid4().hex,
        "postback": {"data": line_parent_actions.encode(line_parent_actions.CANCEL_KEEP)},
    }])
    assert line.loadings == [{"chatId": PARENT, "loadingSeconds": 5}]
    assert len(line.replies) == 1 and line.reads == []  # 按鈕沒有 markAsReadToken


async def test_groups_and_unrelated_events_get_no_loading_or_read(app, line, admin_client):
    follow = {"type": "follow", "source": {"type": "user", "userId": PARENT}, "replyToken": "r", "timestamp": 0, "webhookEventId": "w"}
    await _webhook(app, [follow])
    group_text = _with_token(_said("我的預約"))
    group_text["source"] = {"type": "group", "groupId": YIHUA_GROUP, "userId": PARENT}
    await _webhook(app, [group_text], account="main")
    assert line.loadings == [] and line.reads == [] and line.replies == []


async def test_main_account_one_to_one_also_marks_when_manual(app, line, admin_client):
    line.read_mode["main"] = "manual"
    await _webhook(app, [_with_token(_said("我的預約"))], account="main")
    assert line.reads == [{"markAsReadToken": "read-token-1"}] and line.replies[0]["account"] == "main"


# --- §6 好友輪廓 ---------------------------------------------------------------------------------------

DEMOGRAPHIC = {
    "available": True,
    "genders": [{"gender": "unknown", "percentage": 0}, {"gender": "female", "percentage": 68.5}, {"gender": "male", "percentage": 31.5}],
    "ages": [
        {"age": "from20to24", "percentage": 10.0},
        {"age": "from30to34", "percentage": 40.0},
        {"age": "from50", "percentage": 12.0},
        {"age": "from50to54", "percentage": 7.0},
        {"age": "from70", "percentage": 5.0},
        {"age": "unknown", "percentage": 0},
    ],
    "areas": [
        {"area": "台北市", "percentage": 5.5},
        {"area": "高雄市", "percentage": 70.0},
        {"area": "unknown", "percentage": 24.5},
        {"area": "屏東縣", "percentage": 0},
    ],
    "appTypes": [{"appType": "ios", "percentage": 60.0}],
    "subscriptionPeriods": [{"subscriptionPeriod": "within7days", "percentage": 12.0}, {"subscriptionPeriod": "over365days", "percentage": 0}],
}


def _demographics(client):
    return client.get(f"{API}/admin/line-insights/demographics")


async def test_demographics_shape_zero_percentages_areas_sorted_and_from50_deduplicated(app, line, admin_client):
    line.demographics["main"] = DEMOGRAPHIC
    response = await _demographics(admin_client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["configured"] is True
    accounts = {a["key"]: a for a in body["accounts"]}
    main = accounts["main"]
    assert main["available"] is True and main["display_name"] == "常春藤官網" and main["error_status"] is None
    assert main["genders"] == [{"key": "female", "percentage": 68.5}, {"key": "male", "percentage": 31.5}]
    # 細分的 from50to54、from70 有值：丟掉舊的 from50 合計，免得重複算；百分比 0 的 unknown 不回。
    assert [a["key"] for a in main["ages"]] == ["from20to24", "from30to34", "from50to54", "from70"]
    assert [a["key"] for a in main["areas"]] == ["高雄市", "unknown", "台北市"]
    assert main["subscription_periods"] == [{"key": "within7days", "percentage": 12.0}]
    # 好友不到 20 位（LINE 回 available: false）：沒有資料。
    assert accounts["yihua"]["available"] is False and accounts["yihua"]["genders"] == [] and accounts["yihua"]["areas"] == []


async def test_demographics_keeps_from50_when_no_finer_age_has_data(app, line, admin_client):
    line.demographics["main"] = {"available": True, "ages": [{"age": "from50", "percentage": 12.0}, {"age": "from50to54", "percentage": 0}]}
    main = next(a for a in (await _demographics(admin_client)).json()["accounts"] if a["key"] == "main")
    assert main["ages"] == [{"key": "from50", "percentage": 12.0}]


async def test_demographics_cached_twelve_hours_and_failures_not_cached(app, line, admin_client):
    line.demographics["main"] = DEMOGRAPHIC
    line.demographic_status = 500
    first = {a["key"]: a for a in (await _demographics(admin_client)).json()["accounts"]}
    assert first["main"]["error_status"] == 500 and first["main"]["available"] is False
    line.demographic_status = 200
    second = {a["key"]: a for a in (await _demographics(admin_client)).json()["accounts"]}
    assert second["main"]["available"] is True and second["main"]["error_status"] is None
    calls = line.demographic_calls
    await _demographics(admin_client)
    assert line.demographic_calls == calls  # 命中快取
    line_insights.clear_demographic_cache()
    await _demographics(admin_client)
    assert line.demographic_calls > calls


async def test_demographics_unreachable_line_reports_zero(app, line, admin_client):
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    app.state.line_transport = httpx.MockTransport(refuse)
    body = (await _demographics(admin_client)).json()
    assert all(a["error_status"] == 0 for a in body["accounts"])


async def test_demographics_permission_and_unconfigured(app, line, admin_client, minghua_client):
    assert (await _demographics(minghua_client)).status_code == 403
    for field in ("line_messaging_access_token", "line_messaging_channel_secret", "line_yihua_access_token", "line_yihua_channel_secret"):
        setattr(app.state.settings, field, None)
    body = (await _demographics(admin_client)).json()
    assert body == {"configured": False, "accounts": []}
