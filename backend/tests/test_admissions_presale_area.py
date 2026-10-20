"""附近預售建案 API（2026-10-20 預售建案規格 P11、P12）：半徑內在建案的清單、座標距離與里界重心距離、預計交屋（粗估、
只給到半年）、已過預計時間、排序、沒對到里的案數、沒匯入、本校沒座標、半徑、權限與開關、不含起造人、不寫稽核。

義華校址固定在門牌樣本的座標；公開資料直接寫資料庫。1 公里內（里界面積重心）有本揚里 287 m、本上里 489 m 等；
本武里 1.5 公里。今天固定是 2026-10-20。"""

from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from sqlalchemy import func, select

from app.admissions import presale_area
from app.admissions.geo import boundaries, matcher
from app.admissions.geo import presale as presale_io
from app.admissions.geo.models import GeoDatasetStatus, GeoPresaleBuildcase
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.admissions_area_helpers import AREA
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings

PRESALE = f"{AREA}/presale"
YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133
TODAY = date(2026, 10, 20)
NOW = datetime(2026, 10, 20, 4, 0, tzinfo=timezone.utc)
BENYANG = boundaries.village_code("三民區", "本揚里")
BENSHANG = boundaries.village_code("三民區", "本上里")
BENWU = boundaries.village_code("三民區", "本武里")


@pytest.fixture(autouse=True)
def october(monkeypatch):
    monkeypatch.setattr(presale_area, "today_local", lambda: TODAY)


@pytest.fixture
def located_campus(monkeypatch):
    async def located(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=YIHUA_LAT, lng=YIHUA_LNG, locate_error=None, district="三民區")

    monkeypatch.setattr(matcher, "campus_point", located)


def case(name: str, level: str, village_code: str | None, **kwargs) -> GeoPresaleBuildcase:
    values = {
        "district": "三民區", "street": "義華路", "households": 100, "main_use": "住家用", "residential": True,
        "permit_on": date(2024, 1, 1), "first_registered_on": None, "match_level": level, "lat": None, "lon": None,
        "source_version": "115-10", "updated_at": NOW,
    }
    values.update(kwargs)
    village = boundaries.village_names()[village_code][1] if village_code else None
    return GeoPresaleBuildcase(name=name, village_code=village_code, village=village, **values)


async def _seed(db, *extra: GeoPresaleBuildcase) -> None:
    db.add_all(
        [
            # 有座標：用座標距離（0 m）。120 戶：建照 2024-03 + 48 個月＝2028-03（上半年）。
            case("甲案", "exact", BENYANG, households=120, permit_on=date(2024, 3, 10), lat=YIHUA_LAT, lon=YIHUA_LNG),
            # 只到里：用里界面積重心（本揚里 287 m → 300 m）。36 戶：2023-06 + 36 個月＝2026-06，已過預計時間。
            case("乙案", "street", BENYANG, households=36, permit_on=date(2023, 6, 1)),
            # 地號座標在本校北邊約 445 m（本上里）。200 戶：2025-01 + 48 個月＝2029-01。
            case("丙案", "parcel", BENSHANG, households=200, permit_on=date(2025, 1, 1), lat=YIHUA_LAT + 0.004, lon=YIHUA_LNG),
            # 不列：已登記、非住宅、建照超過 6 年、只到區、待比對。
            case("已登記", "exact", BENYANG, first_registered_on=date(2026, 1, 1)),
            case("廠房", "exact", BENYANG, residential=False),
            case("太舊", "exact", BENYANG, permit_on=date(2020, 10, 19)),
            case("只到區", "district", None),
            case("待比對", "pending", None),
            case("岡山案", "district", None, district="岡山區"),
            *extra,
        ]
    )
    await db.merge(GeoDatasetStatus(dataset="presale_buildcases", active_version="a" * 64, label="115-10", synced_at=NOW))
    await db.commit()


async def _get(client, query: str = "radius_km=1") -> dict:
    response = await client.get(f"{PRESALE}?campus_key=yihua&{query}")
    assert response.status_code == 200, response.text
    return response.json()


async def test_lists_building_cases_in_the_radius_sorted_by_expected_delivery(admin_client, db_session, located_campus):
    await _seed(db_session)
    body = await _get(admin_client)
    assert body["radius_km"] == 1 and body["campus"]["key"] == "yihua"
    assert body["source"] == {"version": "115-10", "unplaced": 2, "note": presale_io.SOURCE_NOTE}
    assert body["summary"] == {"cases": 3, "households": 120 + 36 + 200}
    # 已過預計時間的在最前，其餘依預計交屋由近到遠。
    assert [item["name"] for item in body["items"]] == ["乙案", "甲案", "丙案"]
    assert body["items"][0] == {
        "name": "乙案", "district": "三民區", "village": "本揚里", "village_code": BENYANG, "households": 36,
        "permit_on": "2023-06-01", "expected_year": 2026, "expected_half": 1, "overdue": True, "distance_m": 300,
        "match_level": "street", "lat": None, "lon": None,
    }
    first = body["items"][1]
    assert (first["expected_year"], first["expected_half"], first["overdue"], first["distance_m"]) == (2028, 1, False, 0)
    assert (first["match_level"], first["lat"], first["lon"]) == ("exact", YIHUA_LAT, YIHUA_LNG)
    third = body["items"][2]
    assert (third["expected_year"], third["expected_half"], third["match_level"], third["distance_m"]) == (2029, 1, "parcel", 400)


