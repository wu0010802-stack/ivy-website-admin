"""招生機會 API（2026-10-13 招生機會規格 §5、§6）：附近的里、附近平均、應有與判讀、排序、
半徑外與沒對到里的人數、人口未匯入、本校沒座標、權限與開關。

義華校址固定在門牌樣本的座標（tests/geo_helpers.YIHUA_POINT）；各里人口直接寫資料庫。里界面積
重心到義華的距離：本揚里 287 m、寶業里 329 m、寶國里 458 m、本上里 489 m（都在 1 公里內）、
三民區本武里 1,530 m（3 公里內）、小港區青島里約 8 公里（3 公里外）。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.admissions import opportunity
from app.admissions.geo import boundaries, matcher
from app.admissions.geo.models import GeoDatasetStatus, GeoVillagePopulation
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.admissions_area_helpers import API, AREA, add_visit
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings

OPPORTUNITY = f"{AREA}/opportunity"
TERM = "school_year=115&semester=1"
YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133
NOW = datetime(2026, 10, 13, 4, 0, tzinfo=timezone.utc)
# (區, 里) → (2–5 歲每一歲的人數, 0–1 歲每一歲的人數)
POPULATION = {
    ("三民區", "本揚里"): (100, 30),  # 2–5 歲 400 位
    ("三民區", "寶業里"): (100, 25),  # 400
    ("三民區", "寶國里"): (50, 10),  # 200
    ("三民區", "本上里"): (10, 5),  # 40
    ("三民區", "本武里"): (40, 20),  # 160，1.5 公里
    ("小港區", "青島里"): (200, 80),  # 800，3 公里外
}
# (區, 里) → 參觀人數（115 學年上學期、比對到里）
VISITS = {
    ("三民區", "寶業里"): 12,
    ("三民區", "寶國里"): 4,
    ("三民區", "本武里"): 4,
    ("小港區", "青島里"): 2,
}


@pytest.fixture
def located_campus(monkeypatch):
    async def located(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=YIHUA_LAT, lng=YIHUA_LNG, locate_error=None, district="三民區")

    monkeypatch.setattr(matcher, "campus_point", located)


async def _seed_population(db, rows=POPULATION, *, label: str | None = "115-09") -> None:
    for (district, village), (per_age, per_infant_age) in rows.items():
        db.add(
            GeoVillagePopulation(
                village_code=boundaries.village_code(district, village), district=district, village=village,
                age_0=per_infant_age, age_1=per_infant_age,
                age_2=per_age, age_3=per_age, age_4=per_age, age_5=per_age, age_6=per_age,
                people_total=per_age * 30,
            )
        )
    db.add(GeoDatasetStatus(dataset="population", active_version=label, label=label, synced_at=NOW if label else None))
    await db.flush()


async def _seed_visits(db, visits=VISITS) -> None:
    for (district, village), count in visits.items():
        for _ in range(count):
            await add_visit(db, district=district, geo={"level": "exact", "village": village, "distance_m": 500})
    # 沒對到里的三種：只到區、沒填地址、已匿名化。
    await add_visit(db, district="三民區", geo={"level": "district"})
    await add_visit(db, address=None, geo={"level": "unlocated", "reason": "no_address"})
    await add_visit(db, district="三民區", anonymized=True, geo={"level": "district", "reason": "anonymized"})
    # 不在範圍：114 學年、明華。
    await add_visit(db, district="三民區", target_school_year=114, geo={"level": "exact", "village": "本揚里"})
    await add_visit(db, campus_key="minghua", district="三民區", geo={"level": "exact", "village": "本揚里"})


async def _seed(db) -> None:
    await _seed_population(db)
    await _seed_visits(db)
    await db.commit()


def _by_village(body: dict) -> dict[str, dict]:
    return {row["village"]: row for row in body["villages"]}


def test_judge_thresholds():
    assert opportunity.judge(0, 6.0, judged=False) == "not_judged"
    assert opportunity.judge(0, None, judged=True) == "not_judged"
    assert opportunity.judge(0, 0.9, judged=True) == "few_children"
    # P(X ≤ 0 | 3) = e^-3 ≈ 0.0498 ≤ 0.10；P(X ≤ 0 | 2) = e^-2 ≈ 0.135 > 0.10
    assert opportunity.judge(0, 3.0, judged=True) == "below"
    assert opportunity.judge(0, 2.0, judged=True) == "typical"
    # P(X ≥ 9 | 5) ≈ 0.068；P(X ≥ 8 | 5) ≈ 0.133
    assert opportunity.judge(9, 5.0, judged=True) == "above"
    assert opportunity.judge(8, 5.0, judged=True) == "typical"
    assert opportunity.judge(5, 5.0, judged=True) == "typical"


async def test_opportunity_three_km(admin_client, db_session, located_campus):
    await _seed(db_session)
    response = await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua&{TERM}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["radius_km"] == 3
    assert body["filters"] == {"campus_key": "yihua", "school_year": 115, "semester": 1}
    assert body["population"] == {
        "version": "115-09", "synced_at": "2026-10-13T04:00:00Z", "age_band": "2-5", "source_note": body["population"]["source_note"],
    }
    assert "內政部戶政司" in body["population"]["source_note"]
    # 3 公里內五個里：參觀 0＋12＋4＋0＋4＝20，2–5 歲 400＋400＋200＋40＋160＝1,200，參觀率 1.7%。
    assert body["baseline"] == {"villages": 5, "children": 1200, "infants": 180, "visit": 20, "rate": 1.7, "judged": True}
    assert (body["outside_visit"], body["unplaced_visit"]) == (2, 3)
    rows = _by_village(body)
    assert rows["本揚里"] == {
        "district": "三民區", "village": "本揚里", "village_code": "64000050015", "distance_m": 300,
        "children": 400, "infants": 60, "visit": 0, "rate": 0.0, "expected": 6.7, "shortfall": 6.7, "signal": "below",
    }
    assert (rows["寶業里"]["signal"], rows["寶業里"]["rate"], rows["寶業里"]["shortfall"]) == ("above", 3.0, -5.3)
    assert rows["寶國里"]["signal"] == "typical"
    assert (rows["本上里"]["signal"], rows["本上里"]["expected"]) == ("few_children", 0.7)
    assert (rows["本武里"]["signal"], rows["本武里"]["distance_m"]) == ("typical", 1500)
    assert "青島里" not in rows
    # 少最多的排最前面。
    assert [row["village"] for row in body["villages"]] == ["本揚里", "本上里", "寶國里", "本武里", "寶業里"]


async def test_opportunity_radius_one_moves_far_villages_outside(admin_client, db_session, located_campus):
    await _seed(db_session)
    body = (await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua&{TERM}&radius_km=1")).json()
    assert body["radius_km"] == 1
    assert sorted(row["village"] for row in body["villages"]) == ["寶國里", "寶業里", "本上里", "本揚里"]
    assert body["baseline"]["visit"] == 16 and body["baseline"]["children"] == 1040
    assert body["outside_visit"] == 6  # 本武里 4＋青島里 2


async def test_opportunity_counts_add_up_to_stats(admin_client, db_session, located_campus):
    """附近＋半徑外＋附近但缺人口＋沒對到里＝範圍內全部參觀（和 /stats 同母體）。"""
    await _seed(db_session)
    stats = (await admin_client.get(f"{API}/admin/admissions/stats?campus_key=yihua&{TERM}")).json()
    for radius in (1, 3, 6):
        body = (await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua&{TERM}&radius_km={radius}")).json()
        no_population = sum(row["visit"] for row in body["no_population_villages"])
        assert body["baseline"]["visit"] + body["outside_visit"] + no_population + body["unplaced_visit"] == stats["kpi"]["visit"], radius


async def test_opportunity_without_term_counts_every_year(admin_client, db_session, located_campus):
    await _seed(db_session)
    body = (await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua")).json()
    assert _by_village(body)["本揚里"]["visit"] == 1  # 114 學年那一筆；明華的不算


async def test_opportunity_not_judged_with_few_visits(admin_client, db_session, located_campus):
    await _seed_population(db_session)
    await _seed_visits(db_session, {("三民區", "寶業里"): 9})
    await db_session.commit()
    body = (await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua&{TERM}")).json()
    assert body["baseline"]["visit"] == 9 and body["baseline"]["judged"] is False
    assert {row["signal"] for row in body["villages"]} == {"not_judged"}
    assert _by_village(body)["本揚里"]["expected"] == 3.0  # 應有照算，只是不判斷


async def test_opportunity_without_population(admin_client, db_session, located_campus):
    await _seed_visits(db_session)
    db_session.add(GeoDatasetStatus(dataset="population", last_error="下載失敗：HTTP 500"))  # 只失敗過、沒匯入過
    await db_session.commit()
    body = (await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua&{TERM}")).json()
    assert body["population"]["version"] is None and body["population"]["synced_at"] is None
    assert body["baseline"] is None and body["villages"] == [] and body["no_population_villages"] == []
    assert (body["outside_visit"], body["unplaced_visit"]) == (0, 3)
    area = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()
    assert area["data_status"]["population_version"] is None


async def test_opportunity_when_campus_not_located(admin_client, db_session, monkeypatch):
    async def unlocated(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=None, lng=None, locate_error="no_doorplate", district="三民區")

    monkeypatch.setattr(matcher, "campus_point", unlocated)
    await _seed(db_session)
    body = (await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua&{TERM}")).json()
    assert body["campus"]["locate_error"] == "no_doorplate"
    assert body["baseline"] is None and body["villages"] == [] and body["no_population_villages"] == []
    assert body["population"]["version"] == "115-09"


async def test_area_data_status_reads_population_month(admin_client, db_session):
    await _seed_population(db_session)
    await db_session.commit()
    status = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()["data_status"]
    assert status["population_version"] == "115-09"
    assert status["population_synced_at"] == "2026-10-13T04:00:00Z"


async def test_opportunity_village_with_no_children(admin_client, db_session, located_campus):
    """2–5 歲 0 位的里（工業區等）：參觀率是 null，應有 0、孩子少看不出來。"""
    await _seed_population(db_session, {**POPULATION, ("三民區", "本上里"): (0, 0)})
    await _seed_visits(db_session)
    await db_session.commit()
    row = _by_village((await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua&{TERM}")).json())["本上里"]
    assert (row["children"], row["rate"], row["expected"], row["signal"]) == (0, None, 0.0, "few_children")


async def test_opportunity_nearby_village_without_population_is_not_outside(admin_client, db_session, located_campus):
    """人口批次有 850 個里就能換版（893 里缺幾個也過），所以附近的里可能沒有人口列。本揚里距本校 287 m：
    它的參觀不能被寫成「3 公里外」，也不進附近平均（沒有孩子數可除），另外列在 no_population_villages。"""
    population = {key: value for key, value in POPULATION.items() if key != ("三民區", "本揚里")}
    await _seed_population(db_session, population)
    await _seed_visits(db_session, {**VISITS, ("三民區", "本揚里"): 20})
    await db_session.commit()
    body = (await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua&{TERM}")).json()
    assert body["outside_visit"] == 2  # 只有真的在 3 公里外的青島里
    assert body["baseline"] == {"villages": 4, "children": 800, "infants": 120, "visit": 20, "rate": 2.5, "judged": True}
    assert "本揚里" not in _by_village(body)
    missing = {row["village"]: row for row in body["no_population_villages"]}
    assert missing["本揚里"] == {
        "district": "三民區", "village": "本揚里", "village_code": "64000050015", "distance_m": 300, "visit": 20,
    }
    assert "青島里" not in missing  # 半徑外的里是半徑外，不是缺人口
    stats = (await admin_client.get(f"{API}/admin/admissions/stats?campus_key=yihua&{TERM}")).json()
    total = body["baseline"]["visit"] + body["outside_visit"] + sum(row["visit"] for row in body["no_population_villages"])
    assert total + body["unplaced_visit"] == stats["kpi"]["visit"]


async def test_opportunity_far_village_without_population_stays_outside(admin_client, db_session, located_campus):
    """半徑外的里有沒有人口列都是半徑外：由里界重心的距離決定，不看人口表。"""
    population = {key: value for key, value in POPULATION.items() if key != ("小港區", "青島里")}
    await _seed_population(db_session, population)
    await _seed_visits(db_session)
    await db_session.commit()
    body = (await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua&{TERM}")).json()
    assert body["outside_visit"] == 2
    assert body["baseline"]["visit"] == 20
    assert all(row["village"] != "青島里" for row in body["no_population_villages"])


@pytest.mark.parametrize("radius", ["2", "0", "abc", "", "3.5"])
async def test_opportunity_rejects_bad_radius(admin_client, radius):
    response = await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua&radius_km={radius}")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_RADIUS"


async def test_opportunity_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client):
    path = f"{OPPORTUNITY}?campus_key="
    assert (await reception_yihua_client.get(path + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(path + "minghua")).status_code == 404
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(path + "yihua")).status_code == 403
    assert (await admin_client.get(path + "nowhere")).status_code == 404


async def test_opportunity_needs_login(public_client):
    assert (await public_client.get(f"{OPPORTUNITY}?campus_key=yihua&radius_km=abc")).status_code == 401


async def test_opportunity_hidden_when_admissions_disabled(admin_client):
    """admin_client 只為了建好總管理者帳號；這裡用另一個關掉招生的 app 登入。"""
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        assert (await client.get(f"{OPPORTUNITY}?campus_key=yihua")).status_code == 404
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()


async def test_opportunity_never_writes_audit_entries(admin_client, db_session, located_campus):
    await _seed(db_session)
    before = await db_session.scalar(select(func.count()).select_from(AuditLogEntry))
    assert (await admin_client.get(f"{OPPORTUNITY}?campus_key=yihua&{TERM}")).status_code == 200
    assert await db_session.scalar(select(func.count()).select_from(AuditLogEntry)) == before
