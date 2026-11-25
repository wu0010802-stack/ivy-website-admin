"""搜尋需求（Keyword Planner，docs/specs/2026-11-25-business-profile-keyword-planner-design.md §5）：回應解析、同步的
請求內容與到期規則、區失敗不影響高雄市、關鍵字維護 API 與權限。"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select

from app.insights.google_token import RefreshTokenAuth
from app.insights.http import GoogleApiError
from app.insights.models import SEARCH_DEMAND_GEOS, GoogleSyncStatus, SearchKeyword, SearchKeywordVolume
from app.insights.search_demand import month_range, normalize, parse_results, request_body, sync_search_demand
from app.operations.models import AuditLogEntry as AuditLog
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.google_data_helpers import (
    ADS_REFRESH,
    DEV_TOKEN,
    MANAGER,
    SECRETS,
    FakeGoogleData,
    ads_result,
    settings_with,
)

URL = "/api/website/v1/admin/search-demand"
NOW = datetime(2026, 11, 25, 2, 0, tzinfo=timezone.utc)
CITY, SANMIN, ZUOYING = SEARCH_DEMAND_GEOS["kaohsiung"], SEARCH_DEMAND_GEOS["sanmin"], SEARCH_DEMAND_GEOS["zuoying"]
OCT, SEP = date(2026, 10, 1), date(2026, 9, 1)


async def _no_sleep(_seconds: float) -> None:
    return None


# ── 解析與請求 ─────────────────────────────────────────────────────────────────


def test_month_range_is_last_48_complete_months():
    assert month_range(date(2026, 11, 25)) == (date(2022, 11, 1), date(2026, 10, 1))


def test_request_body_uses_traditional_chinese_and_search_only():
    body = request_body(["三民區 幼兒園"], CITY, date(2022, 11, 1), date(2026, 10, 1))
    assert body == {
        "keywords": ["三民區 幼兒園"],
        "language": "languageConstants/1018",
        "geoTargetConstants": ["geoTargetConstants/9040314"],
        "keywordPlanNetwork": "GOOGLE_SEARCH",
        "historicalMetricsOptions": {"yearMonthRange": {
            "start": {"year": "2022", "month": "NOVEMBER"}, "end": {"year": "2026", "month": "OCTOBER"},
        }},
    }


def test_parse_results_close_variants_and_low_volume():
    parsed = parse_results({"results": [
        ads_result("三民區 幼兒園", {SEP: 70, OCT: None}, close_variants=["三民區幼兒園", "三民 幼兒園"]),
        {"text": "很冷門的字"},
    ]})
    assert parsed[normalize("三民區幼兒園")] == {SEP: 70, OCT: None}
    assert parsed["三民 幼兒園"] == {SEP: 70, OCT: None}
    assert parsed["很冷門的字"] == {}


@pytest.mark.parametrize("bad", [{"results": "x"}, {"results": [{"text": "a", "keywordMetrics": {"monthlySearchVolumes": [
    {"year": "2026", "month": "OCTOBER", "monthlySearches": "-3"}]}}]}, "not json object"])
def test_parse_results_malformed(bad):
    with pytest.raises(GoogleApiError) as exc:
        parse_results(bad)
    assert exc.value.reason == "回應格式不對"


# ── 同步（真資料庫） ─────────────────────────────────────────────────────────────


async def _keyword(db, text: str, *, synced: datetime | None = None) -> SearchKeyword:
    keyword = SearchKeyword(id=uuid.uuid4(), text=text, created_at=NOW - timedelta(days=1), synced_at=synced)
    db.add(keyword)
    await db.commit()
    return keyword


@pytest.fixture
def fake():
    return FakeGoogleData(ads_results={
        CITY: [ads_result("三民區 幼兒園", {SEP: 70, OCT: None}, close_variants=["三民區幼兒園"])],
        SANMIN: [ads_result("三民區 幼兒園", {SEP: 20, OCT: 10})],
    })


async def _sync(app, fake, *, now=NOW, auth=None, **overrides):
    settings = settings_with(app.state.settings, gbp=False, **overrides)
    return await sync_search_demand(
        app.state.session_factory, settings, auth or RefreshTokenAuth(),
        transport=httpx.MockTransport(fake.handler), now=now, sleep=_no_sleep,
    )


async def _volumes(db, keyword_id) -> dict:
    rows = (await db.execute(select(SearchKeywordVolume).where(SearchKeywordVolume.keyword_id == keyword_id))).scalars()
    return {(row.geo, row.month): row.searches for row in rows}


async def test_sync_stores_each_geo_and_marks_keywords(app, db_session, fake):
    exact = await _keyword(db_session, "三民區 幼兒園")
    variant = await _keyword(db_session, "三民區幼兒園")
    rare = await _keyword(db_session, "冷門字")
    result = await _sync(app, fake)
    assert result.outcome == "synced" and result.keywords == 3 and result.geos == ["kaohsiung", "sanmin", "zuoying"]
    # 一個地區一次請求，關鍵字全部一起送
    assert [body["geoTargetConstants"] for body, _ in fake.ads_requests] == [[CITY], [SANMIN], [ZUOYING]]
    assert fake.ads_requests[0][0]["keywords"] == ["三民區 幼兒園", "三民區幼兒園", "冷門字"]
    headers = fake.ads_requests[0][1]
    assert "login-customer-id" not in headers and "developer-token" not in headers
    assert fake.token_requests[0]["refresh_token"] == ADS_REFRESH
    assert await _volumes(db_session, exact.id) == {
        ("kaohsiung", SEP): 70, ("kaohsiung", OCT): None, ("sanmin", SEP): 20, ("sanmin", OCT): 10,
    }
    # 近似字詞對到同一份數字；Google 沒回的字不存任何月份
    assert await _volumes(db_session, variant.id) == {("kaohsiung", SEP): 70, ("kaohsiung", OCT): None}
    assert await _volumes(db_session, rare.id) == {}
    await db_session.refresh(rare)
    assert rare.synced_at == NOW
    status = await db_session.get(GoogleSyncStatus, "search_demand")
    assert status.last_success_at == NOW and status.last_error is None


async def test_optional_headers_are_sent_when_set(app, db_session, fake):
    await _keyword(db_session, "幼兒園")
    await _sync(app, fake, google_ads_login_customer_id=MANAGER, google_ads_developer_token=DEV_TOKEN)
    headers = fake.ads_requests[0][1]
    assert headers["login-customer-id"] == MANAGER and headers["developer-token"] == DEV_TOKEN


async def test_due_rules(app, db_session, fake):
    assert (await _sync(app, fake)).outcome == "skipped"  # 沒有關鍵字
    await _keyword(db_session, "幼兒園")
    auth = RefreshTokenAuth()
    assert (await _sync(app, fake, auth=auth)).outcome == "synced"
    assert (await _sync(app, fake, now=NOW + timedelta(days=6), auth=auth)).outcome == "skipped"
    # 新加的關鍵字下一輪就抓
    await _keyword(db_session, "左營 幼稚園")
    assert (await _sync(app, fake, now=NOW + timedelta(hours=1), auth=auth)).outcome == "synced"
    assert (await _sync(app, fake, now=NOW + timedelta(days=7, hours=1), auth=auth)).outcome == "synced"


async def test_resync_replaces_old_numbers(app, db_session, fake):
    keyword = await _keyword(db_session, "三民區 幼兒園")
    await _sync(app, fake)
    fake.ads_results[CITY] = []
    await _sync(app, fake, now=NOW + timedelta(days=8))
    assert ("kaohsiung", SEP) not in await _volumes(db_session, keyword.id)
    assert (await _volumes(db_session, keyword.id))[("sanmin", OCT)] == 10


async def test_district_failure_keeps_city(app, db_session, fake, caplog):
    keyword = await _keyword(db_session, "三民區 幼兒園")
    fake.ads_fail_geos[ZUOYING] = 400
    caplog.set_level(logging.WARNING)
    result = await _sync(app, fake)
    assert result.outcome == "synced" and result.geos == ["kaohsiung", "sanmin"]
    assert result.error == "左營區：查詢 Keyword Planner（HTTP 400）"
    status = await db_session.get(GoogleSyncStatus, "search_demand")
    assert status.last_success_at == NOW and status.last_error == "左營區：查詢 Keyword Planner（HTTP 400）"
    assert ("kaohsiung", SEP) in await _volumes(db_session, keyword.id)


@pytest.mark.parametrize(("fail", "message"), [
    ({"geo": 403}, "查詢 Keyword Planner（HTTP 403）"),
    ({"token": 400}, "以 refresh token 取得 Google 權杖（HTTP 400）"),
])
async def test_city_failure_fails_the_round(app, db_session, fake, caplog, fail, message):
    keyword = await _keyword(db_session, "三民區 幼兒園")
    if "geo" in fail:
        fake.ads_fail_geos[CITY] = fail["geo"]
    else:
        fake.fail["token"] = fail["token"]
    caplog.set_level(logging.WARNING)
    result = await _sync(app, fake, google_ads_developer_token=DEV_TOKEN)
    assert result.outcome == "failed" and result.error == message
    assert await _volumes(db_session, keyword.id) == {}
    await db_session.refresh(keyword)
    assert keyword.synced_at is None
    status = await db_session.get(GoogleSyncStatus, "search_demand")
    assert status.last_error == message and status.last_success_at is None
    for secret in SECRETS:
        assert secret not in caplog.text
    # 失敗後 3 小時內不再試（就算有還沒同步的關鍵字）
    assert (await _sync(app, fake, now=NOW + timedelta(hours=1))).outcome == "skipped"


async def test_not_configured_skips(app, db_session, fake):
    await _keyword(db_session, "幼兒園")
    settings = settings_with(app.state.settings, gbp=False, ads=False)
    result = await sync_search_demand(app.state.session_factory, settings, RefreshTokenAuth(),
                                      transport=httpx.MockTransport(fake.handler))
    assert result.outcome == "skipped" and fake.ads_requests == []


# ── 後台 API ─────────────────────────────────────────────────────────────────


async def test_api_lists_keywords_and_cells(app, admin_client, db_session):
    original = app.state.settings
    app.state.settings = settings_with(original, gbp=False)
    try:
        body = (await admin_client.get(URL)).json()
        assert body["configured"] is True and body["keywords"] == [] and body["keyword_limit"] == 50
        assert [geo["label"] for geo in body["geos"]] == ["高雄市", "三民區", "左營區"]
        assert len(body["months"]) == 12 and body["months"] == sorted(body["months"])
        last, previous = (date.fromisoformat(f"{month}-01") for month in body["months"][:-3:-1])
        keyword = await _keyword(db_session, "三民區 幼兒園", synced=NOW)
        db_session.add_all([
            SearchKeywordVolume(keyword_id=keyword.id, geo="kaohsiung", month=last, searches=70),
            SearchKeywordVolume(keyword_id=keyword.id, geo="kaohsiung", month=previous, searches=None),
        ])
        await db_session.commit()
        [row] = (await admin_client.get(URL)).json()["keywords"]
    finally:
        app.state.settings = original
    assert row["text"] == "三民區 幼兒園" and row["synced_at"] is not None
    city, sanmin, _ = row["volumes"]
    assert city["geo"] == "kaohsiung" and sanmin["geo"] == "sanmin"
    assert city["cells"][-1] == {"month": last.strftime("%Y-%m"), "available": True, "searches": 70}
    assert city["cells"][-2] == {"month": previous.strftime("%Y-%m"), "available": True, "searches": None}
    assert city["cells"][0]["available"] is False
    assert all(cell["available"] is False for cell in sanmin["cells"])


async def test_api_create_and_delete_with_audit(admin_client, db_session):
    response = await admin_client.post(f"{URL}/keywords", json={"text": "  三民區   幼兒園 "})
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["text"] == "三民區 幼兒園" and created["synced_at"] is None and len(created["volumes"]) == 3
    body = (await admin_client.get(URL)).json()
    assert body["configured"] is False and [row["text"] for row in body["keywords"]] == ["三民區 幼兒園"]

    assert (await admin_client.delete(f"{URL}/keywords/{created['id']}")).status_code == 204
    assert (await admin_client.delete(f"{URL}/keywords/{created['id']}")).status_code == 404
    actions = list((await db_session.execute(
        select(AuditLog.action).where(AuditLog.target_type == "search_keyword").order_by(AuditLog.created_at)
    )).scalars())
    assert actions == ["search_keyword.create", "search_keyword.delete"]


async def test_api_delete_removes_volumes(admin_client, db_session):
    keyword = await _keyword(db_session, "幼兒園", synced=NOW)
    db_session.add(SearchKeywordVolume(keyword_id=keyword.id, geo="kaohsiung", month=OCT, searches=5))
    await db_session.commit()
    assert (await admin_client.delete(f"{URL}/keywords/{keyword.id}")).status_code == 204
    count = (await db_session.execute(select(func.count()).select_from(SearchKeywordVolume))).scalar_one()
    assert count == 0


@pytest.mark.parametrize(("text", "code"), [
    ("   ", "INVALID_SEARCH_KEYWORD"),
    ("字" * 81, "INVALID_SEARCH_KEYWORD"),
    (" ".join(["詞"] * 11), "INVALID_SEARCH_KEYWORD"),
])
async def test_api_create_rejects_bad_text(admin_client, text, code):
    response = await admin_client.post(f"{URL}/keywords", json={"text": text})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code


async def test_api_create_rejects_duplicate_ignoring_case(admin_client):
    assert (await admin_client.post(f"{URL}/keywords", json={"text": "Ivy 幼兒園"})).status_code == 201
    response = await admin_client.post(f"{URL}/keywords", json={"text": "ivy  幼兒園"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "SEARCH_KEYWORD_EXISTS"


async def test_api_create_limit(admin_client, db_session):
    for index in range(50):
        db_session.add(SearchKeyword(id=uuid.uuid4(), text=f"關鍵字{index}", created_at=NOW))
    await db_session.commit()
    response = await admin_client.post(f"{URL}/keywords", json={"text": "第五十一個"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "SEARCH_KEYWORD_LIMIT"


async def test_api_forbidden_for_branch_roles(reception_yihua_client, readonly_yihua_client, minghua_client):
    for client in (reception_yihua_client, readonly_yihua_client, minghua_client):
        assert (await client.get(URL)).status_code == 403
        assert (await client.post(f"{URL}/keywords", json={"text": "幼兒園"})).status_code == 403
        assert (await client.delete(f"{URL}/keywords/{uuid.uuid4()}")).status_code == 403
