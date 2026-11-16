"""官網 cookie 功能（2026-11-16，docs/specs/2026-11-16-cookie-features-design.md）：
§1 網站來源寫進預約、§2 到場與預繳回傳廣告平台、§3 這台裝置記住預約、統計表與匿名化。"""
from __future__ import annotations

import base64
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, update

from app.ad_conversions import service as ad_conversions
from app.ad_conversions.models import AdConversionJob
from app.admissions.models import RecruitmentVisit
from app.booking import attribution
from app.booking.models import VisitRequest
from app.operations import retention_service
from tests.admissions_helpers import ADMISSIONS, complete, started_booking, transition
from tests.conftest import book_slot

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
REMEMBERED = f"{API}/public/visit-remembered"

# 和 web/tests/attribution-cookie.spec.ts 同一組樣本：web 那邊 encodeAttribution(SAMPLE) 要等於這個字串。
SAMPLE = {
    "v": 1,
    "f": {"s": "facebook", "d": "2026-11-10"},
    "l": {"s": "ads", "d": "2026-11-16", "c": "chatgpt-five-campuses"},
    "o": {"v": "opp_AbC.123-x", "t": 1_794_787_200_000},
    "b": {"v": "IwAR0abc_DEF-123", "t": 1_794_787_200_000},
}
SAMPLE_COOKIE = base64.urlsafe_b64encode(json.dumps(SAMPLE, separators=(",", ":")).encode()).decode().rstrip("=")
SAMPLE_COOKIE_EXPECTED = (
    "eyJ2IjoxLCJmIjp7InMiOiJmYWNlYm9vayIsImQiOiIyMDI2LTExLTEwIn0sImwiOnsicyI6ImFkcyIsImQiOiIyMDI2LTExLTE2IiwiYyI6"
    "ImNoYXRncHQtZml2ZS1jYW1wdXNlcyJ9LCJvIjp7InYiOiJvcHBfQWJDLjEyMy14IiwidCI6MTc5NDc4NzIwMDAwMH0sImIiOnsidiI6Ikl3"
    "QVIwYWJjX0RFRi0xMjMiLCJ0IjoxNzk0Nzg3MjAwMDAwfX0"
)


def _enable_platforms(app) -> None:
    """三家都設好伺服器端金鑰（只在這個測試的 app 上）。"""
    app.state.settings = app.state.settings.model_copy(update={
        "ga4_measurement_id": "G-TEST12345", "ga4_api_secret": "ga-secret",
        "meta_pixel_id": "1234567890", "meta_capi_token": "meta-token",
        "openai_pixel_id": "H3LXGVGDAfgHkdJ1svTjbe", "openai_capi_key": "openai-key",
    })


# ── §1 解析 cookie ─────────────────────────────────────────────────────────────


def test_sample_cookie_is_the_shared_fixture():
    assert SAMPLE_COOKIE == SAMPLE_COOKIE_EXPECTED


def test_parse_site_cookie_reads_every_field():
    site = attribution.parse_site_cookie(SAMPLE_COOKIE)
    assert site is not None
    assert site.first == attribution.Touch("facebook", None, date(2026, 11, 10))
    assert site.last == attribution.Touch("ads", "chatgpt-five-campuses", date(2026, 11, 16))
    assert site.oppref is not None and site.oppref.value == "opp_AbC.123-x"
    assert site.fbclid is not None and site.fbclid.value == "IwAR0abc_DEF-123"
    assert attribution.touch_columns(site) == {
        "first_touch_source": "facebook", "first_touch_campaign": None, "first_touch_on": date(2026, 11, 10),
        "last_touch_source": "ads", "last_touch_campaign": "chatgpt-five-campuses", "last_touch_on": date(2026, 11, 16),
        "first_touch_ad_platform": None, "last_touch_ad_platform": None,
    }


@pytest.mark.parametrize("raw", [None, "", "!!!", "e30", base64.urlsafe_b64encode(b'{"v":2}').decode(), "a" * 4000])
def test_parse_site_cookie_rejects_garbage(raw):
    assert attribution.parse_site_cookie(raw) is None


