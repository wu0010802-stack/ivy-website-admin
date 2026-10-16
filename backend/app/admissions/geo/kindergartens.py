"""幼兒園公開資料：kiang 整理的全國教保資訊網 preschools.json（規格 §4、§5.2）。

只留高雄市、**在教育部名單上**的園所（2026-10-15：名單是 kiang 每天從全國教保資訊網爬下的
docs/data/高雄市.csv；preschools.json 的 is_active 一旦是 1 就不會變回 0，停辦的會一直留著，不能用）；
不存負責人姓名（owner），也不讀
punish_all.json（以行為人姓名為鍵）。類型對照：公立→public、非營利→nonprofit、
私立且 pre_public 學年區間涵蓋目前學年→quasi_public、其餘私立→private。月費是
kiang 依收費明細估算的值，畫面上要標「估」。kiang 的資料有一筆座標是字串，一律轉 float。名單換新與異動紀錄見 providers.py（2026-10-14）。

高雄市在名單上的園所若缺必要欄位、欄位超過資料表欄寬、座標不是有限數或不在高雄市外框內、
source_id 重複，整筆略過並計入 ParseReport.skipped（高雄市以外、不在名單的本來就不要，不算）；
不讓一筆壞資料使整批寫入失敗。數量欄位（核定人數、月費）超出 int4 當成未知。
2026-10-15 起另存室內／戶外面積、幼童專用車、兼辦國小課後人數（附近同業比較規格 §4.1）。"""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.kaohsiung import in_kaohsiung
from app.admissions.geo.models import GeoKindergarten
from app.admissions.geo.projection import haversine_m

SOURCE_NOTE = "資料來源：全國教保資訊網（kiang 整理）"
_KIND_BY_TYPE = {"公立": "public", "非營利": "nonprofit", "私立": "private"}
_PRE_PUBLIC = re.compile(r"(\d{3})-(\d{3})")
_POSTAL_PREFIX = re.compile(r"^\[\d+\]")
_AFTER_SCHOOL = re.compile(r"有[，,]\s*人數[：:]\s*([0-9]+)")
_METERS_PER_DEGREE = 111_320.0
_INT4_MAX = 2_147_483_647
REGISTRY_COLUMNS = ("reg_docno", "title", "address", "reg_date")
REGISTRY_FORMAT_MESSAGE = "教育部幼兒園名單格式不對"
# 文字欄位上限，以資料表欄寬為準。
_WIDTHS = {
    name: GeoKindergarten.__table__.c[name].type.length
    for name in ("source_id", "reg_no", "name", "pre_public_period", "district", "address", "phone")
}


class KindergartenFormatError(ValueError):
    """preschools.json 或教育部名單不是預期的格式（或一所高雄市營業中的園所都沒有）。"""


@dataclass
class ParseReport:
    """parse_preschools 的略過數（給同步摘要用）。"""

    skipped: int = 0
    unplaced: int = 0  # 名單有、preschools.json 沒有對應的園所（kiang 還沒算座標）；只進日誌，不算 skipped


@dataclass(frozen=True)
class KindergartenRow:
    source_id: str
    reg_no: str | None
    name: str
    kind: str
    pre_public_period: str | None
    district: str
    address: str
    lat: float
    lng: float
    approved_capacity: int | None
    monthly_fee_estimate: int | None
    has_penalty: bool
    phone: str | None
    registered_on: date | None = None
    indoor_m2: float | None = None
    outdoor_m2: float | None = None
    has_shuttle: bool | None = None
    after_school_capacity: int | None = None


@dataclass(frozen=True)
class NearbyKindergarten:
    source_id: str
    name: str
    kind: str
    pre_public_period: str | None
    address: str
    lat: float
    lng: float
    distance_m: int
    approved_capacity: int | None
    monthly_fee_estimate: int | None
    has_penalty: bool
    phone: str | None
    indoor_m2_per_child: float | None = None
    outdoor_m2_per_child: float | None = None
    has_shuttle: bool | None = None
    after_school_capacity: int | None = None


