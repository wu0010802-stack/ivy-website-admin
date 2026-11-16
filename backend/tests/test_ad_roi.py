"""廣告成效計算與端點（docs/specs/2026-11-16-ad-roi-design.md §7）。
計算規則走純函式 compute_ad_roi；要資料庫的（歸屬回退、排除、待處理、校區、權限、GA4 錯誤）走端點。"""
from __future__ import annotations

import itertools
import uuid
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import update

from app.admissions.ad_roi import (
    ROW_KEYS,
    CaseBucket,
    GoogleState,
    SpendRow,
    compute_ad_roi,
    parse_month_range,
)
from app.admissions.models import RecruitmentVisit
from app.booking.models import VisitRequest, VisitRequestSource
from app.common.timezones import today_local
from app.insights.ga4_ads import Ga4AdsReport, GoogleCampaignMonth
from tests.admissions_helpers import complete, move_slot, readonly_yihua_client, reception_yihua_client, unique_phone  # noqa: F401
from tests.conftest import book_slot
from tests.google_helpers import GA4_PROPERTY, FakeGoogle, make_service_account

pytestmark = pytest.mark.usefixtures("booking_consent")
URL = "/api/website/v1/admin/admissions/ad-roi"
SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
NOW = datetime(2026, 11, 16, tzinfo=timezone.utc)
_DAYS = itertools.count(2)  # 每筆案件用不同日期的場次，避免「這個時間已經有一場」


# ── 月份區間 ───────────────────────────────────────────────────────────────────


def test_parse_month_range_cross_year():
    assert parse_month_range("2026-11", "2027-02", date(2027, 3, 5)) == ["2026-11", "2026-12", "2027-01", "2027-02"]


def test_parse_month_range_clamps_future():
    assert parse_month_range("2026-09", "2027-06", date(2026, 11, 16)) == ["2026-09", "2026-10", "2026-11"]


def test_parse_month_range_rejects_reversed_and_too_long():
    with pytest.raises(ValueError, match="開始月份不能晚於結束月份"):
        parse_month_range("2026-11", "2026-10", date(2026, 11, 16))
    with pytest.raises(ValueError, match="最多 24 個月"):
        parse_month_range("2024-10", "2026-11", date(2026, 11, 16))
    assert len(parse_month_range("2024-12", "2026-11", date(2026, 11, 16))) == 24
    with pytest.raises(ValueError):
        parse_month_range("2026-1", "2026-11", date(2026, 11, 16))


# ── 純函式 ─────────────────────────────────────────────────────────────────────


def _report(*rows: GoogleCampaignMonth) -> GoogleState:
    return GoogleState(configured=True, report=Ga4AdsReport("TWD", "Asia/Taipei", list(rows), NOW))


def _bucket(platform="google", campus="yihua", outcome="completed", deposited=False, considering=False, count=1):
    return CaseBucket(platform, campus, outcome, deposited, considering, count)


def _row(result, key):
    return next(row for row in result["rows"] if row["key"] == key)


def test_compute_costs():
    google = _report(GoogleCampaignMonth("2026-11", "1", "搜尋", 9000, 310, 4120, 5))
    buckets = [_bucket(outcome="completed", count=3), _bucket(outcome="completed", deposited=True, count=1),
               _bucket(outcome="no_show", count=1), _bucket(outcome="upcoming", count=1)]
    row = _row(compute_ad_roi(["2026-11"], buckets, [], google), "google")
    assert (row["cases"], row["completed"], row["deposited"], row["clicks"], row["spend"]) == (6, 4, 1, 310, 9000)
    assert (row["cost_per_case"], row["cost_per_completed"], row["cost_per_deposit"]) == (1500, 2250, 9000)


def test_compute_no_denominator_means_none():
    result = compute_ad_roi(["2026-11"], [], [], _report(GoogleCampaignMonth("2026-11", "1", "x", 500, 0, 0, 0)))
    row = _row(result, "google")
    assert row["spend"] == 500 and row["cost_per_case"] is None and row["cost_per_deposit"] is None
    assert result["google"]["campaigns"][0]["cost_per_click"] is None