def test_parse_site_cookie_drops_bad_fields_but_keeps_the_rest():
    bad = {"v": 1, "f": {"s": "evil", "d": "2026-11-10"}, "l": {"s": "search", "d": "2026-11-12", "c": "Bad Campaign!"},
           "o": {"v": "x;y", "t": 1_794_787_200_000}, "b": {"v": "ok", "t": True}}
    raw = base64.urlsafe_b64encode(json.dumps(bad).encode()).decode().rstrip("=")
    site = attribution.parse_site_cookie(raw)
    assert site is not None
    assert site.first is None
    assert site.last == attribution.Touch("search", None, date(2026, 11, 12))
    assert site.oppref is None and site.fbclid is None


def test_click_ids_only_for_configured_platforms():
    now = datetime(2026, 11, 20, tzinfo=timezone.utc)
    site = attribution.parse_site_cookie(SAMPLE_COOKIE)
    cookies = {"_ga": "GA1.1.123456789.1763000000", "_fbp": "fb.1.1763000000000.987654321", "__obref": "ob.ref-1"}
    assert attribution.click_ids(cookies, site, (), now) is None
    assert attribution.click_ids(cookies, site, ("ga4",), now) == {"ga_client_id": "123456789.1763000000"}
    meta = attribution.click_ids(cookies, site, ("meta",), now)
    # 沒有 _fbc 時用落地的 fbclid 自己組。
    assert meta == {"fbc": "fb.1.1794787200000.IwAR0abc_DEF-123", "fbp": "fb.1.1763000000000.987654321"}
    assert attribution.click_ids({**cookies, "_fbc": "fb.1.1763000000001.realclick"}, site, ("meta",), now)["fbc"] == (
        "fb.1.1763000000001.realclick"
    )
    assert attribution.click_ids(cookies, site, ("openai",), now) == {"oppref": "opp_AbC.123-x", "obref": "ob.ref-1"}
    # 點擊超過 30 天不算。
    late = now + timedelta(days=40)
    assert attribution.click_ids({}, site, ("openai", "meta"), late) is None


# ── §1 送單寫進預約 ───────────────────────────────────────────────────────────


async def _row(db_session, receipt_id) -> VisitRequest:
    db_session.expire_all()
    return (await db_session.execute(select(VisitRequest).where(VisitRequest.id == uuid.UUID(receipt_id)))).scalar_one()


