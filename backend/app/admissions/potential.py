"""招生潛力：每年還能多招幾位新生的三個來源（2026-10-20 招生潛力第二、三波規格 §5，報告 A-07、B-03、B-06、B-11、I-4）。

這個檔放常數、Range、來源一「附近園所停辦釋出」、來源二「現有的里還沒招到」、來源三「新建案搬進來」，以及把三個來源組成 API 回應的
query_potential。所有參數都在下面的常數，畫面「怎麼算」照列；這一版不開放後台修改。

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
  - 資料太少不估：有孩子的里不到 20 個或在籍不到 30 位，來源二沒有數字（重抽里的區間在這種資料量下是外插）。
  - 隱私：只回距離帶彙總，不回逐里數字（details 沒有里代碼與逐里的值）；有一帶有孩子的里不到 3 個時，三帶都只回里數與孩子數。

來源三：本校 3 公里內「在建」的預售建案，預計交屋落在「今天到下一個 8/31」的，住進來的孩子數（報告 B-06）。
  - 建案清單與預計交屋沿用預售建案那一案的規則（trends.building_cases 篩在建、presale.expected_delivery 估交屋日），
    這裡不另寫；已過預計交屋時間但還沒登記的也算進來，因為很可能就在這一年內交屋（裁定 7）。
  - 孩子數＝戶數 × 每百戶 2–5 歲孩子（低 2.5、中 4.0、高 6.0）÷ 100 × 該案所在距離帶的占有率；占有率用來源二的
    band_shares（0–1、1–2、2–3 km：在籍 ÷ 2–5 歲），也就是新搬來的孩子跟附近現有的孩子一樣的機率進本校。
  - 距離：有座標用座標，否則用里重心（同預售建案那一案）；只算 3 km 內。
  - 隱私：details 每案只列案名、戶數、預計交屋年與半年、距離（取整 100 m）、中值貢獻與是否已過預計交屋時間，不放占有率原值；
    來源二把距離帶藏起來時，呼叫端傳 include_mid=False，連單案中值貢獻（可反推占有率）也不回。

組裝（query_potential）：
  - 三個來源固定順序（closures、villages、presale），各自 ok／no_data：沒有資料的來源不給數字，附一句原因 reason；
    總數只加 ok 的來源，included 列出加了哪些，三個都 no_data 則 total 是 None。
  - 來源一 no_data＝幼兒園資料集從沒同步過，或沒有任何完整的學年窗口（同步過、窗口也完整、只是附近沒停辦＝ok 且是 0）。
  - 來源二 no_data＝沒有在籍清冊，或資料太少／擬合不出距離模型。來源三的占有率來自來源二，所以來源二 no_data 時來源三也 no_data；
    預售建案表是空的（沒匯入過）也 no_data，匯入了但 3 km 內沒有在建案＝ok 且是 0。
  - 隱私：band_shares 的原值絕不放進回應（assumptions 只描述怎麼來，不寫數值）；來源二把距離帶藏起來時，來源三逐案的中值貢獻也不回。
  - 本校空位＝本校核定名額（座標 50 m 內最近營業中園所，同 fees.own_fee）− 最近一次在籍清冊人數，不小於 0；
    沒有清冊或沒有核定名額就是 None。
  - events＝本校 3 km 內、起點（first_window_start）以來的停辦園所，供走勢圖標記；school_year 是來源一的學年窗口（10 月到隔年 9 月）。
  - query_potential 任何例外由路由記錄後改用 degraded_potential：三個來源都 no_data、沒有總數與空位、沒有事件，市佔率不受影響。"""

from __future__ import annotations

