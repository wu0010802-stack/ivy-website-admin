"""招生潛力與市佔率 API（2026-10-20 招生潛力與市佔率規格 §5）。

里界重心與校址座標換成小字典（兩個近里），註冊與九月人口用假數字；市佔率要和 query_share 算出的一致。"""
from __future__ import annotations

import math
from datetime import date, datetime, timezone

import pytest

from app.admissions import potential
from app.admissions.enrolled.models import EnrolledRoster
from app.admissions.geo import boundaries, matcher, school_districts
from app.admissions.geo.models import (
    GeoDatasetStatus,
    GeoElementaryGrade1,
    GeoPresaleBuildcase,
    GeoProviderEvent,
    GeoVillageAgesSeptember,
)
from app.admissions.history.models import CampusTermEnrollment
from app.admissions.share import query_share
from app.main import create_app
from tests.admissions_area_helpers import API
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings
from tests.peer_fees_helpers import add_fee, add_kindergarten

POTENTIAL = f"{API}/admin/admissions/potential"
YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133
NEAR_A, NEAR_B = "64000050001", "64000050002"
DISTRICT = "三民區"
CENTROIDS = {
    NEAR_A: (YIHUA_LAT, YIHUA_LNG),  # 0 m
    NEAR_B: (22.6524556, 120.3437133),  # 約 1.1 km
}
POTENTIAL_TODAY = date(2026, 10, 20)


@pytest.fixture(autouse=True)
def world(monkeypatch):
    async def located(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=YIHUA_LAT, lng=YIHUA_LNG, locate_error=None, district=DISTRICT)

    monkeypatch.setattr(matcher, "campus_point", located)
    monkeypatch.setattr(boundaries, "village_centroids", lambda: dict(CENTROIDS))
    monkeypatch.setattr(boundaries, "village_names", lambda: {code: (DISTRICT, f"測試{index}里") for index, code in enumerate(CENTROIDS)})
    monkeypatch.setattr(school_districts, "by_village", lambda: {})
    monkeypatch.setattr(school_districts, "by_school", lambda: {})
    monkeypatch.setattr(potential, "today_local", lambda: POTENTIAL_TODAY)


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
    assert set(body) == {"campus", "share", "potential", "generated_at"}
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


async def _seed_potential(db) -> None:
    """本校（核定 210、在籍清冊 192 人）加兩所停辦的園所：甲 607 m、核定 136（2023-07-31）、乙 2 km、沒有核定（2024-08-01）。"""
    add_kindergarten(db, "own", "高雄市私立常春藤幼兒園", "private", 0, approved_capacity=210)
    add_kindergarten(db, "ire", "高雄市私立愛爾蘭幼兒園", "private", 607, approved_capacity=136, is_active=False)
    add_kindergarten(db, "nocap", "高雄市私立無核定幼兒園", "private", -2000, approved_capacity=None, is_active=False)
    await db.flush()
    add_fee(db, "own", 3, 89_750)
    add_fee(db, "ire", 3, 80_000)
    db.add_all(
        [
            GeoProviderEvent(provider="kindergarten", source_id="ire", change="closed", occurred_on=date(2023, 7, 31)),
            GeoProviderEvent(provider="kindergarten", source_id="nocap", change="closed", occurred_on=date(2024, 8, 1)),
            GeoDatasetStatus(dataset="kindergartens", active_version="2026-10-20", label="2026-10-20", synced_at=datetime.now(timezone.utc)),
            EnrolledRoster(campus_key="yihua", roster_date=date(2026, 10, 15), school_year=115, doorplate_version="115-10", total=192),
        ]
    )
    await db.commit()


async def test_potential_without_any_data(admin_client):
    response = await admin_client.get(f"{POTENTIAL}?campus_key=yihua")

    assert response.status_code == 200, response.text
    estimate = response.json()["potential"]
    assert estimate["status"] == "ready"
    assert [(source["key"], source["status"]) for source in estimate["sources"]] == [
        ("closures", "no_data"), ("villages", "no_data"), ("presale", "no_data"),
    ]
    assert [source["reason"] for source in estimate["sources"]] == ["沒有停辦紀錄", "沒有在籍清冊", "沒有在籍清冊"]
    assert all((source["low"], source["mid"], source["high"]) == (None, None, None) for source in estimate["sources"])
    assert (estimate["total"], estimate["capacity"], estimate["events"]) == (None, None, [])


