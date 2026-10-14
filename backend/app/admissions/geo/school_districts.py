"""高雄市國小學區（里 → 國小），隨程式提交的對照檔（docs/specs/2026-10-14-admissions-village-trends-design.md
§2.4、§3.4、§4.5，D 段）。

- `geo_data/school-districts-<學年>.csv`：一列一個（里、學校）。一個里可以對多所國小：拆鄰（coverage=partial）
  或自由學區（free_zone）；
- `geo_data/elementary-schools-<學年>.csv`：一列一所學校（含分校），招生方式 enrollment：district 一般學區／
  open 大學區（實驗教育）／spacious 空間充裕／capped 總量管制。

兩個檔由 scripts/build_school_districts.py 從教育局「國民小學學區劃分一覽表」PDF 轉出（人工處理的列在
`school-districts-<學年>-overrides.csv`，逐列寫原因）；每學年（約 1 月公告）人工換一次，改 SCHOOL_DISTRICT_YEAR。
不建資料表、不同步；讀一次快取在記憶體（約 1,100 列）。不存學校座標（名錄沒有、不接外部地址服務）。"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

GEO_DATA = Path(__file__).resolve().parent.parent / "geo_data"
SCHOOL_DISTRICT_YEAR = 115
ENROLLMENTS = ("district", "open", "spacious", "capped")
SOURCE_NOTE = (
    f"學區依高雄市政府教育局「{SCHOOL_DISTRICT_YEAR} 學年度國民小學學區劃分一覽表」；"
    f"學校依教育部「國民小學名錄」（{SCHOOL_DISTRICT_YEAR} 學年度）"
)


@dataclass(frozen=True)
class School:
    code: str
    name: str
    district: str
    address: str
    enrollment: str


@dataclass(frozen=True)
class Assignment:
    """一個（里、學校）。partial＝只有部分鄰屬於這所；free_zone＝（全部或部分鄰）和別校是自由學區。"""

    village_code: str
    school_code: str
    partial: bool
    free_zone: bool
    neighborhoods: str
    note: str


def _rows(name: str) -> list[dict[str, str]]:
    with (GEO_DATA / name).open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


@lru_cache(maxsize=1)
def schools() -> dict[str, School]:
    """學校代碼（分校是「本校代碼-分校名」）→ 學校。"""
    result: dict[str, School] = {}
    for row in _rows(f"elementary-schools-{SCHOOL_DISTRICT_YEAR}.csv"):
        result[row["school_code"]] = School(
            code=row["school_code"], name=row["name"], district=row["district"], address=row["address"],
            enrollment=row["enrollment"],
        )
    return result


@lru_cache(maxsize=1)
def assignments() -> tuple[Assignment, ...]:
    return tuple(
        Assignment(
            village_code=row["village_code"],
            school_code=row["school_code"],
            partial=row["coverage"] == "partial",
            free_zone=row["free_zone"] == "true",
            neighborhoods=row["neighborhoods"],
            note=row["note"],
        )
        for row in _rows(f"school-districts-{SCHOOL_DISTRICT_YEAR}.csv")
    )


@lru_cache(maxsize=1)
def by_village() -> dict[str, tuple[Assignment, ...]]:
    """里代碼 → 它對到的學校（依學校代碼排）。"""
    grouped: dict[str, list[Assignment]] = {}
    for item in assignments():
        grouped.setdefault(item.village_code, []).append(item)
    return {code: tuple(sorted(items, key=lambda item: item.school_code)) for code, items in grouped.items()}


@lru_cache(maxsize=1)
def by_school() -> dict[str, tuple[Assignment, ...]]:
    """學校代碼 → 它整個學區的里（含部分鄰、自由學區的里）。"""
    grouped: dict[str, list[Assignment]] = {}
    for item in assignments():
        grouped.setdefault(item.school_code, []).append(item)
    return {code: tuple(items) for code, items in grouped.items()}
