"""手填廣告花費 API（2026-11-16 docs/specs/2026-11-16-ad-roi-design.md §6.2）。"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.operations.models import AuditLogEntry
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401

BASE = "/api/website/v1/admin/admissions/ad-spend"
MONTH = "2026-11"


async def _audit(db, action):
    query = select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    return list((await db.execute(query.execution_options(populate_existing=True))).scalars())


async def test_put_creates_then_updates(admin_client, db_session):
    first = await admin_client.put(f"{BASE}/2026-10/openai", json={"amount": 3000})
    assert first.status_code == 200, first.text
    assert first.json()["month"] == "2026-10" and first.json()["amount"] == 3000
    second = await admin_client.put(f"{BASE}/2026-10/openai", json={"amount": 3500, "note": "加碼"})
    assert second.status_code == 200
    listed = (await admin_client.get(BASE)).json()["entries"]
    assert len(listed) == 1 and listed[0]["amount"] == 3500 and listed[0]["note"] == "加碼"
    rows = await _audit(db_session, "ad_spend.upsert")
    assert [r.metadata_json["before_amount"] for r in rows] == [None, 3000]


async def test_google_is_not_manual(admin_client):
    response = await admin_client.put(f"{BASE}/{MONTH}/google", json={"amount": 1})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_PLATFORM"


@pytest.mark.parametrize("month", ["2099-01", "2026-13", "2026-1", "abcd-ef"])
async def test_bad_month_rejected(admin_client, month):
    response = await admin_client.put(f"{BASE}/{month}/openai", json={"amount": 1})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_MONTH"


@pytest.mark.parametrize("amount", [-1, 10_000_001])
async def test_amount_bounds(admin_client, amount):
    response = await admin_client.put(f"{BASE}/2026-10/openai", json={"amount": amount})
    assert response.status_code == 422


async def test_delete(admin_client, db_session):
    await admin_client.put(f"{BASE}/2026-10/meta", json={"amount": 100})
    assert (await admin_client.delete(f"{BASE}/2026-10/meta")).status_code == 204
    assert (await admin_client.get(BASE)).json()["entries"] == []
    missing = await admin_client.delete(f"{BASE}/2026-10/meta")
    assert missing.status_code == 404 and missing.json()["detail"]["code"] == "AD_SPEND_NOT_FOUND"
    assert len(await _audit(db_session, "ad_spend.delete")) == 1


async def test_list_range_filter(admin_client):
    for month in ("2026-08", "2026-09", "2026-10"):
        await admin_client.put(f"{BASE}/{month}/line", json={"amount": 1})
    entries = (await admin_client.get(f"{BASE}?from=2026-09&to=2026-09")).json()["entries"]
    assert [e["month"] for e in entries] == ["2026-09"]


async def test_branch_admin_forbidden(reception_yihua_client, readonly_yihua_client, admin_client):
    for client in (reception_yihua_client, readonly_yihua_client):
        assert (await client.get(BASE)).status_code == 403
        assert (await client.put(f"{BASE}/2026-10/openai", json={"amount": 1})).status_code == 403
        assert (await client.delete(f"{BASE}/2026-10/openai")).status_code == 403


@pytest.mark.parametrize("raw, expected", [("   ", None), ("", None), ("  備註 ", "備註")])
async def test_note_blank_becomes_none(admin_client, raw, expected):
    response = await admin_client.put(f"{BASE}/2026-10/other", json={"amount": 5, "note": raw})
    assert response.status_code == 200
    assert response.json()["note"] == expected