async def test_potential_estimate_is_serialized(admin_client, db_session):
    await _seed_potential(db_session)

    response = await admin_client.get(f"{POTENTIAL}?campus_key=yihua")

    assert response.status_code == 200, response.text
    estimate = response.json()["potential"]
    closures, villages, presale = estimate["sources"]
    assert (closures["key"], closures["status"], closures["reason"]) == ("closures", "ok", None)
    assert closures["mid"] > 0 and closures["low"] <= closures["mid"] <= closures["high"]
    assert [(year["school_year"], year["events"]) for year in closures["details"]["years"]] == [(111, 1), (112, 0), (113, 0), (114, 0)]
    assert closures["details"]["skipped"] == {"no_capacity": 1, "outside_windows": 0}
    assert closures["details"]["events"][0]["occurred_on"] == "2023-07-31"
    assert {"label": "實收率", "value": "0.67（全市 114 學年核定與幼生比）"} in closures["assumptions"]
    # 有清冊但沒有各里人口：來源二算不出來，來源三沒有占有率可用
    assert (villages["status"], villages["reason"]) == ("no_data", "附近有孩子的里太少")
    assert villages["details"] == {"bands": [], "model": None}
    assert (presale["status"], presale["reason"]) == ("no_data", "附近有孩子的里太少")
    assert presale["details"] == {"deliveries": []}
    assert estimate["total"] == {"low": closures["low"], "mid": closures["mid"], "high": closures["high"], "included": ["closures"]}
    assert estimate["capacity"] == {"approved": 210, "enrolled": 192, "open": 18}
    assert [(item["occurred_on"], item["name"], item["approved_capacity"], item["school_year"]) for item in estimate["events"]] == [
        ("2023-07-31", "高雄市私立愛爾蘭幼兒園", 136, 111),
        ("2024-08-01", "高雄市私立無核定幼兒園", None, 112),
    ]
    assert [item["distance_m"] for item in estimate["events"]] == pytest.approx([607, 2000], abs=3)


async def test_potential_failure_degrades_to_no_data_and_keeps_the_share(admin_client, db_session, monkeypatch, caplog):
    """第二、三波的推估出任何錯：記 exception，推估降級成三個來源都沒有資料，市佔率（第一波）照常回。"""
    await _seed(db_session)
    await _seed_potential(db_session)
    expected = await query_share(db_session, "yihua")

    async def broken(db, campus_key, **kwargs):
        raise RuntimeError("推估壞了")

    monkeypatch.setattr(potential, "query_potential", broken)

    with caplog.at_level("ERROR", logger="app.admissions.routes"):
        response = await admin_client.get(f"{POTENTIAL}?campus_key=yihua")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["share"]["status"] == "ready" and body["share"]["years"] == expected["years"]
    estimate = body["potential"]
    assert estimate["status"] == "ready"
    assert [(source["key"], source["status"], source["reason"]) for source in estimate["sources"]] == [
        ("closures", "no_data", "這一項暫時算不出來"),
        ("villages", "no_data", "這一項暫時算不出來"),
        ("presale", "no_data", "這一項暫時算不出來"),
    ]
    assert all((source["low"], source["mid"], source["high"]) == (None, None, None) for source in estimate["sources"])
    assert all(source["assumptions"] for source in estimate["sources"])
    assert (estimate["total"], estimate["capacity"], estimate["events"]) == (None, None, [])
    errors = [record for record in caplog.records if record.name == "app.admissions.routes" and record.exc_info]
    assert len(errors) == 1 and "推估壞了" in str(errors[0].exc_info[1])


def _json_numbers(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from _json_numbers(item)
    elif isinstance(value, list):
        for item in value:
            yield from _json_numbers(item)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        yield value


async def test_potential_never_returns_the_band_shares(admin_client, db_session, monkeypatch):
    """三個來源都有數字：距離帶彙總與逐案貢獻都在，占有率（在籍 ÷ 2–5 歲）的原值不在回應裡。"""
    await _seed_potential(db_session)
    obs = [
        potential.VillageObs(
            f"64000{index:06d}", 100.0 + index * 100, 2400,
            round(2400 * math.exp(-2.6 - 1.07 * (100 + index * 100) / 1000) * (0.5 if index % 2 else 1.0)),
        )
        for index in range(60)
    ]

    async def village_obs(db, campus_key, lat, lng, *, radius_m=potential.VILLAGE_FIT_RADIUS_M):
        return obs

    monkeypatch.setattr(potential, "load_village_obs", village_obs)
    db_session.add(
        GeoPresaleBuildcase(
            name="測試建案", village_code=NEAR_B, village="測試1里", district=DISTRICT, street="義華路", households=300,
            main_use="住家用", residential=True, permit_on=date(2023, 1, 1), first_registered_on=None, match_level="street",
            lat=None, lon=None, source_version="115-10", updated_at=datetime.now(timezone.utc),
        )
    )
    await db_session.commit()

    response = await admin_client.get(f"{POTENTIAL}?campus_key=yihua")

    assert response.status_code == 200, response.text
    estimate = response.json()["potential"]
    sources = {source["key"]: source for source in estimate["sources"]}
    assert [source["status"] for source in estimate["sources"]] == ["ok", "ok", "ok"]
    assert [band["band"] for band in sources["villages"]["details"]["bands"]] == ["0-1", "1-2", "2-3"]
    assert all(band["enrolled"] is not None for band in sources["villages"]["details"]["bands"])
    assert [item["name"] for item in sources["presale"]["details"]["deliveries"]] == ["測試建案"]
    assert sources["presale"]["details"]["deliveries"][0]["mid"] > 0
    assert estimate["total"]["included"] == ["closures", "villages", "presale"]
    shares = potential.band_shares(obs)
    assert min(shares.values()) > 0
    # 逐一比對回應裡的數值，不比對整段 JSON 文字：時間戳記的秒數小數會碰巧含有同一串數字，
    # CI 曾因 '0.0112' 出現在「…20.011231Z」而失敗（run 40904623394，2026-10-29）。
    numbers = [str(number) for number in _json_numbers(response.json())]
    for band, share in shares.items():
        assert not any(number.startswith(str(share)[:6]) for number in numbers), band


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