import asyncio
import math
import random
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import area
from app.admissions.enrolled.models import EnrolledRoster, EnrolledStudentPoint
from app.admissions.geo import boundaries, fees, matcher, providers
from app.admissions.geo import presale as presale_io
from app.admissions.geo.models import (
    PRESALE_VILLAGE_LEVELS,
    VILLAGE_LEVELS,
    GeoDatasetStatus,
    GeoKindergarten,
    GeoKindergartenFee,
    GeoPresaleBuildcase,
    GeoProviderEvent,
    GeoVillagePopulation,
)
from app.admissions.geo.projection import haversine_m
from app.admissions.presale_area import DISTANCE_ROUND_M
from app.admissions.trends import building_cases
from app.common.timezones import today_local

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
# 資料太少不估：有 2–5 歲孩子的里至少幾個、在籍至少幾位（報告也以 30 筆為可判讀下限）。
MIN_FIT_VILLAGES = 20
MIN_FIT_ENROLLED = 30
# 距離帶（上界 m，含上界；0 m 算第一帶）：畫面展開的彙總與給來源三的占有率（B-03）共用。
VILLAGE_BANDS: tuple[tuple[str, int], ...] = (("0-1", 1000), ("1-2", 2000), ("2-3", 3000))
# 有一帶「有 2–5 歲孩子的里」少於這個數字，彙總就等於逐里數字（報告 B-11：逐里小數能推回在籍人數），三帶都不回在籍、期望、缺口。
BAND_MIN_VILLAGES = 3

# ---- 來源三參數（報告 B-06）----

# 每百戶 2–5 歲孩子（低、中、高）。
KIDS_PER_100_HOUSEHOLDS = (2.5, 4.0, 6.0)
DELIVERY_RADIUS_M = VILLAGE_BANDS[-1][1]  # 只算 3 km 內（占有率只有到 3 km 的三帶）
INTAKE_START_MONTH = 9  # 新學年 9/1 開學：交屋在下一個 9/1 之前的案，這一年內有機會入學
DELIVERY_DIGITS = 2  # details 每案中值貢獻的小數位數（單案常小於 0.1）

# ---- 組裝參數 ----

SOURCE_KEYS = ("closures", "villages", "presale")  # API 回應固定三筆、固定順序
EVENT_LIST_RADIUS_M = VILLAGE_BANDS[-1][1]  # 走勢圖的停辦標記只列 3 km 內
CLOSURE_DATASET = "kindergartens"
# no_data 的原因（畫面直接顯示）。
REASON_NO_CLOSURES = "沒有停辦紀錄"
REASON_NO_ROSTER = "沒有在籍清冊"
REASON_NO_PRESALE = "沒有預售資料"
REASON_FEW_VILLAGES = "附近有孩子的里太少"
REASON_FEW_ENROLLED = "在籍人數太少"
REASON_NO_MODEL = "算不出距離曲線"
REASON_NO_POINT = "校址還沒定位"
REASON_UNAVAILABLE = "這一項暫時算不出來"  # query_potential 出錯的降級回應（degraded_potential）


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
    """模型給這個里的在籍期望值 μ；沒有 2–5 歲孩子的里是 0（不算指數，也就不會溢位）。"""
    if item.kids <= 0:
        return 0.0
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