def test_compute_google_campaigns_sum_and_sort():
    google = _report(
        GoogleCampaignMonth("2026-10", "a", "小", 100, 10, 0, 0),
        GoogleCampaignMonth("2026-10", "b", "大", 700, 20, 0, 0),
        GoogleCampaignMonth("2026-11", "a", "小", 300, 10, 0, 1),
    )
    campaigns = compute_ad_roi(["2026-10", "2026-11"], [], [], google)["google"]["campaigns"]
    assert [(c["campaign_id"], c["cost"], c["clicks"], c["cost_per_click"]) for c in campaigns] == [("b", 700, 20, 35), ("a", 400, 20, 20)]


def test_compute_manual_states():
    months = ["2026-09", "2026-10", "2026-11"]
    unset = compute_ad_roi(months, [_bucket("openai")], [], GoogleState(False))
    row = _row(unset, "openai")
    assert (row["spend_state"], row["spend"], row["cost_per_case"], row["missing_months"]) == ("unset", None, None, 0)
    partial = compute_ad_roi(months, [_bucket("openai")], [SpendRow("2026-10", "openai", 3000)], GoogleState(False))
    row = _row(partial, "openai")
    assert (row["spend_state"], row["spend"], row["missing_months"], row["cost_per_case"]) == ("ok", 3000, 2, 3000)
    zero = compute_ad_roi(months, [_bucket("openai")], [SpendRow(m, "openai", 0) for m in months], GoogleState(False))
    row = _row(zero, "openai")
    assert (row["spend_state"], row["spend"], row["missing_months"], row["cost_per_case"]) == ("ok", 0, 0, 0)


def test_compute_ignores_spend_outside_months():
    result = compute_ad_roi(["2026-11"], [_bucket("meta")], [SpendRow("2026-10", "meta", 999)], GoogleState(False))
    assert _row(result, "meta")["spend_state"] == "unset"


def test_offline_has_no_cost_and_only_listed_when_filled():
    assert "offline" not in [r["key"] for r in compute_ad_roi(["2026-11"], [_bucket()], [], GoogleState(False))["rows"]]
    row = _row(compute_ad_roi(["2026-11"], [_bucket()], [SpendRow("2026-11", "offline", 8000)], GoogleState(False)), "offline")
    assert row["spend"] == 8000 and row["cases"] == 0
    assert row["cost_per_case"] is row["cost_per_completed"] is row["cost_per_deposit"] is None


def test_listing_rules_and_order():
    result = compute_ad_roi(["2026-11"], [], [], GoogleState(False))
    assert [r["key"] for r in result["rows"]] == ["google", "organic"]
    result = compute_ad_roi(["2026-11"], [_bucket("unknown"), _bucket("unrecorded"), _bucket("line")], [], GoogleState(False))
    keys = [r["key"] for r in result["rows"]]
    assert keys == [k for k in ROW_KEYS if k in {"google", "line", "unknown", "organic", "unrecorded"}]
    row = _row(result, "organic")
    assert row["spend_state"] == "none" and row["spend"] is None and row["cost_per_case"] is None


def test_google_not_configured_still_counts_bookings():
    result = compute_ad_roi(["2026-11"], [_bucket(count=2)], [], GoogleState(False))
    row = _row(result, "google")
    assert (row["spend_state"], row["spend"], row["cases"]) == ("not_configured", None, 2)
    assert result["google"]["configured"] is False and result["google"]["campaigns"] == []


def test_google_error_state():
    row = _row(compute_ad_roi(["2026-11"], [_bucket()], [], GoogleState(True, error="壞了")), "google")
    assert row["spend_state"] == "error" and row["spend"] is None and row["cases"] == 1


def test_pending_counts_only_ad_rows():
    buckets = [
        _bucket(outcome="upcoming", count=2), _bucket("openai", outcome="awaiting_attendance"),
        _bucket(outcome="completed", considering=True, count=3), _bucket("organic", outcome="upcoming", count=9),
        _bucket("organic", outcome="completed", considering=True, count=9),
    ]
    assert compute_ad_roi(["2026-11"], buckets, [], GoogleState(False))["pending"] == {
        "upcoming": 2, "awaiting_attendance": 1, "considering": 3
    }


