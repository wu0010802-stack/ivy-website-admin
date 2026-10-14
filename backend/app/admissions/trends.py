"""里的變化（docs/specs/2026-10-14-admissions-village-trends-design.md §5、§6）：/admin/admissions/area/trends。

只讀：不 flush、不 commit、不寫稽核。回應只有里層級的公開資料與加總，不含家長個資。
半徑內的里同招生機會：里界面積重心在本校半徑內（boundaries.village_centroids）。

- 這一年淨增（V1）：本月 M 的 2–5 歲 − 一年前 M−12 的 1–4 歲（同一批孩子）＝這一年搬進來減搬出去的
  幼兒園年紀孩子。要有兩個月份的年齡歷史，以及 M 往回 12 個月內至少 10 個月的遷入遷出（判斷里界調整）。
- 近 12 個月出生、全年齡淨遷入（V2）：各自以表裡最新的月份往回 12 個月，有資料的月份相加。
- 出生和前一年同月份比只在半徑合計（V3、V4），只比兩段都有資料的月份，不到 6 個月不比。
- 里界調整（V5）：上面三個期間內代碼頭尾不齊，或某個月行政區域調整人數（增或減取大）≥ 該里人口 1% 且
  ≥ 20 人的里，同一區的合併成一組（含已廢止的舊代碼），數字整組相加；組裡只要有一個里在半徑內，整組列一列。
- 分級（V6）：戶籍是全數登記不是抽樣，不做統計檢定，用固定門檻。
- 所得（V9，C 段）：最新年度的中位數，只當背景，不排序、不分級、不進合計。合併組不列（中位數不能相加）；
  里界在所得年度之後調整過（V5 的門檻，看遷入遷出表裡所有存著的月份）的里照列，另標 income_boundary_changed。
- 國小學區（V10、V11，D 段）：每列寫對到的國小（部分鄰、自由學區另標）。「依國小學區」只列學區碰到半徑內任一個里
  的國小，每所合計**整個學區**（含半徑外的里）的孩子、這一年淨增與參觀人數；部分里與自由學區的里同時算進每一所，
  各列不能相加。參觀人數的母體同 /area/opportunity（頁首校區＋入學學年學期，到里且未匿名化）。

這些都是描述性的數字，不預測、不打分（招生統計「不做」清單不變）。"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.area import campus_out
from app.admissions.geo import boundaries
from app.admissions.geo import income as income_io
from app.admissions.geo import school_districts as sd
from app.admissions.geo import village_series as series_io
from app.admissions.geo.models import (
    GeoDatasetStatus,
    GeoVillageAges,
    GeoVillageBirths,
    GeoVillageIncome,
    GeoVillageMigration,
    GeoVillagePopulation,
)
from app.admissions.geo.projection import haversine_m
from app.admissions.opportunity import visits_by_village
from app.admissions.stats import pct

# 本月 2–5 歲（幼兒園年紀，同招生機會）；一年前的同一批孩子是 1–4 歲。
KIDS_BAND = (2, 5)
YEAR_AGO_BAND = (1, 4)
PERIOD_MONTHS = 12
# 判斷里界調整至少要有幾個月的遷入遷出；出生和前一年比至少要比幾個月。
MIN_MIGRATION_MONTHS = 10
MIN_COMPARE_MONTHS = 6
# 一年前 1–4 歲不到這個數字：「孩子少」，不分級。
FEW_BASE = 20
# 里界調整的門檻：調整人數（增或減取大）≥ 該里人口的這個比例，而且 ≥ 這個人數。
BOUNDARY_SHARE = 0.01
BOUNDARY_MIN_PEOPLE = 20
DISTANCE_ROUND_M = 100


def kids_level(net: int | None, base: int | None) -> str:
    """孩子增減的分級（規格 V6）：up2 增加多／up1 增加／flat 差不多／down1 減少／down2 減少多；
    一年前 1–4 歲不到 20 位是 few，算不出來是 unknown。"""
    if net is None or base is None:
        return "unknown"
    if base < FEW_BASE:
        return "few"
    share = net / base
    if net >= 5 and share >= 0.10:
        return "up2"
    if net >= 3 and share >= 0.03:
        return "up1"
    if net <= -5 and share <= -0.10:
        return "down2"
    if net <= -3 and share <= -0.03:
        return "down1"
    return "flat"


def _round_distance(meters: float) -> int:
    return int(round(meters / DISTANCE_ROUND_M) * DISTANCE_ROUND_M)


async def _label(db: AsyncSession, dataset: str) -> str | None:
    status = await db.get(GeoDatasetStatus, dataset)
    return status.label if status is not None and status.active_version is not None else None


async def _income(db: AsyncSession, districts: set[str]) -> tuple[int | None, str, dict[str, int]]:
    """(使用中的所得年度, 顯名與附註, 代碼 → 中位數)。"""
    status = await db.get(GeoDatasetStatus, "income")
    if status is None or status.active_version is None:
        return None, "", {}
    year = int(status.active_version)
    rows = await db.execute(
        select(GeoVillageIncome.village_code, GeoVillageIncome.median).where(GeoVillageIncome.district.in_(districts))
    )
    return year, income_io.citation(year, status.synced_at), {code: median for code, median in rows.all()}


async def _adjusted_since(db: AsyncSession, districts: set[str], year: int, people: dict[str, int]) -> set[str]:
    """所得年度之後（遷入遷出表裡所有存著的月份），行政區域調整人數過 V5 門檻的代碼。表只存 25 個月，
    更早的調整看不到（規格 §5.8 的限制）。"""
    m = GeoVillageMigration
    moved = func.greatest(m.boundary_in, m.boundary_out)
    rows = await db.execute(
        select(m.village_code, func.max(moved))
        .where(m.district.in_(districts), m.month > f"{year:03d}-12", moved >= BOUNDARY_MIN_PEOPLE)
        .group_by(m.village_code)
    )
    return {code for code, most in rows.all() if most >= BOUNDARY_SHARE * people.get(code, 0)}


@dataclass
class _Data:
    """這次計算讀進來的資料（只讀半徑內的里所在的行政區）。"""

    population: dict[str, GeoVillagePopulation] = field(default_factory=dict)
    ages: dict[str, dict[str, GeoVillageAges]] = field(default_factory=dict)  # 月份 → 代碼 → 列
    births: dict[str, dict[str, int]] = field(default_factory=dict)  # 月份 → 代碼 → 出生數
    migration: dict[str, dict[str, Any]] = field(default_factory=dict)  # 月份 → 代碼 → 列
    districts: dict[str, str] = field(default_factory=dict)  # 代碼 → 區（含已廢止的舊代碼）
    names: dict[str, str] = field(default_factory=dict)  # 代碼 → 里名


async def _load(
    db: AsyncSession, districts: set[str], *, current: str | None, births_months: list[str], migration_months: list[str]
) -> _Data:
    data = _Data()
    for row in (
        await db.execute(select(GeoVillagePopulation).where(GeoVillagePopulation.district.in_(districts)))
    ).scalars():
        data.population[row.village_code] = row
    if current is not None:
        months = [current, series_io.shift(current, -PERIOD_MONTHS)]
        for row in (
            await db.execute(
                select(GeoVillageAges).where(GeoVillageAges.month.in_(months), GeoVillageAges.district.in_(districts))
            )
        ).scalars():
            data.ages.setdefault(row.month, {})[row.village_code] = row
    if births_months:
        b = GeoVillageBirths
        rows = await db.execute(
            select(b.month, b.village_code, b.district, b.village, b.births).where(
                b.month.in_(births_months), b.district.in_(districts)
            )
        )
        for month, code, district, village, births in rows.all():
            data.births.setdefault(month, {})[code] = births
            data.districts.setdefault(code, district)
            data.names.setdefault(code, village)
    if migration_months:
        m = GeoVillageMigration
        rows = await db.execute(select(m).where(m.month.in_(migration_months), m.district.in_(districts)))
        for row in rows.scalars():
            data.migration.setdefault(row.month, {})[row.village_code] = row
            data.districts.setdefault(row.village_code, row.district)
            data.names.setdefault(row.village_code, row.village)
    for month_rows in data.ages.values():
        for code, row in month_rows.items():
            data.districts.setdefault(code, row.district)
            data.names.setdefault(code, row.village)
    return data


def _ends_differ(rows_by_month: dict[str, dict[str, Any]], months: list[str]) -> set[str]:
    """期間內有資料的第一個月與最後一個月，代碼只在其中一端出現的（新設或廢止的里）。"""
    present = [month for month in months if month in rows_by_month]
    if len(present) < 2:
        return set()
    first, last = set(rows_by_month[present[0]]), set(rows_by_month[present[-1]])
    return first ^ last


def _people(data: _Data, code: str) -> int:
    if code in data.population:
        return data.population[code].people_total
    return max((rows[code].people_total for rows in data.ages.values() if code in rows), default=0)


def _adjusted_codes(data: _Data, *, kids_months: list[str], births_window: list[str], migration_window: list[str]) -> set[str]:
    """V5：三個期間任一個裡，代碼頭尾不齊或行政區域調整人數過門檻的代碼。"""
    flagged = _ends_differ(data.births, births_window) | _ends_differ(data.migration, migration_window)
    if len(kids_months) == 2 and all(month in data.ages for month in kids_months):
        flagged |= set(data.ages[kids_months[0]]) ^ set(data.ages[kids_months[1]])
    for rows in data.migration.values():
        for code, row in rows.items():
            moved = max(row.boundary_in, row.boundary_out)
            if moved >= BOUNDARY_MIN_PEOPLE and moved >= BOUNDARY_SHARE * _people(data, code):
                flagged.add(code)
    return flagged


def _sum_ages(row: GeoVillageAges | GeoVillagePopulation | None, band: tuple[int, int]) -> int:
    if row is None:
        return 0
    return sum(getattr(row, f"age_{age}") for age in range(band[0], band[1] + 1))


def _unit_schools(codes: list[str]) -> list[dict[str, Any]]:
    """一列（一個里或合併組）對到的國小：整里在前、部分在後，同級依校名。合併組裡只要有一個里只屬部分鄰、或
    有里不屬這所，就算部分。"""
    found: dict[str, dict[str, Any]] = {}
    for code in codes:
        for item in sd.by_village().get(code, ()):
            school = sd.schools()[item.school_code]
            entry = found.setdefault(
                item.school_code,
                {"code": school.code, "name": school.name, "district": school.district, "partial": False,
                 "free_zone": False, "villages": 0},
            )
            entry["partial"] = entry["partial"] or item.partial
            entry["free_zone"] = entry["free_zone"] or item.free_zone
            entry["villages"] += 1
    rows = []
    for entry in found.values():
        villages = entry.pop("villages")
        entry["partial"] = entry["partial"] or villages < len(codes)
        rows.append(entry)
    return sorted(rows, key=lambda row: (row["partial"], row["name"], row["district"]))


async def _schools(
    db: AsyncSession,
    touched: list[str],
    data: _Data,
    *,
    adjusted: set[str],
    kids_months: list[str],
    campus_key: str,
    school_year: int | None,
    semester: int | None,
) -> list[dict[str, Any]]:
    """依國小學區（規格 §5.9）：每所合計整個學區的里。這一年淨增只加算得出的里（里界調整過、或缺一年前年齡的
    另標 kids_partial）；kids_months 是空的（全部算不出來）時是 null。"""
    if not touched:
        return []
    visits, _ = await visits_by_village(db, campus_key, school_year, semester)
    rows = []
    for school_code in touched:
        school = sd.schools()[school_code]
        items = sd.by_school()[school_code]
        codes = [item.village_code for item in items]
        with_population = [code for code in codes if code in data.population]
        children = sum(_sum_ages(data.population[code], KIDS_BAND) for code in with_population) if with_population else None
        kids_net, kids_partial = None, False
        if kids_months:
            countable = [
                code for code in codes
                if code not in adjusted and all(code in data.ages.get(month, {}) for month in kids_months)
            ]
            kids_partial = len(countable) < len(codes)
            if countable:
                kids_net = sum(
                    _sum_ages(data.ages[kids_months[1]][code], KIDS_BAND)
                    - _sum_ages(data.ages[kids_months[0]][code], YEAR_AGO_BAND)
                    for code in countable
                )
        visit = sum(visits.get(code, 0) for code in codes)
        rows.append(
            {
                "code": school.code,
                "name": school.name,
                "district": school.district,
                "enrollment": school.enrollment,
                "villages_full": sum(not item.partial for item in items),
                "villages_partial": sum(item.partial for item in items),
                "children": children,
                "kids_net": kids_net,
                "kids_partial": kids_partial,
                "visit": visit,
                "rate": pct(visit, children) if children else None,
            }
        )
    rows.sort(key=lambda row: (-row["visit"], -(row["children"] or 0), row["district"], row["name"]))
    return rows


async def query_trends(
    db: AsyncSession,
    campus_key: str,
    *,
    school_year: int | None,
    semester: int | None,
    radius_km: int,
    now: datetime | None = None,
) -> dict[str, Any]:
    campus = await campus_out(db, campus_key)
    current = await _label(db, "population")
    births_latest = await _label(db, "births")
    migration_latest = await _label(db, "migration")
    births_window = series_io.window(births_latest, PERIOD_MONTHS) if births_latest else []
    births_previous = [series_io.shift(month, -PERIOD_MONTHS) for month in births_window]
    migration_window = series_io.window(migration_latest, PERIOD_MONTHS) if migration_latest else []
    kids_window = series_io.window(current, PERIOD_MONTHS) if current else []
    kids_months = [series_io.shift(current, -PERIOD_MONTHS), current] if current else []

    result: dict[str, Any] = {
        "as_of": now or datetime.now(timezone.utc),
        "filters": {"campus_key": campus_key, "school_year": school_year, "semester": semester},
        "radius_km": radius_km,
        "campus": campus,
        "sources": {
            "population": {"month": current, "year_ago_month": None},
            "births": {"latest": births_latest, "months": [], "missing": []},
            "migration": {"latest": migration_latest, "months": [], "missing": []},
            "note": series_io.SOURCE_NOTE,
            "income": {"year": None, "note": ""},
            "school_districts": {"school_year": sd.SCHOOL_DISTRICT_YEAR, "note": sd.SOURCE_NOTE},
        },
        "baseline": None,
        "kids_unavailable": None,
        "villages": [],
        "schools": [],
    }
    if campus["lat"] is None or campus["lng"] is None:
        return result

    radius_m = radius_km * 1000
    near: dict[str, int] = {}
    for code, point in boundaries.village_centroids().items():
        distance = haversine_m(campus["lat"], campus["lng"], *point)
        if distance <= radius_m:
            near[code] = _round_distance(distance)
    names = boundaries.village_names()
    # 學區碰到半徑內任一個里的國小，整個學區的里都要讀（含半徑外的里所在的區）。
    touched = sorted({item.school_code for code in near for item in sd.by_village().get(code, ())})
    school_villages = {item.village_code for school in touched for item in sd.by_school()[school]}
    districts = {names[code][0] for code in (*near, *school_villages) if code in names}
    data = await _load(
        db,
        districts,
        current=current,
        births_months=sorted({*births_window, *births_previous}),
        migration_months=sorted({*migration_window, *kids_window}),
    )

    income_year, income_note, incomes = await _income(db, districts)
    result["sources"]["income"] = {"year": income_year, "note": income_note}
    income_changed = (
        await _adjusted_since(db, districts, income_year, {code: _people(data, code) for code in incomes})
        if income_year is not None
        else set()
    )

    births_present = [month for month in births_window if month in data.births]
    migration_present = [month for month in migration_window if month in data.migration]
    result["sources"]["births"].update(
        months=births_present, missing=[month for month in births_window if month not in data.births]
    )
    result["sources"]["migration"].update(
        months=migration_present, missing=[month for month in migration_window if month not in data.migration]
    )
    kids_ready = bool(kids_months) and all(month in data.ages for month in kids_months)
    if kids_ready:
        result["sources"]["population"]["year_ago_month"] = kids_months[0]
    if current is None:
        unavailable = "no_population"
    elif not kids_ready:
        unavailable = "no_year_ago"
    elif sum(month in data.migration for month in kids_window) < MIN_MIGRATION_MONTHS:
        unavailable = "no_migration"
    else:
        unavailable = None
    result["kids_unavailable"] = unavailable

    adjusted = _adjusted_codes(
        data, kids_months=kids_months if kids_ready else [], births_window=births_window, migration_window=migration_window
    )
    groups: dict[str, list[str]] = defaultdict(list)
    for code in sorted(adjusted):
        district = names[code][0] if code in names else data.districts.get(code)
        if district is not None:
            groups[district].append(code)

    # 半徑內的里 → 一列（沒調整過的里）或一組（同區調整過的里合併）。
    units: dict[str, dict[str, Any]] = {}
    for code, distance in near.items():
        district = names[code][0]
        if code in adjusted:
            codes = groups[district]
            key = f"group:{district}:{codes[0]}"
        else:
            codes = [code]
            key = code
        unit = units.setdefault(key, {"key": key, "district": district, "codes": codes, "distance_m": distance})
        unit["distance_m"] = min(unit["distance_m"], distance)

    def total(rows_by_month: dict[str, dict[str, Any]], months: list[str], codes: list[str], value) -> int:
        return sum(value(rows_by_month[month][code]) for month in months for code in codes if code in rows_by_month.get(month, {}))

    def has_rows(rows_by_month: dict[str, dict[str, Any]], months: list[str], codes: list[str]) -> bool:
        """這些代碼在這些月份裡至少有一列（沒有就是 null，不寫 0）。"""
        return any(code in rows_by_month.get(month, {}) for month in months for code in codes)

    def net_moves(row: GeoVillageMigration) -> int:
        return row.moved_in - row.moved_out + row.address_in - row.address_out

    villages = []
    for unit in units.values():
        codes = unit["codes"]
        current_codes = [code for code in codes if code in names]
        children = (
            sum(_sum_ages(data.population.get(code), KIDS_BAND) for code in current_codes)
            if any(code in data.population for code in current_codes)
            else None
        )
        kids_net = kids_base = None
        if unavailable is None and all(has_rows(data.ages, [month], codes) for month in kids_months):
            now_kids = sum(_sum_ages(data.ages[kids_months[1]].get(code), KIDS_BAND) for code in codes)
            kids_base = sum(_sum_ages(data.ages[kids_months[0]].get(code), YEAR_AGO_BAND) for code in codes)
            kids_net = now_kids - kids_base
        merged = unit["key"].startswith("group:")
        villages.append(
            {
                "schools": _unit_schools(current_codes),
                "key": unit["key"],
                "district": unit["district"],
                "village": "、".join(names[code][1] for code in current_codes),
                "codes": codes,
                "merged": merged,
                "distance_m": unit["distance_m"],
                "children": children,
                "kids_net": kids_net,
                "kids_base": kids_base,
                "kids_level": kids_level(kids_net, kids_base),
                "births_12m": (
                    total(data.births, births_present, codes, lambda births: births)
                    if has_rows(data.births, births_present, codes)
                    else None
                ),
                "migration_net_12m": (
                    total(data.migration, migration_present, codes, net_moves)
                    if has_rows(data.migration, migration_present, codes)
                    else None
                ),
                "income_median": None if merged else incomes.get(codes[0]),
                "income_boundary_changed": not merged and codes[0] in incomes and codes[0] in income_changed,
            }
        )
    villages.sort(
        key=lambda row: (
            row["kids_net"] is None, -(row["kids_net"] or 0), -(row["children"] or 0), row["district"], row["village"],
        )
    )
    result["villages"] = villages
    result["schools"] = await _schools(
        db, touched, data, adjusted=adjusted, kids_months=kids_months if unavailable is None else [],
        campus_key=campus_key, school_year=school_year, semester=semester,
    )

    all_codes = [code for row in villages for code in row["codes"]]
    compared = [
        month for month in births_present if series_io.shift(month, -PERIOD_MONTHS) in data.births
    ]
    births_now = total(data.births, compared, all_codes, lambda births: births)
    births_before = total(data.births, [series_io.shift(month, -PERIOD_MONTHS) for month in compared], all_codes, lambda births: births)
    change = (
        round((births_now / births_before - 1) * 100, 1)
        if len(compared) >= MIN_COMPARE_MONTHS and births_before > 0
        else None
    )
    with_kids = [row for row in villages if row["kids_net"] is not None]
    with_children = [row for row in villages if row["children"] is not None]
    result["baseline"] = {
        "villages": len(near),
        "children": sum(row["children"] for row in with_children) if with_children else None,
        "kids_net": sum(row["kids_net"] for row in with_kids) if with_kids else None,
        "kids_base": sum(row["kids_base"] for row in with_kids) if with_kids else None,
        "births_12m": sum(row["births_12m"] or 0 for row in villages) if births_present else None,
        "births_months": len(births_present),
        "births_compared_months": len(compared),
        "births_change_pct": change,
        "migration_net_12m": sum(row["migration_net_12m"] or 0 for row in villages) if migration_present else None,
        "migration_months": len(migration_present),
    }
    return result