def _checked_gap(obs: list[VillageObs], a: float, b: float) -> float | None:
    """village_gaps 的安全版：指數溢位或結果不是有限數回 None。
    重抽里擬合出的 (a, b) 套回沒被抽到的里可能離譜（例如只抽到近處的里，斜率估得很陡），exp 會溢位。"""
    try:
        gap = village_gaps(obs, a, b)
    except OverflowError:
        return None
    return gap if math.isfinite(gap) else None


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
    只要有一帶「有 2–5 歲孩子的里」不到 BAND_MIN_VILLAGES 個，三帶的在籍、期望、缺口都是 None（只剩里數與孩子數）：
    薄的那一帶等於逐里數字，只藏那一帶的話，用總和減其他帶還是推得回來。"""
    rows = {key: {"band": key, "villages": 0, "kids": 0, "enrolled": 0, "expected": 0.0, "gap": 0.0} for key, _ in VILLAGE_BANDS}
    with_children = {key: 0 for key, _ in VILLAGE_BANDS}
    for item in obs:
        key = _band_of(item.distance_m, VILLAGE_BANDS)
        if key is None:
            continue
        row = rows[key]
        row["villages"] += 1
        with_children[key] += item.kids > 0
        row["kids"] += item.kids
        row["enrolled"] += item.enrolled
        row["expected"] += _expected(item, a, b)
        row["gap"] += village_gaps([item], a, b, radius_m=VILLAGE_BANDS[-1][1])
    hide = any(count < BAND_MIN_VILLAGES for count in with_children.values())
    for row in rows.values():
        if hide:
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
    有放回地抽出同樣數量的里，重新擬合，再用這組 (a, b) 對原本的里算缺口 ÷ 3，共 draws 次，
    亂數是 random.Random(seed)；擬合失敗、缺口溢位或不是有限數的那一次略過，成功不到 50 次不給區間。重抽里反映「換一批里會估出怎樣的距離曲線、缺口跟著變多少」。
    不用參數化自助法（依擬合出的 μ 重抽各里在籍）：它假設模型正確，量到的是模型為真時光靠雜訊會量到的缺口，
    不是缺口的不確定性。低／高仍取 min(P10, 中)、max(P90, 中)，區間永遠包住中值。
    資料太少不估：有 2–5 歲孩子的里不到 MIN_FIT_VILLAGES（20）個，或在籍總和不到 MIN_FIT_ENROLLED（30）位，
    一律回 (None, {"bands": [], "model": None})。理由：里太少、在籍太少時，重抽里會常常抽不到某些距離，
    擬合出的斜率不穩，自助法的區間是外插出來的數字（實測 8 個里會得到高值 7332 這種沒意義的區間），
    而且報告也以 30 筆為可判讀下限。
    模型擬合不出來（沒有在籍、全在同一個距離、估計值跑到無限遠…），或實際資料的缺口算不出來（溢位），
    也回同樣的 (None, {"bands": [], "model": None})。
    details 只有 bands（0-1、1-2、2-3 km 三個距離帶；有一帶有孩子的里不到 3 個，三帶都只回里數與孩子數）
    與 model（a、b），沒有里代碼，也沒有逐里的數字。"""
    if sum(item.kids > 0 for item in obs) < MIN_FIT_VILLAGES or sum(item.enrolled for item in obs) < MIN_FIT_ENROLLED:
        return None, {"bands": [], "model": None}
    obs = sorted(obs, key=lambda item: item.code)  # 抽樣的順序不受資料列順序影響
    model = fit_distance_model(obs)
    if model is None:
        return None, {"bands": [], "model": None}
    a, b = model
    point = _checked_gap(obs, a, b)
    if point is None:
        return None, {"bands": [], "model": None}
    mid = point / VILLAGE_COHORT_YEARS
    details = {
        "bands": _village_bands(obs, a, b),
        "model": {"a": round(a, MODEL_DIGITS), "b": round(b, MODEL_DIGITS)},
    }
    rng = random.Random(seed)
    pool = [item for item in obs if item.kids > 0]
    gaps: list[float] = []
    for _ in range(draws):
        refit = fit_distance_model(rng.choices(pool, k=len(pool)))
        gap = _checked_gap(obs, *refit) if refit is not None else None
        if gap is not None:
            gaps.append(gap / VILLAGE_COHORT_YEARS)
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


# ---- 來源三：新建案搬進來 ----


@dataclass(frozen=True)
class Delivery:
    """一個在建的預售建案：name 案名、households 戶數、distance_m 到本校的直線距離（有座標用座標，否則里重心；不四捨五入）、
    expected 預計交屋日（建照日加依戶數的月數，粗估；已過預計時間還沒登記的也是這個日期，早於今天）。"""

    name: str
    households: int
    distance_m: float
    expected: date


def next_school_year_start(today: date) -> date:
    """下一個 9 月 1 日；今天是 9/1 時取明年（交屋早於這一天的案，這一學年內有機會搬進來）。"""
    this_year = date(today.year, INTAKE_START_MONTH, 1)
    return this_year if today < this_year else date(today.year + 1, INTAKE_START_MONTH, 1)


def _round_distance(meters: float) -> int:
    return int(round(meters / DISTANCE_ROUND_M) * DISTANCE_ROUND_M)