@pytest.mark.asyncio
async def test_submission_records_site_source_from_cookie(admin_client, public_client, db_session):
    public_client.cookies.set(attribution.SITE_COOKIE, SAMPLE_COOKIE)
    booked = await book_slot(admin_client, public_client)
    row = await _row(db_session, booked["receipt_id"])
    assert (row.first_touch_source, row.first_touch_on) == ("facebook", date(2026, 11, 10))
    assert (row.last_touch_source, row.last_touch_campaign) == ("ads", "chatgpt-five-campuses")
    # 沒有設定任何平台：不記點擊識別碼。
    assert row.ad_click_ids is None

    detail = (await admin_client.get(f"{API}/admin/visit-requests/{booked['receipt_id']}")).json()
    assert detail["last_touch_source"] == "ads" and detail["first_touch_campaign"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("header", [{"DNT": "1"}, {"Sec-GPC": "1"}])
async def test_dnt_or_gpc_skips_site_source(app, admin_client, public_client, db_session, header):
    _enable_platforms(app)
    public_client.cookies.set(attribution.SITE_COOKIE, SAMPLE_COOKIE)
    public_client.cookies.set("_ga", "GA1.1.1.2")
    public_client.headers.update(header)
    booked = await book_slot(admin_client, public_client)
    row = await _row(db_session, booked["receipt_id"])
    assert row.first_touch_source is None and row.last_touch_source is None and row.ad_click_ids is None


@pytest.mark.asyncio
async def test_submission_records_click_ids_for_configured_platforms(app, admin_client, public_client, db_session):
    _enable_platforms(app)
    public_client.cookies.set(attribution.SITE_COOKIE, SAMPLE_COOKIE)
    public_client.cookies.set("_ga", "GA1.1.555.666")
    public_client.cookies.set("_fbc", "fb.1.1763251200000.click")
    booked = await book_slot(admin_client, public_client)
    row = await _row(db_session, booked["receipt_id"])
    assert row.ad_click_ids["ga_client_id"] == "555.666"
    assert row.ad_click_ids["fbc"] == "fb.1.1763251200000.click"
    assert row.ad_click_ids["oppref"] == "opp_AbC.123-x"
    assert "obref" not in row.ad_click_ids


# ── §3 這台裝置記住預約 ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_booking_remembers_the_visit_on_this_device(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    assert public_client.cookies.get("ivy_visit_remember") == booked["manage_path"].split("token=", 1)[1]
    set_cookie = booked["response"].headers["set-cookie"]
    assert "HttpOnly" in set_cookie and "SameSite=lax" in set_cookie and "Path=/" in set_cookie

    found = await public_client.get(REMEMBERED)
    assert found.status_code == 200, found.text
    body = found.json()
    assert body["campus_key"] == "yihua" and body["slot_date"] == booked["slot_date"]
    assert set(body) == {"campus_key", "campus_name", "slot_date", "start_time", "end_time"}
    assert found.headers["cache-control"] == "private, no-store"

    opened = await public_client.post(f"{REMEMBERED}/open")
    assert opened.status_code == 200, opened.text
    me = await public_client.get(f"{API}/public/visit-manage/me")
    assert me.status_code == 200 and me.json()["id"] == booked["receipt_id"]


@pytest.mark.asyncio
async def test_forget_clears_the_cookie_only(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    gone = await public_client.delete(REMEMBERED)
    assert gone.status_code == 204
    assert public_client.cookies.get("ivy_visit_remember") is None
    assert (await public_client.get(REMEMBERED)).status_code == 204
    # 預約本身與修改連結都還在。
    detail = (await admin_client.get(f"{API}/admin/visit-requests/{booked['receipt_id']}")).json()
    assert detail["status"] == "confirmed"


@pytest.mark.asyncio
async def test_cancelled_visit_is_forgotten(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})
    found = await public_client.get(REMEMBERED)
    assert found.status_code == 204
    assert public_client.cookies.get("ivy_visit_remember") is None
    opened = await public_client.post(f"{REMEMBERED}/open")
    assert opened.status_code == 401


@pytest.mark.asyncio
async def test_remembered_endpoints_need_the_parent_header(app, admin_client, public_client):
    await book_slot(admin_client, public_client)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as bare:
        bare.cookies.set("ivy_visit_remember", public_client.cookies.get("ivy_visit_remember"))
        assert (await bare.get(REMEMBERED)).status_code == 403
        assert (await bare.post(f"{REMEMBERED}/open")).status_code == 403


@pytest.mark.asyncio
async def test_forged_cookie_is_ignored(public_client):
    public_client.cookies.set("ivy_visit_remember", "not-a-real-token")
    assert (await public_client.get(REMEMBERED)).status_code == 204
    assert (await public_client.post(f"{REMEMBERED}/open")).status_code == 401


# ── §2 排入與送出 ─────────────────────────────────────────────────────────────


async def _jobs(db_session) -> list[AdConversionJob]:
    db_session.expire_all()
    return list((await db_session.execute(select(AdConversionJob).order_by(AdConversionJob.platform))).scalars())


@pytest.mark.asyncio
async def test_attendance_and_deposit_enqueue_jobs(app, admin_client, public_client, db_session):
    _enable_platforms(app)
    public_client.cookies.set("_ga", "GA1.1.555.666")
    public_client.cookies.set("_fbp", "fb.1.1763000000000.42")
    booking = await started_booking(admin_client, public_client, db_session)
    assert (await complete(admin_client, booking["id"])).status_code == 200
    jobs = await _jobs(db_session)
    assert [(j.platform, j.event, j.status) for j in jobs] == [
        ("ga4", "visit_attended", "pending"), ("meta", "visit_attended", "pending"),
    ]

    visit_id = (await db_session.execute(
        select(RecruitmentVisit.id).where(RecruitmentVisit.visit_request_id == uuid.UUID(booking["id"]))
    )).scalar_one()
    record = (await admin_client.get(f"{ADMISSIONS}/records/{visit_id}")).json()
    deposited = await transition(admin_client, record, "deposited")
    events = sorted((j.platform, j.event) for j in await _jobs(db_session))
    assert ("ga4", "deposit_paid") in events and ("meta", "deposit_paid") in events
    # 退預繳再預繳不重排。
    back = await transition(admin_client, deposited, "visited")
    await transition(admin_client, back, "deposited")
    assert len(await _jobs(db_session)) == 4


@pytest.mark.asyncio
async def test_attendance_without_click_ids_enqueues_nothing(admin_client, public_client, db_session):
    booking = await started_booking(admin_client, public_client, db_session)
    assert (await complete(admin_client, booking["id"])).status_code == 200
    assert await _jobs(db_session) == []


async def _job_for(app, db_session, platform: str, ids: dict, *, occurred_at: datetime | None = None, **visit) -> AdConversionJob:
    booking = await book_slot_direct(app, db_session, ids, **visit)
    now = occurred_at or datetime.now(timezone.utc)
    job = AdConversionJob(
        id=uuid.uuid4(), visit_request_id=booking.id, event="visit_attended", platform=platform, status="pending",
        occurred_at=now, attempts=0, next_attempt_at=now, created_at=now,
    )
    db_session.add(job)
    await db_session.commit()
    return job


async def book_slot_direct(app, db_session, ids: dict, **visit) -> VisitRequest:
    row = (await db_session.execute(select(VisitRequest).limit(1))).scalar_one()
    await db_session.execute(update(VisitRequest).where(VisitRequest.id == row.id).values(ad_click_ids=ids, **visit))
    await db_session.commit()
    return row


class _Recorder:
    def __init__(self, status: int = 204, body: str = ""):
        self.requests: list[httpx.Request] = []
        self.status = status
        self.body = body

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, text=self.body)


