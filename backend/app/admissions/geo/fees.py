"""幼兒園公告收費：kiang 整理的全國教保資訊網收費明細（2026-10-15 附近同業比較規格 §2、§4.2）。

來源 https://kiang.github.io/ap.ece.moe.edu.tw/data/slip{學年}/高雄市/{園名}.json，一所一檔。只讀 slip，
檔頭 meta（含負責人姓名）整段不讀。只取全日班、2–5 歲、一學期：上學期的全學期總收費是正整數就用上學期，
否則用下學期（實測上下學期 266／266 筆相同，F4）。學期項目取小計、課後延托取每月單價；交通費格式不一致，
只存公告原文（F5）。統計工具（中位數、月均）與「本校」查詢也放這裡，給 area.py 與 peer_fees.py 共用。"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from decimal import Decimal
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.kindergartens import _int_or_none
from app.admissions.geo.models import FEE_AGES, GeoKindergarten, GeoKindergartenFee
from app.admissions.geo.projection import haversine_m

SLIP_ROOT = "https://kiang.github.io/ap.ece.moe.edu.tw/data"
CITY = "高雄市"
SOURCE_NOTE = "資料來源：全國教保資訊網（kiang 整理），園所公告收費"
# 學期項目（小計）與欄位名稱的對照；順序就是畫面上項目對照表的順序。
SEMESTER_ITEMS = (
    ("tuition", "學費"), ("misc_fee", "雜費"), ("materials", "材料費"),
    ("activities", "活動費"), ("lunch", "午餐費"), ("snack", "點心費"),
)
ITEM_KEYS = (*(key for key, _ in SEMESTER_ITEMS), "after_care_monthly")
TOTAL_ITEM = "全學期總收費"
AFTER_CARE_ITEM = "課後延托費"
TRANSPORT_ITEM = "交通費"
TRANSPORT_MAX = 40
_METERS_PER_DEGREE = 111_320.0
_SPACES = re.compile(r"\s+")


class FeeFormatError(ValueError):
    """收費檔不是預期的格式。"""


@dataclass(frozen=True)
class FeeRow:
    age: int
    months: float | None
    tuition: int | None
    misc_fee: int | None
    materials: int | None
    activities: int | None
    lunch: int | None
    snack: int | None
    semester_total: int
    after_care_monthly: int | None
    transport_note: str | None


def slip_url(school_year: int, title: str) -> str:
    """園名要整段編碼（非營利園名常有括號、斜線以外的符號）。"""
    return f"{SLIP_ROOT}/slip{school_year}/{quote(CITY)}/{quote(title, safe='')}.json"


def _amount(value: object) -> int | None:
    number = _int_or_none(value)
    return number if number is not None and number >= 0 else None


def _positive(value: object) -> int | None:
    number = _int_or_none(value)
    return number if number is not None and number > 0 else None


def _months(value: object) -> float | None:
    try:
        number = float(str(value).strip())
    except ValueError:
        return None
    return number if math.isfinite(number) and 0.5 <= number <= 12 else None


def _full_day(age_block: object, term: str) -> tuple[dict, object] | None:
    """某一學期的全日班收費表與月數；總收費不是正整數（沒開這個班、沒填）回 None。"""
    semester = age_block.get(term) if isinstance(age_block, dict) else None
    classes = semester.get("class") if isinstance(semester, dict) else None
    table = classes.get("全日班") if isinstance(classes, dict) else None
    if not isinstance(table, dict):
        return None
    total = table.get(TOTAL_ITEM)
    if not isinstance(total, dict) or _positive(total.get("小計")) is None:
        return None
    return table, semester.get("months")


def _cell(table: dict, item: str, field: str) -> object:
    entry = table.get(item)
    return entry.get(field) if isinstance(entry, dict) else None


def parse_slip(data: object) -> list[FeeRow]:
    slip = data.get("slip") if isinstance(data, dict) else None
    if not isinstance(slip, dict):
        raise FeeFormatError("收費檔不是預期的格式")
    rows: list[FeeRow] = []
    for age in FEE_AGES:
        block = slip.get(str(age))
        found = _full_day(block, "上學期") or _full_day(block, "下學期")
        if found is None:
            continue
        table, months = found
        transport = _SPACES.sub(" ", str(_cell(table, TRANSPORT_ITEM, "單價") or "")).strip()[:TRANSPORT_MAX]
        items = {key: _amount(_cell(table, name, "小計")) for key, name in SEMESTER_ITEMS}
        rows.append(
            FeeRow(
                age=age,
                months=_months(months),
                **items,
                semester_total=_positive(_cell(table, TOTAL_ITEM, "小計")),  # _full_day 已確定是正整數
                after_care_monthly=_amount(_cell(table, AFTER_CARE_ITEM, "單價")),
                transport_note=transport or None,
            )
        )
    return rows


def half_up(value: float) -> int:
    """四捨五入到整數（Python 的 round 是銀行家捨入，0.5 會往偶數靠）。只用在正數。"""
    return math.floor(value + 0.5)


def median(values: list[int]) -> int | None:
    """中位數；少於 3 個不算（規格 F14）。偶數個取中間兩個的平均，四捨五入到元。"""
    if len(values) < 3:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return half_up((ordered[middle - 1] + ordered[middle]) / 2)


def monthly_average(total: int, months: Decimal | float | None) -> int | None:
    """月均＝學期總收費 ÷ 月數，四捨五入到元；月數不知道就不算。"""
    if months is None or float(months) <= 0:
        return None
    return half_up(total / float(months))


async def own_fee(
    db: AsyncSession, lat: float, lng: float, *, age: int, radius_m: int
) -> tuple[GeoKindergarten | None, GeoKindergartenFee | None]:
    """本校：距 (lat, lng) radius_m 內最近的營業中園所（規格 F12），以及它這個年齡的收費列（可能沒有）。"""
    dlat = radius_m / _METERS_PER_DEGREE
    dlng = radius_m / (_METERS_PER_DEGREE * math.cos(math.radians(lat)))
    result = await db.execute(
        select(GeoKindergarten).where(
            GeoKindergarten.is_active.is_(True),
            GeoKindergarten.lat.between(lat - dlat, lat + dlat),
            GeoKindergarten.lng.between(lng - dlng, lng + dlng),
        )
    )
    candidates = [(haversine_m(lat, lng, row.lat, row.lng), row) for row in result.scalars()]
    candidates = [(distance, row) for distance, row in candidates if distance <= radius_m]
    if not candidates:
        return None, None
    _, school = min(candidates, key=lambda pair: (pair[0], pair[1].source_id))
    return school, await db.get(GeoKindergartenFee, (school.source_id, age))
