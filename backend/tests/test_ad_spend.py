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


async def test_list_range_beyond_this_month_is_clamped(admin_client):
    await admin_client.put(f"{BASE}/2026-10/line", json={"amount": 1})
    response = await admin_client.get(f"{BASE}?from=2026-10&to=2099-12")
    assert response.status_code == 200
    assert [e["month"] for e in response.json()["entries"]] == ["2026-10"]
    assert (await admin_client.get(f"{BASE}?from=2099-01&to=2099-12")).status_code == 200
    bad = await admin_client.get(f"{BASE}?from=2026-1&to=2026-12")
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "INVALID_MONTH"


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


async def test_body_error_uses_ad_spend_code(admin_client):
    response = await admin_client.put(f"{BASE}/2026-10/openai", json={"amount": 1, "extra": 1})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert (detail["code"], detail["message"]) == ("INVALID_AD_SPEND", "花費資料格式不對")


async def test_concurrent_first_puts_record_true_before_amount(app, admin_client, db_session):
    """列還不存在時兩個 PUT 並發：另一個交易先拿著同一把 advisory lock，等兩個請求都卡在鎖上才放手，
    所以一定是同時排隊；序列化後必有一筆 before=None、另一筆 before＝先寫入的金額。"""
    import asyncio

    from sqlalchemy import text

    from app.admissions.ad_roi_routes import ad_spend_lock_key
    from datetime import date

    key = ad_spend_lock_key(date(2026, 10, 1), "meta")
    async with app.state.session_factory() as holder:
        await holder.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": key})
        tasks = [
            asyncio.create_task(admin_client.put(f"{BASE}/2026-10/meta", json={"amount": amount})) for amount in (100, 200)
        ]
        for _ in range(100):
            if any(t.done() for t in tasks):
                break
            async with app.state.engine.connect() as conn:
                waiting = await conn.scalar(
                    text(
                        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                        "AND wait_event_type = 'Lock' AND wait_event = 'advisory'"
                    )
                )
            if waiting >= 2:
                break
            await asyncio.sleep(0.05)
        await holder.rollback()
    responses = await asyncio.gather(*tasks)
    assert [r.status_code for r in responses] == [200, 200]
    rows = await _audit(db_session, "ad_spend.upsert")
    pairs = sorted((r.metadata_json["amount"], r.metadata_json["before_amount"]) for r in rows)
    assert len(pairs) == 2
    first = next(p for p in pairs if p[1] is None)
    second = next(p for p in pairs if p[1] is not None)
    assert second[1] == first[0]