def test_by_campus_order_and_ad_rows_only():
    buckets = [_bucket("openai", "renwu"), _bucket("google", "minghua"), _bucket("google", "yihua"),
               _bucket("organic", "yihua"), _bucket("meta", "yihua", outcome="completed", deposited=True)]
    got = compute_ad_roi(["2026-11"], buckets, [], GoogleState(False))["by_campus"]
    assert [(c["campus_key"], c["platform"]) for c in got] == [
        ("yihua", "google"), ("yihua", "meta"), ("minghua", "google"), ("renwu", "openai")
    ]
    assert got[1] == {"campus_key": "yihua", "platform": "meta", "cases": 1, "completed": 1, "deposited": 1}


# ── 端點（真資料庫） ─────────────────────────────────────────────────────────────


@pytest.fixture
def google(app):
    account = make_service_account()
    fake = FakeGoogle(account, scope=SCOPE)
    original = app.state.settings
    app.state.settings = original.model_copy(update={
        "google_sc_service_account_json": account.json_text, "ga4_property_id": GA4_PROPERTY,
    })
    app.state.google_transport = httpx.MockTransport(fake.handler)
    yield fake
    app.state.settings = original
    app.state.google_transport = None


def _month() -> str:
    return today_local().strftime("%Y-%m")


async def _get(client, **params):
    response = await client.get(URL, params={"from": _month(), "to": _month(), **params})
    assert response.status_code == 200, response.text
    return response.json()


async def _case(admin_client, public_client, db_session, campus="yihua", **columns) -> uuid.UUID:
    """用預約流程建一筆官網案件，再直接改歸屬欄位與狀態。"""
    booking = await book_slot(
        admin_client, public_client, campus, phone=unique_phone(), days_ahead=next(_DAYS), idempotency_key=f"roi-{uuid.uuid4()}"
    )
    request_id = uuid.UUID(booking["receipt_id"])
    if columns:
        await db_session.execute(update(VisitRequest).where(VisitRequest.id == request_id).values(**columns))
        await db_session.commit()
    return request_id


def _rows(body) -> dict:
    return {row["key"]: row for row in body["rows"]}


async def test_unknown_platform_and_direct_fallback(admin_client, public_client, db_session):
    await _case(admin_client, public_client, db_session, last_touch_source="ads", last_touch_ad_platform=None, first_touch_source="ads")
    await _case(admin_client, public_client, db_session, first_touch_source="search", last_touch_source=None)
    await _case(admin_client, public_client, db_session, last_touch_source="ads", last_touch_ad_platform="openai")
    last = _rows(await _get(admin_client, touch="last"))
    assert (last["unknown"]["cases"], last["organic"]["cases"], last["openai"]["cases"]) == (1, 1, 1)
    first = _rows(await _get(admin_client, touch="first"))
    assert (first["unknown"]["cases"], first["organic"]["cases"], first.get("openai")) == (1, 1, None)
    assert first["unrecorded"]["cases"] == 1


async def test_ads_touch_wins_over_ignored_platform_when_fallback(admin_client, public_client, db_session):
    # 沒有最後點擊來源、只有第一次是廣告：算 direct → organic，不是廣告
    await _case(admin_client, public_client, db_session, first_touch_source="ads", first_touch_ad_platform="meta", last_touch_source=None, last_touch_ad_platform="meta")
    rows = _rows(await _get(admin_client, touch="last"))
    assert rows["organic"]["cases"] == 1 and "meta" not in rows


async def test_google_error_is_reported(admin_client, public_client, db_session, google):
    google.ga4_cost_status = 500
    await _case(admin_client, public_client, db_session, last_touch_source="ads", last_touch_ad_platform="google")
    body = await _get(admin_client)
    assert body["google"]["error"] == "查詢 GA4 廣告花費（HTTP 500）"
    assert _rows(body)["google"]["spend_state"] == "error" and _rows(body)["google"]["cases"] == 1


async def test_google_spend_from_ga4(admin_client, public_client, db_session, google):
    google.ga4_cost_rows = [([today_local().strftime("%Y%m"), "11", "活動"], ["9000", "310", "4120"])]
    google.ga4_lead_rows = [([today_local().strftime("%Y%m"), "11", "活動"], ["5"])]
    await _case(admin_client, public_client, db_session, last_touch_source="ads", last_touch_ad_platform="google")
    body = await _get(admin_client)
    row = _rows(body)["google"]
    assert (row["spend_state"], row["spend"], row["clicks"], row["cost_per_case"]) == ("ok", 9000, 310, 9000)
    assert body["google"]["campaigns"][0]["leads"] == 5


