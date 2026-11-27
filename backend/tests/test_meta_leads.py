"""Meta 名單型廣告（即時表單）→ 後台「廣告名單」收件匣（docs/specs/2026-11-26-meta-lead-inbox-design.md）：
設定、Graph API 拉取、去重與 cursor、過期刪除、LINE 通知、收件匣 API 與權限、轉成參觀案件、回傳 Meta 的格式。
Meta 與 LINE 一律用 httpx.MockTransport 假造。"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.ad_conversions.models import AdConversionJob
from app.ad_conversions.service import build_request
from app.booking.attribution import PLATFORM_KEYS
from app.booking.models import VisitRequest
from app.config import Settings
from app.meta_leads.models import MetaLead, MetaLeadSync
from app.meta_leads.service import contact_fields, normalize_phone
from app.meta_leads.sync import OVERLAP, notify_new_leads, purge_expired, sync_leads
from app.notifications.line import LineMessagingClient
from app.notifications.models import LineCampusTarget, LineGroup
from app.operations.models import AuditLogEntry
from app.workers.maintenance import run_cycle
from tests.conftest import create_slot

API = "/api/website/v1/admin/meta-leads"
VISITS = "/api/website/v1/admin/visit-requests"
SYSTEM_TOKEN = "SYSTEM-USER-TOKEN-should-never-leak"
PAGE_TOKEN = "PAGE-TOKEN-should-never-leak"
YIHUA_PAGE = "1111111111"
MINGHUA_PAGE = "2222222222"
FORM_ID = "333333333333"
FORM_NAME = "1219假日參觀日_預約表單"
GROUP = "C" + "a" * 32


def _graph_time(at: datetime) -> str:
    return at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+0000")


def _lead(lead_id: str, created_at: datetime, *, name="王小明", phone="+886 912-345-678") -> dict:
    return {
        "id": lead_id,
        "created_time": _graph_time(created_at),
        "field_data": [
            {"name": "full_name", "values": [name]},
            {"name": "phone_number", "values": [phone]},
            {"name": "孩子目前幾歲？", "values": ["3歲"]},
            {"name": "12/19（六）希望參觀的時段？", "values": ["10:00–11:00"]},
        ],
        "form_id": FORM_ID,
        "ad_id": "4444",
        "campaign_id": "5555",
        "platform": "fb",
        "is_organic": False,
    }


class FakeMeta:
    """graph.facebook.com：換 Page token、表單清單、名單（兩頁）。記下每個請求，最後檢查 token 沒進網址。"""

    def __init__(self) -> None:
        now = datetime.now(timezone.utc)
        self.leads = [_lead("9000000000000002", now - timedelta(minutes=5)), _lead("9000000000000001", now - timedelta(hours=1))]
        self.fail_forms_with: int | None = None
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.url.host == "graph.facebook.com"
        # token 走 Authorization header，網址裡不能有（httpx 的 INFO 紀錄會印完整網址）。
        assert "access_token" not in request.url.params
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        assert token in (SYSTEM_TOKEN, PAGE_TOKEN)
        parts = request.url.path.strip("/").split("/")
        if len(parts) == 2:
            return httpx.Response(200, json={"access_token": PAGE_TOKEN, "id": parts[1]})
        if parts[2] == "leadgen_forms":
            assert token == PAGE_TOKEN
            if self.fail_forms_with:
                return httpx.Response(
                    self.fail_forms_with, json={"error": {"message": f"Missing permission {PAGE_TOKEN}", "code": 200}}
                )
            return httpx.Response(200, json={"data": [{"id": FORM_ID, "name": FORM_NAME}]} if parts[1] == YIHUA_PAGE else {"data": []})
        if parts[2] == "leads":
            assert token == PAGE_TOKEN and parts[1] == FORM_ID
            # 兩頁：第一頁的 paging.next 是帶 token 的完整網址，程式只能用 cursors.after 接著讀。
            if request.url.params.get("after") == "PAGE2":
                return httpx.Response(200, json={"data": self.leads[1:]})
            return httpx.Response(200, json={
                "data": self.leads[:1],
                "paging": {
                    "cursors": {"before": "PAGE1", "after": "PAGE2"},
                    "next": f"https://graph.facebook.com/v27.0/{FORM_ID}/leads?access_token=LEAKED&after=PAGE2",
                },
            })
        return httpx.Response(404)

    def lead_requests(self) -> list[httpx.Request]:
        return [request for request in self.requests if request.url.path.endswith("/leads")]


def _settings(base: Settings, **overrides) -> Settings:
    return base.model_copy(update={
        "facebook_access_token": SYSTEM_TOKEN,
        "facebook_pages": f"yihua={YIHUA_PAGE},minghua={MINGHUA_PAGE}",
        "meta_leads_enabled": True,
        **overrides,
    })


@pytest.fixture
def meta(app) -> FakeMeta:
    fake = FakeMeta()
    original = app.state.settings
    app.state.settings = _settings(original)
    app.state.facebook_transport = httpx.MockTransport(fake.handler)
    yield fake
    app.state.settings = original
    app.state.facebook_transport = None


async def _sync(app, meta: FakeMeta, campus_keys=None):
    return await sync_leads(
        app.state.session_factory, app.state.settings, campus_keys=campus_keys,
        transport=httpx.MockTransport(meta.handler),
    )


async def _leads(db_session) -> list[MetaLead]:
    db_session.expire_all()
    return list(await db_session.scalars(select(MetaLead).order_by(MetaLead.created_at)))


# ── 設定與欄位整理 ─────────────────────────────────────


def test_settings_require_facebook_sync(isolated_settings):
    with pytest.raises(ValidationError, match="WEBSITE_META_LEADS_ENABLED"):
        Settings.model_validate({**isolated_settings.model_dump(), "meta_leads_enabled": True})
    settings = Settings.model_validate({
        **isolated_settings.model_dump(), "meta_leads_enabled": True,
        "facebook_access_token": "t", "facebook_pages": "yihua=12345",
    })
    assert settings.meta_leads_sync_enabled
    assert not isolated_settings.meta_leads_sync_enabled


@pytest.mark.parametrize(("raw", "expected"), [
    ("+886 912-345-678", "0912345678"),
    ("886912345678", "0912345678"),
    ("+8860912345678", "0912345678"),
    ("0912345678", "0912345678"),
    ("+81 90 1234 5678", "+819012345678"),
    ("", None),
    (None, None),
])
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


def test_contact_fields_split_name_phone_and_answers():
    name, phone, answers = contact_fields((
        ("full_name", " 王小明 "), ("phone_number", "+886912345678"), ("email", "mom@example.com"),
        ("孩子目前幾歲？", "3歲"),
    ))
    assert (name, phone) == ("王小明", "0912345678")
    assert answers == [{"question": "email", "answer": "mom@example.com"}, {"question": "孩子目前幾歲？", "answer": "3歲"}]
    assert contact_fields((("first_name", "小明"), ("last_name", "王")))[0] == "小明 王"
    assert contact_fields(()) == (None, None, [])


# ── 拉取 ──────────────────────────────────────────────


async def test_sync_writes_new_leads_once_and_follows_cursor(app, meta, db_session):
    results = await _sync(app, meta)
    assert [(r.campus_key, r.count, r.error) for r in results] == [("yihua", 2, None), ("minghua", 0, None)]
    leads = await _leads(db_session)
    assert [lead.lead_id for lead in leads] == ["9000000000000001", "9000000000000002"]
    first = leads[0]
    assert (first.campus_key, first.status, first.form_name, first.platform, first.is_organic) == (
        "yihua", "new", FORM_NAME, "fb", False
    )
    assert (first.parent_name, first.phone) == ("王小明", "0912345678")
    assert first.answers == [
        {"question": "孩子目前幾歲？", "answer": "3歲"},
        {"question": "12/19（六）希望參觀的時段？", "answer": "10:00–11:00"},
    ]
    sync_row = await db_session.get(MetaLeadSync, "yihua")
    assert sync_row.last_error is None and sync_row.last_count == 2
    cursor = sync_row.cursor_at
    assert cursor == leads[1].created_at
    # 帶 token 的 paging.next 網址從來沒被請求過。
    assert not any("LEAKED" in str(request.url) for request in meta.requests)

    # 再拉一次：同一筆不重複寫，從 cursor 往前重疊一段再讀。
    before = len(meta.lead_requests())
    results = await _sync(app, meta, campus_keys=["yihua"])
    assert results[0].count == 0
    assert len(await _leads(db_session)) == 2
    filtering = json.loads(meta.lead_requests()[before].url.params["filtering"])
    assert filtering == [{
        "field": "time_created", "operator": "GREATER_THAN",
        "value": int((cursor - OVERLAP).timestamp()),
    }]


async def test_sync_keeps_status_and_cleared_details(app, meta, db_session):
    await _sync(app, meta)
    lead = (await _leads(db_session))[0]
    lead.status, lead.parent_name, lead.phone, lead.answers = "converted", None, None, None
    await db_session.commit()
    await _sync(app, meta)
    lead = (await _leads(db_session))[0]
    assert (lead.status, lead.parent_name, lead.phone, lead.answers) == ("converted", None, None, None)


async def test_sync_error_records_code_without_token(app, meta, db_session, caplog):
    meta.fail_forms_with = 403
    results = await _sync(app, meta, campus_keys=["yihua"])
    assert results[0].error == "讀取即時表單（HTTP 403、code 200）"
    sync_row = await db_session.get(MetaLeadSync, "yihua")
    assert sync_row.last_error == results[0].error and sync_row.last_success_at is None
    assert PAGE_TOKEN not in caplog.text and SYSTEM_TOKEN not in caplog.text
    assert await _leads(db_session) == []


async def test_sync_does_nothing_when_disabled(app):
    assert await sync_leads(app.state.session_factory, app.state.settings) == []


async def test_purge_deletes_only_old_unconverted_leads(app, db_session):
    now = datetime.now(timezone.utc)
    for index, (status, age) in enumerate([("new", 100), ("dismissed", 100), ("converted", 100), ("new", 10)]):
        db_session.add(MetaLead(
            campus_key="yihua", lead_id=f"90{index}", form_id=FORM_ID, created_at=now - timedelta(days=age),
            fetched_at=now, status=status,
        ))
    await db_session.commit()
    settings = _settings(app.state.settings)
    assert await purge_expired(db_session, settings) == 2
    await db_session.commit()
    assert sorted((lead.lead_id, lead.status) for lead in await _leads(db_session)) == [("902", "converted"), ("903", "new")]


async def test_maintenance_purges_expired_leads_even_when_feature_is_off(app, db_session):
    now = datetime.now(timezone.utc)
    db_session.add(MetaLead(
        campus_key="yihua", lead_id="777", form_id=FORM_ID, created_at=now - timedelta(days=120), fetched_at=now,
        parent_name="過期", phone="0911111111",
    ))
    await db_session.commit()
    settings = app.state.settings.model_copy(update={"notification_email_sink_dir": None, "smtp_host": None})
    assert not settings.meta_leads_sync_enabled
    result = await run_cycle(app.state.session_factory, settings, worker_id="test")
    assert result.meta_leads_purged == 1 and "meta_leads" not in result.failed_steps
    assert await _leads(db_session) == []


# ── LINE 通知 ──────────────────────────────────────────


class FakeLine:
    def __init__(self, status: int = 200) -> None:
        self.status = status
        self.pushes: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v2/bot/message/push"
        self.pushes.append(json.loads(request.content))
        return httpx.Response(self.status, json={})


async def _bind_group(db_session) -> None:
    now = datetime.now(timezone.utc)
    db_session.add(LineGroup(target_id=GROUP, source_type="group", name="義華", first_seen_at=now, last_seen_at=now))
    await db_session.flush()
    db_session.add(LineCampusTarget(campus_key="yihua", target_id=GROUP, updated_at=now))
    await db_session.commit()


async def test_notify_pushes_one_message_per_campus_without_personal_data(app, meta, db_session):
    await _sync(app, meta)
    now = datetime.now(timezone.utc)
    db_session.add(MetaLead(
        campus_key="yihua", lead_id="8000", form_id=FORM_ID, created_at=now - timedelta(days=2), fetched_at=now,
        parent_name="很久以前", phone="0900000000",
    ))
    await db_session.commit()
    await _bind_group(db_session)
    fake = FakeLine()
    settings = _settings(app.state.settings, admin_origin="https://admin.example.com")
    async with LineMessagingClient("LINE-TOKEN", transport=httpx.MockTransport(fake.handler)) as line:
        assert await notify_new_leads(db_session, settings, line_client=line) == 1
        assert await notify_new_leads(db_session, settings, line_client=line) == 0
    assert len(fake.pushes) == 1
    text = fake.pushes[0]["messages"][0]["text"]
    assert fake.pushes[0]["to"] == GROUP
    assert "2 筆新的 Meta 廣告名單" in text
    assert "https://admin.example.com/admin/meta-leads?campus=yihua" in text
    assert "王小明" not in text and "0912345678" not in text
    assert all(lead.notified_at is not None for lead in await _leads(db_session))


async def test_notify_retries_when_push_fails_and_skips_without_line(app, meta, db_session):
    await _sync(app, meta)
    await _bind_group(db_session)
    fake = FakeLine(status=500)
    async with LineMessagingClient("LINE-TOKEN", transport=httpx.MockTransport(fake.handler)) as line:
        assert await notify_new_leads(db_session, app.state.settings, line_client=line) == 0
    assert all(lead.notified_at is None for lead in await _leads(db_session))
    # 沒設 LINE：直接記已通知，不再排著。
    assert await notify_new_leads(db_session, app.state.settings, line_client=None) == 0
    assert all(lead.notified_at is not None for lead in await _leads(db_session))


# ── 收件匣 API 與權限 ───────────────────────────────────


async def test_list_pending_dismiss_restore_and_scope(app, meta, admin_client, minghua_client, db_session):
    await _sync(app, meta)
    body = (await admin_client.get(API, params={"campus_key": "yihua"})).json()
    assert body["configured"] is True and body["counts"] == {"new": 2, "converted": 0, "dismissed": 0}
    assert [lead["phone"] for lead in body["leads"]] == ["0912345678", "0912345678"]
    assert body["leads"][0]["answers"][0] == {"question": "孩子目前幾歲？", "answer": "3歲"}
    lead_id = body["leads"][0]["id"]

    assert (await admin_client.get(f"{API}/pending")).json() == {"campuses": {"yihua": 2}}
    assert (await minghua_client.get(f"{API}/pending")).json() == {"campuses": {}}
    # 別校的名單：一律 404（ScopeDenied），不透露有沒有這筆。
    assert (await minghua_client.get(API, params={"campus_key": "yihua"})).status_code == 404
    assert (await minghua_client.post(f"{API}/{lead_id}/dismiss")).status_code == 404

    dismissed = await admin_client.post(f"{API}/{lead_id}/dismiss")
    assert dismissed.status_code == 200 and dismissed.json()["status"] == "dismissed"
    again = await admin_client.post(f"{API}/{lead_id}/dismiss")
    assert again.status_code == 409 and again.json()["detail"]["code"] == "META_LEAD_STATUS"
    restored = await admin_client.post(f"{API}/{lead_id}/restore")
    assert restored.json()["status"] == "new"
    actions = (await db_session.scalars(select(AuditLogEntry.action))).all()
    assert {"meta_lead.dismiss", "meta_lead.restore"} <= set(actions)


async def test_sync_endpoint_requires_configuration(app, admin_client, db_session):
    response = await admin_client.post(f"{API}/sync", json={"campus_key": "yihua"})
    assert response.status_code == 409 and response.json()["detail"]["code"] == "META_LEADS_NOT_CONFIGURED"
    assert (await admin_client.get(API, params={"campus_key": "yihua"})).json()["configured"] is False


async def test_sync_endpoint_pulls_and_audits(app, meta, admin_client, db_session):
    response = await admin_client.post(f"{API}/sync", json={"campus_key": "yihua"})
    assert response.status_code == 200, response.text
    assert response.json()["counts"]["new"] == 2 and response.json()["sync"]["last_count"] == 2
    entry = (await db_session.scalars(select(AuditLogEntry).where(AuditLogEntry.action == "meta_leads.sync"))).one()
    assert entry.metadata_json == {"new_leads": 2, "sync_failed": False}


# ── 轉成參觀案件 ───────────────────────────────────────


def _manual(lead_id: str, slot_id: str, campus_key: str = "yihua") -> dict:
    return {
        "campus_key": campus_key,
        "source": "phone",
        "parent_name": "王小明",
        "phone": "0912345678",
        "consent_given": False,
        "slot_id": slot_id,
        "note": "Meta 名單：孩子 3 歲，想約 10:00",
        "meta_lead_id": lead_id,
    }


@pytest.mark.usefixtures("booking_consent")
async def test_convert_lead_to_case_with_meta_attribution(app, meta, admin_client, db_session):
    await _sync(app, meta)
    lead = (await _leads(db_session))[0]
    slot_id = await create_slot(admin_client)
    response = await admin_client.post(VISITS, json=_manual(str(lead.id), slot_id), headers={"Idempotency-Key": "lead-1"})
    assert response.status_code == 201, response.text
    case = await db_session.get(VisitRequest, uuid.UUID(response.json()["id"]))
    assert (case.status, case.source) == ("confirmed", "phone")
    assert (case.first_touch_source, case.first_touch_ad_platform) == ("ads", "meta")
    assert (case.last_touch_source, case.last_touch_ad_platform) == ("ads", "meta")
    assert case.ad_click_ids == {"meta_lead_id": lead.lead_id}

    await db_session.refresh(lead)
    assert (lead.status, lead.visit_request_id) == ("converted", case.id)
    assert (lead.parent_name, lead.phone, lead.answers) == (None, None, None)

    # 同一張補登表單重送（網路逾時重按）：回原案件，不重建。
    replay = await admin_client.post(VISITS, json=_manual(str(lead.id), slot_id), headers={"Idempotency-Key": "lead-1"})
    assert replay.status_code == 200 and replay.json()["id"] == str(case.id)
    # 換一張表單再轉同一筆：擋下。
    other = await admin_client.post(VISITS, json=_manual(str(lead.id), slot_id), headers={"Idempotency-Key": "lead-2"})
    assert other.status_code == 409 and other.json()["detail"]["code"] == "META_LEAD_STATUS"
    assert len((await db_session.scalars(select(VisitRequest))).all()) == 1


@pytest.mark.usefixtures("booking_consent")
async def test_convert_rejects_lead_from_another_campus(app, meta, admin_client, db_session):
    await _sync(app, meta)
    lead = (await _leads(db_session))[0]
    slot_id = await create_slot(admin_client, "minghua")
    response = await admin_client.post(
        VISITS, json=_manual(str(lead.id), slot_id, "minghua"), headers={"Idempotency-Key": "lead-x"}
    )
    assert response.status_code == 409 and response.json()["detail"]["code"] == "META_LEAD_CAMPUS"
    assert (await db_session.scalars(select(VisitRequest))).all() == []
    await db_session.refresh(lead)
    assert lead.status == "new"


# ── 回傳 Meta ─────────────────────────────────────────


def test_meta_lead_case_sends_crm_lead_event(isolated_settings):
    settings = isolated_settings.model_copy(update={"meta_pixel_id": "123456789", "meta_capi_token": "CAPI"})
    job = AdConversionJob(
        visit_request_id=uuid.uuid4(), event="visit_attended", platform="meta",
        occurred_at=datetime(2026, 12, 19, 2, 0, tzinfo=timezone.utc),
    )
    url, headers, body = build_request(job, {"meta_lead_id": "9000000000000001"}, "yihua", settings)
    assert url.endswith("/123456789/events") and headers == {}
    event = body["data"][0]
    assert event["event_name"] == "VisitAttended"
    assert event["action_source"] == "system_generated"
    assert event["user_data"] == {"lead_id": 9000000000000001}
    assert event["custom_data"] == {"campus_key": "yihua", "event_source": "crm", "lead_event_source": "ivy-website"}
    # 官網送單的案件照舊送 fbc／fbp。
    _, _, web = build_request(job, {"fbc": "fb.1.1.abc"}, "yihua", settings)
    assert web["data"][0]["action_source"] == "physical_store" and web["data"][0]["user_data"] == {"fbc": "fb.1.1.abc"}


def test_meta_lead_id_selects_the_meta_platform():
    # enqueue 照 PLATFORM_KEYS 看 ad_click_ids 有哪個平台的識別碼就排哪個平台。
    ids = {"meta_lead_id": "9000000000000001"}
    assert [platform for platform, keys in PLATFORM_KEYS.items() if any(ids.get(key) for key in keys)] == ["meta"]


# ── 每校自己的 token、只拉名單的粉專清單（2026-11-26，docs/specs/2026-11-26-line-group-reports-design.md §5） ──


def test_per_campus_token_and_leads_only_pages(isolated_settings):
    base = {**isolated_settings.model_dump(), "facebook_access_token": "shared", "facebook_pages": "yihua=12345"}
    plain = Settings.model_validate(base)
    assert plain.meta_leads_page_ids == {"yihua": "12345"}
    assert plain.facebook_token_for("yihua") == plain.facebook_token_for("minghua") == plain.facebook_token_for(None) == "shared"

    settings = Settings.model_validate({
        **base, "meta_leads_enabled": True, "facebook_minghua_access_token": " minghua-token ",
        "meta_leads_pages": "yihua=12345, minghua=67890",
    })
    assert settings.meta_leads_page_ids == {"yihua": "12345", "minghua": "67890"}
    assert settings.facebook_page_ids == {"yihua": "12345"}  # 粉專貼文的清單不受影響
    assert settings.facebook_token_for("minghua") == "minghua-token" and settings.facebook_token_for("yihua") == "shared"
    assert "minghua-token" not in repr(settings)
    with pytest.raises(ValidationError, match="WEBSITE_META_LEADS_PAGES"):
        Settings.model_validate({**base, "meta_leads_pages": "minghua"})


async def test_sync_uses_each_campus_token_and_the_leads_only_list(app):
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        parts = request.url.path.strip("/").split("/")
        if len(parts) == 2:
            seen[parts[1]] = token
            return httpx.Response(200, json={"access_token": f"page-{parts[1]}", "id": parts[1]})
        assert token == f"page-{parts[1]}"
        return httpx.Response(200, json={"data": []})

    settings = _settings(
        app.state.settings, facebook_pages=f"yihua={YIHUA_PAGE}",
        meta_leads_pages=f"yihua={YIHUA_PAGE},minghua={MINGHUA_PAGE}", facebook_minghua_access_token="minghua-own",
    )
    results = await sync_leads(app.state.session_factory, settings, transport=httpx.MockTransport(handler))
    assert [(r.campus_key, r.error) for r in results] == [("yihua", None), ("minghua", None)]
    assert seen == {YIHUA_PAGE: SYSTEM_TOKEN, MINGHUA_PAGE: "minghua-own"}
