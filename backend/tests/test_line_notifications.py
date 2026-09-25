"""LINE 群組推播：webhook 記錄群組、後台指定各校群組、outbox 推播。

LINE API 全部用 httpx.MockTransport 模擬，不連真的 LINE、不發真的訊息。"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.main import create_app
from app.notifications.line import LineMessagingClient, retry_key, verify_signature
from app.notifications.models import LineGroup, NotificationDelivery
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client, _test_settings, parent_client, publish_booking_consent
from tests.test_maintenance import _expired_hold

SECRET = "line-channel-secret-for-tests"
TOKEN = "line-access-token-for-tests"
GROUP = "C" + "a" * 32
OTHER_GROUP = "C" + "b" * 32
ROOM = "R" + "c" * 32


class FakeLine:
    """模擬 LINE API：記錄推播，可指定下一次推播的狀態碼。"""

    def __init__(self) -> None:
        self.pushes: list[dict] = []
        self.push_status: list[int] = []
        self.group_names = {GROUP: "義華校務群", OTHER_GROUP: "總部"}

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        if request.url.path == "/v2/bot/message/push":
            status = self.push_status.pop(0) if self.push_status else 200
            if status == 200:
                self.pushes.append({"body": json.loads(request.content), "retry_key": request.headers.get("x-line-retry-key")})
                return httpx.Response(200, json={})
            if status == 409:
                return httpx.Response(409, headers={"x-line-accepted-request-id": "abc"}, json={})
            return httpx.Response(status, json={"message": "error"})
        if request.url.path.startswith("/v2/bot/group/") and request.url.path.endswith("/summary"):
            group_id = request.url.path.split("/")[4]
            if group_id in self.group_names:
                return httpx.Response(200, json={"groupId": group_id, "groupName": self.group_names[group_id]})
            return httpx.Response(404, json={})
        return httpx.Response(404, json={})

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


@pytest.fixture
def fake_line() -> FakeLine:
    return FakeLine()


@pytest.fixture
async def line_app(fake_line):
    settings = _test_settings().model_copy(
        update={
            "line_messaging_channel_secret": SECRET,
            "line_messaging_access_token": TOKEN,
            "admin_origin": "https://ivy.example",
        }
    )
    app = create_app(settings)
    app.state.line_transport = fake_line.transport()
    yield app
    await app.state.engine.dispose()


def _sign(body: bytes) -> str:
    return base64.b64encode(hmac.new(SECRET.encode(), body, hashlib.sha256).digest()).decode()


async def _webhook(app, events: list[dict], *, signature: str | None = "auto") -> httpx.Response:
    body = json.dumps({"destination": "U" + "0" * 32, "events": events}).encode()
    headers = {"content-type": "application/json"}
    if signature == "auto":
        headers["x-line-signature"] = _sign(body)
    elif signature is not None:
        headers["x-line-signature"] = signature
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return await client.post("/api/website/v1/line/webhook", content=body, headers=headers)


def _event(kind: str, target: str = GROUP, **extra) -> dict:
    source = {"type": "group", "groupId": target} if target.startswith("C") else {"type": "room", "roomId": target}
    return {"type": kind, "source": source, "timestamp": 0, "webhookEventId": uuid.uuid4().hex, **extra}


async def _super_admin(app) -> httpx.AsyncClient:
    async with app.state.session_factory() as db:
        from app.auth.models import Role

        await _create_user(db, "line-admin@ivy.example", "line-admin-password-123", Role.SUPER_ADMIN)
    return await _logged_in_client(app, "line-admin@ivy.example", "line-admin-password-123")


# --- 簽章 ---------------------------------------------------------------------


def test_signature_verification():
    body = b'{"events":[]}'
    assert verify_signature(SECRET, body, _sign(body))
    assert not verify_signature(SECRET, body, _sign(b'{"events":[1]}'))
    assert not verify_signature(SECRET, body, None)
    assert not verify_signature("other-secret", body, _sign(body))


def test_retry_key_is_stable_per_message_and_group():
    message_id = uuid.uuid4()
    assert retry_key(message_id, GROUP) == retry_key(message_id, GROUP)
    assert retry_key(message_id, GROUP) != retry_key(message_id, OTHER_GROUP)
    assert retry_key(message_id, GROUP) != retry_key(uuid.uuid4(), GROUP)


# --- webhook -----------------------------------------------------------------


async def test_webhook_rejects_bad_or_missing_signature(line_app):
    assert (await _webhook(line_app, [_event("join")], signature=None)).status_code == 401
    assert (await _webhook(line_app, [_event("join")], signature="bm90LXZhbGlk")).status_code == 401
    async with line_app.state.session_factory() as db:
        assert (await db.execute(select(LineGroup))).scalars().all() == []


async def test_webhook_is_off_when_line_is_not_configured(app):
    assert (await _webhook(app, [_event("join")])).status_code == 404


async def test_console_verify_request_with_no_events_succeeds(line_app):
    assert (await _webhook(line_app, [])).status_code == 200


async def test_join_leave_rejoin_and_names(line_app):
    assert (await _webhook(line_app, [_event("join"), _event("join", ROOM)])).status_code == 200
    async with line_app.state.session_factory() as db:
        groups = {g.target_id: g for g in (await db.execute(select(LineGroup))).scalars()}
    assert groups[GROUP].name == "義華校務群"
    assert groups[GROUP].source_type == "group"
    assert groups[ROOM].source_type == "room" and groups[ROOM].name is None
    assert groups[GROUP].left_at is None

    await _webhook(line_app, [_event("leave")])
    async with line_app.state.session_factory() as db:
        assert (await db.get(LineGroup, GROUP)).left_at is not None

    await _webhook(line_app, [_event("join")])
    async with line_app.state.session_factory() as db:
        assert (await db.get(LineGroup, GROUP)).left_at is None


async def test_message_in_group_records_group_but_never_stores_text(line_app):
    secret_text = "家長電話 0912345678"
    await _webhook(line_app, [_event("message", message={"type": "text", "id": "1", "text": secret_text})])
    async with line_app.state.session_factory() as db:
        group = await db.get(LineGroup, GROUP)
        assert group is not None
        dump = json.dumps({c.name: str(getattr(group, c.name)) for c in LineGroup.__table__.columns})
    assert secret_text not in dump


async def test_webhook_ignores_one_to_one_chats_and_malformed_ids(line_app):
    events = [
        {"type": "follow", "source": {"type": "user", "userId": "U" + "1" * 32}},
        _event("join", "C-not-a-real-id"),
        {"type": "join"},
        "garbage",
    ]
    assert (await _webhook(line_app, events)).status_code == 200
    async with line_app.state.session_factory() as db:
        assert (await db.execute(select(LineGroup))).scalars().all() == []


# --- 後台設定 -----------------------------------------------------------------


async def test_admin_settings_require_super_admin(line_app):
    async with line_app.state.session_factory() as db:
        from app.auth.models import Role

        await _create_user(db, "mh@ivy.example", "minghua-admin-password-123", Role.CAMPUS_ADMIN, ["minghua"])
    client = await _logged_in_client(line_app, "mh@ivy.example", "minghua-admin-password-123")
    try:
        assert (await client.get("/api/website/v1/admin/line")).status_code == 403
        put = await client.put("/api/website/v1/admin/line/campus-targets/minghua", json={"target_id": None})
        assert put.status_code == 403
    finally:
        await client.aclose()


async def test_assign_group_to_campus_and_clear(line_app):
    await _webhook(line_app, [_event("join")])
    client = await _super_admin(line_app)
    try:
        body = (await client.get("/api/website/v1/admin/line")).json()
        assert body["enabled"] is True
        assert body["webhook_url"] == "https://ivy.example/api/website/v1/line/webhook"
        assert [g["target_id"] for g in body["groups"]] == [GROUP]
        assert {t["campus_key"] for t in body["targets"]} == {"yihua", "minghua", "chongde", "international", "renwu"}

        resp = await client.put("/api/website/v1/admin/line/campus-targets/yihua", json={"target_id": GROUP})
        assert resp.status_code == 200, resp.text
        targets = {t["campus_key"]: t["target_id"] for t in resp.json()["targets"]}
        assert targets["yihua"] == GROUP and targets["minghua"] is None

        cleared = await client.put("/api/website/v1/admin/line/campus-targets/yihua", json={"target_id": None})
        assert {t["campus_key"]: t["target_id"] for t in cleared.json()["targets"]}["yihua"] is None
    finally:
        await client.aclose()

    async with line_app.state.session_factory() as db:
        actions = (await db.execute(select(AuditLogEntry.action))).scalars().all()
    assert actions.count("line.campus_target.update") == 2


async def test_cannot_assign_unknown_or_left_group(line_app):
    await _webhook(line_app, [_event("join"), _event("leave")])
    client = await _super_admin(line_app)
    try:
        for target in (GROUP, OTHER_GROUP):
            resp = await client.put("/api/website/v1/admin/line/campus-targets/yihua", json={"target_id": target})
            assert resp.status_code == 409
            assert resp.json()["detail"]["code"] == "LINE_GROUP_UNAVAILABLE"
        missing = await client.put("/api/website/v1/admin/line/campus-targets/nowhere", json={"target_id": None})
        assert missing.status_code == 404
    finally:
        await client.aclose()


async def test_test_push_sends_to_assigned_group(line_app, fake_line):
    await _webhook(line_app, [_event("join")])
    client = await _super_admin(line_app)
    try:
        missing = await client.post("/api/website/v1/admin/line/campus-targets/yihua/test")
        assert missing.json()["detail"]["code"] == "LINE_TARGET_MISSING"

        await client.put("/api/website/v1/admin/line/campus-targets/yihua", json={"target_id": GROUP})
        resp = await client.post("/api/website/v1/admin/line/campus-targets/yihua/test")
        assert resp.status_code == 204, resp.text
        assert fake_line.pushes[-1]["body"]["to"] == GROUP
        assert "義華" in fake_line.pushes[-1]["body"]["messages"][0]["text"]

        fake_line.push_status = [500]
        failed = await client.post("/api/website/v1/admin/line/campus-targets/yihua/test")
        assert failed.status_code == 502
        assert failed.json()["detail"]["code"] == "LINE_PUSH_FAILED"
    finally:
        await client.aclose()


async def test_test_push_is_rate_limited(line_app):
    await _webhook(line_app, [_event("join")])
    client = await _super_admin(line_app)
    try:
        await client.put("/api/website/v1/admin/line/campus-targets/yihua", json={"target_id": GROUP})
        codes = [(await client.post("/api/website/v1/admin/line/campus-targets/yihua/test")).status_code for _ in range(6)]
        assert codes[:5] == [204] * 5
        assert codes[5] == 429
    finally:
        await client.aclose()


# --- outbox 推播 ---------------------------------------------------------------


async def _setup_case(line_app, *, assign: bool = True) -> tuple[httpx.AsyncClient, httpx.AsyncClient]:
    """建立一筆義華的案件（會產生 outbox），並依需要把義華指到 GROUP。"""
    await _webhook(line_app, [_event("join")])
    admin = await _super_admin(line_app)
    if assign:
        await admin.put("/api/website/v1/admin/line/campus-targets/yihua", json={"target_id": GROUP})
    # 開 slots 與官網送單都要有已發布的同意文字。
    async with line_app.state.session_factory() as db:
        await publish_booking_consent(db)
    public = parent_client(line_app)
    return admin, public


async def _run_outbox(line_app, fake_line, adapter=None) -> dict:
    from app.workers.runner import process_outbox_batch

    async with line_app.state.session_factory() as db:
        line = LineMessagingClient(TOKEN, transport=fake_line.transport())
        try:
            return await process_outbox_batch(db, adapter, limit=50, line=line, admin_origin="https://ivy.example")
        finally:
            await line.aclose()


async def test_outbox_pushes_to_campus_group_once(line_app, fake_line):
    admin, public = await _setup_case(line_app)
    try:
        async with line_app.state.session_factory() as db:
            receipt_id = await _expired_hold(admin, public, db, "line-case")
        result = await _run_outbox(line_app, fake_line)
    finally:
        await admin.aclose()
        await public.aclose()

    assert result["failed"] == 0
    assert len(fake_line.pushes) == result["sent"] >= 1
    push = fake_line.pushes[0]
    text = push["body"]["messages"][0]["text"]
    assert push["body"]["to"] == GROUP
    assert "義華" in text and receipt_id in text
    assert f"https://ivy.example/admin/visit-requests/{receipt_id}" in text
    assert "陳媽媽" not in text and "0912345678" not in text, "群組推播不能帶家長個資"
    assert push["retry_key"]

    # 再跑一次不會重送。
    before = len(fake_line.pushes)
    await _run_outbox(line_app, fake_line)
    assert len(fake_line.pushes) == before


async def test_outbox_retries_failed_push_with_same_retry_key(line_app, fake_line):
    admin, public = await _setup_case(line_app)
    try:
        async with line_app.state.session_factory() as db:
            await _expired_hold(admin, public, db, "line-retry")
        fake_line.push_status = [500]
        first = await _run_outbox(line_app, fake_line)
        assert first["failed"] == 1

        async with line_app.state.session_factory() as db:
            from sqlalchemy import update

            from app.booking.models import OutboxMessage

            await db.execute(update(OutboxMessage).values(next_attempt_at=OutboxMessage.created_at))
            await db.commit()
        # LINE 回 409＋accepted request id：先前那次其實已被接受，視為成功、不重複記錄。
        fake_line.push_status = [409]
        second = await _run_outbox(line_app, fake_line)
        assert second["failed"] == 0
    finally:
        await admin.aclose()
        await public.aclose()

    async with line_app.state.session_factory() as db:
        deliveries = (
            await db.execute(select(NotificationDelivery).where(NotificationDelivery.channel == "line"))
        ).scalars().all()
    assert {d.recipient_key for d in deliveries} == {GROUP}


async def test_outbox_skips_line_when_campus_has_no_group(line_app, fake_line):
    admin, public = await _setup_case(line_app, assign=False)
    try:
        async with line_app.state.session_factory() as db:
            await _expired_hold(admin, public, db, "line-none")
        result = await _run_outbox(line_app, fake_line)
    finally:
        await admin.aclose()
        await public.aclose()
    assert result["failed"] == 0 and result["sent"] >= 1
    assert fake_line.pushes == []


async def test_outbox_skips_group_the_bot_has_left(line_app, fake_line):
    admin, public = await _setup_case(line_app)
    try:
        await _webhook(line_app, [_event("leave")])
        async with line_app.state.session_factory() as db:
            await _expired_hold(admin, public, db, "line-left")
        result = await _run_outbox(line_app, fake_line)
    finally:
        await admin.aclose()
        await public.aclose()
    assert result["failed"] == 0
    assert fake_line.pushes == []


def test_line_settings_must_be_set_together():
    from app.config import Settings

    base = {"database_url": "postgresql+asyncpg://localhost/ivy_website_dev", "session_secret": "x" * 20}
    with pytest.raises(ValueError):
        Settings(**base, line_messaging_channel_secret=SECRET)
    with pytest.raises(ValueError):
        Settings(**base, line_messaging_access_token=TOKEN)
    assert Settings(**base, line_messaging_channel_secret=SECRET, line_messaging_access_token=TOKEN).line_messaging_enabled
    assert not Settings(**base).line_messaging_enabled
    assert SECRET not in repr(Settings(**base, line_messaging_channel_secret=SECRET, line_messaging_access_token=TOKEN))


async def test_maintenance_cycle_pushes_when_line_is_configured(line_app, fake_line):
    from app.workers.maintenance import run_cycle

    admin, public = await _setup_case(line_app)
    try:
        async with line_app.state.session_factory() as db:
            await _expired_hold(admin, public, db, "line-cycle")
    finally:
        await admin.aclose()
        await public.aclose()
    settings = line_app.state.settings.model_copy(update={"notification_email_sink_dir": None})
    result = await run_cycle(
        line_app.state.session_factory, settings, worker_id="t", line_transport=fake_line.transport()
    )
    assert result.line_configured and not result.email_configured
    assert result.failed_steps == []
    assert [p["body"]["to"] for p in fake_line.pushes] == [GROUP] * len(fake_line.pushes) and fake_line.pushes


async def test_same_group_twice_in_one_webhook(line_app):
    """LINE 會把多個事件放在同一個 webhook；同一個群組先 join 再發話不能重複插入。"""
    response = await _webhook(line_app, [_event("join"), _event("message", message={"type": "text", "text": "hi"})])
    assert response.status_code == 200
    async with line_app.state.session_factory() as db:
        assert len((await db.execute(select(LineGroup))).scalars().all()) == 1
