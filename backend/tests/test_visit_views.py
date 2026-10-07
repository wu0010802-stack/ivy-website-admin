"""案件列表的接待頁籤（2026-10-06 方向 B）：接下來以台北「今天」為界、今天整天都在；
時間已過是場次已開始、還沒到場（含沒來）；已到場、已取消各一頁。頁籤可以重疊。"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, time, timedelta

import pytest
from sqlalchemy import select, update

from app.booking import status_groups
from app.booking.models import VisitRequest, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local
from app.operations.models import AuditLogEntry
from tests.conftest import create_slot, legacy_request

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"


async def _case(admin_client, name: str, *, days_ahead: int, campus_key: str = "yihua") -> str:
    """櫃台補登一筆（不經官網送單，避開每校每小時的送單上限）。"""
    slot_id = await create_slot(admin_client, campus_key, days_ahead=days_ahead)
    resp = await admin_client.post(
        f"{API}/admin/visit-requests",
        json={"campus_key": campus_key, "source": "phone", "parent_name": name, "phone": "0912345678", "consent_given": True, "slot_id": slot_id},
        headers={"Idempotency-Key": f"views-{uuid.uuid4()}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _move(db, case_id: str, *, days: int, start: time, end: time) -> None:
    """把案件的場次移到今天加 days 天（測試前置；公開預約與補登只收還沒開始的場次）。"""
    slot_id = await db.scalar(select(VisitRequest.slot_id).where(VisitRequest.id == uuid.UUID(case_id)))
    await db.execute(
        update(VisitSlot).where(VisitSlot.id == slot_id).values(slot_date=today_local() + timedelta(days=days), start_time=start, end_time=end)
    )
    await db.commit()


async def _ids(client, **params) -> list[str]:
    resp = await client.get(f"{API}/admin/visit-requests", params=params)
    assert resp.status_code == 200, resp.text
    return [row["id"] for row in resp.json()]


async def _scenario(admin_client, db) -> dict[str, str]:
    cases = {
        "future": await _case(admin_client, "三天後", days_ahead=3),
        "today_started": await _case(admin_client, "今天還沒標", days_ahead=4),
        "today_arrived": await _case(admin_client, "今天到了", days_ahead=5),
        "yesterday_unmarked": await _case(admin_client, "昨天沒標", days_ahead=6),
        "yesterday_no_show": await _case(admin_client, "昨天沒來", days_ahead=7),
        "old_arrived": await _case(admin_client, "前天到了", days_ahead=8),
        "cancelled": await _case(admin_client, "取消了", days_ahead=9),
    }
    await _move(db, cases["today_started"], days=0, start=time(0, 0), end=time(0, 30))
    await _move(db, cases["today_arrived"], days=0, start=time(0, 0), end=time(0, 30))
    await _move(db, cases["yesterday_unmarked"], days=-1, start=time(10, 0), end=time(11, 0))
    await _move(db, cases["yesterday_no_show"], days=-1, start=time(11, 0), end=time(12, 0))
    await _move(db, cases["old_arrived"], days=-2, start=time(10, 0), end=time(11, 0))
    for key, action in (("today_arrived", "complete"), ("old_arrived", "complete"), ("yesterday_no_show", "no-show")):
        resp = await admin_client.post(f"{API}/admin/visit-requests/{cases[key]}/{action}")
        assert resp.status_code == 200, resp.text
    assert (await admin_client.post(f"{API}/admin/visit-requests/{cases['cancelled']}/cancel", json={})).status_code == 200
    return cases


@pytest.mark.asyncio
async def test_views_split_by_taipei_today_and_counts(admin_client, db_session):
    c = await _scenario(admin_client, db_session)
    assert set(await _ids(admin_client, view="upcoming")) == {c["future"], c["today_started"], c["today_arrived"]}
    assert set(await _ids(admin_client, view="past")) == {c["today_started"], c["yesterday_unmarked"], c["yesterday_no_show"]}
    assert set(await _ids(admin_client, view="arrived")) == {c["today_arrived"], c["old_arrived"]}
    assert set(await _ids(admin_client, view="cancelled")) == {c["cancelled"]}
    # 「只看尚未確認到場」＝時間已過＋預約正常，和總覽 awaiting_attendance 同一批。
    assert set(await _ids(admin_client, view="past", status="confirmed")) == {c["today_started"], c["yesterday_unmarked"]}

    counts = await admin_client.get(f"{API}/admin/visit-requests/view-counts")
    assert counts.status_code == 200, counts.text
    assert counts.json() == {"upcoming": 3, "past_unmarked": 2}
    dashboard = (await admin_client.get(f"{API}/admin/dashboard")).json()
    assert dashboard["awaiting_attendance"] == counts.json()["past_unmarked"]


@pytest.mark.asyncio
async def test_visit_order_sorts_by_slot_and_pages_stably(admin_client, db_session):
    c = await _scenario(admin_client, db_session)
    assert await _ids(admin_client, view="upcoming", order="visit_asc") == [c["today_started"], c["today_arrived"], c["future"]]
    assert await _ids(admin_client, view="past", order="visit_desc") == [c["today_started"], c["yesterday_no_show"], c["yesterday_unmarked"]]
    assert await _ids(admin_client, view="upcoming", order="visit_asc", page_size=2, page=2) == [c["future"]]


@pytest.mark.asyncio
async def test_visit_order_puts_cases_without_slot_last_in_both_directions(admin_client, db_session):
    c = await _scenario(admin_client, db_session)
    no_slot = await legacy_request(db_session, status="cancelled", parent_name="沒有場次")
    await db_session.commit()
    everyone = {c["today_started"], c["today_arrived"], c["future"], c["yesterday_unmarked"], c["yesterday_no_show"], c["old_arrived"], c["cancelled"]}
    asc = await _ids(admin_client, order="visit_asc")
    desc = await _ids(admin_client, order="visit_desc")
    assert asc[-1] == no_slot and desc[-1] == no_slot
    assert set(asc) == set(desc) == everyone | {no_slot}
    # 今天 00:00 的兩筆同一時間：依送出時間，遞增先送的在前、遞減先送的在後。
    assert asc.index(c["today_started"]) < asc.index(c["today_arrived"])
    assert desc.index(c["today_arrived"]) < desc.index(c["today_started"])
    # 沒有場次的案件不屬於接下來（今天起的場次才算）。
    assert no_slot not in await _ids(admin_client, view="upcoming")
    assert no_slot in await _ids(admin_client, view="cancelled")


@pytest.mark.asyncio
async def test_today_not_started_is_upcoming_but_not_past(admin_client, db_session):
    case = await _case(admin_client, "今天下午", days_ahead=3)
    await _move(db_session, case, days=0, start=time(14, 0), end=time(15, 0))
    morning = datetime.combine(today_local(), time(0, 0, 30), tzinfo=OPERATING_TZ)

    async def members(view: str) -> set[str]:
        rows = await db_session.execute(select(VisitRequest.id).where(status_groups.view_condition(view, morning)))
        return {str(row) for row in rows.scalars()}

    assert case in await members("upcoming")
    assert case not in await members("past")


@pytest.mark.asyncio
@pytest.mark.parametrize(("param", "value"), [("view", "pending"), ("view", "all"), ("order", "visit")])
async def test_unknown_view_or_order_is_rejected(admin_client, param, value):
    response = await admin_client.get(f"{API}/admin/visit-requests", params={param: value})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_export_and_counts_follow_view_and_campus_scope(admin_client, minghua_client, db_session):
    c = await _scenario(admin_client, db_session)
    resp = await admin_client.get(f"{API}/admin/visit-requests/export", params={"view": "cancelled"})
    assert resp.status_code == 200, resp.text
    names = {row[3] for row in list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))[1:]}
    assert names == {"取消了"}
    # 匯出稽核記下用了哪個頁籤（只記條件，不記內容）。
    entry = (await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "visit_request.export"))).scalar_one()
    assert entry.metadata_json == {"row_count": 1, "view": "cancelled"}
    other = await minghua_client.get(f"{API}/admin/visit-requests/view-counts")
    assert other.status_code == 200, other.text
    assert other.json() == {"upcoming": 0, "past_unmarked": 0}
    assert c["future"] not in await _ids(minghua_client, view="upcoming")
