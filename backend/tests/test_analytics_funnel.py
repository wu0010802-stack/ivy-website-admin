"""成效統計補完（2026-09-25 缺口 B11 #62、#63）：公開點擊以 event id 去重、
入口代碼白名單、伺服器產生 visit_cancelled 並分原因、漏斗依台北日期區間與
來源分組。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.booking import workflow_service
from app.booking.models import VisitRequest
from app.common import timezones
from app.operations.models import CTA_ENTRIES, AnalyticsEvent, AnalyticsEventType
from tests.conftest import set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
BASE = f"{API}/admin"


def _click(event_type="booking_cta_clicked", campus_key="yihua", entry="campus_hero", event_id=None) -> dict:
    return {"event_type": event_type, "campus_key": campus_key, "entry": entry, "event_id": str(event_id or uuid.uuid4())}


async def _funnel(client, query: str = "") -> dict:
    response = await client.get(f"{BASE}/analytics/funnel?campus_key=yihua{query}")
    assert response.status_code == 200, response.text
    return response.json()


async def _submit(admin_client, public_client, key: str, **extra) -> str:
    response = await set_booking_mode(admin_client, "yihua", mode="inquiry")
    assert response.status_code == 200, response.text
    response = await public_client.post(
        f"{API}/public/visit-requests",
        json={
            "campus_key": "yihua",
            "config_version": response.json()["version"],
            "parent_name": "陳媽媽",
            "phone": "0912345678",
            "consent_given": True,
            **extra,
        },
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 201, response.text
    return response.json()["receipt_id"]


# --- #63 公開點擊：event id 去重與入口代碼 ---------------------------------


@pytest.mark.asyncio
async def test_resent_click_with_same_event_id_counts_once(public_client, admin_client, db_session):
    event_id = uuid.uuid4()
    for _ in range(3):
        response = await public_client.post(f"{API}/public/analytics-events", json=_click(event_id=event_id))
        assert response.status_code == 204
    await public_client.post(f"{API}/public/analytics-events", json=_click(entry="campus_banner"))

    funnel = await _funnel(admin_client)
    assert funnel["counts"]["booking_cta_clicked"] == 2
    entries = {row["entry"]: row["counts"]["booking_cta_clicked"] for row in funnel["clicks_by_entry"]}
    assert entries == {"campus_hero": 1, "campus_banner": 1}
    rows = (await db_session.execute(select(AnalyticsEvent).where(AnalyticsEvent.event_id == event_id))).scalars().all()
    assert len(rows) == 1 and rows[0].entry == "campus_hero"


@pytest.mark.asyncio
async def test_click_requires_event_id_and_known_entry(public_client):
    no_id = _click()
    del no_id["event_id"]
    assert (await public_client.post(f"{API}/public/analytics-events", json=no_id)).status_code == 422
    bad_id = {**_click(), "event_id": "parent-phone-0912345678"}
    assert (await public_client.post(f"{API}/public/analytics-events", json=bad_id)).status_code == 422
    unknown_entry = _click(entry="injected<script>")
    assert (await public_client.post(f"{API}/public/analytics-events", json=unknown_entry)).status_code == 422
    # 不收入口與事件以外的欄位（例如頁面網址、家長資料）。
    extra = {**_click(), "page_url": "/visit/manage#token=secret"}
    assert (await public_client.post(f"{API}/public/analytics-events", json=extra)).status_code == 422
    for entry in CTA_ENTRIES:
        assert (await public_client.post(f"{API}/public/analytics-events", json=_click(entry=entry))).status_code == 204


@pytest.mark.asyncio
async def test_click_without_campus_is_shown_only_to_all_campus_viewers(public_client, admin_client, minghua_client):
    await public_client.post(f"{API}/public/analytics-events", json=_click(campus_key=None, entry="header"))
    funnel = await _funnel(admin_client)
    assert funnel["counts"]["booking_cta_clicked"] == 0
    assert funnel["unassigned_clicks"]["booking_cta_clicked"] == 1
    minghua = await minghua_client.get(f"{BASE}/analytics/funnel?campus_key=minghua")
    assert minghua.status_code == 200
    assert minghua.json()["unassigned_clicks"] is None


@pytest.mark.asyncio
async def test_public_endpoint_still_rejects_server_side_events(public_client):
    for event_type in ("visit_cancelled", "request_created"):
        response = await public_client.post(f"{API}/public/analytics-events", json=_click(event_type=event_type))
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "EVENT_TYPE_NOT_ALLOWED"


# --- #62 visit_cancelled 與取消原因 -----------------------------------------


@pytest.mark.asyncio
async def test_cancellations_are_recorded_with_reason(admin_client, public_client, db_session):
    staff = await _submit(admin_client, public_client, "b11-cancel-staff")
    assert (await admin_client.post(f"{BASE}/visit-requests/{staff}/cancel")).status_code == 200
    # 重複取消是冪等的，不會多記一筆。
    assert (await admin_client.post(f"{BASE}/visit-requests/{staff}/cancel")).status_code == 200

    parent = await _submit(admin_client, public_client, "b11-cancel-parent")
    link = await admin_client.post(f"{BASE}/visit-requests/{parent}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]
    await public_client.post(f"{API}/public/visit-manage/exchange", json={"token": token})
    assert (await public_client.post(f"{API}/public/visit-manage/cancel")).status_code == 200

    response = await set_booking_mode(admin_client, "yihua", mode="slots", slots_auto_confirm=False)
    version = response.json()["version"]
    slot = await admin_client.post(
        f"{BASE}/slots?campus_key=yihua",
        json={"slot_date": (date.today() + timedelta(days=3)).isoformat(), "start_time": "10:00:00", "end_time": "11:00:00", "capacity": 2},
    )
    held = await public_client.post(
        f"{API}/public/visit-requests",
        json={"campus_key": "yihua", "config_version": version, "parent_name": "林爸爸", "phone": "0922333444", "consent_given": True, "slot_id": slot.json()["id"]},
        headers={"Idempotency-Key": "b11-cancel-hold"},
    )
    row = await db_session.get(VisitRequest, uuid.UUID(held.json()["receipt_id"]))
    row.hold_expires_at = timezones.now_utc() - timedelta(minutes=1)
    await db_session.commit()
    assert await workflow_service.expire_holds(db_session) == 1
    await db_session.commit()

    funnel = await _funnel(admin_client)
    assert funnel["counts"]["visit_cancelled"] == 3
    assert funnel["cancelled_by_reason"] == {"staff": 1, "parent": 1, "hold_expired": 1}
    # 事件只留去識別的快照，不帶姓名、電話或案件 id。
    events = (await db_session.execute(
        select(AnalyticsEvent).where(AnalyticsEvent.event_type == AnalyticsEventType.VISIT_CANCELLED)
    )).scalars().all()
    assert {e.source for e in events} == {"web"}
    assert "0912345678" not in str([vars(e) for e in events])


# --- #62 日期區間與來源維度 ---------------------------------------------------


@pytest.mark.asyncio
async def test_funnel_groups_by_source_and_referral(admin_client, public_client, db_session):
    web = await _submit(admin_client, public_client, "b11-src-web", referral_sources=["facebook", "friends_family"])
    await _submit(admin_client, public_client, "b11-src-none")
    manual = await admin_client.post(
        f"{BASE}/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": "王媽媽", "phone": "0933444555", "consent_given": True},
        headers={"Idempotency-Key": "b11-src-manual"},
    )
    assert manual.status_code == 201, manual.text
    assert (await admin_client.post(f"{BASE}/visit-requests/{manual.json()['id']}/cancel")).status_code == 200
    assert (await admin_client.post(f"{BASE}/visit-requests/{web}/cancel")).status_code == 200
    # 2026-09-25 以前的事件沒有來源快照。
    db_session.add(AnalyticsEvent(event_type=AnalyticsEventType.REQUEST_CREATED, campus_key="yihua", created_at=timezones.now_utc()))
    await db_session.commit()

    funnel = await _funnel(admin_client)
    assert funnel["counts"]["request_created"] == 3
    by_source = {row["source"]: row["counts"] for row in funnel["by_source"]}
    assert by_source["web"]["request_created"] == 2
    assert by_source["web"]["visit_cancelled"] == 1
    assert by_source["phone"]["request_created"] == 0  # 補登不算官網送出的需求
    assert by_source["phone"]["visit_cancelled"] == 1
    assert by_source["unknown"]["request_created"] == 1
    by_referral = {row["referral"]: row["counts"] for row in funnel["by_referral"]}
    assert by_referral["facebook"]["request_created"] == 1
    assert by_referral["friends_family"]["request_created"] == 1
    assert by_referral["facebook"]["visit_cancelled"] == 1
    assert by_referral["none"]["request_created"] == 1
    assert by_referral["unknown"]["request_created"] == 1


@pytest.mark.asyncio
async def test_funnel_date_range_uses_taipei_day_boundaries(admin_client, db_session):
    def at(value: str) -> datetime:
        return datetime.fromisoformat(value).astimezone(timezone.utc)

    for created_at in (
        at("2026-03-31T23:59:00+08:00"),  # 台北 3/31，UTC 已是 3/31 15:59
        at("2026-04-01T00:10:00+08:00"),  # 台北 4/1，UTC 還是 3/31
        at("2026-04-30T23:50:00+08:00"),
        at("2026-05-01T00:00:00+08:00"),
    ):
        db_session.add(AnalyticsEvent(
            event_type=AnalyticsEventType.REQUEST_CREATED, campus_key="yihua", created_at=created_at, source="web", referral_sources=[],
        ))
    await db_session.commit()

    april = await _funnel(admin_client, "&from=2026-04-01&to=2026-04-30")
    assert april["counts"]["request_created"] == 2
    assert april["date_from"] == "2026-04-01" and april["date_to"] == "2026-04-30"
    assert (await _funnel(admin_client, "&from=2026-05-01"))["counts"]["request_created"] == 1
    assert (await _funnel(admin_client, "&to=2026-03-31"))["counts"]["request_created"] == 1
    assert (await _funnel(admin_client))["counts"]["request_created"] == 4

    reversed_range = await admin_client.get(f"{BASE}/analytics/funnel?campus_key=yihua&from=2026-04-30&to=2026-04-01")
    assert reversed_range.status_code == 422
    assert reversed_range.json()["detail"]["code"] == "INVALID_DATE_RANGE"
    too_long = await admin_client.get(f"{BASE}/analytics/funnel?campus_key=yihua&from=2025-01-01&to=2026-04-01")
    assert too_long.status_code == 422


@pytest.mark.asyncio
async def test_funnel_other_campus_is_hidden(minghua_client):
    response = await minghua_client.get(f"{BASE}/analytics/funnel?campus_key=yihua")
    assert response.status_code == 404