def presale_range(
    deliveries: list[Delivery], shares: dict[str, float], *, today: date, include_mid: bool = True
) -> tuple[Range, dict]:
    """來源三的低／中／高，以及畫面「怎麼算」要的逐案明細。

    只取預計交屋早於 next_school_year_start(today) 的案（含已過預計時間、還沒登記的）；距離超過 3 km 的案沒有占有率，不算。
    每案的孩子數＝戶數 × 每百戶孩子數（低 2.5、中 4.0、高 6.0）÷ 100 × 該案距離帶的占有率（shares 的鍵 "0-1"、"1-2"、"2-3"，缺的帶當 0）。
    沒有任何符合的案，數字就是 0（資料有沒有由呼叫端看 load_deliveries 是否為 None）。
    details.deliveries 每案只有 name、households、expected_year、expected_half（1 上半年／2 下半年）、distance_m（取整 100）、
    mid（中值貢獻，2 位小數）、overdue（預計交屋早於今天，還沒登記）；不放占有率原值，依預計交屋、距離、案名排序。
    include_mid=False 時每案的 mid 是 None（數字照算）：單案 mid 加戶數可以反推該帶占有率，來源二把距離帶藏起來時
    （里太少，帶的數字等於逐里數字），呼叫端要傳 False，不然占有率會從這裡洩出去。"""
    cutoff = next_school_year_start(today)
    totals = [0.0] * len(KIDS_PER_100_HOUSEHOLDS)
    listed: list[dict] = []
    for item in sorted(deliveries, key=lambda row: (row.expected, row.distance_m, row.name)):
        band = _band_of(item.distance_m, VILLAGE_BANDS)
        if item.expected >= cutoff or band is None:
            continue
        contributions = [
            item.households * per_100 / 100 * shares.get(band, 0.0) for per_100 in KIDS_PER_100_HOUSEHOLDS
        ]
        totals = [total + value for total, value in zip(totals, contributions)]
        year, half = presale_io.delivery_half(item.expected)
        listed.append(
            {
                "name": item.name, "households": item.households, "expected_year": year, "expected_half": half,
                "distance_m": _round_distance(item.distance_m),
                "mid": round(contributions[1], DELIVERY_DIGITS) if include_mid else None,
                "overdue": item.expected < today,
            }
        )
    low, mid, high = totals
    return Range(low=low, mid=mid, high=high), {"deliveries": listed}


async def load_deliveries(
    db: AsyncSession, lat: float, lng: float, *, today: date, radius_m: float = DELIVERY_RADIUS_M
) -> list[Delivery] | None:
    """(lat, lng) radius_m 內、在建的預售建案；預售建案表是空的（還沒匯入過）回 None，匯入了但半徑內沒有在建案回 []。

    「在建」與預計交屋沿用預售建案那一案：trends.building_cases 篩住宅、沒登記、建照 6 年內的案（只讀半徑內有里的區），
    presale.expected_delivery 估交屋日。有座標（parcel、exact、nearby）用座標到 (lat, lng) 的直線距離，只到里（street）用里界重心；
    只到區、待比對的案沒有位置，不列。預計交屋不在這裡篩，presale_range 才依今天切一年。結果依預計交屋、距離、案名排序。"""
    if (await db.execute(select(GeoPresaleBuildcase.name).limit(1))).first() is None:
        return None
    names = boundaries.village_names()
    centroids = boundaries.village_centroids()
    districts = {
        names[code][0]
        for code, point in centroids.items()
        if code in names and haversine_m(lat, lng, *point) <= radius_m
    }
    deliveries: list[Delivery] = []
    for case in await building_cases(db, districts, today):
        if case.match_level not in PRESALE_VILLAGE_LEVELS or case.village_code not in names:
            continue
        point = (case.lat, case.lon) if case.lat is not None and case.lon is not None else centroids.get(case.village_code)
        if point is None:  # 里名單有這個里、里界重心沒有（兩份資料不同步）：沒有位置可量距離，不列
            continue
        distance = haversine_m(lat, lng, *point)
        if distance > radius_m:
            continue
        deliveries.append(
            Delivery(
                name=case.name, households=case.households, distance_m=distance,
                expected=presale_io.expected_delivery(case.permit_on, case.households),
            )
        )
    deliveries.sort(key=lambda item: (item.expected, item.distance_m, item.name))
    return deliveries


# ---- 組裝：三個來源、空位與停辦事件 ----


def _num(value: float) -> str:
    return f"{value:g}"


def _percent(rate: float) -> str:
    return f"{rate * 100:.1f}%"


def _distance_text() -> str:
    parts: list[str] = []
    lower = 0
    for upper, weight in DISTANCE_BANDS:
        parts.append(f"{_num(lower / 1000)}–{_num(upper / 1000)} km {_num(weight)}")
        lower = upper
    return "、".join(parts) + f"、{_num(lower / 1000)} km 外不算"