@pytest.mark.asyncio
async def test_process_due_sends_each_platform_format(app, admin_client, public_client, db_session):
    _enable_platforms(app)
    await book_slot(admin_client, public_client)
    ids = {"ga_client_id": "555.666", "fbc": "fb.1.1763251200000.click", "fbp": "fb.1.1.2", "oppref": "opp1", "obref": "ob1"}
    for platform in ("ga4", "meta", "openai"):
        await _job_for(app, db_session, platform, ids)
    recorder = _Recorder()
    async with app.state.session_factory() as db:
        counts = await ad_conversions.process_due(db, app.state.settings, transport=httpx.MockTransport(recorder))
    assert counts == {"sent": 3, "failed": 0, "skipped": 0, "retried": 0}
    by_host = {request.url.host: request for request in recorder.requests}

    ga = by_host["www.google-analytics.com"]
    assert ga.url.params["measurement_id"] == "G-TEST12345" and ga.url.params["api_secret"] == "ga-secret"
    ga_body = json.loads(ga.content)
    assert ga_body["client_id"] == "555.666" and ga_body["events"][0]["name"] == "visit_attended"
    assert ga_body["events"][0]["params"]["campus_key"] == "yihua"

    meta = by_host["graph.facebook.com"]
    assert meta.url.path == "/v26.0/1234567890/events" and "access_token" not in str(meta.url)
    meta_event = json.loads(meta.content)["data"][0]
    assert meta_event["event_name"] == "VisitAttended" and meta_event["action_source"] == "physical_store"
    assert meta_event["user_data"] == {"fbc": "fb.1.1763251200000.click", "fbp": "fb.1.1.2"}

    openai = by_host["bzr.openai.com"]
    assert openai.url.params["pid"] == "H3LXGVGDAfgHkdJ1svTjbe"
    assert openai.headers["authorization"] == "Bearer openai-key"
    event = json.loads(openai.content)["events"][0]
    assert event["type"] == "custom" and event["custom_event_name"] == "visit_attended"
    assert event["oppref"] == "opp1" and event["user"] == {"obref": "ob1"}

    # 不送任何個資：姓名、電話都不在任何一個請求裡。
    for request in recorder.requests:
        assert "陳媽媽" not in request.content.decode() and "0912345678" not in request.content.decode()
    assert {j.status for j in await _jobs(db_session)} == {"sent"}