def _int_or_none(value: object) -> int | None:
    """數量欄位 → 整數；不是數字、不是有限數、超出 int4（寫入會失敗）都是 None。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        number = value
    else:
        try:
            parsed = value if isinstance(value, float) else float(re.sub(r"[,\s]", "", str(value or "")))
        except ValueError:
            return None
        if not math.isfinite(parsed):
            return None
        number = int(round(parsed))
    return number if -_INT4_MAX <= number <= _INT4_MAX else None


def _text_or_none(value: object) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned or None


def _registered_on(value: object) -> date | None:
    """來源的設立日 reg_date，格式 YYYY/MM/DD（月日可只有一位）；格式不符或不是真的日期回 None。"""
    text = _text_or_none(value)
    if text is None:
        return None
    try:
        year, month, day = (int(part) for part in text.split("/"))
        return date(year, month, day)
    except (ValueError, OverflowError):  # 段數不對、不是數字、不存在的日期；年份大到超出 C int 是 OverflowError
        return None


def _area_m2(value: object) -> float | None:
    """面積「1,534.78平方公尺」→ 1534.78；空、0、不是數字都是 None。"""
    text = str(value or "").replace("平方公尺", "").replace(",", "").strip()
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) and number > 0 else None


def _has_shuttle(props: dict) -> bool | None:
    """幼童專用車：kiang 把原站的車牌表存成空白字元（有車），沒有車是空字串；沒有這個欄位＝不知道。
    用原始字串判斷，不能先 strip。"""
    if "shuttle" not in props or props["shuttle"] is None:
        return None
    return str(props["shuttle"]) != ""


def _after_school_capacity(value: object) -> int | None:
    """兼辦國小課後：「無」→ 0、「有，人數：20」→ 20；只寫「有」、其他、超出 int4 → None。"""
    text = str(value or "").strip()
    if text == "無":
        return 0
    matched = _AFTER_SCHOOL.fullmatch(text)
    return _int_or_none(matched.group(1)) if matched else None


def per_child(area_m2: float | None, capacity: int | None) -> float | None:
    """每位核定幼生的面積（m²，四捨五入到 0.1）；核定是 0 或不知道、面積不知道都是 None（規格 F15）。"""
    if area_m2 is None or capacity is None or capacity <= 0:
        return None
    return math.floor(area_m2 / capacity * 10 + 0.5) / 10


@dataclass(frozen=True)
class Registry:
    """教育部名單（2026-10-15 規格 §3.1）。keys：營業中的（立案文號、名稱），就是 kiang 產生 uuid 的鍵；
    places：（地址、設立日），新名稱還沒有座標時也認得出改名（規格 §4）。"""

    keys: frozenset[tuple[str, str]]
    places: frozenset[tuple[str, date]]


def registry_key(reg_docno: object, title: object) -> tuple[str, str]:
    """名單與 preschools.json 兩邊用同一個寫法比對：去頭尾空白。"""
    return str(reg_docno or "").strip(), str(title or "").strip()


def place_key(address: object, reg_date: object) -> tuple[str, date] | None:
    """改名判斷用的（地址、設立日）：地址去掉郵遞區號（和 KindergartenRow.address 同一個寫法）；設立日不明或沒地址回 None。"""
    opened = _registered_on(reg_date)
    text = _POSTAL_PREFIX.sub("", str(address or "").strip())
    return (text, opened) if opened is not None and text else None


def parse_registry(text: str) -> Registry:
    """kiang docs/data/高雄市.csv（呼叫端已用 utf-8-sig 解碼）→ Registry。只讀立案文號、名稱、地址、設立日四欄，
    負責人不讀。沒有這四欄（例如抓到 HTML 錯誤頁）或一列可用的都沒有 → KindergartenFormatError。"""
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or not set(REGISTRY_COLUMNS) <= set(reader.fieldnames):
        raise KindergartenFormatError(REGISTRY_FORMAT_MESSAGE)
    keys: set[tuple[str, str]] = set()
    places: set[tuple[str, date]] = set()
    for row in reader:
        key = registry_key(row.get("reg_docno"), row.get("title"))
        if not all(key):
            continue
        keys.add(key)
        place = place_key(row.get("address"), row.get("reg_date"))
        if place is not None:
            places.add(place)
    if not keys:
        raise KindergartenFormatError(REGISTRY_FORMAT_MESSAGE)
    return Registry(frozenset(keys), frozenset(places))


def _kind(type_name: str, pre_public: str | None, school_year: int) -> str | None:
    kind = _KIND_BY_TYPE.get(type_name)
    if kind == "private" and pre_public:
        matched = _PRE_PUBLIC.fullmatch(pre_public)
        if matched and int(matched.group(1)) <= school_year <= int(matched.group(2)):
            return "quasi_public"
    return kind


def kind_as_of(kind: str, pre_public_period: str | None, school_year: int) -> str:
    """資料表裡舊列的類型，用 school_year 這一學年重算（規格 P7）。公立、非營利不受準公共期間影響；
    私立與準公共本質上都是私立，依舊列保存的準公共期間重算。8 月學年更替時沒改過資料的園所類型會
    自己變，比對異動時舊的一邊要先這樣重算，才不會一次冒出一批假的類型變動。"""
    if kind in ("private", "quasi_public"):
        return _kind("私立", pre_public_period, school_year) or kind
    return kind


def parse_preschools(
    data: dict, *, registry: Registry, school_year: int, report: ParseReport | None = None
) -> list[KindergartenRow]:
    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        raise KindergartenFormatError("幼兒園資料不是 GeoJSON FeatureCollection")
    report = report if report is not None else ParseReport()
    rows: list[KindergartenRow] = []
    seen: set[str] = set()
    listed: set[tuple[str, str]] = set()
    for feature in features:
        props = (feature.get("properties") or {}) if isinstance(feature, dict) else None
        if not isinstance(props, dict):
            report.skipped += 1
            continue
        if str(props.get("city") or "").replace("臺", "台") != "高雄市":
            continue
        key = registry_key(props.get("reg_docno"), props.get("title"))
        if key not in registry.keys:
            continue  # 不在教育部名單＝停辦或改名（kiang 的 is_active 不會變回 0，不看它）
        listed.add(key)
        row = _row(feature, props, school_year)
        if row is None or row.source_id in seen:
            report.skipped += 1
            continue
        seen.add(row.source_id)
        rows.append(row)
    report.unplaced = len(registry.keys - listed)
    if not rows:
        raise KindergartenFormatError("幼兒園資料裡沒有高雄市營業中的園所")
    return rows


def _row(feature: dict, props: dict, school_year: int) -> KindergartenRow | None:
    """一筆高雄市、在名單上的園所 → 資料列；缺必要欄位、欄位放不進資料表、座標不合格回 None。"""
    try:
        lng, lat = (float(value) for value in feature["geometry"]["coordinates"][:2])
    except (KeyError, TypeError, ValueError):
        return None
    if not in_kaohsiung(lat, lng):
        return None
    pre_public = _text_or_none(props.get("pre_public"))
    pre_public = None if pre_public == "無" else pre_public
    kind = _kind(str(props.get("type") or ""), pre_public, school_year)
    source_id = _text_or_none(props.get("id"))
    name = _text_or_none(props.get("title"))
    if kind is None or source_id is None or name is None:
        return None
    row = KindergartenRow(
        source_id=source_id,
        reg_no=_text_or_none(props.get("reg_no")),
        name=name,
        kind=kind,
        pre_public_period=pre_public,
        district=str(props.get("town") or "").strip(),
        address=_POSTAL_PREFIX.sub("", str(props.get("address") or "").strip()),
        lat=lat,
        lng=lng,
        approved_capacity=_int_or_none(props.get("count_approved")),
        monthly_fee_estimate=_int_or_none(props.get("monthly")),
        has_penalty=str(props.get("penalty") or "") == "有",
        phone=_text_or_none(props.get("tel")),
        registered_on=_registered_on(props.get("reg_date")),
        indoor_m2=_area_m2(props.get("size_in")),
        outdoor_m2=_area_m2(props.get("size_out")),
        has_shuttle=_has_shuttle(props),
        after_school_capacity=_after_school_capacity(props.get("is_after")),
    )
    if any(len(getattr(row, column) or "") > width for column, width in _WIDTHS.items()):
        return None
    return row


async def nearby(db: AsyncSession, lat: float, lng: float, radius_m: int) -> list[NearbyKindergarten]:
    """半徑 radius_m 內的營業中園所，依距離（公尺，四捨五入）、名稱排序。先用經緯度
    方框篩，再算大圓距離。"""
    dlat = radius_m / _METERS_PER_DEGREE
    dlng = radius_m / (_METERS_PER_DEGREE * math.cos(math.radians(lat)))
    result = await db.execute(
        select(GeoKindergarten).where(
            GeoKindergarten.is_active.is_(True),
            GeoKindergarten.lat.between(lat - dlat, lat + dlat),
            GeoKindergarten.lng.between(lng - dlng, lng + dlng),
        )
    )
    items: list[NearbyKindergarten] = []
    for row in result.scalars():
        distance = haversine_m(lat, lng, row.lat, row.lng)
        if distance > radius_m:
            continue
        items.append(
            NearbyKindergarten(
                source_id=row.source_id,
                name=row.name,
                kind=row.kind,
                pre_public_period=row.pre_public_period,
                address=row.address,
                lat=row.lat,
                lng=row.lng,
                distance_m=round(distance),
                approved_capacity=row.approved_capacity,
                monthly_fee_estimate=row.monthly_fee_estimate,
                has_penalty=row.has_penalty,
                phone=row.phone,
                indoor_m2_per_child=per_child(row.indoor_m2, row.approved_capacity),
                outdoor_m2_per_child=per_child(row.outdoor_m2, row.approved_capacity),
                has_shuttle=row.has_shuttle,
                after_school_capacity=row.after_school_capacity,
            )
        )
    items.sort(key=lambda item: (item.distance_m, item.name))
    return items