def _closure_assumptions(today: date, details: dict | None) -> list[dict]:
    """來源一的「怎麼算」：參數與出處。details 只在算出數字時給，多列被略過與取中性係數的園所數。"""
    years = _complete_years(today)
    since = first_window_start(today)  # 事件只保留 72 個月，起點會隨年份往後移
    low_price, high_price = (_num(percent / 100) for percent in PRICE_SIMILAR_PERCENT)
    window = (
        f"學年窗口（10/1 到隔年 9/30）：{years[0]}–{years[-1]} 學年共 {len(years)} 年，進行中的不算"
        if years
        else "還沒有完整的學年窗口"
    )
    rows = [
        ("承接率", f"中 {_percent(CATCH_RATE_MID)}、高 {_percent(CATCH_RATE_HIGH)}（只有童年綠地、愛爾蘭兩次停辦可校準）"),
        ("實收率", f"{OCCUPANCY_RATE}（全市 114 學年核定與幼生比）"),
        ("畢業比例", f"{GRADUATING_SHARE}（大班不轉園）"),
        ("距離係數", _distance_text()),
        (
            "價格係數",
            f"本校 {PRICE_FEE_AGE} 歲一學期收費 ÷ 對方：{low_price}–{high_price} 倍 {_num(PRICE_FACTOR_SIMILAR)}、"
            f"不到 {low_price} 倍 {_num(PRICE_FACTOR_THEY_ARE_PRICEY)}、"
            f"{high_price}–{_num(PRICE_MODERATE_MAX_PERCENT / 100)} 倍 {_num(PRICE_FACTOR_MODERATE)}、"
            f"超過 {_num(PRICE_MODERATE_MAX_PERCENT / 100)} 倍 {_num(PRICE_FACTOR_FAR_ABOVE)}；"
            f"公幼、非營利、準公共 {_num(PRICE_FACTOR_PUBLIC)}；對方沒有收費資料取 {_num(PRICE_FACTOR_SIMILAR)}",
        ),
        ("統計窗口", window),
        ("停辦日期", "園所離開教育部名單的那天；名單消失日不等於實際停收日"),
        ("怎麼看這個數字", f"{since.year} 年 {since.month} 月以來各學年的平均，不是預測下一所會停辦"),
        ("低、中、高", "低＝最低那年 × 承接率中值；中＝各年平均 × 承接率中值；高＝最高那年 × 承接率高值"),
        ("排除", f"本校與五校校址 {area.OWN_CAMPUS_RADIUS_M} m 內的園所"),
        ("沒有計入", "園所是否連鎖（類型係數）與老師帶班：公開資料看不出來，也無法預期"),
    ]
    if details is not None:
        rows += [
            ("核定名額沒填", f"{details['skipped']['no_capacity']} 所（算不出來，略過）"),
            ("不在完整窗口", f"{details['skipped']['outside_windows']} 所（進行中的學年或更早，不算）"),
            ("沒有收費資料", f"{details['price_unknown']} 所（價格係數取 {_num(PRICE_FACTOR_SIMILAR)}）"),
        ]
    return [{"label": label, "value": value} for label, value in rows]


def _village_assumptions() -> list[dict]:
    low, high = BOOTSTRAP_PERCENTILES
    rows = [
        (
            "模型",
            f"在籍 ~ Poisson(μ)，log μ = a + b × 距離（km）+ log(2–5 歲人數)；a、b 用本校 {_num(VILLAGE_FIT_RADIUS_M / 1000)} 公里內各里擬合（報告 B-03）",
        ),
        (
            "缺口",
            f"{_num(VILLAGE_GAP_RADIUS_M / 1000)} 公里內每個里 μ − θ × μ（招得比期望多的算 0），"
            f"θ = (實際 + {VILLAGE_SHRINK}) ÷ (μ + {VILLAGE_SHRINK})，小里的缺口不被雜訊放大（報告 B-11）",
        ),
        ("每年新生", f"在籍缺口 ÷ {VILLAGE_COHORT_YEARS}（在籍約是每年新生的 {VILLAGE_COHORT_YEARS} 倍）"),
        (
            "低、高",
            f"以里為單位重抽 {BOOTSTRAP_DRAWS} 次的 {low}、{high} 百分位（固定種子 {BOOTSTRAP_SEED}）；中是實際資料的缺口",
        ),
        ("資料門檻", f"有 2–5 歲孩子的里至少 {MIN_FIT_VILLAGES} 個、在籍至少 {MIN_FIT_ENROLLED} 位，不足不估"),
        (
            "距離帶",
            f"只回 0–1、1–2、2–3 km 的彙總；有一帶有孩子的里不到 {BAND_MIN_VILLAGES} 個，三帶都不回在籍、期望與缺口",
        ),
    ]
    return [{"label": label, "value": value} for label, value in rows]