@pytest.mark.asyncio
async def test_process_due_retries_then_fails(app, admin_client, public_client, db_session):
    _enable_platforms(app)
    await book_slot(admin_client, public_client)
    first_due = (await _job_for(app, db_session, "ga4", {"ga_client_id": "1.2"})).next_attempt_at
    async with app.state.session_factory() as db:
        counts = await ad_conversions.process_due(db, app.state.settings, transport=httpx.MockTransport(_Recorder(503)))
    assert counts["retried"] == 1
    [row] = await _jobs(db_session)
    assert row.status == "pending" and row.attempts == 1 and row.next_attempt_at > first_due

    await db_session.execute(update(AdConversionJob).values(next_attempt_at=datetime.now(timezone.utc)))
    await db_session.commit()
    async with app.state.session_factory() as db:
        counts = await ad_conversions.process_due(db, app.state.settings, transport=httpx.MockTransport(_Recorder(400, "bad")))
    assert counts["failed"] == 1
    [row] = await _jobs(db_session)
    assert row.status == "failed" and row.last_error.startswith("HTTP 400")


@pytest.mark.asyncio
async def test_process_due_skips_expired_unconfigured_and_anonymized(app, admin_client, public_client, db_session):
    await book_slot(admin_client, public_client)
    old = datetime.now(timezone.utc) - timedelta(days=4)
    await _job_for(app, db_session, "ga4", {"ga_client_id": "1.2"}, occurred_at=old)
    recorder = _Recorder()
    # 平台沒設定：skipped。
    async with app.state.session_factory() as db:
        assert (await ad_conversions.process_due(db, app.state.settings, transport=httpx.MockTransport(recorder)))["skipped"] == 1
    assert (await _jobs(db_session))[0].last_error == "not_configured"

    _enable_platforms(app)
    await db_session.execute(update(AdConversionJob).values(status="pending", finished_at=None, last_error=None))
    await db_session.commit()
    async with app.state.session_factory() as db:
        await ad_conversions.process_due(db, app.state.settings, transport=httpx.MockTransport(recorder))
    assert (await _jobs(db_session))[0].last_error == "expired"
    assert recorder.requests == []


@pytest.mark.asyncio
async def test_anonymize_clears_click_ids(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(booked["receipt_id"]))
        .values(ad_click_ids={"ga_client_id": "1.2"}, first_touch_source="search")
    )
    await db_session.commit()
    row = await _row(db_session, booked["receipt_id"])
    assert await retention_service.anonymize(db_session, row)
    await db_session.commit()
    row = await _row(db_session, booked["receipt_id"])
    assert row.ad_click_ids is None and row.first_touch_source == "search"


# ── 統計表 ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_attribution_outcomes_groups_by_source(admin_client, public_client, second_public_client, db_session):
    public_client.cookies.set(attribution.SITE_COOKIE, SAMPLE_COOKIE)
    first = await started_booking(admin_client, public_client, db_session)
    assert (await complete(admin_client, first["id"])).status_code == 200
    # 第二筆沒有 cookie：沒有記錄。
    await book_slot(admin_client, second_public_client, phone="0912000111", days_ahead=4)

    last = (await admin_client.get(f"{API}/admin/analytics/booking-attribution", params={"touch": "last"})).json()
    rows = {row["source"]: row for row in last["rows"]}
    assert rows["ads"]["cases"] == 1 and rows["ads"]["completed"] == 1
    assert rows["ads"]["attendance_rate"]["value"] == 100.0
    assert rows["ads"]["campaigns"][0]["campaign"] == "chatgpt-five-campuses"
    assert rows["unrecorded"]["cases"] == 1
    assert last["totals"]["cases"] == 2

    first_touch = (await admin_client.get(f"{API}/admin/analytics/booking-attribution", params={"touch": "first"})).json()
    assert {row["source"] for row in first_touch["rows"]} == {"facebook", "unrecorded"}

    one = (await admin_client.get(
        f"{API}/admin/analytics/booking-attribution", params={"touch": "last", "campus_key": "minghua"}
    )).json()
    assert one["totals"]["cases"] == 0


@pytest.mark.asyncio
async def test_last_touch_falls_back_to_direct(admin_client, public_client, db_session):
    only_first = {"v": 1, "f": {"s": "direct", "d": "2026-11-16"}}
    public_client.cookies.set(
        attribution.SITE_COOKIE, base64.urlsafe_b64encode(json.dumps(only_first).encode()).decode().rstrip("=")
    )
    await book_slot(admin_client, public_client)
    last = (await admin_client.get(f"{API}/admin/analytics/booking-attribution", params={"touch": "last"})).json()
    assert [row["source"] for row in last["rows"]] == ["direct"]
