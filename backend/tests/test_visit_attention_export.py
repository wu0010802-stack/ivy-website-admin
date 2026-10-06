"""待人工處理的案件清單（規格 L110、L227）與依畫面篩選的 CSV 匯出（規格 L213）。

關了時段、設了休假日或停用分校之後，既有案件不會被自動取消，但家長可能照
原時間到園——園方要拿得到「該聯絡誰」的名單，總覽的數字點進來也要是同一批。
（2026-09-30 起手動「停止申請」只是不收新預約，已約的家長照常參觀，不列入；
休假日整天關閉與停用分校才要人工聯絡。）
匯出則要跟畫面上篩好的是同一批，不能篩了「已確認」卻下載整校案件。"""
from __future__ import annotations

import csv
import io
import uuid
from datetime import timedelta
from typing import get_args

import pytest
from sqlalchemy import select

from app.booking import export_labels
from app.booking.models import VisitRequest, VisitRequestSource, VisitRequestStatus
from app.booking.schemas import ReferralSource
from app.common.timezones import OPERATING_TZ, today_local
from app.operations.models import AuditLogEntry
from tests.conftest import create_slot, legacy_request
from tests.test_visit_workflow import _create_slot

API = "/api/website/v1"


async def _manual(client, *, slot_id, campus_key="yihua", parent_name="林爸爸", phone="0912345678", source="phone"):
    """櫃台補登：選場次即確認。"""
    resp = await client.post(
        f"{API}/admin/visit-requests",
        json={
            "campus_key": campus_key,
            "source": source,
            "parent_name": parent_name,
            "phone": phone,
            "consent_given": True,
            "slot_id": slot_id,
        },
        headers={"Idempotency-Key": f"attention-{uuid.uuid4()}"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "confirmed"
    return resp.json()["id"]


async def _ids(client, query):
    resp = await client.get(f"{API}/admin/visit-requests?{query}")
    assert resp.status_code == 200, resp.text
    return {row["id"] for row in resp.json()}


@pytest.mark.asyncio
async def test_needs_attention_lists_closed_slots_holidays_and_inactive_campuses(admin_client, minghua_client, db_session):
    closed_slot = await _create_slot(admin_client, capacity=3, days_ahead=3)
    holiday_slot = await _create_slot(admin_client, capacity=4, days_ahead=5)
    open_slot = await _create_slot(admin_client, capacity=3, days_ahead=6)
    on_closed = await _manual(admin_client, slot_id=closed_slot["id"], parent_name="關閉場")
    cancelled = await _manual(admin_client, slot_id=closed_slot["id"], parent_name="已取消", phone="0912345679")
    await admin_client.post(f"{API}/admin/visit-requests/{cancelled}/cancel", json={})
    on_holiday = await _manual(admin_client, slot_id=holiday_slot["id"], parent_name="休假日")
    on_holiday_b = await _manual(admin_client, slot_id=holiday_slot["id"], parent_name="休假日乙", phone="0912345680")
    untouched = await _manual(admin_client, slot_id=open_slot["id"], parent_name="照常")
    minghua_case = await legacy_request(db_session, campus_key="minghua", status="confirmed", parent_name="明華已確認")

    assert await _ids(admin_client, "needs_attention=true") == set()

    closed = await admin_client.patch(f"{API}/admin/slots/{closed_slot['id']}", json={"closed": True, "expected_version": 1})
    assert closed.status_code == 200
    holiday = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": holiday_slot["slot_date"]}
    )
    assert holiday.json()["affected_requests"] == 2
    off = await admin_client.patch(f"{API}/admin/campuses/minghua/status", json={"active": False})
    assert off.json()["open_requests"] == 1
    try:
        # 已取消的、時段照常的都不列；手動停止申請的場次只是不收新預約，已約的家長照常來，
        # 也不列；休假日整天關閉要聯絡；停用分校所有進行中的案件都要聯絡。
        assert await _ids(admin_client, "needs_attention=true") == {on_holiday, on_holiday_b, minghua_case}
        assert on_closed not in await _ids(admin_client, "needs_attention=true")
        assert await _ids(admin_client, "needs_attention=true&campus_key=yihua") == {on_holiday, on_holiday_b}
        # 分校帳號只看得到自己校。
        assert await _ids(minghua_client, "needs_attention=true") == {minghua_case}

        dashboard = (await admin_client.get(f"{API}/admin/dashboard")).json()
        assert dashboard["needs_attention"] == 3
        assert (await minghua_client.get(f"{API}/admin/dashboard")).json()["needs_attention"] == 1
    finally:
        await admin_client.patch(f"{API}/admin/campuses/minghua/status", json={"active": True})

    # 改期到開放中的場次、或取消休假日之後，就不再需要人工處理。
    moved = await admin_client.post(
        f"{API}/admin/visit-requests/{on_holiday_b}/reschedule", json={"new_slot_id": open_slot["id"]}
    )
    assert moved.status_code == 200, moved.text
    assert await _ids(admin_client, "needs_attention=true") == {on_holiday}
    assert untouched not in await _ids(admin_client, "needs_attention=true")
    await admin_client.delete(f"{API}/admin/visit-schedule/yihua/exceptions/{holiday.json()['id']}")
    assert await _ids(admin_client, "needs_attention=true") == set()
    assert (await admin_client.get(f"{API}/admin/dashboard")).json()["needs_attention"] == 0


@pytest.mark.asyncio
async def test_export_header_has_each_column_once(admin_client, db_session):
    """園方用 Excel 直接開：BOM、中文欄名、代碼換中文、台北時間、手機保留開頭的 0。"""
    visit_id = await _manual(admin_client, slot_id=await create_slot(admin_client), phone="0912345601")
    resp = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua")
    assert resp.status_code == 200, resp.text
    assert resp.content.startswith("\ufeff".encode())
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    text = resp.content.decode("utf-8-sig")
    header = next(csv.reader(io.StringIO(text)))
    assert header == [
        "校區", "狀態", "來源", "家長", "手機", "送出時間",
        "孩子姓名", "孩子生日", "Email", "得知管道", "人數",
        "參觀日期", "開始", "結束",
    ]
    assert list(export_labels.EXPORT_HEADERS) == header
    assert len(set(header)) == len(header)
    row = next(csv.DictReader(io.StringIO(text)))
    assert row["校區"] == "義華"
    assert row["狀態"] == "預約正常"
    assert row["來源"] == "電話"
    assert row["手機"] == "0912-345-601"
    stored = await db_session.get(VisitRequest, uuid.UUID(visit_id))
    assert row["送出時間"] == stored.created_at.astimezone(OPERATING_TZ).strftime("%Y/%m/%d %H:%M")


def test_export_labels_cover_every_code():
    # 新增狀態、來源或得知管道代碼時，CSV 對照表要一起補，不然匯出會出現英文代碼。
    assert set(export_labels.STATUS_LABELS) == {s.value for s in VisitRequestStatus}
    assert set(export_labels.SOURCE_LABELS) == {s.value for s in VisitRequestSource}
    assert set(export_labels.REFERRAL_LABELS) == set(get_args(ReferralSource))


def test_export_phone_format_keeps_unknown_shapes():
    assert export_labels.format_phone("0912345601") == "0912-345-601"
    # 舊資料或市話不是 09 開頭十碼，照原樣輸出。
    assert export_labels.format_phone("072345678") == "072345678"


async def test_export_applies_screen_filters_and_audits_them(admin_client, db_session):
    slot = await _create_slot(admin_client, capacity=3)
    confirmed = await _manual(admin_client, slot_id=slot["id"], parent_name="王媽媽", phone="0922000111")
    # 已結案的案件（完成、未到場）：不是進行中，status 篩選與需要處理清單都不該撈到。
    await legacy_request(db_session, status="completed", parent_name="李爸爸", phone="0922000222", source="line")
    await legacy_request(db_session, status="no_show", parent_name="張媽媽", phone="0922000333", source="walk_in")

    async def export(query: str) -> list[dict]:
        resp = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua&{query}")
        assert resp.status_code == 200, resp.text
        return list(csv.DictReader(io.StringIO(resp.content.decode("utf-8-sig"))))

    everything = await export("")
    assert {r["家長"] for r in everything} == {"王媽媽", "李爸爸", "張媽媽"}
    assert [r["家長"] for r in await export("status=confirmed")] == ["王媽媽"]
    assert [r["家長"] for r in await export("source=line")] == ["李爸爸"]
    assert [r["家長"] for r in await export("q=0922000333")] == ["張媽媽"]
    today = today_local()
    assert len(await export(f"created_from={today - timedelta(days=1)}&created_to={today}")) == 3
    assert await export(f"created_from={today + timedelta(days=1)}") == []
    holiday = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": slot["slot_date"]}
    )
    assert holiday.status_code == 201, holiday.text
    assert [r["家長"] for r in await export("needs_attention=true")] == ["王媽媽"]

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
    assert by_query[4] == {
        "row_count": 3,
        "created_from": (today - timedelta(days=1)).isoformat(),
        "created_to": today.isoformat(),
    }
    assert by_query[-1] == {"row_count": 1, "needs_attention": True}
    assert all(a.campus_key == "yihua" for a in audits)


@pytest.mark.asyncio
async def test_export_streams_in_batches_and_audit_count_matches_output(admin_client, db_session, monkeypatch):
    """跨多個批次：BOM 只在開頭一次、列數與排序（新到舊）正確，稽核筆數等於實際輸出筆數。"""
    from app.booking import routes as booking_routes

    monkeypatch.setattr(booking_routes, "_EXPORT_BATCH", 2)
    slot_id = await create_slot(admin_client, capacity=10)
    for n in range(5):
        await _manual(admin_client, slot_id=slot_id, parent_name=f"家長{n}", phone=f"09123456{n:02d}")

    resp = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua")
    assert resp.status_code == 200, resp.text
    assert resp.headers["cache-control"] == "private, no-store"
    assert resp.headers["content-disposition"].startswith('attachment; filename="visit-requests-yihua-')
    text = resp.content.decode("utf-8")
    assert text.startswith("﻿") and text.count("﻿") == 1
    rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    assert [r["家長"] for r in rows] == [f"家長{n}" for n in (4, 3, 2, 1, 0)]
    entry = (await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "visit_request.export"))).scalar_one()
    assert entry.metadata_json["row_count"] == len(rows) == 5