def _presale_assumptions(today: date) -> list[dict]:
    low, mid, high = (f"{value:.1f}" for value in KIDS_PER_100_HOUSEHOLDS)
    through = next_school_year_start(today) - timedelta(days=1)
    rows = [
        ("每百戶 2–5 歲孩子", f"低 {low}、中 {mid}、高 {high} 人（報告 B-06）"),
        ("進本校的機率", "新搬來的孩子跟附近現有的孩子一樣：用來源二各距離帶（0–1、1–2、2–3 km）的占有率（在籍 ÷ 2–5 歲）"),
        (
            "算進哪些案",
            f"{_num(DELIVERY_RADIUS_M / 1000)} km 內在建的預售建案，預計交屋在今天到 {through.isoformat()} 之間（含已過預計時間、還沒登記的）",
        ),
        ("預計交屋", "建照日加上依戶數估的月數，粗估，只到上下半年"),
        ("距離", "有座標用座標，否則用里重心"),
    ]
    return [{"label": label, "value": value} for label, value in rows]


def _assumptions(key: str, today: date, details: dict | None = None) -> list[dict]:
    if key == "closures":
        return _closure_assumptions(today, details)
    return _village_assumptions() if key == "villages" else _presale_assumptions(today)


def _empty_details(key: str) -> dict:
    if key == "closures":
        return {"years": [], "skipped": {"no_capacity": 0, "outside_windows": 0}, "price_unknown": 0, "events": []}
    return {"bands": [], "model": None} if key == "villages" else {"deliveries": []}


def _no_data(key: str, reason: str, today: date) -> dict:
    return {
        "key": key, "status": "no_data", "low": None, "mid": None, "high": None, "reason": reason,
        "assumptions": _assumptions(key, today), "details": _empty_details(key),
    }


def _ok(key: str, result: Range, details: dict, today: date) -> dict:
    return {
        "key": key, "status": "ok", "low": result.low, "mid": result.mid, "high": result.high, "reason": None,
        "assumptions": _assumptions(key, today, details if key == "closures" else None), "details": details,
    }


def _event_marks(events: list[ClosureEvent]) -> list[dict]:
    """走勢圖的停辦標記：EVENT_LIST_RADIUS_M 內的停辦園所（核定名額沒填的也列），依日期排序。"""
    return [
        {
            "occurred_on": event.occurred_on, "name": event.name, "approved_capacity": event.approved_capacity,
            "distance_m": int(round(event.distance_m)), "school_year": school_year_window(event.occurred_on),
        }
        for event in events
        if event.distance_m <= EVENT_LIST_RADIUS_M
    ]


async def _closures_source(db: AsyncSession, lat: float, lng: float, today: date) -> tuple[dict, list[dict]]:
    """來源一與停辦標記。幼兒園資料集從沒同步過 → no_data（空事件不代表附近沒停辦，只是還沒有紀錄）。"""
    status = await db.get(GeoDatasetStatus, CLOSURE_DATASET)
    if status is None or status.synced_at is None:
        return _no_data("closures", REASON_NO_CLOSURES, today), []
    events = await load_closure_events(db, lat, lng, since=first_window_start(today), today=today)
    result, details = closures_range(events, today=today)
    if result is None:
        return _no_data("closures", REASON_NO_CLOSURES, today), _event_marks(events)
    return _ok("closures", result, details, today), _event_marks(events)


def _villages_reason(obs: list[VillageObs]) -> str:
    """villages_range 沒給數字的原因：和它的門檻同一套判斷，其餘就是模型擬合不出來。"""
    if sum(item.kids > 0 for item in obs) < MIN_FIT_VILLAGES:
        return REASON_FEW_VILLAGES
    if sum(item.enrolled for item in obs) < MIN_FIT_ENROLLED:
        return REASON_FEW_ENROLLED
    return REASON_NO_MODEL


