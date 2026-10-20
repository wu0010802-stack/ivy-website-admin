"""招生潛力與市佔率 API（2026-10-20 招生潛力與市佔率規格 §5）。

里界重心與校址座標換成小字典（兩個近里），註冊與九月人口用假數字；市佔率要和 query_share 算出的一致。"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app.admissions.geo import boundaries, matcher, school_districts
from app.admissions.geo.models import GeoElementaryGrade1, GeoVillageAgesSeptember
from app.admissions.history.models import CampusTermEnrollment
from app.admissions.share import query_share
from app.main import create_app
from tests.admissions_area_helpers import API
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings

POTENTIAL = f"{API}/admin/admissions/potential"
YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133
NEAR_A, NEAR_B = "64000050001", "64000050002"
DISTRICT = "三民區"
CENTROIDS = {
    NEAR_A: (YIHUA_LAT, YIHUA_LNG),  # 0 m
    NEAR_B: (22.6524556, 120.3437133),  # 約 1.1 km
}


@pytest.fixture(autouse=True)
def world(monkeypatch):
    async def located(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=YIHUA_LAT, lng=YIHUA_LNG, locate_error=None, district=DISTRICT)

    monkeypatch.setattr(matcher, "campus_point", located)
    monkeypatch.setattr(boundaries, "village_centroids", lambda: dict(CENTROIDS))
    monkeypatch.setattr(boundaries, "village_names", lambda: {code: (DISTRICT, f"測試{index}里") for index, code in enumerate(CENTROIDS)})
    monkeypatch.setattr(school_districts, "by_village", lambda: {})
    monkeypatch.setattr(school_districts, "by_school", lambda: {})


async def _seed(db) -> None:
    """兩個學年的上學期註冊（109＝210、110＝173）加對應的九月人口；112 學年只有註冊沒有九月列。"""
    for year, registered in ((109, 210), (110, 173), (112, 131)):
        db.add_all(
            CampusTermEnrollment(
                campus_key="yihua", school_year=year, semester=1, grade=grade, as_of=date(year + 1911, 9, 15),
                registered=count, imported_at=datetime.now(timezone.utc),
            )
            for grade, count in (("大班", registered - 100), ("中班", 60), ("小班", 30), ("幼幼班", 10))
        )
    for year, kids in ((109, 14076), (110, 13158)):
        base, extra = divmod(kids, 4)
        ages = [base + (1 if index < extra else 0) for index in range(4)]
        db.add(
            GeoVillageAgesSeptember(
                year=year, village_code=NEAR_A, district=DISTRICT, village="測試0里", age_0=9, age_1=9,
                age_2=ages[0], age_3=ages[1], age_4=ages[2], age_5=ages[3], age_6=0, people_total=5000,
            )
        )
    await db.commit()


async def test_not_imported(admin_client):
    response = await admin_client.get(f"{POTENTIAL}?campus_key=yihua")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["campus"]["key"] == "yihua"
    assert body["share"]["status"] == "not_imported"
    assert (body["share"]["years"], body["share"]["latest"], body["share"]["best"]) == ([], None, None)
    assert body["share"]["elementary_check"] is None


async def test_payload_shape(admin_client, db_session):
    await _seed(db_session)
    expected = await query_share(db_session, "yihua")

    response = await admin_client.get(f"{POTENTIAL}?campus_key=yihua")

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"campus", "share", "generated_at"}
    assert datetime.fromisoformat(body["generated_at"]).tzinfo is not None
    assert body["campus"]["key"] == "yihua"
    assert (body["campus"]["lat"], body["campus"]["lng"]) == (YIHUA_LAT, YIHUA_LNG)
    share = body["share"]
    assert share["status"] == "ready"
    assert share["radius_km"] == 3
    assert share["years"] == expected["years"]
    assert [(year["school_year"], year["registered"], year["children"], year["share"]) for year in share["years"]] == [
        (109, 210, 14076, 0.0149),
        (110, 173, 13158, 0.0131),
        (112, 131, None, None),
    ]
    assert share["latest"] == expected["latest"] == share["years"][1]
    assert share["best"] == expected["best"] == share["years"][0]
    assert share["elementary_check"] is None
    assert share["notes"] == expected["notes"]


async def test_elementary_check_is_serialized(admin_client, db_session, monkeypatch):
    """A 里只屬一所國小：兩年都是一年級 100 ÷ 6 歲 125 → 0.8，最新一年沒偏離平均，不提醒。"""
    assign = school_districts.Assignment(village_code=NEAR_A, school_code="553610", partial=False, free_zone=False, neighborhoods="", note="")
    monkeypatch.setattr(school_districts, "by_village", lambda: {NEAR_A: (assign,)})
    monkeypatch.setattr(school_districts, "by_school", lambda: {"553610": (assign,)})
    await _seed(db_session)
    for year in (113, 114):
        db_session.add(GeoElementaryGrade1(school_year=year, school_code="553610", grade1=100, school_name="甲國小"))
        db_session.add(
            GeoVillageAgesSeptember(
                year=year, village_code=NEAR_A, district=DISTRICT, village="測試0里", age_0=0, age_1=0,
                age_2=0, age_3=0, age_4=0, age_5=0, age_6=125, people_total=5000,
            )
        )
    await db_session.commit()

    response = await admin_client.get(f"{POTENTIAL}?campus_key=yihua")

    assert response.status_code == 200, response.text
    check = response.json()["share"]["elementary_check"]
    assert check["schools"] == 1
    assert check["years"] == [
        {"school_year": 113, "grade1": 100, "age6": 125.0, "ratio": 0.8, "schools": 1},
        {"school_year": 114, "grade1": 100, "age6": 125.0, "ratio": 0.8, "schools": 1},
    ]
    assert (check["mean"], check["latest_ratio"], check["warn"]) == (0.8, 0.8, False)


async def test_no_store_header(admin_client):
    response = await admin_client.get(f"{POTENTIAL}?campus_key=yihua")
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["cache-control"]


async def test_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client, public_client):
    """限總管理者（admissions.stats）：其他角色不論本校或他校一律 403。"""
    path = f"{POTENTIAL}?campus_key="
    for client in (reception_yihua_client, minghua_client, editor_client, readonly_yihua_client):
        assert (await client.get(path + "yihua")).status_code == 403
        assert (await client.get(path + "minghua")).status_code == 403
    assert (await admin_client.get(path + "yihua")).status_code == 200
    assert (await admin_client.get(path + "minghua")).status_code == 200
    assert (await admin_client.get(path + "nowhere")).status_code == 404
    assert (await public_client.get(path + "yihua")).status_code == 401


async def test_hidden_when_admissions_are_disabled(admin_client):
    """admin_client 只為了建好總管理者帳號；這裡用另一個關掉招生的 app 登入。"""
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        assert (await client.get(f"{POTENTIAL}?campus_key=yihua")).status_code == 404
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()