async def test_distance_uses_coordinates_when_present_and_a_far_pin_in_a_near_village_is_out(admin_client, db_session, located_campus):
    # 本揚里的重心在 287 m，但這案的地號座標在 2.2 公里外：有座標就用座標，半徑 1 公里不列、3 公里列。
    await _seed(db_session, case("遠點", "parcel", BENYANG, lat=YIHUA_LAT + 0.02, lon=YIHUA_LNG))
    assert "遠點" not in [item["name"] for item in (await _get(admin_client))["items"]]
    far = {item["name"]: item for item in (await _get(admin_client, "radius_km=3"))["items"]}["遠點"]
    assert far["distance_m"] == 2200


async def test_street_level_cases_use_the_village_centroid_for_the_radius(admin_client, db_session, located_campus):
    await _seed(db_session, case("本武案", "street", BENWU))
    assert "本武案" not in [item["name"] for item in (await _get(admin_client, "radius_km=1"))["items"]]
    three = {item["name"]: item for item in (await _get(admin_client, "radius_km=3"))["items"]}
    assert three["本武案"]["distance_m"] == 1500 and three["本武案"]["village"] == "本武里"


async def test_ties_are_ordered_by_distance_then_name(admin_client, db_session, located_campus):
    await _seed(
        db_session,
        case("同日遠", "street", BENSHANG, households=120, permit_on=date(2024, 3, 10)),
        case("同日近", "exact", BENYANG, households=120, permit_on=date(2024, 3, 10), lat=YIHUA_LAT, lon=YIHUA_LNG),
    )
    # 同預計交屋日（2028-03-10）：先看距離（0 m、0 m、500 m），同距離依案名（「同」比「甲」小）。
    assert [item["name"] for item in (await _get(admin_client))["items"]] == ["乙案", "同日近", "甲案", "同日遠", "丙案"]


async def test_empty_states(admin_client, db_session, located_campus, monkeypatch):
    # 沒匯入：清單空、版本 null、來源說明空。
    body = await _get(admin_client)
    assert body["source"] == {"version": None, "unplaced": 0, "note": ""} and body["items"] == []
    assert body["summary"] == {"cases": 0, "households": 0}
    # 匯入了但半徑內沒有在建案：版本照給。
    await db_session.merge(GeoDatasetStatus(dataset="presale_buildcases", active_version="a" * 64, label="115-10", synced_at=NOW))
    await db_session.commit()
    body = await _get(admin_client)
    assert body["source"]["version"] == "115-10" and body["items"] == []

    async def unlocated(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=None, lng=None, locate_error="no_doorplate", district="三民區")

    monkeypatch.setattr(matcher, "campus_point", unlocated)
    await _seed(db_session)
    body = await _get(admin_client)
    assert body["campus"]["locate_error"] == "no_doorplate" and body["items"] == []


async def test_response_never_carries_a_builder(admin_client, db_session, located_campus):
    await _seed(db_session)
    body = await _get(admin_client)
    assert set(body["items"][0]) == {
        "name", "district", "village", "village_code", "households", "permit_on", "expected_year", "expected_half",
        "overdue", "distance_m", "match_level", "lat", "lon",
    }


@pytest.mark.parametrize("radius", ["2", "0", "abc", "", "3.5"])
async def test_rejects_bad_radius(admin_client, radius):
    response = await admin_client.get(f"{PRESALE}?campus_key=yihua&radius_km={radius}")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_RADIUS"


async def test_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client):
    """與「里的變化」同一個權限（admissions.stats，限總管理者）：其他角色不論本校或他校一律 403。"""
    path = f"{PRESALE}?campus_key="
    for client in (reception_yihua_client, minghua_client, editor_client, readonly_yihua_client):
        assert (await client.get(path + "yihua")).status_code == 403
        assert (await client.get(path + "minghua")).status_code == 403
    assert (await admin_client.get(path + "yihua")).status_code == 200
    assert (await admin_client.get(path + "nowhere")).status_code == 404


async def test_needs_login(public_client):
    assert (await public_client.get(f"{PRESALE}?campus_key=yihua")).status_code == 401


async def test_hidden_when_admissions_disabled(admin_client):
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        assert (await client.get(f"{PRESALE}?campus_key=yihua")).status_code == 404
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()


async def test_never_writes_audit_entries(admin_client, db_session, located_campus):
    await _seed(db_session)
    before = await db_session.scalar(select(func.count()).select_from(AuditLogEntry))
    await _get(admin_client)
    assert await db_session.scalar(select(func.count()).select_from(AuditLogEntry)) == before
