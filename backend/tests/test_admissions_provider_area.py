"""附近托嬰與園所變化 API（2026-10-14 規格 §6）：半徑與總結、空值、尚未匯入、本校沒座標、權限、開關、視窗與去重。"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import update

from app.admissions import area
from app.admissions.geo import babycare as geo_babycare
from app.admissions.geo import matcher
from app.admissions.geo import providers as geo_providers
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoKindergarten, GeoProviderEvent
from app.common.timezones import today_local
from app.main import create_app
from tests.admissions_area_helpers import AREA
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings
from tests.geo_helpers import load_babycare_sample, load_geo_samples, publish_campus_address

BABYCARE = f"{AREA}/babycare"
CHANGES = f"{AREA}/changes"
# tests/fixtures/geo/preschools-sample.json 的兩所：何嘉仁（距義華 300 m）、保羅（513 m）。
HOJIAREN = "e464ae13-0cbc-4a8e-9289-de0c18abc263"
PAUL = "0f26d968-d574-4e8f-bbdd-2b88a65efaf1"
# 托嬰樣本沒有月費、收費檔也沒匯入：summary 的月費那六個鍵都是空的。
NO_FEES = {"fee_count": 0, "fee_median": None, "fee_min": None, "fee_max": None, "own_age2_monthly": None, "fee_school_year": None}


@pytest.fixture
async def located(db_session):
    """義華有座標（發布校址）、幼兒園與托嬰樣本都已匯入。"""
    await load_geo_samples(db_session)
    await load_babycare_sample(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")


@pytest.fixture
def unlocated_campus(monkeypatch):
    async def unlocated(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=None, lng=None, locate_error="pending", district="三民區")

    monkeypatch.setattr(matcher, "campus_point", unlocated)


# ---- 附近托嬰 ----


async def test_babycare_lists_the_nearby_ones_by_distance_with_a_summary(admin_client, located):
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua")).json()
    assert body["radius_km"] == 3 and body["synced_at"] is not None
    assert body["source_note"] == geo_babycare.SOURCE_NOTE
    assert [(item["source_id"], item["distance_m"]) for item in body["items"]] == [
        ("CW10203013", 165), ("CW10112502", 435), ("CW11507009", 939), ("CW10808013", 1297), ("CW10112245", 1657),
    ]
    assert body["summary"] == {"count": 5, "approved_total": 157, "enrolled_total": 107, **NO_FEES}
    home = body["items"][3]
    assert (home["kind"], home["approved_capacity"], home["enrolled"], home["phone"]) == ("home", 12, 4, "073705166")
    assert body["items"][4]["address"] == "高雄市鳥松區大埤路123之4號1樓、123之6號1-2樓"
    assert body["campus"]["key"] == "yihua" and body["campus"]["lat"] is not None


@pytest.mark.parametrize(("radius", "count", "approved", "enrolled"), [(1, 3, 120, 78), (3, 5, 157, 107), (6, 5, 157, 107)])
async def test_babycare_follows_the_radius(admin_client, located, radius, count, approved, enrolled):
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua&radius_km={radius}")).json()
    assert body["radius_km"] == radius
    assert body["summary"] == {"count": count, "approved_total": approved, "enrolled_total": enrolled, **NO_FEES}
    assert len(body["items"]) == count  # 8.3 公里外的那一所連 6 公里都進不來


async def test_babycare_unknown_numbers_are_null_and_not_counted(admin_client, db_session, located):
    await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id == "CW10203013").values(approved_capacity=None, enrolled=None))
    await db_session.commit()
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua")).json()
    first = body["items"][0]
    assert (first["source_id"], first["approved_capacity"], first["enrolled"]) == ("CW10203013", None, None)
    assert body["summary"] == {"count": 5, "approved_total": 105, "enrolled_total": 55, **NO_FEES}


async def test_babycare_closed_ones_are_not_listed(admin_client, db_session, located):
    await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id == "CW10112502").values(is_active=False))
    await db_session.commit()
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua&radius_km=1")).json()
    assert [item["source_id"] for item in body["items"]] == ["CW10203013", "CW11507009"]
    assert body["summary"]["count"] == 2


async def test_babycare_not_imported_says_so_instead_of_pretending_there_is_none(admin_client, db_session):
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua")).json()
    assert body["synced_at"] is None and body["items"] == []
    assert body["summary"] == {"count": 0, "approved_total": 0, "enrolled_total": 0, **NO_FEES}


async def test_babycare_when_campus_not_located(admin_client, unlocated_campus, monkeypatch):
    async def must_not_query(*args, **kwargs):
        raise AssertionError("本校沒座標時不該查附近托嬰")

    monkeypatch.setattr(geo_babycare, "nearby", must_not_query)
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua")).json()
    assert body["items"] == [] and body["campus"]["locate_error"] == "pending" and body["campus"]["lat"] is None


# ---- 附近園所的變化 ----


async def _seed_changes(db_session) -> None:
    today = today_local()
    # 何嘉仁：設立日 40 天前 → 新設（設立日）。
    await db_session.execute(update(GeoKindergarten).where(GeoKindergarten.source_id == HOJIAREN).values(registered_on=today - timedelta(days=40)))
    # 頂尖小子托嬰：5 天前停辦。
    await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id == "CW10112502").values(is_active=False))
    db_session.add_all(
        [
            GeoProviderEvent(provider="babycare", source_id="CW10112502", change="closed", occurred_on=today - timedelta(days=5)),
            # 保羅：10 天前由私立轉準公共。
            GeoProviderEvent(
                provider="kindergarten", source_id=PAUL, change="kind_changed", occurred_on=today - timedelta(days=10),
                old_value="private", new_value="quasi_public",
            ),
            # 視窗之外的事件不出現。
            GeoProviderEvent(provider="babycare", source_id="CW11507009", change="closed", occurred_on=today - timedelta(days=400)),
        ]
    )
    await db_session.commit()


async def test_changes_lists_new_closed_and_kind_changed_newest_first(admin_client, db_session, located):
    await _seed_changes(db_session)
    body = (await admin_client.get(f"{CHANGES}?campus_key=yihua")).json()
    today = today_local()
    assert (body["radius_km"], body["window_months"]) == (3, 12)
    assert [(item["provider"], item["change"], item["date_basis"]) for item in body["items"]] == [
        ("babycare", "closed", "observed"),
        ("kindergarten", "kind_changed", "observed"),
        ("kindergarten", "opened", "registered"),
    ]
    closed, kind_changed, opened = body["items"]
    assert closed["date"] == (today - timedelta(days=5)).isoformat() and closed["kind"] == "center" and closed["distance_m"] == 435
    assert (kind_changed["old_kind"], kind_changed["new_kind"], kind_changed["kind"]) == ("private", "quasi_public", "quasi_public")
    assert opened["date"] == (today - timedelta(days=40)).isoformat() and opened["distance_m"] == 300
    assert closed["old_kind"] is None and opened["new_kind"] is None


async def test_changes_tracking_since_is_the_baseline_of_each_list(admin_client, db_session, located):
    body = (await admin_client.get(f"{CHANGES}?campus_key=yihua")).json()
    today = today_local().isoformat()
    assert body["tracking_since"] == {"kindergarten": today, "babycare": today}
    await db_session.execute(update(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "babycare").values(baseline_on=None))
    await db_session.commit()
    assert (await admin_client.get(f"{CHANGES}?campus_key=yihua")).json()["tracking_since"] == {"kindergarten": today, "babycare": None}


async def test_changes_with_nothing_recorded_yet(admin_client, db_session):
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    body = (await admin_client.get(f"{CHANGES}?campus_key=yihua")).json()
    assert body["items"] == [] and body["tracking_since"] == {"kindergarten": None, "babycare": None}


@pytest.mark.parametrize(("radius", "expected"), [(1, ["CW10112502"]), (3, ["CW10112502", "CW10808013"]), (6, ["CW10112502", "CW10808013"])])
async def test_changes_follow_the_radius(admin_client, db_session, located, radius, expected):
    today = today_local()
    await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id.in_(["CW10112502", "CW10808013"])).values(is_active=False))
    db_session.add_all(
        [
            GeoProviderEvent(provider="babycare", source_id="CW10112502", change="closed", occurred_on=today - timedelta(days=1)),  # 435 m
            GeoProviderEvent(provider="babycare", source_id="CW10808013", change="closed", occurred_on=today - timedelta(days=2)),  # 1297 m
        ]
    )
    await db_session.commit()
    body = (await admin_client.get(f"{CHANGES}?campus_key=yihua&radius_km={radius}")).json()
    assert [item["source_id"] for item in body["items"]] == expected


async def test_changes_when_campus_not_located(admin_client, unlocated_campus, monkeypatch):
    async def must_not_query(*args, **kwargs):
        raise AssertionError("本校沒座標時不該查附近的變化")

    monkeypatch.setattr(geo_providers, "nearby_changes", must_not_query)
    body = (await admin_client.get(f"{CHANGES}?campus_key=yihua")).json()
    assert body["items"] == [] and body["campus"]["locate_error"] == "pending"


async def test_query_changes_uses_the_given_day_for_the_window(db_session, located):
    """視窗以 today 參數為準（不讀系統時間），固定日期才測得到邊界。"""
    db_session.add(GeoProviderEvent(provider="babycare", source_id="CW10112502", change="closed", occurred_on=date(2025, 10, 14)))
    await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id == "CW10112502").values(is_active=False))
    await db_session.commit()
    inside = await area.query_changes(db_session, "yihua", radius_km=3, today=date(2026, 10, 14))
    outside = await area.query_changes(db_session, "yihua", radius_km=3, today=date(2026, 10, 15))
    assert [item["source_id"] for item in inside["items"]] == ["CW10112502"]
    assert outside["items"] == []


# ---- 共通：半徑、權限、開關 ----


@pytest.mark.parametrize("path", [BABYCARE, CHANGES], ids=["babycare", "changes"])
@pytest.mark.parametrize("radius", ["2", "0", "-1", "7", "abc", "", "3.5", "1,3", "%E4%B8%89"])
async def test_reject_any_radius_but_1_3_6_with_the_same_error_code(admin_client, path, radius):
    response = await admin_client.get(f"{path}?campus_key=yihua&radius_km={radius}")
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_RADIUS"


@pytest.mark.parametrize("path", [BABYCARE, CHANGES], ids=["babycare", "changes"])
async def test_bad_radius_does_not_skip_the_login_check(public_client, reception_yihua_client, path):
    url = f"{path}?campus_key=yihua&radius_km=abc"
    assert (await public_client.get(url)).status_code == 401
    assert (await reception_yihua_client.get(url)).status_code == 422


@pytest.mark.parametrize("path", [BABYCARE, CHANGES], ids=["babycare", "changes"])
async def test_permissions(
    reception_yihua_client, readonly_yihua_client, editor_client, minghua_client, admin_client, path
):
    url = f"{path}?campus_key="
    assert (await reception_yihua_client.get(url + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(url + "minghua")).status_code == 404
    assert (await editor_client.get(url + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(url + "yihua")).status_code == 403
    assert (await minghua_client.get(url + "yihua")).status_code == 404
    assert (await admin_client.get(url + "nowhere")).status_code == 404


async def test_hidden_when_admissions_disabled(admin_client):
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        for path in (f"{BABYCARE}?campus_key=yihua", f"{CHANGES}?campus_key=yihua"):
            response = await client.get(path)
            assert response.status_code == 404, (path, response.text)
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()


async def test_area_data_status_has_the_babycare_sync_time(admin_client, db_session):
    assert (await admin_client.get(f"{AREA}?campus_key=yihua")).json()["data_status"]["babycare_synced_at"] is None
    await load_babycare_sample(db_session)
    assert (await admin_client.get(f"{AREA}?campus_key=yihua")).json()["data_status"]["babycare_synced_at"] is not None