async def _villages_source(
    db: AsyncSession, campus_key: str, lat: float, lng: float, today: date
) -> tuple[dict, dict[str, float] | None, bool]:
    """來源二，加上給來源三的占有率（算不出來是 None）與距離帶是否被藏起來。"""
    obs = await load_village_obs(db, campus_key, lat, lng)
    if obs is None:
        return _no_data("villages", REASON_NO_ROSTER, today), None, False
    # 兩參數牛頓法加 200 次重抽擬合是純 CPU 計算，放進執行緒，不卡住事件迴圈上的其他請求
    result, details = await asyncio.to_thread(villages_range, obs)
    if result is None:
        return _no_data("villages", _villages_reason(obs), today), None, False
    hidden = any(band["enrolled"] is None for band in details["bands"])
    return _ok("villages", result, details, today), band_shares(obs), hidden


async def _presale_source(
    db: AsyncSession, lat: float, lng: float, today: date, villages: dict, shares: dict[str, float] | None, hidden: bool
) -> dict:
    """來源三。占有率來自來源二：來源二沒有數字就沒有占有率可用，原因照來源二。"""
    if shares is None:
        return _no_data("presale", villages["reason"], today)
    deliveries = await load_deliveries(db, lat, lng, today=today)
    if deliveries is None:
        return _no_data("presale", REASON_NO_PRESALE, today)
    result, details = presale_range(deliveries, shares, today=today, include_mid=not hidden)
    return _ok("presale", result, details, today)


async def _capacity(db: AsyncSession, campus_key: str, lat: float, lng: float) -> dict | None:
    """本校核定名額、最近一次清冊的在籍人數與空位；任一邊沒有（或核定不是正數）回 None。"""
    roster = await db.get(EnrolledRoster, campus_key)
    if roster is None:
        return None
    school, _ = await fees.own_fee(db, lat, lng, age=PRICE_FEE_AGE, radius_m=area.OWN_CAMPUS_RADIUS_M)
    approved = school.approved_capacity if school is not None else None
    if approved is None or approved <= 0:
        return None
    return {"approved": approved, "enrolled": roster.total, "open": max(0, approved - roster.total)}


def _total(sources: list[dict]) -> dict | None:
    """只加 ok 的來源；沒有任何 ok 的來源就沒有總數。"""
    counted = [source for source in sources if source["status"] == "ok"]
    if not counted:
        return None
    total: dict = {name: round(sum(source[name] for source in counted), RANGE_DIGITS) for name in ("low", "mid", "high")}
    total["included"] = [source["key"] for source in counted]
    return total


def degraded_potential(today: date | None = None) -> dict:
    """query_potential 出錯時的降級回應（路由記錄例外後改用這個）：三個來源都 no_data、沒有總數與空位、沒有停辦事件，
    讓同一個 API 的市佔率照常顯示；status 仍是 ready，原因寫在每個來源的 reason。"""
    today = today or today_local()
    return {
        "status": "ready", "sources": [_no_data(key, REASON_UNAVAILABLE, today) for key in SOURCE_KEYS],
        "total": None, "capacity": None, "events": [],
    }


async def query_potential(db: AsyncSession, campus_key: str, *, today: date | None = None) -> dict:
    """某校每年還能多招的人數：三個來源、總數、本校空位與 3 km 內的停辦事件（組裝規則見模組說明）。
    status：ready，或 no_campus_point＝校址對不到座標（三個來源都 no_data）。today 不給就取台北今天。"""
    today = today or today_local()
    point = await matcher.campus_point(db, campus_key)
    if point.locate_error is not None or point.lat is None or point.lng is None:
        sources = [_no_data(key, REASON_NO_POINT, today) for key in SOURCE_KEYS]
        return {"status": "no_campus_point", "sources": sources, "total": None, "capacity": None, "events": []}
    lat, lng = point.lat, point.lng
    closures, events = await _closures_source(db, lat, lng, today)
    villages, shares, hidden = await _villages_source(db, campus_key, lat, lng, today)
    presale = await _presale_source(db, lat, lng, today, villages, shares, hidden)
    sources = [closures, villages, presale]
    return {
        "status": "ready", "sources": sources, "total": _total(sources),
        "capacity": await _capacity(db, campus_key, lat, lng), "events": events,
    }
