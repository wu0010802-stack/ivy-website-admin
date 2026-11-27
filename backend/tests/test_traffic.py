"""官網瀏覽量與 Core Web Vitals：公開寫入規則、去識別化與後台彙總。"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, text

from app.common.timezones import today_local
from app.operations import traffic_service
from app.operations.models import PageViewDaily, WebVitalSample
from tests.conftest import freeze_rate_limit_clock

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
async def test_content_pages_are_stored_without_campus(public_client, db_session):
    # 2026-09-30：公開內頁也回報瀏覽與 CWV，消息內文頁在前端就歸成 news
    for page in ("about", "curriculum", "environment", "admission", "news", "anniversary"):
        assert (await public_client.post(URL, json=_view(page=page, campus=None))).status_code == 204
    assert (await public_client.post(URL, json=_vital("INP", 180, page="environment", device="mobile"))).status_code == 204
    rows = (await db_session.execute(select(PageViewDaily).order_by(PageViewDaily.page))).scalars().all()
    assert [(r.page, r.campus_key, r.views) for r in rows] == [
        ("about", "", 1), ("admission", "", 1), ("anniversary", "", 1), ("curriculum", "", 1), ("environment", "", 1), ("news", "", 1)]
    vitals = (await db_session.execute(select(WebVitalSample))).scalars().all()
    assert [(v.page, v.campus_key, v.metric) for v in vitals] == [("environment", "", "INP")]


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [
    _view(page="home", campus="yihua"),
    _view(page="campus", campus=None),
    _view(page="about", campus="yihua"),
    _view(page="news/garden", campus=None),
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
async def test_rate_limited_per_source(app, public_client):
    freeze_rate_limit_clock(app)
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


@pytest.mark.asyncio
async def test_admin_summary_page_vitals_split_by_page(admin_client, public_client):
    """2026-11-27：各頁分開的 p75；預約頁五校合併算，全站合計照舊。"""
    for value in (1000, 2000, 3000, 5000):
        await public_client.post(URL, json=_vital("LCP", value, device="mobile"))
    for value in (2000, 4000):
        await public_client.post(URL, json=_vital("LCP", value, page="visit", campus="yihua", device="mobile"))
    await public_client.post(URL, json=_vital("LCP", 6000, page="visit", campus="renwu", device="mobile"))
    await public_client.post(URL, json=_vital("CLS", 0.02, page="about", device="desktop"))

    body = (await admin_client.get("/api/website/v1/admin/analytics/traffic?days=7")).json()
    rows = {(row["page"], row["metric"], row["device"]): row for row in body["page_vitals"]}
    assert set(rows) == {("home", "LCP", "mobile"), ("visit", "LCP", "mobile"), ("about", "CLS", "desktop")}
    assert (rows[("home", "LCP", "mobile")]["p75"], rows[("home", "LCP", "mobile")]["samples"]) == (3500.0, 4)
    visit = rows[("visit", "LCP", "mobile")]
    assert (visit["p75"], visit["samples"], visit["rating"]) == (5000.0, 3, "poor")
    assert rows[("about", "CLS", "desktop")]["rating"] == "good"
    assert [row["page"] for row in body["page_vitals"]] == ["about", "home", "visit"]
    # 全站合計不受影響：手機 LCP 七筆一起算
    lcp = next(v for v in body["vitals"] if v["metric"] == "LCP" and v["device"] == "mobile")
    assert lcp["samples"] == 7


@pytest.mark.asyncio
async def test_stats_start_trims_views_and_vitals(app, admin_client, db_session):
    """2026-11-20：起算日（設定 analytics_stats_start）以前的瀏覽與速度樣本不列入，期間從起算日開始。"""
    today = today_local()
    for days_ago, views in ((10, 5), (2, 3), (0, 4)):
        db_session.add(PageViewDaily(
            id=uuid.uuid4(), day=today - timedelta(days=days_ago), page="home", campus_key="", device="desktop", views=views,
        ))
    db_session.add(WebVitalSample(
        id=uuid.uuid4(), day=today - timedelta(days=10), metric="LCP", page="home", campus_key="", device="desktop",
        value=9000.0, updated_at=datetime.now(timezone.utc),
    ))
    await db_session.commit()

    summary = await traffic_service.get_traffic_summary(db_session, 28, stats_start=today - timedelta(days=2))
    assert summary["since"] == (today - timedelta(days=2)).isoformat()
    assert [row["views"] for row in summary["daily"]] == [3, 0, 4]
    assert summary["total_views"] == 7 and summary["vitals"] == [] and summary["page_vitals"] == []
    # 起算日還沒到就不限；沒設照舊。
    assert (await traffic_service.get_traffic_summary(db_session, 28, stats_start=today + timedelta(days=1)))["total_views"] == 12
    assert (await traffic_service.get_traffic_summary(db_session, 28))["total_views"] == 12

    app.state.settings = app.state.settings.model_copy(update={"analytics_stats_start": today - timedelta(days=2)})
    body = (await admin_client.get("/api/website/v1/admin/analytics/traffic?days=7")).json()
    assert body["since"] == (today - timedelta(days=2)).isoformat() and body["total_views"] == 7


def test_production_default_stats_start_is_after_the_launch_checks():
    # 網域 11-11 切到新站、11-12 /about 上線驗證灌進約 250 次造訪：正式站從 11-13 起算。
    from datetime import date

    from app.config import Settings

    assert Settings.model_fields["analytics_stats_start"].default == date(2026, 11, 13)
