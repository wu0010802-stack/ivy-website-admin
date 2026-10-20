"""招生潛力：每年還能多招幾位新生的三個來源（2026-10-20 招生潛力第二、三波規格 §5，報告 A-07、B-03、B-06、B-11、I-4）。

這個檔先放常數、Range、來源一「附近園所停辦釋出」與來源二「現有的里還沒招到」；來源三接在後面。所有參數都在
下面的常數，畫面「怎麼算」照列；這一版不開放後台修改。

來源一：附近 8 公里內幼兒園停辦，家長轉來本校的孩子數。
  流入＝核定名額 × 實收率 × (1 − 畢業比例) × 承接率 × 距離係數 × 價格係數（報告 A-07）。
  - 類型係數（連鎖園 0.6）與老師帶班不算：公開資料看不出是不是連鎖，老師帶班也無法預期（裁定 5）。
  - 本校與五校 50 m 內的園所不算（本機構）。
  - 年度窗口是學年口徑：10/1 起算新學年，只算「完整」的窗口（窗口最後一天 < 今天），進行中的不算；
    起點是 2022-10（回補檔的起點），事件只保留 72 個月，所以之後的起點是保留期內第一個整個窗口（first_window_start）。
  - 低＝最低那年 × 承接率中值；中＝平均 × 承接率中值；高＝最高那年 × 承接率高值（裁定 4）。
    規格原寫「低 0%」，會讓低值恆為 0，所以改用中值。
  - 核定名額沒填的停辦園所算不出來，略過並計數；對方沒有收費資料時價格係數取 1，也計數。

來源二：本校 6 公里內各里的在籍人數，對照距離模型「應有的人數」，3 公里內招得比應有少的部分就是還能招的空間。
  - 模型（報告 B-03 的 M1）：在籍 ~ Poisson(μ)，log μ = a + b·距離（km）+ log(2–5 歲人數)，自己寫兩參數牛頓法，不加依賴。
  - 缺口（報告 B-11）：每個 3 公里內的里 max(0, μ − θ·μ)，θ = (實際 + 5.1) ÷ (μ + 5.1)，經驗貝氏收縮讓小里的缺口不被雜訊放大。
  - 每年新生＝在籍缺口 ÷ 3（在籍約是每年新生的三倍）。
  - 中＝實際資料的缺口 ÷ 3；低／高＝以里為單位的非參數自助法的 10／90 百分位：固定種子 20261020，200 次，每次從 6 公里內
    有孩子的里有放回地抽出同樣數量的里、重新擬合，再用這組 (a, b) 對原本 3 公里內的里算缺口 ÷ 3。低／高向中值靠攏，區間永遠包住中值。
  - 不用參數化自助法（依擬合出的 μ 重抽各里在籍）：它假設模型正確，量到的是「模型為真時光靠雜訊會量到的缺口」，
    不是缺口的不確定性；實測區間又窄又常包不住實際缺口。
  - 隱私：只回距離帶彙總，不回逐里數字（details 沒有里代碼與逐里的值）；某一帶不到 3 個里時，那一帶只回里數與孩子數。"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import date

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import area
from app.admissions.enrolled.models import EnrolledRoster, EnrolledStudentPoint
from app.admissions.geo import boundaries, fees, matcher, providers
from app.admissions.geo.models import (
    VILLAGE_LEVELS,
    GeoKindergarten,
    GeoKindergartenFee,
    GeoProviderEvent,
    GeoVillagePopulation,
)
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
# 學年窗口：10/1 起算新學年；最早從 2022-10（停辦回補檔的起點，民國 111 學年）起算，之後隨事件保留期往後移。
SCHOOL_YEAR_START_MONTH = 10
FIRST_SCHOOL_YEAR = 111
RANGE_DIGITS = 1

# ---- 來源二參數（報告 B-03 M1、B-11）----

# 距離模型 log μ = a + b·距離（km）+ log(2–5 歲)；報告估計值 a ≈ −2.613、b ≈ −1.067。
KIDS_AGES = (2, 5)
VILLAGE_FIT_RADIUS_M = 6000  # 擬合用 6 km 內的里
VILLAGE_GAP_RADIUS_M = 3000  # 缺口只算 3 km 內的里
VILLAGE_SHRINK = 5.1  # 經驗貝氏收縮參數（B-11）
VILLAGE_COHORT_YEARS = 3  # 每年新生＝在籍缺口 ÷ 3（B-11 假設：每年新生約為在籍的三分之一）
# 牛頓法：最多迭代次數、步長小於這個值就算收斂、一步沒改善時最多對折幾次。
MODEL_MAX_ITERATIONS = 50
MODEL_TOLERANCE = 1e-8
MODEL_MAX_HALVINGS = 30
MODEL_DIGITS = 3  # details.model 的 a、b 四捨五入位數
# 以里為單位的自助法：固定種子、抽樣次數、成功次數至少要有幾次才給區間、低／高取的百分位。
BOOTSTRAP_SEED = 20261020
BOOTSTRAP_DRAWS = 200
BOOTSTRAP_MIN_SUCCESS = 50
BOOTSTRAP_PERCENTILES = (10, 90)
# 距離帶（上界 m，含上界；0 m 算第一帶）：畫面展開的彙總與給來源三的占有率（B-03）共用。
VILLAGE_BANDS: tuple[tuple[str, int], ...] = (("0-1", 1000), ("1-2", 2000), ("2-3", 3000))
# 一帶的里少於這個數字，彙總就等於逐里數字（報告 B-11：逐里小數能推回在籍人數），那一帶不回在籍、期望、缺口。
BAND_MIN_VILLAGES = 3


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


def _window_start(school_year: int) -> date:
    """學年窗口的第一天（10/1）。"""
    return date(school_year + 1911, SCHOOL_YEAR_START_MONTH, 1)


def _first_year(today: date) -> int:
    """第一個算進來的學年：整個窗口都還在事件保留期內（起日 ≥ 保留期的最舊一天）的最早一年，且不早於 111 學年。
    保留期滿 72 個月時，事件會從最舊的月份開始被清掉，這樣的窗口只剩一部分，不能當完整的一年算。"""
    oldest = providers.months_ago(today, providers.EVENT_RETENTION_MONTHS)
    year = school_year_window(oldest)
    if _window_start(year) < oldest:
        year += 1
    return max(year, FIRST_SCHOOL_YEAR)


def first_window_start(today: date) -> date:
    """來源一第一個窗口的第一天；呼叫端用它當 load_closure_events 的 since。"""
    return _window_start(_first_year(today))


def _complete_years(today: date) -> list[int]:
    years: list[int] = []
    year = _first_year(today)
    while _window_end(year) < today:
        years.append(year)
        year += 1
    return years


def closures_range(events: list[ClosureEvent], *, today: date) -> tuple[Range | None, dict]:
    """來源一的低／中／高，以及畫面「怎麼算」要的明細。

    沒有任何完整窗口 → None，由呼叫端標 no_data；有完整窗口但窗口內沒有事件，數字就是 0。
    details：
    - years：每個完整窗口一筆（沒停辦的窗口也列，值 0），weighted＝窗口內各事件承接率取 1 的流入加總；
    - skipped：no_capacity＝窗口內但核定名額沒填的、outside_windows＝不在任何完整窗口（進行中，或早於第一個窗口）的事件數；
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
    if not years:
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
    同一所有多筆停辦事件只取最近一筆。沒有核定名額或沒有收費的照樣載入，由 closures_range 略過或取中性係數。"""
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
    # 同一所有好幾筆停辦事件（停辦、重新營業、再停辦）只取最近一筆：同一所不重複算。
    latest: dict[str, tuple[date, GeoKindergarten, int | None]] = {}
    for occurred_on, school, their_fee in rows.all():
        if school.source_id not in latest or occurred_on > latest[school.source_id][0]:
            latest[school.source_id] = (occurred_on, school, their_fee)
    events: list[ClosureEvent] = []
    for occurred_on, school, their_fee in latest.values():
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


# ---- 來源二：現有的里還沒招到 ----


@dataclass(frozen=True)
class VillageObs:
    """一個里的觀測：code 里代碼、distance_m 里重心到本校的直線距離（不四捨五入）、kids 2–5 歲人數、enrolled 本校在籍人數。"""

    code: str
    distance_m: float
    kids: int
    enrolled: int


def _expected(item: VillageObs, a: float, b: float) -> float:
    """模型給這個里的在籍期望值 μ。"""
    return item.kids * math.exp(a + b * item.distance_m / 1000)


# 擬合用的一列：(距離 km, 2–5 歲, log(2–5 歲), 在籍)。
_FitRow = tuple[float, int, float, int]


def _poisson_loglik(rows: list[_FitRow], a: float, b: float) -> float | None:
    """Poisson 對數概似（略去與參數無關的常數項）；指數溢位或結果不是有限數回 None。"""
    total = 0.0
    try:
        for x, kids, log_kids, y in rows:
            total += y * (log_kids + a + b * x) - kids * math.exp(a + b * x)
    except OverflowError:
        return None
    return total if math.isfinite(total) else None


def _newton_step(rows: list[_FitRow], a: float, b: float) -> tuple[float, float] | None:
    """牛頓法一步：2×2 Hessian（Fisher 資訊）直接解。所有里在同一個距離（或只有一個里）時斜率估不出來，回 None。"""
    score_a = score_b = h_aa = h_ab = h_bb = 0.0
    for x, kids, _, y in rows:
        mu = kids * math.exp(a + b * x)
        residual = y - mu
        score_a += residual
        score_b += x * residual
        h_aa += mu
        h_ab += x * mu
        h_bb += x * x * mu
    det = h_aa * h_bb - h_ab * h_ab
    if not det > 1e-12 * h_aa * h_bb:  # 也擋掉 NaN
        return None
    return (h_bb * score_a - h_ab * score_b) / det, (h_aa * score_b - h_ab * score_a) / det


def fit_distance_model(obs: list[VillageObs]) -> tuple[float, float] | None:
    """Poisson 牛頓法估 (a, b)：log μ = a + b·距離（km）+ log(2–5 歲)。

    2–5 歲是 0 的里不參與。初值是 (log(總在籍 ÷ 總孩子), 0)；每步先試完整牛頓步，概似變差就對折（最多 30 次）；
    步長小於 1e-8 算收斂，50 次還沒收斂（例如在籍全擠在一個里，估計值要跑到無限遠才擬合得上）、概似溢位或
    出現 NaN 都回 None；總在籍 0 或沒有任何里也是 None。"""
    rows: list[_FitRow] = [
        (item.distance_m / 1000, item.kids, math.log(item.kids), item.enrolled) for item in obs if item.kids > 0
    ]
    total_enrolled = sum(row[3] for row in rows)
    if total_enrolled <= 0:
        return None
    a, b = math.log(total_enrolled / sum(row[1] for row in rows)), 0.0
    loglik = _poisson_loglik(rows, a, b)
    for _ in range(MODEL_MAX_ITERATIONS):
        step = _newton_step(rows, a, b) if loglik is not None else None
        if step is None:
            return None
        da, db = step
        if max(abs(da), abs(db)) < MODEL_TOLERANCE:
            a, b = a + da, b + db
            return (a, b) if math.isfinite(a) and math.isfinite(b) else None
        scale = 1.0
        for _ in range(MODEL_MAX_HALVINGS):
            candidate = _poisson_loglik(rows, a + scale * da, b + scale * db)
            # 容許浮點誤差等級的退步：接近最佳解時概似的變化小於浮點精度，嚴格要求進步會誤判成失敗。
            if candidate is not None and candidate >= loglik - 1e-9 * max(1.0, abs(loglik)):
                break
            scale /= 2
        else:
            return None
        a, b, loglik = a + scale * da, b + scale * db, candidate
    return None


def village_gaps(
    obs: list[VillageObs], a: float, b: float, *, radius_m: float = VILLAGE_GAP_RADIUS_M, shrink: float = VILLAGE_SHRINK
) -> float:
    """半徑內在籍缺口的總和：每個里 max(0, μ − θ·μ)，θ = (實際 + shrink) ÷ (μ + shrink)（報告 B-11 經驗貝氏收縮）。

    期望值小的里，實際只差一兩位就是雜訊，θ 被拉向 1、缺口縮小；期望值大的里幾乎不受影響。
    招得比期望多的里缺口是 0，不抵銷別的里。"""
    total = 0.0
    for item in obs:
        if item.kids <= 0 or item.distance_m > radius_m:
            continue
        mu = _expected(item, a, b)
        if mu <= 0:
            continue
        theta = (item.enrolled + shrink) / (mu + shrink)
        total += max(0.0, mu - theta * mu)
    return total


def _percentile(ordered: list[float], percent: float) -> float:
    """已排序資料的線性內插百分位（同 numpy 預設）。"""
    position = (len(ordered) - 1) * percent / 100
    lower, upper = math.floor(position), math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _band_of(distance_m: float, bands: tuple[tuple[str, int], ...]) -> str | None:
    """距離落在哪一帶；帶界含上界，超過最後一帶是 None。"""
    for key, upper in bands:
        if distance_m <= upper:
            return key
    return None


def _village_bands(obs: list[VillageObs], a: float, b: float) -> list[dict]:
    """畫面展開的距離帶彙總：里數、2–5 歲、在籍、期望、在籍缺口（還沒 ÷ 3）。只彙總，不留逐里的值。
    里數不到 BAND_MIN_VILLAGES 的帶，在籍、期望、缺口是 None（只剩里數與孩子數）。"""
    rows = {key: {"band": key, "villages": 0, "kids": 0, "enrolled": 0, "expected": 0.0, "gap": 0.0} for key, _ in VILLAGE_BANDS}
    for item in obs:
        key = _band_of(item.distance_m, VILLAGE_BANDS)
        if key is None:
            continue
        row = rows[key]
        row["villages"] += 1
        row["kids"] += item.kids
        row["enrolled"] += item.enrolled
        row["expected"] += _expected(item, a, b)
        row["gap"] += village_gaps([item], a, b, radius_m=VILLAGE_BANDS[-1][1])
    for row in rows.values():
        if row["villages"] < BAND_MIN_VILLAGES:
            row["enrolled"] = row["expected"] = row["gap"] = None
        else:
            row["expected"] = round(row["expected"], RANGE_DIGITS)
            row["gap"] = round(row["gap"], RANGE_DIGITS)
    return list(rows.values())


def villages_range(
    obs: list[VillageObs], *, seed: int = BOOTSTRAP_SEED, draws: int = BOOTSTRAP_DRAWS
) -> tuple[Range | None, dict]:
    """來源二的低／中／高，以及畫面「怎麼算」要的距離帶彙總。

    中＝實際資料擬合一次的缺口 ÷ 3。低／高＝以里為單位的非參數自助法的 10／90 百分位：每次從 obs 裡有孩子的里
    有放回地抽出同樣數量的里，重新擬合（失敗就略過），再用這組 (a, b) 對原本的里算缺口 ÷ 3，共 draws 次，
    亂數是 random.Random(seed)；成功不到 50 次不給區間。重抽里反映「換一批里會估出怎樣的距離曲線、缺口跟著變多少」。
    不用參數化自助法（依擬合出的 μ 重抽各里在籍）：它假設模型正確，量到的是模型為真時光靠雜訊會量到的缺口，
    不是缺口的不確定性。低／高仍取 min(P10, 中)、max(P90, 中)，區間永遠包住中值。
    模型擬合不出來（沒有在籍、全在同一個距離、估計值跑到無限遠…）回 (None, {"bands": [], "model": None})。
    details 只有 bands（0-1、1-2、2-3 km 三個距離帶，不到 3 個里的帶只回里數與孩子數）與 model（a、b），
    沒有里代碼，也沒有逐里的數字。"""
    obs = sorted(obs, key=lambda item: item.code)  # 抽樣的順序不受資料列順序影響
    model = fit_distance_model(obs)
    if model is None:
        return None, {"bands": [], "model": None}
    a, b = model
    details = {
        "bands": _village_bands(obs, a, b),
        "model": {"a": round(a, MODEL_DIGITS), "b": round(b, MODEL_DIGITS)},
    }
    mid = village_gaps(obs, a, b) / VILLAGE_COHORT_YEARS
    rng = random.Random(seed)
    pool = [item for item in obs if item.kids > 0]
    gaps: list[float] = []
    for _ in range(draws):
        refit = fit_distance_model(rng.choices(pool, k=len(pool)))
        if refit is not None:
            gaps.append(village_gaps(obs, *refit) / VILLAGE_COHORT_YEARS)
    if len(gaps) < BOOTSTRAP_MIN_SUCCESS:
        return None, details
    gaps.sort()
    low, high = (_percentile(gaps, percent) for percent in BOOTSTRAP_PERCENTILES)
    return Range(low=min(low, mid), mid=mid, high=max(high, mid)), details


def band_shares(obs: list[VillageObs]) -> dict[str, float]:
    """0–1、1–2、2–3 km 三帶各自的占有率＝在籍 ÷ 2–5 歲（報告 B-03），給來源三用。
    帶界含上界；3 km 外不算；那一帶沒有孩子（或沒有里）是 0.0。"""
    kids = {key: 0 for key, _ in VILLAGE_BANDS}
    enrolled = {key: 0 for key, _ in VILLAGE_BANDS}
    for item in obs:
        key = _band_of(item.distance_m, VILLAGE_BANDS)
        if key is not None:
            kids[key] += item.kids
            enrolled[key] += item.enrolled
    return {key: enrolled[key] / kids[key] if kids[key] > 0 else 0.0 for key in kids}


async def load_village_obs(
    db: AsyncSession, campus_key: str, lat: float, lng: float, *, radius_m: float = VILLAGE_FIT_RADIUS_M
) -> list[VillageObs] | None:
    """(lat, lng) radius_m 內各里的觀測；這一校沒有匯入過在籍清冊回 None。

    孩子數取 geo_village_population（只存使用中的月份）的 2–5 歲加總，距離是里重心到 (lat, lng) 的直線距離。
    在籍數沿用在籍分布的口徑：比對到里的點（exact／nearby／street）依 (區, 里) 計數，再用里界檔對到里代碼，
    對不到的不算。人口表有的里都列出，沒有在籍的里在籍是 0（擬合需要這些 0）；人口表沒有的里沒有孩子數可除，不列。
    結果依里代碼排序。"""
    if await db.get(EnrolledRoster, campus_key) is None:
        return None
    counted = await db.execute(
        select(EnrolledStudentPoint.district, EnrolledStudentPoint.village, func.count())
        .where(
            EnrolledStudentPoint.campus_key == campus_key,
            EnrolledStudentPoint.match_level.in_(VILLAGE_LEVELS),
            EnrolledStudentPoint.district.is_not(None),
            EnrolledStudentPoint.village.is_not(None),
        )
        .group_by(EnrolledStudentPoint.district, EnrolledStudentPoint.village)
    )
    enrolled: dict[str, int] = {}
    for district, village, count in counted.all():
        code = boundaries.village_code(district, village) if district and village else None
        if code is not None:
            enrolled[code] = enrolled.get(code, 0) + count
    centroids = boundaries.village_centroids()
    population = (await db.execute(select(GeoVillagePopulation))).scalars().all()
    obs: list[VillageObs] = []
    for row in population:
        centroid = centroids.get(row.village_code)
        if centroid is None:
            continue
        distance = haversine_m(lat, lng, *centroid)
        if distance > radius_m:
            continue
        kids = sum(getattr(row, f"age_{age}") for age in range(KIDS_AGES[0], KIDS_AGES[1] + 1))
        obs.append(VillageObs(row.village_code, distance, kids, enrolled.get(row.village_code, 0)))
    obs.sort(key=lambda item: item.code)
    return obs
