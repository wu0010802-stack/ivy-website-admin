"""圖文選單與「在 LINE 裡預約就綁定」（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §4、§7）。

LINE API 全部用 httpx.MockTransport 模擬，不連真的 LINE。"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from io import BytesIO
from urllib.parse import parse_qs

import httpx
import pytest
from PIL import Image
from sqlalchemy import select

from app.booking.models import OutboxMessage
from app.notifications import line_liff, line_parent, line_rich_menus
from app.notifications.line_parent import LineClients
from app.notifications.models import LineParentLink, LineRichMenu, LineRichMenuUser
from app.operations.models import AuditLogEntry
from app.workers.maintenance import run_cycle
from tests.conftest import _test_settings, book_slot, open_manage
from tests.test_line_integrations_20261116 import (
    API,
    MAIN_SECRET,
    MAIN_TOKEN,
    ORIGIN,
    OTHER_PARENT,
    PARENT,
    YIHUA_SECRET,
    YIHUA_TOKEN,
    FakeLine as BaseFakeLine,
    _enable_parent_line,
    _follow,
    _link,
    _run_outbox,
    _webhook,
)

pytestmark = pytest.mark.usefixtures("booking_consent")

LIFF_ID = "1234567890-AbcdEfgh"
CHANNEL_ID = "1234567890"
PROFILE = {"address": "高雄市三民區範例路 1 號", "phone": "07-300-0000"}


class FakeLine(BaseFakeLine):
    """加上圖文選單、LIFF 驗證端點。"""

    def __init__(self) -> None:
        super().__init__()
        self.menus: dict[str, dict] = {}  # 選單代號 → {"account", "body", "image"}
        self.deleted: list[str] = []
        self.default: dict[str, str | None] = {}  # 帳號 → 預設選單代號
        self.default_cleared: list[str] = []
        self.links: dict[tuple[str, str], str] = {}  # (帳號, userId) → 選單代號
        self.unlinked: list[tuple[str, str]] = []
        self.summaries: dict[str, dict | int] = {}
        self.fail_create_at: int | None = None  # 第幾次建立回 500（從 1 算）
        self.fail_upload = False
        self.creates = 0
        self.id_tokens: dict[str, dict | int] = {}
        self.verify_calls: list[dict] = []
        self.verify_error = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        if path == "/oauth2/v2.1/verify":
            if self.verify_error:
                raise httpx.ConnectError("boom")
            form = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
            self.verify_calls.append(form)
            answer = self.id_tokens.get(form.get("id_token", ""), 400)
            if isinstance(answer, int):
                return httpx.Response(answer, json={"error": "invalid_request", "error_description": "Invalid IdToken."})
            return httpx.Response(200, json=answer)
        account = self.account(request)
        if path == "/v2/bot/richmenu" and method == "POST":
            self.creates += 1
            if self.fail_create_at == self.creates:
                return httpx.Response(500, json={"message": "error"})
            menu_id = f"richmenu-{self.creates:04d}"
            self.menus[menu_id] = {"account": account, "body": json.loads(request.content), "image": None}
            return httpx.Response(200, json={"richMenuId": menu_id})
        if path.startswith("/v2/bot/richmenu/") and path.endswith("/content") and method == "POST":
            assert request.url.host == "api-data.line.me"
            assert request.headers["content-type"] == "image/png"
            if self.fail_upload:
                return httpx.Response(400, json={"message": "bad image"})
            self.menus[path.split("/")[4]]["image"] = request.content
            return httpx.Response(200, json={})
        if path.startswith("/v2/bot/richmenu/") and method == "DELETE":
            menu_id = path.rsplit("/", 1)[1]
            self.deleted.append(menu_id)
            return httpx.Response(200 if self.menus.pop(menu_id, None) else 404, json={})
        if path.startswith("/v2/bot/user/all/richmenu"):
            if method == "DELETE":
                self.default[account] = None
                self.default_cleared.append(account)
                return httpx.Response(200, json={})
            self.default[account] = path.rsplit("/", 1)[1]
            return httpx.Response(200, json={})
        if path.startswith("/v2/bot/user/") and "/richmenu" in path:
            user = path.split("/")[4]
            if method == "DELETE":
                self.links.pop((account, user), None)
                self.unlinked.append((account, user))
                return httpx.Response(200, json={})
            menu_id = path.rsplit("/", 1)[1]
            if menu_id not in self.menus:
                return httpx.Response(404, json={})
            self.links[(account, user)] = menu_id
            return httpx.Response(200, json={})
        if path.startswith("/v2/bot/insight/richmenu/"):
            answer = self.summaries.get(path.split("/")[5], 404)
            return httpx.Response(answer, json={}) if isinstance(answer, int) else httpx.Response(200, json=answer)
        return super().handler(request)


@pytest.fixture
def fake_line(app) -> FakeLine:
    fake = FakeLine()
    settings = app.state.settings
    settings.line_messaging_channel_secret = MAIN_SECRET
    settings.line_messaging_access_token = MAIN_TOKEN
    settings.line_yihua_channel_secret = YIHUA_SECRET
    settings.line_yihua_access_token = YIHUA_TOKEN
    settings.admin_origin = "https://admin.ivy.example"
    settings.public_origin = ORIGIN
    app.state.line_transport = fake.transport()
    line_parent.clear_bot_info_cache()
    line_rich_menus.clear_cache()
    return fake


@pytest.fixture
def campus_profile(monkeypatch) -> dict:
    """已發布的五校介紹：預設每校都有電話與地址；測試可以改這個 dict。"""
    profile = dict(PROFILE)

    async def published(db, kind, key):
        return dict(profile) if kind == "campus_profile" else None

    monkeypatch.setattr(line_rich_menus.content_service, "published_payload", published)
    return profile


def _liff(app, fake: FakeLine, token: str = "liff-token", user: str = PARENT, **claims) -> str:
    app.state.settings.line_liff_id = LIFF_ID
    fake.id_tokens[token] = {"iss": "https://access.line.me", "sub": user, "aud": CHANNEL_ID, "exp": int(time.time()) + 3600, **claims}
    return token


async def _put_menu(admin_client, mode: str | None, account: str = "yihua") -> httpx.Response:
    return await admin_client.put(f"{API}/admin/line/accounts/{account}/rich-menu", json={"mode": mode})


def _account(body: dict, key: str = "yihua") -> dict:
    return next(account for account in body["accounts"] if account["key"] == key)


# --- 選單內容 -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["campus-default.png", "campus-booked.png", "shared-default.png", "shared-booked.png"])
def test_bundled_images_meet_line_requirements(name):
    data = line_rich_menus.image_bytes(name)
    assert len(data) <= 1_000_000
    image = Image.open(BytesIO(data))
    assert image.format == "PNG" and image.size == (line_rich_menus.WIDTH, line_rich_menus.HEIGHT)


async def test_campus_account_menu_has_visit_map_and_phone(app, db_session, fake_line, campus_profile):
    specs = await line_rich_menus.build_specs(db_session, app.state.settings, "yihua")
    assert specs is not None and specs["default"].layout == "campus"
    default = specs["default"].to_line("yihua")
    assert default["size"] == {"width": 2500, "height": 843}
    assert sum(area["bounds"]["width"] for area in default["areas"]) == 2500
    assert [area["bounds"]["x"] for area in default["areas"]] == [0, 833, 1667]
    assert len(default["chatBarText"]) <= 14
    actions = [area["action"] for area in default["areas"]]
    assert actions[0] == {"type": "uri", "label": "預約參觀", "uri": f"{ORIGIN}/visit/yihua"}
    assert actions[1]["label"] == "園所位置" and actions[1]["uri"].startswith("https://www.google.com/maps/search/")
    assert actions[2] == {"type": "uri", "label": "撥打電話", "uri": "tel:073000000"}
    booked = specs["booked"].to_line("yihua")
    assert booked["areas"][0]["action"] == {"type": "message", "label": "我的預約", "text": "我的預約"}
    assert booked["areas"][0]["action"]["text"] in line_parent.MY_VISITS_KEYWORDS
    assert [area["action"] for area in booked["areas"][1:]] == actions[1:]


async def test_shared_account_and_campus_without_phone_use_site_links(app, db_session, fake_line, campus_profile):
    main = await line_rich_menus.build_specs(db_session, app.state.settings, "main")
    assert main["default"].layout == "shared"
    assert [cell.action["uri"] for cell in main["default"].cells] == [f"{ORIGIN}/visit", f"{ORIGIN}/environment", f"{ORIGIN}/"]
    campus_profile["phone"] = ""
    yihua = await line_rich_menus.build_specs(db_session, app.state.settings, "yihua")
    assert yihua["default"].layout == "shared"
    assert yihua["default"].cells[0].action["uri"] == f"{ORIGIN}/visit/yihua"


async def test_visit_cell_uses_liff_only_when_parent_line_is_on(app, db_session, admin_client, fake_line, campus_profile):
    app.state.settings.line_liff_id = LIFF_ID
    specs = await line_rich_menus.build_specs(db_session, app.state.settings, "yihua")
    assert specs["default"].cells[0].action["uri"] == f"{ORIGIN}/visit/yihua"
    assert (await _enable_parent_line(admin_client)).status_code == 200
    specs = await line_rich_menus.build_specs(db_session, app.state.settings, "yihua")
    assert specs["default"].cells[0].action["uri"] == f"https://liff.line.me/{LIFF_ID}/yihua"
    main = await line_rich_menus.build_specs(db_session, app.state.settings, "main")
    assert main["default"].cells[0].action["uri"] == f"https://liff.line.me/{LIFF_ID}"


async def test_no_site_origin_means_no_menu(app, db_session, admin_client, fake_line, campus_profile):
    app.state.settings.public_origin = None
    app.state.settings.admin_origin = None
    assert await line_rich_menus.build_specs(db_session, app.state.settings, "yihua") is None
    response = await _put_menu(admin_client, "booked")
    assert response.status_code == 409 and response.json()["detail"]["code"] == "LINE_RICH_MENU_UNAVAILABLE"
    assert fake_line.creates == 0


# --- 套用、重建、停用 ---------------------------------------------------------------------------------


async def test_booked_mode_creates_one_menu_and_leaves_default_alone(app, db_session, admin_client, fake_line, campus_profile):
    response = await _put_menu(admin_client, "booked")
    assert response.status_code == 200, response.text
    menu = _account(response.json())["rich_menu"]
    assert menu["mode"] == "booked" and menu["outdated"] is False
    assert _account(response.json(), "main")["rich_menu"] is None
    assert len(fake_line.menus) == 1
    (menu_id, created), = fake_line.menus.items()
    assert created["account"] == "yihua" and created["body"]["chatBarText"] == "我的預約"
    assert created["image"] == line_rich_menus.image_bytes("campus-booked.png")
    assert fake_line.default == {} and fake_line.default_cleared == []
    row = await db_session.get(LineRichMenu, "yihua")
    assert (row.mode, row.default_menu_id, row.booked_menu_id) == ("booked", None, menu_id)
    audit = (await db_session.scalars(select(AuditLogEntry).where(AuditLogEntry.action == "line.rich_menu.update"))).one()
    assert audit.target_id == "yihua" and audit.metadata_json == {"before": None, "after": "booked"}


async def test_all_mode_sets_default_menu_then_switching_to_booked_clears_it(app, db_session, admin_client, fake_line, campus_profile):
    assert (await _put_menu(admin_client, "all")).status_code == 200
    row = await db_session.get(LineRichMenu, "yihua")
    first_default, first_booked = row.default_menu_id, row.booked_menu_id
    assert fake_line.default == {"yihua": first_default}
    assert fake_line.menus[first_default]["body"]["chatBarText"] == "預約參觀"
    assert fake_line.menus[first_default]["image"] == line_rich_menus.image_bytes("campus-default.png")

    response = await _put_menu(admin_client, "booked")
    assert response.status_code == 200 and _account(response.json())["rich_menu"]["mode"] == "booked"
    await db_session.refresh(row)
    assert row.default_menu_id is None and row.booked_menu_id not in (first_default, first_booked)
    assert fake_line.default_cleared == ["yihua"]
    assert set(fake_line.deleted) == {first_default, first_booked} and set(fake_line.menus) == {row.booked_menu_id}
    audits = (
        await db_session.scalars(
            select(AuditLogEntry).where(AuditLogEntry.action == "line.rich_menu.update").order_by(AuditLogEntry.created_at)
        )
    ).all()
    assert [entry.metadata_json for entry in audits] == [{"before": None, "after": "all"}, {"before": "all", "after": "booked"}]


async def test_create_failure_cleans_up_and_keeps_database_untouched(app, db_session, admin_client, fake_line, campus_profile):
    fake_line.fail_create_at = 2  # 「已預約」版建好了，「一般」版失敗
    response = await _put_menu(admin_client, "all")
    assert response.status_code == 502 and response.json()["detail"]["code"] == "LINE_RICH_MENU_FAILED"
    assert fake_line.menus == {} and fake_line.deleted == ["richmenu-0001"] and fake_line.default == {}
    assert await db_session.get(LineRichMenu, "yihua") is None


async def test_upload_failure_deletes_the_menu_without_image(app, db_session, admin_client, fake_line, campus_profile):
    fake_line.fail_upload = True
    assert (await _put_menu(admin_client, "booked")).status_code == 502
    assert fake_line.menus == {} and await db_session.get(LineRichMenu, "yihua") is None


async def test_remove_unlinks_users_and_deletes_menus(app, db_session, admin_client, public_client, fake_line, campus_profile):
    await _link(app, admin_client, public_client)
    assert (await _put_menu(admin_client, "all")).status_code == 200
    row = await db_session.get(LineRichMenu, "yihua")
    menu_ids = {row.default_menu_id, row.booked_menu_id}
    assert fake_line.links == {("yihua", PARENT): row.booked_menu_id}

    response = await _put_menu(admin_client, None)
    assert response.status_code == 200 and _account(response.json())["rich_menu"] is None
    assert fake_line.links == {} and ("yihua", PARENT) in fake_line.unlinked
    assert fake_line.default_cleared == ["yihua"] and set(fake_line.deleted) == menu_ids
    db_session.expire_all()
    assert await db_session.get(LineRichMenu, "yihua") is None
    assert (await db_session.scalars(select(LineRichMenuUser))).all() == []
    # 本來就沒有：不呼叫 LINE、不寫稽核。
    calls = len(fake_line.deleted)
    assert (await _put_menu(admin_client, None)).status_code == 200 and len(fake_line.deleted) == calls


async def test_reapply_rebuilds_and_relinks_booked_parents(app, db_session, admin_client, public_client, fake_line, campus_profile):
    await _link(app, admin_client, public_client)
    assert (await _put_menu(admin_client, "booked")).status_code == 200
    first = (await db_session.get(LineRichMenu, "yihua")).booked_menu_id
    assert fake_line.links == {("yihua", PARENT): first}
    assert (await _put_menu(admin_client, "booked")).status_code == 200
    db_session.expire_all()
    second = (await db_session.get(LineRichMenu, "yihua")).booked_menu_id
    assert second != first and fake_line.deleted == [first]
    assert fake_line.links == {("yihua", PARENT): second}


async def test_menu_is_marked_outdated_when_campus_details_change(app, admin_client, fake_line, campus_profile):
    assert (await _put_menu(admin_client, "booked")).status_code == 200
    assert _account((await admin_client.get(f"{API}/admin/line")).json())["rich_menu"]["outdated"] is False
    campus_profile["phone"] = "07-311-1111"
    assert _account((await admin_client.get(f"{API}/admin/line")).json())["rich_menu"]["outdated"] is True


async def test_rich_menu_requires_notifications_manage_and_known_account(app, admin_client, minghua_client, fake_line, campus_profile):
    assert (await _put_menu(minghua_client, "booked")).status_code == 403
    assert (await minghua_client.get(f"{API}/admin/line/accounts/yihua/rich-menu/insight")).status_code == 403
    assert (await _put_menu(admin_client, "booked", account="renwu")).status_code == 404  # 沒設金鑰
    assert (await _put_menu(admin_client, "everyone")).status_code == 422
    assert fake_line.creates == 0


# --- 對齊：誰該看已預約版 -----------------------------------------------------------------------------


async def _reconcile(app, db_session, **kwargs) -> int:
    async with LineClients(app.state.settings, transport=app.state.line_transport) as clients:
        return await line_rich_menus.reconcile(db_session, clients, **kwargs)


async def test_reconcile_links_new_bindings_and_unlinks_ended_or_unbound(app, db_session, admin_client, public_client, fake_line, campus_profile):
    assert (await _enable_parent_line(admin_client)).status_code == 200
    assert (await _put_menu(admin_client, "booked")).status_code == 200
    menu_id = (await db_session.get(LineRichMenu, "yihua")).booked_menu_id
    assert fake_line.links == {}

    await _link(app, admin_client, public_client)  # 之後才綁定：靠下一輪對齊換上
    assert await _reconcile(app, db_session) == 1
    assert fake_line.links == {("yihua", PARENT): menu_id}
    assert await _reconcile(app, db_session) == 0  # 已經對齊：不再呼叫 LINE

    # 參觀結束（場次時間過了）就換回去。
    later = datetime.now(timezone.utc) + timedelta(days=30)
    assert await _reconcile(app, db_session, now=later) == 1
    assert fake_line.links == {} and (await db_session.scalars(select(LineRichMenuUser))).all() == []

    # 還沒結束時再對齊會換回來；家長自己解除綁定後又換回去。
    assert await _reconcile(app, db_session) == 1 and fake_line.links == {("yihua", PARENT): menu_id}
    assert (await public_client.delete(f"{API}/public/visit-manage/line-notify", headers={"X-Ivy-Parent": "1"})).status_code == 204
    assert await _reconcile(app, db_session) == 1 and fake_line.links == {}


async def test_blocked_parent_is_unlinked_and_refollow_relinks(app, db_session, admin_client, public_client, fake_line, campus_profile):
    await _link(app, admin_client, public_client)
    assert (await _put_menu(admin_client, "booked")).status_code == 200
    menu_id = (await db_session.get(LineRichMenu, "yihua")).booked_menu_id
    assert (await _webhook(app, [_follow("unfollow")])).status_code == 200
    assert await _reconcile(app, db_session) == 1 and fake_line.links == {}

    assert (await _webhook(app, [_follow("follow")])).status_code == 200
    assert await _reconcile(app, db_session) == 1 and fake_line.links == {("yihua", PARENT): menu_id}
    # 已經記著「換上了」的人再加一次好友（之前不是好友、那次其實沒換成）：忘掉紀錄、下一輪再換一次。
    fake_line.links.clear()
    assert (await _webhook(app, [_follow("follow")])).status_code == 200
    assert await _reconcile(app, db_session) == 1 and fake_line.links == {("yihua", PARENT): menu_id}


async def test_reconcile_skips_accounts_without_credentials_and_survives_line_errors(app, db_session, admin_client, public_client, fake_line, campus_profile):
    await _link(app, admin_client, public_client)
    assert (await _put_menu(admin_client, "booked")).status_code == 200
    row = await db_session.get(LineRichMenu, "yihua")
    # LINE 那邊的選單不見了（404）：這一位跳過、不記成已換上，下一輪再試。
    await db_session.execute(LineRichMenuUser.__table__.delete())
    await db_session.commit()
    fake_line.links.clear()
    fake_line.menus.pop(row.booked_menu_id)
    assert await _reconcile(app, db_session) == 0
    assert (await db_session.scalars(select(LineRichMenuUser))).all() == []
    # 金鑰拿掉：不呼叫 LINE。
    app.state.settings.line_yihua_channel_secret = None
    app.state.settings.line_yihua_access_token = None
    assert await _reconcile(app, db_session) == 0


async def test_maintenance_cycle_runs_the_reconcile_step(app, db_session, admin_client, public_client, fake_line, campus_profile):
    assert (await _enable_parent_line(admin_client)).status_code == 200
    assert (await _put_menu(admin_client, "booked")).status_code == 200
    await _link(app, admin_client, public_client)
    settings = app.state.settings.model_copy(update={"smtp_host": None, "resend_api_key": None})
    result = await run_cycle(app.state.session_factory, settings, worker_id="menus", line_transport=app.state.line_transport)
    assert "line_rich_menus" not in result.failed_steps and result.rich_menus_synced == 1
    assert ("yihua", PARENT) in fake_line.links and result.did_anything


# --- 點擊統計 -----------------------------------------------------------------------------------------


async def test_insight_maps_clicks_to_cells_and_handles_missing_numbers(app, db_session, admin_client, fake_line, campus_profile):
    assert (await admin_client.get(f"{API}/admin/line/accounts/yihua/rich-menu/insight")).status_code == 404
    assert (await _put_menu(admin_client, "all")).status_code == 200
    row = await db_session.get(LineRichMenu, "yihua")
    fake_line.summaries[row.default_menu_id] = {
        "richMenuId": row.default_menu_id,
        "impression": {"metrics": {"count": 120, "uniqueUsers": 45}},
        "clicks": [
            {"bounds": {"x": 1667, "y": 0, "width": 833, "height": 843}, "metrics": {"count": 9, "uniqueUsers": 8}},
            {"bounds": {"x": 0, "y": 0, "width": 833, "height": 843}, "metrics": {"count": 30, "uniqueUsers": 22}},
        ],
    }
    fake_line.summaries[row.booked_menu_id] = {"richMenuId": row.booked_menu_id}  # 點的人不到 20 位
    response = await admin_client.get(f"{API}/admin/line/accounts/yihua/rich-menu/insight?days=28")
    assert response.status_code == 200, response.text
    body = response.json()
    start, end = line_rich_menus.insight_range(28)
    assert (body["from_date"], body["to_date"], body["error_status"]) == (start.isoformat(), end.isoformat(), None)
    default, booked = body["menus"]
    assert (default["kind"], default["available"], default["impressions"], default["impression_users"]) == ("default", True, 120, 45)
    assert default["areas"] == [
        {"label": "預約參觀", "clicks": 30, "users": 22},
        {"label": "園所位置", "clicks": 0, "users": 0},
        {"label": "撥打電話", "clicks": 9, "users": 8},
    ]
    assert booked == {"kind": "booked", "available": False, "impressions": None, "impression_users": None, "areas": []}
    assert (await admin_client.get(f"{API}/admin/line/accounts/yihua/rich-menu/insight?days=3")).status_code == 422


async def test_insight_reports_line_errors_and_not_yet_aggregated(app, db_session, admin_client, fake_line, campus_profile):
    assert (await _put_menu(admin_client, "all")).status_code == 200
    row = await db_session.get(LineRichMenu, "yihua")
    fake_line.summaries[row.default_menu_id] = 401
    # 已預約版剛建好：LINE 回 404 → 沒有數字，不是錯誤。
    body = (await admin_client.get(f"{API}/admin/line/accounts/yihua/rich-menu/insight")).json()
    assert body["error_status"] == 401
    assert body["menus"] == [{"kind": "booked", "available": False, "impressions": None, "impression_users": None, "areas": []}]


def test_insight_range_ends_yesterday_in_line_time():
    # 台北 11/28 00:30＝UTC 11/27 16:30＝LINE（UTC+9）11/28 01:30 → 昨天是 11/27。
    now = datetime(2026, 11, 27, 16, 30, tzinfo=timezone.utc)
    start, end = line_rich_menus.insight_range(28, now)
    assert (start.isoformat(), end.isoformat()) == ("2026-10-31", "2026-11-27")


# --- LIFF：驗證 ID token --------------------------------------------------------------------------------


def _liff_settings(**update):
    return _test_settings().model_copy(update={"line_liff_id": LIFF_ID, **update})


def test_liff_settings_derive_channel_id_and_reject_bad_values():
    assert _test_settings().line_liff_client_id is None and _test_settings().line_liff_url is None
    settings = _liff_settings()
    assert settings.line_liff_client_id == CHANNEL_ID and settings.line_liff_url == f"https://liff.line.me/{LIFF_ID}"
    assert _liff_settings(line_liff_channel_id="2000000001").line_liff_client_id == "2000000001"
    base = _test_settings().model_dump()
    for bad in ({"line_liff_id": "not-a-liff-id!"}, {"line_liff_channel_id": "123"}, {"line_liff_id": LIFF_ID, "line_liff_channel_id": "abc"}):
        with pytest.raises(ValueError):
            type(_test_settings())(**{**base, **bad})


async def test_verify_id_token_accepts_only_valid_tokens_for_this_channel():
    fake = FakeLine()
    now = int(time.time())
    good = {"sub": PARENT, "aud": CHANNEL_ID, "exp": now + 600}
    fake.id_tokens = {
        "good": good,
        "other-channel": {**good, "aud": "9999999999"},
        "expired": {**good, "exp": now - 1},
        "odd-subject": {**good, "sub": "not-a-user-id"},
        "rejected": 400,
    }
    settings = _liff_settings()
    transport = fake.transport()
    assert await line_liff.verify_id_token(settings, "good", transport) == PARENT
    assert fake.verify_calls[-1] == {"id_token": "good", "client_id": CHANNEL_ID}
    for token in ("other-channel", "expired", "odd-subject", "rejected", "unknown"):
        assert await line_liff.verify_id_token(settings, token, transport) is None
    calls = len(fake.verify_calls)
    # 沒帶、太長、沒設 LIFF：不向 LINE 驗。
    assert await line_liff.verify_id_token(settings, None, transport) is None
    assert await line_liff.verify_id_token(settings, "x" * 5000, transport) is None
    assert await line_liff.verify_id_token(_test_settings(), "good", transport) is None
    assert len(fake.verify_calls) == calls
    fake.verify_error = True
    assert await line_liff.verify_id_token(settings, "good", transport) is None


# --- LIFF：送單當下綁定 ---------------------------------------------------------------------------------


async def test_booking_inside_line_links_the_visit_and_notifies_by_line(app, db_session, admin_client, public_client, fake_line):
    token = _liff(app, fake_line)
    assert (await _enable_parent_line(admin_client)).status_code == 200
    config = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    assert config["line_liff_enabled"] is True and config["line_notify_enabled"] is True

    booked = await book_slot(admin_client, public_client, email=None, line_id_token=token)
    response = booked["response"]
    assert response.status_code == 201
    assert response.json()["line_notify"] == {
        "linked": True, "friend": True, "account_name": "常春藤義華", "add_friend_url": "https://line.me/R/ti/p/%40ivy-yihua",
    }
    link = (await db_session.scalars(select(LineParentLink))).one()
    assert (str(link.visit_request_id), link.account_key, link.line_user_id) == (booked["receipt_id"], "yihua", PARENT)
    audit = (await db_session.scalars(select(AuditLogEntry).where(AuditLogEntry.action == "line.parent.link"))).one()
    assert audit.target_id == booked["receipt_id"] and audit.metadata_json == {"account_key": "yihua", "via": "liff"}

    # 沒留 Email 也排得進家長通知（因為送單當下已經綁了），送出時推到這個 LINE。
    kinds = (await db_session.scalars(select(OutboxMessage.kind))).all()
    assert "parent_visit_booked" in kinds
    await _run_outbox(app, db_session)
    parent_pushes = [push for push in fake_line.pushes if push["body"]["to"] == PARENT]
    assert len(parent_pushes) == 1 and parent_pushes[0]["account"] == "yihua"

    # 修改頁查得到已綁與好友狀態。
    await open_manage(public_client, booked["manage_path"])
    state = (await public_client.get(f"{API}/public/visit-manage/line-notify")).json()
    assert (state["linked"], state["friend"], state["account_name"]) == (True, True, "常春藤義華")


async def test_booking_inside_line_reports_when_parent_is_not_a_friend(app, db_session, admin_client, public_client, fake_line):
    token = _liff(app, fake_line, user=OTHER_PARENT)  # OTHER_PARENT 沒加義華帳號好友
    assert (await _enable_parent_line(admin_client)).status_code == 200
    booked = await book_slot(admin_client, public_client, line_id_token=token)
    notify = booked["response"].json()["line_notify"]
    assert notify["linked"] is True and notify["friend"] is False and notify["add_friend_url"]
    await open_manage(public_client, booked["manage_path"])
    assert (await public_client.get(f"{API}/public/visit-manage/line-notify")).json()["friend"] is False
    fake_line.friends.add(OTHER_PARENT)
    assert (await public_client.get(f"{API}/public/visit-manage/line-notify")).json()["friend"] is True


async def test_bad_token_or_feature_off_still_books_without_linking(app, db_session, admin_client, public_client, fake_line):
    # 1) 沒設 LIFF：不驗、不綁。
    assert (await _enable_parent_line(admin_client)).status_code == 200
    assert (await public_client.get(f"{API}/public/booking-config/yihua")).json()["line_liff_enabled"] is False
    first = await book_slot(admin_client, public_client, line_id_token="whatever", days_ahead=3)
    assert first["response"].status_code == 201 and first["response"].json()["line_notify"] is None
    assert fake_line.verify_calls == []

    # 2) 有設 LIFF、token 驗不過：預約照常成立，不綁。
    _liff(app, fake_line)
    second = await book_slot(admin_client, public_client, line_id_token="forged", phone="0922333444", days_ahead=4)
    assert second["response"].status_code == 201 and second["response"].json()["line_notify"] is None

    # 3) 連不上 LINE：一樣只是不綁。
    fake_line.verify_error = True
    third = await book_slot(admin_client, public_client, line_id_token="liff-token", phone="0933444555", days_ahead=5)
    assert third["response"].status_code == 201 and third["response"].json()["line_notify"] is None
    assert (await db_session.scalars(select(LineParentLink))).all() == []


async def test_valid_token_is_ignored_when_campus_has_no_parent_line(app, db_session, admin_client, public_client, fake_line):
    token = _liff(app, fake_line)
    assert (await public_client.get(f"{API}/public/booking-config/yihua")).json()["line_liff_enabled"] is False
    booked = await book_slot(admin_client, public_client, line_id_token=token)
    assert booked["response"].status_code == 201 and booked["response"].json()["line_notify"] is None
    assert (await db_session.scalars(select(LineParentLink))).all() == []


async def test_replay_returns_line_notify_and_token_is_not_part_of_the_payload(app, db_session, admin_client, public_client, fake_line):
    token = _liff(app, fake_line)
    assert (await _enable_parent_line(admin_client)).status_code == 200
    first = await book_slot(admin_client, public_client, line_id_token=token, idempotency_key="liff-replay")
    body = json.loads(first["response"].request.content)
    # 同一把 key 重送：token 換了（重新整理後 LIFF 給新的）也算同一筆，不是「同 key 不同內容」；不重綁、不多寫稽核。
    replay = await public_client.post(
        f"{API}/public/visit-requests", json={**body, "line_id_token": "another-token"}, headers={"Idempotency-Key": "liff-replay"}
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["receipt_id"] == first["receipt_id"] and replay.json()["line_notify"]["linked"] is True
    assert len((await db_session.scalars(select(LineParentLink))).all()) == 1
    audits = (await db_session.scalars(select(AuditLogEntry).where(AuditLogEntry.action == "line.parent.link"))).all()
    assert len(audits) == 1


async def test_booking_inside_line_gets_the_booked_menu_on_next_reconcile(app, db_session, admin_client, public_client, fake_line, campus_profile):
    token = _liff(app, fake_line)
    assert (await _enable_parent_line(admin_client)).status_code == 200
    assert (await _put_menu(admin_client, "booked")).status_code == 200
    menu = fake_line.menus[(await db_session.get(LineRichMenu, "yihua")).booked_menu_id]
    # 有設 LIFF、這校有開家長通知：選單不走 LIFF 的只有「我的預約」那格；重建後「預約參觀」才會是 LIFF 網址。
    assert menu["body"]["areas"][0]["action"]["text"] == "我的預約"
    await book_slot(admin_client, public_client, line_id_token=token)
    assert await _reconcile(app, db_session) == 1
    assert ("yihua", PARENT) in fake_line.links
