"""三公里市佔率與國小一年級對帳（2026-10-20 招生潛力與市佔率規格 §3.2、§3.3、§4）。

市佔率＝某學年上學期四個年級的日期欄註冊人數（不含重讀保留生）÷ 該學年九月底校址 N 公里內的 2–5 歲戶籍人數。
- 半徑內的里：現行里界的面積重心到校址 ≤ N×1000 m；和後台其他地方不同，這裡不四捨五入到 100 m（報告 B-04 L19）。
- 里代碼在 111-06、115-07 各變過一次：某學年缺現行代碼的資料時，把那一年資料裡「不在現行里界、而且和缺漏代碼同區」
  的代碼一起計入（里的變化合併組的做法，trends.py），merged＝True 並寫一條 note。
- 學年完全沒有九月列（ODRP014 從 107 年才有資料）→ 人口與市佔率都是 None，不寫 0。

國小對帳不進市佔率：半徑內各里對到的國小，一年級人數 ÷ 這些學校整個學區同一年九月底的 6 歲戶籍人數
（一個里對到 n 所學校，該里的 6 歲人數各算 1/n）。最新一年偏離之前各年的平均超過 RATIO_WARN 就提醒分母可能不準。
回傳的 schools＝半徑內各里所屬的國小數（畫面寫「N 所國小」）；每個學年另有 schools＝那一年有一年級人數的學校數。"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo import boundaries, matcher, projection, school_districts
from app.admissions.geo.models import GeoElementaryGrade1, GeoVillageAgesSeptember
from app.admissions.history.models import CampusTermEnrollment

DEFAULT_RADIUS_KM = 3
FALL_SEMESTER = 1
KIDS_AGES = (2, 3, 4, 5)
SHARE_DIGITS = 4
RATIO_DIGITS = 3
AGE6_DIGITS = 1
# 最新一年的比值偏離歷年平均超過這個值，就標提醒（規格 §3.3，預設門檻）。
RATIO_WARN = 0.05
MIN_CHECK_YEARS = 2


@dataclass(frozen=True)
class _Pop:
    """某里某年九月底的人口：district 是來源的區名（舊代碼沒換成現行代碼時用來判斷同區）。"""

    district: str
    kids: int
    age_6: int


@dataclass(frozen=True)
class _Denominator:
    """某學年的分母。villages＝現行代碼自己有資料的里數；merged＝區 → 合併計入的舊代碼數。"""

    children: int
    villages: int
    merged: dict[str, int]


def _empty(status: str, radius_km: int) -> dict:
    return {
        "status": status, "radius_km": radius_km, "latest": None, "best": None, "years": [],
        "elementary_check": None, "notes": [],
    }


async def _registered_by_year(db: AsyncSession, campus_key: str) -> dict[int, int]:
    """學年 → 上學期各年級日期欄註冊人數相加（重讀保留生另存在 repeat_registered，不在這裡）；下學期的列不看。"""
    rows = await db.execute(
        select(CampusTermEnrollment.school_year, func.sum(CampusTermEnrollment.registered))
        .where(CampusTermEnrollment.campus_key == campus_key, CampusTermEnrollment.semester == FALL_SEMESTER)
        .group_by(CampusTermEnrollment.school_year)
        .order_by(CampusTermEnrollment.school_year)
    )
    return {year: int(total) for year, total in rows}


async def _population_by_year(db: AsyncSession) -> dict[int, dict[str, _Pop]]:
    """民國年 → 里代碼 → 九月底人口（整張表，約 900 里 × 9 年；對帳要用到半徑外的學區里，所以不先篩）。"""
    kids = sum(getattr(GeoVillageAgesSeptember, f"age_{age}") for age in KIDS_AGES)
    rows = await db.execute(
        select(
            GeoVillageAgesSeptember.year, GeoVillageAgesSeptember.village_code, GeoVillageAgesSeptember.district,
            kids, GeoVillageAgesSeptember.age_6,
        )
    )
    population: dict[int, dict[str, _Pop]] = {}
    for year, code, district, kids_count, age_6 in rows:
        population.setdefault(year, {})[code] = _Pop(district, kids_count, age_6)
    return population


def _villages_within(lat: float, lng: float, radius_m: float) -> frozenset[str]:
    return frozenset(
        code for code, (village_lat, village_lng) in boundaries.village_centroids().items()
        if projection.haversine_m(lat, lng, village_lat, village_lng) <= radius_m
    )


def _denominator(rows: dict[str, _Pop], near: frozenset[str]) -> _Denominator | None:
    """某學年的分母：半徑內現行代碼有資料的里；有現行代碼缺資料時，再加上同區、不在現行里界的舊代碼。
    一個資料都湊不到（沒有任何自己的里、也沒有可併的舊代碼）回 None。"""
    own = [code for code in near if code in rows]
    missing = [code for code in near if code not in rows]
    merged: dict[str, int] = {}
    extras: list[str] = []
    if missing:
        current, names = boundaries.village_centroids(), boundaries.village_names()
        districts = {names[code][0] for code in missing if code in names}
        extras = [code for code, pop in rows.items() if code not in current and pop.district in districts]
        for code in extras:
            merged[rows[code].district] = merged.get(rows[code].district, 0) + 1
    if not own and not extras:
        return None
    children = sum(rows[code].kids for code in own + extras)
    return _Denominator(children, len(own), merged)


def _share_years(
    registered: dict[int, int], population: dict[int, dict[str, _Pop]], near: frozenset[str]
) -> tuple[list[dict], list[str]]:
    years: list[dict] = []
    notes: list[str] = []
    for year, count in registered.items():
        denominator = _denominator(population[year], near) if year in population else None
        entry = {"school_year": year, "registered": count, "children": None, "villages": None, "share": None, "merged": False}
        if denominator is not None:
            entry.update(children=denominator.children, villages=denominator.villages, merged=bool(denominator.merged))
            if denominator.children > 0:
                entry["share"] = round(count / denominator.children, SHARE_DIGITS)
            notes.extend(
                f"{year} 學年里界調整，{district} {number} 里合併計入" for district, number in sorted(denominator.merged.items())
            )
        years.append(entry)
    return years, notes


# ---- 國小一年級對帳 ----


def _district_weights(near: frozenset[str]) -> tuple[list[str], list[tuple[str, float]]]:
    """(半徑內各里對到的國小, 這些學校整個學區的 (里代碼, 權重))：一個里對到 n 所學校，在 n 所學校的學區裡各算 1/n，
    所以不論 S 裡有幾所，每個里最多算滿一次。"""
    by_village, by_school = school_districts.by_village(), school_districts.by_school()
    schools = sorted({item.school_code for code in near for item in by_village.get(code, ())})
    weights: list[tuple[str, float]] = []
    for school in schools:
        for village in sorted({item.village_code for item in by_school.get(school, ())}):
            count = len({item.school_code for item in by_village.get(village, ())}) or 1
            weights.append((village, 1 / count))
    return schools, weights


async def _elementary_check(db: AsyncSession, near: frozenset[str], population: dict[int, dict[str, _Pop]]) -> dict | None:
    schools, weights = _district_weights(near)
    if not schools:
        return None
    rows = await db.execute(
        select(GeoElementaryGrade1.school_year, func.count(), func.sum(GeoElementaryGrade1.grade1))
        .where(GeoElementaryGrade1.school_code.in_(schools))
        .group_by(GeoElementaryGrade1.school_year)
    )
    grade1 = {year: (int(count), int(total)) for year, count, total in rows}
    entries: list[dict] = []
    ratios: list[float] = []
    for year in sorted(grade1.keys() & population.keys()):
        age_6 = sum(population[year][village].age_6 * weight for village, weight in weights if village in population[year])
        if age_6 <= 0:
            continue
        counted, total = grade1[year]
        ratios.append(total / age_6)
        entries.append(
            {
                "school_year": year, "grade1": total, "age6": round(age_6, AGE6_DIGITS),
                "ratio": round(ratios[-1], RATIO_DIGITS), "schools": counted,
            }
        )
    if len(entries) < MIN_CHECK_YEARS:
        return None
    mean = round(sum(ratios[:-1]) / (len(ratios) - 1), RATIO_DIGITS)
    latest = entries[-1]["ratio"]
    warn = round(abs(latest - mean), RATIO_DIGITS) > RATIO_WARN
    return {"years": entries, "mean": mean, "latest_ratio": latest, "warn": warn, "schools": len(schools)}


# ---- 對外 ----


async def query_share(db: AsyncSession, campus_key: str, *, radius_km: int = DEFAULT_RADIUS_KM) -> dict:
    """某校的市佔率走勢與國小對帳。status：not_imported＝沒有任何上學期的註冊列；no_campus_point＝校址對不到座標；
    ready 才有數字。years 依學年遞增、含所有有上學期註冊的學年（沒有分母的學年數字是 None）；
    latest＝最新一個有市佔率的學年，best＝市佔率最高的學年（同分取較新）。"""
    registered = await _registered_by_year(db, campus_key)
    if not registered:
        return _empty("not_imported", radius_km)
    point = await matcher.campus_point(db, campus_key)
    if point.locate_error is not None or point.lat is None or point.lng is None:
        return _empty("no_campus_point", radius_km)
    near = _villages_within(point.lat, point.lng, radius_km * 1000)
    population = await _population_by_year(db)
    years, notes = _share_years(registered, population, near)
    shared = [year for year in years if year["share"] is not None]
    return {
        "status": "ready",
        "radius_km": radius_km,
        "latest": dict(shared[-1]) if shared else None,
        "best": dict(max(shared, key=lambda year: (year["share"], year["school_year"]))) if shared else None,
        "years": years,
        "elementary_check": await _elementary_check(db, near, population),
        "notes": notes,
    }