async def test_not_configured_end_to_end(admin_client, public_client, db_session):
    await _case(admin_client, public_client, db_session, last_touch_source="ads", last_touch_ad_platform="google")
    body = await _get(admin_client)
    assert body["google"]["configured"] is False
    assert _rows(body)["google"]["spend_state"] == "not_configured" and _rows(body)["google"]["cases"] == 1


async def test_manual_spend_read_from_table(admin_client, public_client, db_session):
    await _case(admin_client, public_client, db_session, last_touch_source="ads", last_touch_ad_platform="openai")
    assert (await admin_client.put(f"/api/website/v1/admin/admissions/ad-spend/{_month()}/openai", json={"amount": 3000})).status_code == 200
    row = _rows(await _get(admin_client))["openai"]
    assert (row["spend"], row["spend_state"], row["cost_per_case"]) == (3000, "ok", 3000)


async def test_pending_counts(admin_client, public_client, db_session):
    ads = dict(last_touch_source="ads", last_touch_ad_platform="google")
    await _case(admin_client, public_client, db_session, **ads)  # 未到參觀日
    waiting = await _case(admin_client, public_client, db_session, **ads)  # 已過時間未標記
    considering = await _case(admin_client, public_client, db_session, **ads)
    withdrawn = await _case(admin_client, public_client, db_session, **ads)
    for request_id in (waiting, considering, withdrawn):
        slot_id = (await db_session.execute(VisitRequest.__table__.select().where(VisitRequest.id == request_id))).first().slot_id
        await move_slot(db_session, slot_id, slot_date=today_local() - timedelta(days=1))
    for request_id in (considering, withdrawn):
        assert (await complete(admin_client, request_id)).status_code == 200
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.visit_request_id == withdrawn).values(withdrawn_at=datetime.now(timezone.utc))
    )
    await db_session.commit()
    body = await _get(admin_client)
    assert body["pending"] == {"upcoming": 1, "awaiting_attendance": 1, "considering": 1}
    row = _rows(body)["google"]
    assert (row["cases"], row["completed"]) == (4, 2)


async def test_by_campus(admin_client, public_client, db_session):
    ads = dict(last_touch_source="ads", last_touch_ad_platform="google")
    await _case(admin_client, public_client, db_session, "minghua", **ads)
    await _case(admin_client, public_client, db_session, "yihua", **ads)
    body = await _get(admin_client)
    assert [(c["campus_key"], c["platform"], c["cases"]) for c in body["by_campus"]] == [("yihua", "google", 1), ("minghua", "google", 1)]


async def test_excluded_and_assisted_cases_ignored(admin_client, public_client, db_session):
    ads = dict(last_touch_source="ads", last_touch_ad_platform="google")
    await _case(admin_client, public_client, db_session, **ads)
    await _case(admin_client, public_client, db_session, excluded_at=datetime.now(timezone.utc), exclude_reason="test", **ads)
    await _case(admin_client, public_client, db_session, source=VisitRequestSource.PHONE.value, **ads)
    assert _rows(await _get(admin_client))["google"]["cases"] == 1


async def test_cases_outside_range_ignored(admin_client, public_client, db_session):
    await _case(admin_client, public_client, db_session, last_touch_source="ads", last_touch_ad_platform="google",
                created_at=datetime.now(timezone.utc) - timedelta(days=70))
    assert _rows(await _get(admin_client))["google"]["cases"] == 0


@pytest.mark.parametrize("params", [
    {"from": "2026-11", "to": "2026-10"}, {"from": "2024-01", "to": "2026-11"}, {"from": "abc", "to": "2026-11"},
])
async def test_invalid_range_is_422(admin_client, params):
    response = await admin_client.get(URL, params=params)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_MONTH_RANGE"
    assert response.json()["detail"]["message"]


async def test_branch_admin_forbidden(reception_yihua_client, readonly_yihua_client):
    for client in (reception_yihua_client, readonly_yihua_client):
        assert (await client.get(URL, params={"from": "2026-11", "to": "2026-11"})).status_code == 403
