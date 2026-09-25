"""待人工處理的案件清單（規格 L110、L227）與依畫面篩選的 CSV 匯出（規格 L213）。

關了時段、設了休假日或停用分校之後，既有案件不會被自動取消，但家長可能照
原時間到園——園方要拿得到「該聯絡誰」的名單，總覽的數字點進來也要是同一批。
匯出則要跟畫面上篩好的是同一批，不能篩了「已確認」卻下載整校案件。"""
from __future__ import annotations

import csv
import io
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.booking.routes import EXPORT_COLUMNS
from app.common.timezones import today_local
from app.operations.models import AuditLogEntry
from tests.test_visit_workflow import _create_slot

API = "/api/website/v1"


async def _manual(client, *, campus_key="yihua", parent_name="林爸爸", phone="0912345678", source="phone"):
    resp = await client.post(
        f"{API}/admin/visit-requests",
        json={
            "campus_key": campus_key,
            "source": source,
            "parent_name": parent_name,
            "phone": phone,
            "consent_given": True,
        },
        headers={"Idempotency-Key": f"attention-{uuid.uuid4()}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _confirmed(client, slot_id, **kwargs):
    rid = await _manual(client, **kwargs)
    resp = await client.post(f"{API}/admin/visit-requests/{rid}/confirm", json={"slot_id": slot_id})
    assert resp.status_code == 200, resp.text
    return rid


async def _ids(client, query):
    resp = await client.get(f"{API}/admin/visit-requests?{query}")
    assert resp.status_code == 200, resp.text
    return {row["id"] for row in resp.json()}


@pytest.mark.asyncio
async def test_needs_attention_lists_closed_slots_holidays_and_inactive_campuses(admin_client, minghua_client):
    closed_slot = await _create_slot(admin_client, capacity=3, days_ahead=3)
    holiday_slot = await _create_slot(admin_client, capacity=3, days_ahead=5)
    open_slot = await _create_slot(admin_client, capacity=3, days_ahead=6)
    on_closed = await _confirmed(admin_client, closed_slot["id"], parent_name="關閉場")
    cancelled = await _confirmed(admin_client, closed_slot["id"], parent_name="已取消", phone="0912345679")
    await admin_client.post(f"{API}/admin/visit-requests/{cancelled}/cancel", json={})
    on_holiday = await _confirmed(admin_client, holiday_slot["id"], parent_name="休假日")
    untouched = await _confirmed(admin_client, open_slot["id"], parent_name="照常")
    minghua_new = await _manual(admin_client, campus_key="minghua", parent_name="明華新需求")

    assert await _ids(admin_client, "needs_attention=true") == set()

    closed = await admin_client.patch(f"{API}/admin/slots/{closed_slot['id']}", json={"closed": True, "expected_version": 1})
    assert closed.status_code == 200
    holiday = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": holiday_slot["slot_date"]}
    )
    assert holiday.json()["affected_requests"] == 1
    off = await admin_client.patch(f"{API}/admin/campuses/minghua/status", json={"active": False})
    assert off.json()["open_requests"] == 1
    try:
        # 已取消的、時段照常的都不列；停用分校連還沒排時段的新需求也要聯絡。
        assert await _ids(admin_client, "needs_attention=true") == {on_closed, on_holiday, minghua_new}
        assert await _ids(admin_client, "needs_attention=true&campus_key=yihua") == {on_closed, on_holiday}
        # 分校帳號只看得到自己校。
        assert await _ids(minghua_client, "needs_attention=true") == {minghua_new}

        dashboard = (await admin_client.get(f"{API}/admin/dashboard")).json()
        assert dashboard["needs_attention"] == 3
        assert (await minghua_client.get(f"{API}/admin/dashboard")).json()["needs_attention"] == 1
    finally:
        await admin_client.patch(f"{API}/admin/campuses/minghua/status", json={"active": True})

    # 改期到開放中的場次、或重新打開時段之後，就不再需要人工處理。
    moved = await admin_client.post(
        f"{API}/admin/visit-requests/{on_closed}/reschedule", json={"new_slot_id": open_slot["id"]}
    )
    assert moved.status_code == 200, moved.text
    assert await _ids(admin_client, "needs_attention=true") == {on_holiday}
    assert untouched not in await _ids(admin_client, "needs_attention=true")
    await admin_client.delete(f"{API}/admin/visit-schedule/yihua/exceptions/{holiday.json()['id']}")
    assert await _ids(admin_client, "needs_attention=true") == set()
    assert (await admin_client.get(f"{API}/admin/dashboard")).json()["needs_attention"] == 0


@pytest.mark.asyncio
async def test_export_header_has_each_column_once(admin_client):
    await _manual(admin_client)
    resp = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua")
    assert resp.status_code == 200, resp.text
    header = next(csv.reader(io.StringIO(resp.text)))
    assert header == [
        "campus_key", "status", "source", "parent_name", "phone", "created_at",
        "child_name", "child_birthdate", "email", "referral_sources", "party_size",
        "slot_date", "start_time", "end_time",
    ]
    assert list(EXPORT_COLUMNS) == header
    assert len(set(header)) == len(header)
    row = next(csv.DictReader(io.StringIO(resp.text)))
    assert row["source"] == "phone"


@pytest.mark.asyncio
async def test_export_applies_screen_filters_and_audits_them(admin_client, db_session):
    slot = await _create_slot(admin_client, capacity=3)
    confirmed = await _confirmed(admin_client, slot["id"], parent_name="王媽媽", phone="0922000111")
    await _manual(admin_client, parent_name="李爸爸", phone="0922000222", source="line")
    await _manual(admin_client, parent_name="張媽媽", phone="0922000333", source="walk_in")

    async def export(query: str) -> list[dict]:
        resp = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua&{query}")
        assert resp.status_code == 200, resp.text
        return list(csv.DictReader(io.StringIO(resp.text)))

    everything = await export("")
    assert {r["parent_name"] for r in everything} == {"王媽媽", "李爸爸", "張媽媽"}
    assert [r["parent_name"] for r in await export("status=confirmed")] == ["王媽媽"]
    assert [r["parent_name"] for r in await export("source=line")] == ["李爸爸"]
    assert [r["parent_name"] for r in await export("q=0922000333")] == ["張媽媽"]
    assert [r["parent_name"] for r in await export("assignee=me&status=confirmed")] == ["王媽媽"]
    today = today_local()
    assert len(await export(f"created_from={today - timedelta(days=1)}&created_to={today}")) == 3
    assert await export(f"created_from={today + timedelta(days=1)}") == []
    await admin_client.patch(f"{API}/admin/slots/{slot['id']}", json={"closed": True, "expected_version": 1})
    assert [r["parent_name"] for r in await export("needs_attention=true")] == ["王媽媽"]

    # 清單與匯出同一組條件得到同一批案件。
    assert await _ids(admin_client, "campus_key=yihua&status=confirmed&needs_attention=true") == {confirmed}

    audits = (
        await db_session.execute(
            select(AuditLogEntry)
            .where(AuditLogEntry.action == "visit_request.export")
            .order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    by_query = [a.metadata_json for a in audits]
    assert by_query[0] == {"row_count": 3}
    assert by_query[1] == {"row_count": 1, "status": "confirmed"}
    # 搜尋字常常就是家長姓名或手機：只記有搜尋，不記內容。
    searched = by_query[3]
    assert searched == {"row_count": 1, "has_search": True}
    assert "0922000333" not in str(searched)
    assert by_query[5] == {
        "row_count": 3,
        "created_from": (today - timedelta(days=1)).isoformat(),
        "created_to": today.isoformat(),
    }
    assert by_query[-1] == {"row_count": 1, "needs_attention": True}
    assert all(a.campus_key == "yihua" for a in audits)
