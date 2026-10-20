"""招生潛力：每年還能多招幾位新生的三個來源（2026-10-20 招生潛力第二、三波規格 §5，報告 A-07、B-03、B-06、B-11、I-4）。

這個檔先放常數、Range 與來源一「附近園所停辦釋出」；來源二、三接在後面。所有參數都在下面的常數，
畫面「怎麼算」照列；這一版不開放後台修改。

來源一：附近 8 公里內幼兒園停辦，家長轉來本校的孩子數。
  流入＝核定名額 × 實收率 × (1 − 畢業比例) × 承接率 × 距離係數 × 價格係數（報告 A-07）。
  - 類型係數（連鎖園 0.6）與老師帶班不算：公開資料看不出是不是連鎖，老師帶班也無法預期（裁定 5）。
  - 本校與五校 50 m 內的園所不算（本機構）。
  - 年度窗口是學年口徑：10/1 起算新學年，只算 2022-10 起「完整」的窗口（窗口最後一天 < 今天），進行中的不算。
  - 低＝最低那年 × 承接率中值；中＝平均 × 承接率中值；高＝最高那年 × 承接率高值（裁定 4）。
    規格原寫「低 0%」，會讓低值恆為 0，所以改用中值。
  - 核定名額沒填的停辦園所算不出來，略過並計數；對方沒有收費資料時價格係數取 1，也計數。"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import area
from app.admissions.geo import fees, matcher
from app.admissions.geo.models import GeoKindergarten, GeoKindergartenFee, GeoProviderEvent
from app.admissions.geo.projection import haversine_m

# ---- 參數（報告 A-07、B-03、B-04、B-06、B-11、I-4）----

# 距離帶（A-07）：(距離上界 m，含；係數)。A ≤ 1.5 km、B 1.5–3、C 3–5、D 5–8，超過 8 km（E）係數 0。
DISTANCE_BANDS: tuple[tuple[int, float], ...] = ((1500, 1.0), (3000, 0.45), (5000, 0.12), (8000, 0.02))
CLOSURE_RADIUS_M = DISTANCE_BANDS[-1][0]
# 實收率：全市 114 學年核定名額對照實際幼生（B-04）。
OCCUPANCY_RATE = 0.67
# 畢業比例：大班不會轉園（A-07）。
GRADUATING_SHARE = 0.29
# 承接率（I-4 回測）：中＝童年綠地與愛爾蘭合併 13.8%、高＝童年綠地 17.3%。
CATCH_RATE_MID = 0.138
CATCH_RATE_HIGH = 0.173
# 價格係數（A-07）：本校 3 歲一學期收費 ÷ 對方，用百分比整數比較（兩端的整數倍不會有浮點誤差）。
PRICE_FEE_AGE = 3
PRICE_SIMILAR_PERCENT = (80, 130)  # 0.8–1.3 倍（含）→ 1
PRICE_MODERATE_MAX_PERCENT = 160  # 1.3–1.6 倍（含 1.6）→ 0.6，更貴 → 0.3
PRICE_FACTOR_SIMILAR = 1.0
PRICE_FACTOR_THEY_ARE_PRICEY = 0.7  # 對方貴很多（本校不到對方的 0.8 倍）
PRICE_FACTOR_MODERATE = 0.6
PRICE_FACTOR_FAR_ABOVE = 0.3
# 公共化園所（公幼、非營利、準公共）：家長多半抽籤或看公共化價格，不看本校收費。
PUBLIC_KINDS = ("public", "nonprofit", "quasi_public")
PRICE_FACTOR_PUBLIC = 0.1
# 學年窗口：10/1 起算新學年；只算 2022-10 起（停辦回補檔的起點），民國 111 學年的窗口。
SCHOOL_YEAR_START_MONTH = 10
FIRST_SCHOOL_YEAR = 111
RANGE_DIGITS = 1


@dataclass(frozen=True)
class Range:
    """每年可多招人數的低／中／高，四捨五入到 1 位。"""

    low: float
    mid: float
    high: float

    def __post_init__(self) -> None:
        for name in ("low", "mid", "high"):
            object.__setattr__(self, name, round(getattr(self, name), RANGE_DIGITS))


@dataclass(frozen=True)
class ClosureEvent:
    """一所停辦的幼兒園。own_fee、their_fee 是 3 歲一學期收費（元）；任一邊沒有資料是 None。"""

    occurred_on: date
    name: str
    kind: str
    approved_capacity: int | None
    distance_m: float
    own_fee: int | None
    their_fee: int | None


def band_weight(distance_m: float) -> float:
    """距離係數；帶界含上界（1500 m 算 A 帶），超過 8 km 是 0。"""
    for upper, weight in DISTANCE_BANDS:
        if distance_m <= upper:
            return weight
    return 0.0


def _price_known(own_fee: int | None, their_fee: int | None) -> bool:
    return bool(own_fee and their_fee and own_fee > 0 and their_fee > 0)


def price_factor(kind: str, own_fee: int | None, their_fee: int | None) -> float:
    """價格係數：公共化 0.1；沒有收費資料取 1（由呼叫端計數）；其餘看本校收費 ÷ 對方。"""
    if kind in PUBLIC_KINDS:
        return PRICE_FACTOR_PUBLIC
    if not _price_known(own_fee, their_fee):
        return PRICE_FACTOR_SIMILAR
    scaled = own_fee * 100  # 和 their_fee × 百分比比較，等同 own ÷ their 對 0.8、1.3、1.6，整數運算沒有浮點誤差
    low, high = PRICE_SIMILAR_PERCENT
    if scaled < their_fee * low:
        return PRICE_FACTOR_THEY_ARE_PRICEY
    if scaled <= their_fee * high:
        return PRICE_FACTOR_SIMILAR
    if scaled <= their_fee * PRICE_MODERATE_MAX_PERCENT:
        return PRICE_FACTOR_MODERATE
    return PRICE_FACTOR_FAR_ABOVE


def school_year_window(day: date) -> int:
    """日期落在哪個學年窗口（民國年）：10/1 起算新學年，例如 2022-10-01～2023-09-30 都是 111。"""
    return day.year - 1911 if day.month >= SCHOOL_YEAR_START_MONTH else day.year - 1912


def _window_end(school_year: int) -> date:
    """學年窗口的最後一天（隔年 9/30）。"""
    return date(school_year + 1912, SCHOOL_YEAR_START_MONTH - 1, 30)


def _has_capacity(event: ClosureEvent) -> bool:
    return event.approved_capacity is not None and event.approved_capacity > 0


def closure_inflow(event: ClosureEvent, *, catch_rate: float) -> float:
    """一所停辦園所一年內轉來的孩子數；沒有核定名額算 0（呼叫端另外計數）。"""
    if not _has_capacity(event):
        return 0.0
    return (
        event.approved_capacity * OCCUPANCY_RATE * (1 - GRADUATING_SHARE) * catch_rate
        * band_weight(event.distance_m) * price_factor(event.kind, event.own_fee, event.their_fee)
    )


def _complete_years(today: date) -> list[int]:
    years: list[int] = []
    year = FIRST_SCHOOL_YEAR
    while _window_end(year) < today:
        years.append(year)
        year += 1
    return years


def closures_range(events: list[ClosureEvent], *, today: date) -> tuple[Range | None, dict]:
    """來源一的低／中／高，以及畫面「怎麼算」要的明細。

    沒有完整窗口、或一件停辦事件都沒有（資料根本沒回補）→ None，由呼叫端標 no_data。
    details：
    - years：每個完整窗口一筆（沒停辦的窗口也列，值 0），weighted＝窗口內各事件承接率取 1 的流入加總；
    - skipped：no_capacity＝窗口內但核定名額沒填的、outside_windows＝不在任何完整窗口（進行中或 2022-10 之前）的事件數；
    - price_unknown：算進去的事件裡，價格係數因缺收費資料取 1 的事件數（公共化園所直接 0.1，不算在內）；
    - events：算進去的事件（日期、園名、核定、距離 m、學年、承接率取 1 的流入），依日期排序。"""
    years = _complete_years(today)
    weighted = {year: 0.0 for year in years}
    counted = {year: 0 for year in years}
    skipped = {"no_capacity": 0, "outside_windows": 0}
    price_unknown = 0
    listed: list[dict] = []
    for event in sorted(events, key=lambda item: (item.occurred_on, item.name)):
        year = school_year_window(event.occurred_on)
        if year not in weighted:
            skipped["outside_windows"] += 1
            continue
        if not _has_capacity(event):
            skipped["no_capacity"] += 1
            continue
        inflow = closure_inflow(event, catch_rate=1)
        weighted[year] += inflow
        counted[year] += 1
        if event.kind not in PUBLIC_KINDS and not _price_known(event.own_fee, event.their_fee):
            price_unknown += 1
        listed.append(
            {
                "occurred_on": event.occurred_on, "name": event.name, "approved_capacity": event.approved_capacity,
                "distance_m": round(event.distance_m), "school_year": year, "weighted": round(inflow, RANGE_DIGITS),
            }
        )
    details = {
        "years": [
            {"school_year": year, "weighted": round(weighted[year], RANGE_DIGITS), "events": counted[year]} for year in years
        ],
        "skipped": skipped,
        "price_unknown": price_unknown,
        "events": listed,
    }
    if not years or not events:
        return None, details
    values = list(weighted.values())
    return (
        Range(
            low=min(values) * CATCH_RATE_MID,
            mid=sum(values) / len(values) * CATCH_RATE_MID,
            high=max(values) * CATCH_RATE_HIGH,
        ),
        details,
    )


_METERS_PER_DEGREE = 111_320.0


def _box(lat: float, lng: float, radius_m: float) -> tuple[float, float, float, float]:
    """經緯度方框（先用索引篩，再算大圓距離）：(南, 北, 西, 東)。"""
    dlat = radius_m / _METERS_PER_DEGREE
    dlng = radius_m / (_METERS_PER_DEGREE * math.cos(math.radians(lat)))
    return lat - dlat, lat + dlat, lng - dlng, lng + dlng


async def load_closure_events(
    db: AsyncSession, lat: float, lng: float, *, since: date, today: date
) -> list[ClosureEvent]:
    """(lat, lng) 8 km 內、since～today 的幼兒園停辦事件，排除五校（含傳進來的校址）50 m 內的園所。

    停辦的園所列一直留在 geo_kindergartens（is_active 為假），事件 join 回去取名稱、類型、核定與座標。
    本校收費取座標 50 m 內最近營業中園所的 3 歲一學期收費（fees.own_fee）；對方收費取同一個年齡的 semester_total。
    沒有核定名額或沒有收費的照樣載入，由 closures_range 略過或取中性係數。"""
    south, north, west, east = _box(lat, lng, CLOSURE_RADIUS_M)
    rows = await db.execute(
        select(GeoProviderEvent.occurred_on, GeoKindergarten, GeoKindergartenFee.semester_total)
        .join(GeoKindergarten, GeoKindergarten.source_id == GeoProviderEvent.source_id)
        .outerjoin(
            GeoKindergartenFee,
            and_(GeoKindergartenFee.source_id == GeoKindergarten.source_id, GeoKindergartenFee.age == PRICE_FEE_AGE),
        )
        .where(
            GeoProviderEvent.provider == "kindergarten",
            GeoProviderEvent.change == "closed",
            GeoProviderEvent.occurred_on >= since,
            GeoProviderEvent.occurred_on <= today,
            GeoKindergarten.lat.between(south, north),
            GeoKindergarten.lng.between(west, east),
        )
    )
    campus_points = await matcher.campus_points(db)
    own_points = [(lat, lng)] + [
        (point.lat, point.lng) for point in campus_points.values() if point.lat is not None and point.lng is not None
    ]
    _, own_fee_row = await fees.own_fee(db, lat, lng, age=PRICE_FEE_AGE, radius_m=area.OWN_CAMPUS_RADIUS_M)
    own_total = own_fee_row.semester_total if own_fee_row is not None else None
    events: list[ClosureEvent] = []
    for occurred_on, school, their_fee in rows.all():
        distance = haversine_m(lat, lng, school.lat, school.lng)
        if distance > CLOSURE_RADIUS_M:
            continue
        if any(haversine_m(school.lat, school.lng, a, b) <= area.OWN_CAMPUS_RADIUS_M for a, b in own_points):
            continue
        events.append(
            ClosureEvent(
                occurred_on=occurred_on, name=school.name, kind=school.kind, approved_capacity=school.approved_capacity,
                distance_m=distance, own_fee=own_total, their_fee=their_fee,
            )
        )
    events.sort(key=lambda item: (item.occurred_on, item.distance_m, item.name))
    return events
