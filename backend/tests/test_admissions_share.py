"""三公里市佔率與國小一年級對帳（2026-10-20 招生潛力與市佔率規格 §3.2、§3.3、§4）。

里界重心、校址座標、學區對照都用 monkeypatch 換成小字典（三個近里、一個 4 km 外的里），資料表用假數字；
報告 I-9 §7 的註冊與分母逐年代入，市佔率要和報告一致到小數第四位。"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from sqlalchemy import delete

from app.admissions.geo import boundaries, matcher, school_districts, september
from app.admissions.geo.models import GeoElementaryGrade1, GeoVillageAgesSeptember
from app.admissions.history.models import CampusTermEnrollment
from app.admissions.share import query_share

YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133
NEAR_A, NEAR_B, NEAR_C = "64000050001", "64000050002", "64000050003"
FAR = "64000050099"
OLD = "64000051999"  # 現行里界沒有的舊代碼
DISTRICT = "三民區"
# 緯度差 1 度＝111,195 m（haversine，地球半徑 6,371 km）；每個里和校址的距離寫在後面。
CENTROIDS = {
    NEAR_A: (YIHUA_LAT, YIHUA_LNG),  # 0 m
    NEAR_B: (22.6524556, 120.3437133),  # 約 1.1 km
    NEAR_C: (22.6624556, 120.3537133),  # 約 2.5 km
    FAR: (22.6784556, YIHUA_LNG),  # 約 4.0 km
}
NAMES = {code: (DISTRICT, f"測試{index}里") for index, code in enumerate(CENTROIDS)}
# 報告 I-9 §7：(學年, 秋季註冊, 3 公里內 2–5 歲, 市佔率)。
REPORT = [
    (107, 245, 14507, 0.0169),
    (108, 279, 14366, 0.0194),
    (109, 210, 14076, 0.0149),
    (110, 173, 13158, 0.0131),
    (111, 108, 12125, 0.0089),
    (112, 131, 11629, 0.0113),
    (113, 118, 10871, 0.0109),
    (114, 121, 10255, 0.0118),
    (115, 189, 9788, 0.0193),
]


@pytest.fixture(autouse=True)
def world(monkeypatch):
    """義華校址＋四個里的重心；學區對照預設空（國小對帳用到時各測試自己換）。"""

    async def located(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=YIHUA_LAT, lng=YIHUA_LNG, locate_error=None, district=DISTRICT)

    monkeypatch.setattr(matcher, "campus_point", located)
    monkeypatch.setattr(boundaries, "village_centroids", lambda: dict(CENTROIDS))
    monkeypatch.setattr(boundaries, "village_names", lambda: dict(NAMES))
    monkeypatch.setattr(school_districts, "by_village", lambda: {})
    monkeypatch.setattr(school_districts, "by_school", lambda: {})


async def _enroll(db, year, grades, *, semester=1, repeat_registered=None, campus_key="yihua"):
    """grades：年級 → 日期欄註冊人數；重讀保留生的註冊數寫在第一個年級那一列。"""
    as_of = date(year + 1911, 9, 15) if semester == 1 else date(year + 1912, 3, 15)
    db.add_all(
        CampusTermEnrollment(
            campus_key=campus_key, school_year=year, semester=semester, grade=grade, as_of=as_of, registered=registered,
            imported_at=datetime.now(timezone.utc), repeat_registered=repeat_registered if index == 0 else None,
        )
        for index, (grade, registered) in enumerate(grades.items())
    )
    await db.commit()


async def _population(db, year, code, kids, *, district=DISTRICT, age_6=0):
    """kids 平均分在 2–5 歲；0、1 歲與 6 歲塞入不相干的數字，確認不被算進去。"""
    base, extra = divmod(kids, 4)
    ages = [base + (1 if index < extra else 0) for index in range(4)]
    db.add(
        GeoVillageAgesSeptember(
            year=year, village_code=code, district=district, village="測試里", age_0=9, age_1=9,
            age_2=ages[0], age_3=ages[1], age_4=ages[2], age_5=ages[3], age_6=age_6, people_total=5000,
        )
    )
    await db.commit()


@pytest.mark.parametrize(("year", "registered", "children", "share"), REPORT)
async def test_share_formula_matches_report(db_session, year, registered, children, share):
    await _enroll(db_session, year, {"大班": registered - 100, "中班": 60, "小班": 30, "幼幼班": 10})
    await _population(db_session, year, NEAR_A, children)

    result = await query_share(db_session, "yihua")

    assert result["status"] == "ready"
    assert result["years"] == [
        {"school_year": year, "registered": registered, "children": children, "villages": 1, "share": share, "merged": False}
    ]


async def test_registered_excludes_repeat(db_session):
    await _enroll(db_session, 109, {"大班": 56, "中班": 80, "小班": 41, "幼幼班": 11}, repeat_registered=5)

    result = await query_share(db_session, "yihua")

    assert [year["registered"] for year in result["years"]] == [188]


async def test_spring_rows_ignored(db_session):
    await _enroll(db_session, 109, {"大班": 100})
    await _enroll(db_session, 109, {"大班": 999}, semester=2)
    await _enroll(db_session, 110, {"大班": 888}, semester=2)

    result = await query_share(db_session, "yihua")

    assert [(year["school_year"], year["registered"]) for year in result["years"]] == [(109, 100)]


async def test_only_spring_rows_is_not_imported(db_session):
    await _enroll(db_session, 110, {"大班": 888}, semester=2)

    result = await query_share(db_session, "yihua")

    assert result["status"] == "not_imported"
    assert result["years"] == []


async def test_far_village_excluded(db_session):
    await _enroll(db_session, 114, {"大班": 10})
    await _population(db_session, 114, NEAR_A, 1000)
    await _population(db_session, 114, NEAR_B, 500)
    await _population(db_session, 114, FAR, 5000)

    result = await query_share(db_session, "yihua")

    assert (result["years"][0]["children"], result["years"][0]["villages"]) == (1500, 2)


async def test_radius_is_exact_not_rounded_to_100m(db_session, monkeypatch):
    """校址往北 0.02725 度＝3,030 m：四捨五入到 100 m 會變 3,000 而被算進來，這裡要排除。"""
    monkeypatch.setattr(boundaries, "village_centroids", lambda: {NEAR_A: CENTROIDS[NEAR_A], NEAR_B: (YIHUA_LAT + 0.02725, YIHUA_LNG)})
    await _enroll(db_session, 114, {"大班": 10})
    await _population(db_session, 114, NEAR_A, 1000)
    await _population(db_session, 114, NEAR_B, 500)

    result = await query_share(db_session, "yihua")

    assert result["years"][0]["children"] == 1000


async def test_radius_km_parameter(db_session):
    await _enroll(db_session, 114, {"大班": 10})
    await _population(db_session, 114, NEAR_A, 1000)
    await _population(db_session, 114, FAR, 5000)

    result = await query_share(db_session, "yihua", radius_km=5)

    assert result["radius_km"] == 5
    assert result["years"][0]["children"] == 6000


async def test_year_without_population_has_no_share(db_session):
    """108 學年沒有九月列（例如還沒同步到）→ 全是 None，latest 取有分母的 107。"""
    for year in (107, 108):
        await _enroll(db_session, year, {"大班": 100})
    await _population(db_session, 107, NEAR_A, 5000)

    result = await query_share(db_session, "yihua")

    assert result["years"][1] == {
        "school_year": 108, "registered": 100, "children": None, "villages": None, "share": None, "merged": False,
    }
    assert result["latest"]["school_year"] == 107
    assert result["best"]["school_year"] == 107


async def test_years_start_at_first_september_year(db_session):
    """走勢從 107 學年起（規格 §1.3）：註冊有 99–115，九月資料 107–115 → years 從 107 開始，99–106 不輸出；
    latest／best 不受影響。"""
    for year in range(99, 116):
        await _enroll(db_session, year, {"大班": 100 + year})
    for year in range(september.FIRST_YEAR, 116):
        await _population(db_session, year, NEAR_A, 5000)

    result = await query_share(db_session, "yihua")

    assert [year["school_year"] for year in result["years"]] == list(range(september.FIRST_YEAR, 116))
    assert all(year["share"] is not None for year in result["years"])
    assert result["latest"]["school_year"] == 115
    assert result["best"]["school_year"] == 115


async def test_only_years_before_september_data_has_no_years(db_session):
    """只有 107 學年以前的註冊：status 仍是 ready，但沒有任何一年可畫（不是 not_imported）。"""
    await _enroll(db_session, 106, {"大班": 77})
    await _population(db_session, 107, NEAR_A, 5000)

    result = await query_share(db_session, "yihua")

    assert result["status"] == "ready"
    assert result["years"] == []
    assert result["latest"] is None
    assert result["best"] is None


async def test_no_population_at_all(db_session):
    await _enroll(db_session, 115, {"大班": 189})

    result = await query_share(db_session, "yihua")

    assert result["status"] == "ready"
    assert result["latest"] is None and result["best"] is None
    assert result["years"][0]["share"] is None


async def test_merged_group_for_changed_codes(db_session):
    """里界調整：114 學年 NEAR_C 還沒有資料、多出同區的舊代碼 OLD → 舊代碼計入；
    別區的舊代碼、現行里界的遠里不能被拉進來；113 學年只是少一個里、沒有舊代碼 → 不算合併。"""
    await _enroll(db_session, 113, {"大班": 10})
    await _enroll(db_session, 114, {"大班": 10})
    await _enroll(db_session, 115, {"大班": 10})
    for year in (113, 114):
        await _population(db_session, year, NEAR_A, 100)
        await _population(db_session, year, NEAR_B, 100)
        await _population(db_session, year, FAR, 300)
    await _population(db_session, 114, OLD, 70)
    await _population(db_session, 114, "63000011001", 5000, district="鹽埕區")
    for code in (NEAR_A, NEAR_B, NEAR_C):
        await _population(db_session, 115, code, 100)

    result = await query_share(db_session, "yihua")

    by_year = {year["school_year"]: year for year in result["years"]}
    assert (by_year[113]["children"], by_year[113]["villages"], by_year[113]["merged"]) == (200, 2, False)
    assert (by_year[114]["children"], by_year[114]["villages"], by_year[114]["merged"]) == (270, 2, True)
    assert (by_year[115]["children"], by_year[115]["villages"], by_year[115]["merged"]) == (300, 3, False)
    assert result["notes"] == ["114 學年里界調整，三民區 1 里合併計入"]


async def test_not_imported(db_session):
    result = await query_share(db_session, "yihua")

    assert result == {
        "status": "not_imported", "radius_km": 3, "latest": None, "best": None, "years": [],
        "elementary_check": None, "notes": [],
    }


async def test_campus_without_point(db_session, monkeypatch):
    async def unlocated(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=None, lng=None, locate_error="no_doorplate", district=DISTRICT)

    monkeypatch.setattr(matcher, "campus_point", unlocated)
    await _enroll(db_session, 115, {"大班": 189})

    result = await query_share(db_session, "yihua")

    assert result["status"] == "no_campus_point"
    assert result["years"] == [] and result["latest"] is None and result["elementary_check"] is None


async def test_best_year(db_session):
    """報告的九年：最高是 108 學年 1.94%，最新是 115 學年 1.93%。"""
    for year, registered, children, _ in REPORT:
        await _enroll(db_session, year, {"大班": registered})
        await _population(db_session, year, NEAR_A, children)

    result = await query_share(db_session, "yihua")

    assert [year["school_year"] for year in result["years"]] == [year for year, *_ in REPORT]
    assert (result["best"]["school_year"], result["best"]["share"]) == (108, 0.0194)
    assert (result["latest"]["school_year"], result["latest"]["share"]) == (115, 0.0193)


# ---- 國小一年級對帳 ----

S1, S2 = "553610", "124601"
V1, V2, V3, V4 = NEAR_A, NEAR_B, NEAR_C, FAR


def _assign(village, school):
    return school_districts.Assignment(
        village_code=village, school_code=school, partial=False, free_zone=False, neighborhoods="", note=""
    )


@pytest.fixture
def two_schools(monkeypatch):
    """V1 只屬 S1、V2 同時屬 S1 與 S2（人數各算一半）、V3 只屬 S2；S2 的學區還有 3 公里外的 V4。"""
    assigns = [_assign(V1, S1), _assign(V2, S1), _assign(V2, S2), _assign(V3, S2), _assign(V4, S2)]
    monkeypatch.setattr(
        school_districts, "by_village",
        lambda: {v: tuple(a for a in assigns if a.village_code == v) for v in (V1, V2, V3, V4)},
    )
    monkeypatch.setattr(
        school_districts, "by_school",
        lambda: {s: tuple(a for a in assigns if a.school_code == s) for s in (S1, S2)},
    )


async def _school_years(db, grade1_by_year, *, age_6=(100, 200, 100, 100)):
    """age_6：V1~V4 每年相同的 6 歲人數；一年級人數拆在 S1、S2 兩校。"""
    for year, grade1 in grade1_by_year.items():
        for code, count in zip((V1, V2, V3, V4), age_6):
            await _population(db, year, code, 0, age_6=count)
        db.add_all(
            [
                GeoElementaryGrade1(school_year=year, school_code=S1, grade1=grade1 // 2, school_name="甲國小"),
                GeoElementaryGrade1(school_year=year, school_code=S2, grade1=grade1 - grade1 // 2, school_name="乙國小"),
            ]
        )
    await db.commit()


@pytest.mark.parametrize(("latest_grade1", "latest_ratio", "warn"), [(430, 0.86, True), (420, 0.84, False)])
async def test_elementary_check_ratio_and_warn(db_session, two_schools, latest_grade1, latest_ratio, warn):
    """分母＝V1 100＋V2 200÷2（S1）＋V2 200÷2（S2）＋V3 100＋V4 100＝500；前兩年 400 → 0.80。"""
    await _enroll(db_session, 114, {"大班": 10})
    await _school_years(db_session, {112: 400, 113: 400, 114: latest_grade1})

    check = (await query_share(db_session, "yihua"))["elementary_check"]

    assert check == {
        "years": [
            {"school_year": 112, "grade1": 400, "age6": 500.0, "ratio": 0.8, "schools": 2},
            {"school_year": 113, "grade1": 400, "age6": 500.0, "ratio": 0.8, "schools": 2},
            {"school_year": 114, "grade1": latest_grade1, "age6": 500.0, "ratio": latest_ratio, "schools": 2},
        ],
        "mean": 0.8,
        "latest_ratio": latest_ratio,
        "warn": warn,
        "schools": 2,
    }


async def test_elementary_check_mean_excludes_latest_year(db_session, two_schools):
    await _enroll(db_session, 114, {"大班": 10})
    await _school_years(db_session, {111: 400, 112: 450, 113: 500})  # 0.80、0.90、1.00

    check = (await query_share(db_session, "yihua"))["elementary_check"]

    assert (check["mean"], check["latest_ratio"], check["warn"]) == (0.85, 1.0, True)


async def test_elementary_check_counts_schools_with_data(db_session, two_schools):
    """schools 是半徑內各里所屬的國小數（2）；某學年 S2 沒有一年級列，那一年的 schools 只有 1。"""
    await _enroll(db_session, 114, {"大班": 10})
    await _school_years(db_session, {112: 400, 113: 400, 114: 400})
    await db_session.execute(delete(GeoElementaryGrade1).where(GeoElementaryGrade1.school_year == 113, GeoElementaryGrade1.school_code == S2))
    await db_session.commit()

    check = (await query_share(db_session, "yihua"))["elementary_check"]

    assert check["schools"] == 2
    assert [(year["school_year"], year["grade1"], year["schools"]) for year in check["years"]] == [(112, 400, 2), (113, 200, 1), (114, 400, 2)]


async def test_elementary_check_needs_two_years(db_session, two_schools):
    await _enroll(db_session, 114, {"大班": 10})
    await _school_years(db_session, {114: 400})

    assert (await query_share(db_session, "yihua"))["elementary_check"] is None


async def test_elementary_check_without_schools(db_session):
    """近里在學區對照裡一所國小都對不到 → 沒有對帳。"""
    await _enroll(db_session, 114, {"大班": 10})
    await _population(db_session, 113, NEAR_A, 100, age_6=50)
    await _population(db_session, 114, NEAR_A, 100, age_6=50)

    assert (await query_share(db_session, "yihua"))["elementary_check"] is None
