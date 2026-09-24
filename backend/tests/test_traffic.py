"""官網瀏覽量與 Core Web Vitals：公開寫入規則、去識別化與後台彙總。"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select, text

from app.common.timezones import today_local
from app.operations import traffic_service
from app.operations.models import PageViewDaily, WebVitalSample

URL = "/api/website/v1/public/telemetry"


def _view(**overrides) -> dict:
    return {"event": "page_view", "page": "campus", "campus": "yihua", "device": "mobile", **overrides}


def _vital(metric: str, value: float, sample_id: str | None = None, **overrides) -> dict:
    return {"event": metric, "page": "home", "campus": None, "device": "desktop",
            "value": value, "id": sample_id or str(uuid.uuid4()), **overrides}


@pytest.mark.asyncio
async def test_page_views_accumulate_into_one_daily_row(public_client, db_session):
    for _ in range(3):
        assert (await public_client.post(URL, json=_view())).status_code == 204
    assert (await public_client.post(URL, json=_view(page="home", campus=None))).status_code == 204
    rows = (await db_session.execute(select(PageViewDaily).order_by(PageViewDaily.page))).scalars().all()
    assert [(r.page, r.campus_key, r.views) for r in rows] == [("campus", "yihua", 3), ("home", "", 1)]
    assert all(r.day == today_local() for r in rows)


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [
    _view(page="home", campus="yihua"),
    _view(page="campus", campus=None),
    _view(campus="taipei"),
    _view(device="tablet"),
    _view(value=1.0),
    _view(ip="1.2.3.4"),
    _vital("LCP", -1),
    _vital("CLS", 101),
    {**_vital("INP", 120), "id": "not-a-uuid"},
    {k: v for k, v in _vital("LCP", 1200).items() if k != "id"},
])
async def test_rejects_malformed_or_extra_fields(public_client, body):
    assert (await public_client.post(URL, json=body)).status_code == 422


@pytest.mark.asyncio
async def test_vital_updates_same_sample_and_ignores_visit_click(public_client, db_session):
    sample = str(uuid.uuid4())
    assert (await public_client.post(URL, json=_vital("CLS", 0.05, sample))).status_code == 204
    assert (await public_client.post(URL, json=_vital("CLS", 0.12, sample))).status_code == 204
    # 同一個 id 冒充另一種指標不能蓋掉原本的樣本。
    assert (await public_client.post(URL, json=_vital("LCP", 9999, sample))).status_code == 204
    assert (await public_client.post(URL, json={"event": "visit_click", "page": "visit", "campus": "renwu", "device": "mobile"})).status_code == 204
    rows = (await db_session.execute(select(WebVitalSample))).scalars().all()
    assert [(r.metric, r.value) for r in rows] == [("CLS", 0.12)]
    assert await db_session.scalar(select(func.count()).select_from(PageViewDaily)) == 0


@pytest.mark.asyncio
async def test_rate_limited_per_source(public_client):
    for _ in range(120):
        assert (await public_client.post(URL, json=_view())).status_code == 204
    blocked = await public_client.post(URL, json=_view())
    assert blocked.status_code == 429
    assert blocked.headers.get("retry-after")


@pytest.mark.asyncio
async def test_old_vital_samples_are_purged(public_client, db_session):
    await public_client.post(URL, json=_vital("LCP", 1000))
    old_day = today_local() - timedelta(days=traffic_service.VITAL_RETENTION_DAYS + 1)
    await db_session.execute(text("UPDATE web_vital_samples SET day = :day"), {"day": old_day})
    await db_session.commit()
    traffic_service._last_purge = None
    await public_client.post(URL, json=_vital("LCP", 1500))
    values = (await db_session.execute(select(WebVitalSample.value))).scalars().all()
    assert values == [1500]


@pytest.mark.asyncio
async def test_admin_summary_p75_and_ratings(admin_client, minghua_client, public_client):
    for _ in range(2):
        await public_client.post(URL, json=_view())
    await public_client.post(URL, json=_view(page="visit", campus=None, device="desktop"))
    for value in (1000, 2000, 3000, 5000):
        await public_client.post(URL, json=_vital("LCP", value))
    await public_client.post(URL, json=_vital("CLS", 0.3))

    response = await minghua_client.get("/api/website/v1/admin/analytics/traffic?days=7")
    assert response.status_code == 200
    body = response.json()
    assert body["total_views"] == 3
    assert len(body["daily"]) == 7 and body["daily"][-1] == {"day": today_local().isoformat(), "views": 3}
    assert body["pages"][0] == {"page": "campus", "campus_key": "yihua", "views": 2}
    assert {"page": "visit", "campus_key": None, "views": 1} in body["pages"]
    assert body["devices"] == {"desktop": 1, "mobile": 2}
    lcp, cls = body["vitals"]
    assert (lcp["metric"], lcp["samples"], lcp["p75"], lcp["rating"]) == ("LCP", 4, 3500.0, "needs_improvement")
    assert (cls["metric"], cls["rating"]) == ("CLS", "poor")

    assert (await admin_client.get("/api/website/v1/admin/analytics/traffic?days=3")).status_code == 422
    assert (await public_client.get("/api/website/v1/admin/analytics/traffic")).status_code == 401
