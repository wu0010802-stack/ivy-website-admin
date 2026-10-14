"""托嬰中心與公共托育家園公開資料：kiang 整理的 babycare.json（規格 §2、§3、§5）。

來源 https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json（GeoJSON FeatureCollection，全國約 2,000 筆，
衛福部社會及家庭署公開資料，每天自動更新）。properties 只有 id、name、city、address、phone、
capacity（核定人數）、status（實際收托）、is_active；沒有設立日、類型、月費，也沒有負責人姓名。
類型由名稱判斷：含「家園」＝公共托育家園（home），其餘＝托嬰中心（center）。實際收托是官方回報的數字，
統計時點與定義官方沒有說明，畫面只寫「實際收托（官方資料）」。

只留高雄市、營業中（is_active 為真）的機構；缺必要欄位、欄位超過資料表欄寬、座標不是有限數或不在
高雄市外框內、id 重複，整筆略過並計入 ParseReport.skipped（別的縣市、停業的本來就不要，不算）；
不讓一筆壞資料使整批寫入失敗。數量欄位超出 int4 當成未知。停業的機構不收進來：同步比對時
「名單沒有」就是停辦（providers.py）。"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.kaohsiung import in_kaohsiung
from app.admissions.geo.kindergartens import ParseReport, _int_or_none, _text_or_none  # 同一套欄位清理
from app.admissions.geo.models import GeoBabycare
from app.admissions.geo.projection import haversine_m

SOURCE_NOTE = "資料來源：衛生福利部社會及家庭署公開資料（kiang 整理）；實際收托為官方資料"
_POSTAL_PREFIX = re.compile(r"^\d{3,6}")
_METERS_PER_DEGREE = 111_320.0
# 文字欄位上限，以資料表欄寬為準。
_WIDTHS = {
    name: GeoBabycare.__table__.c[name].type.length for name in ("source_id", "name", "address", "phone")
}


class BabycareFormatError(ValueError):
    """babycare.json 不是預期的格式（或一所高雄市營業中的機構都沒有）。"""


@dataclass(frozen=True)
class BabycareRow:
    source_id: str
    name: str
    kind: str
    address: str
    lat: float
    lng: float
    approved_capacity: int | None
    enrolled: int | None
    phone: str | None


@dataclass(frozen=True)
class NearbyBabycare:
    source_id: str
    name: str
    kind: str
    address: str
    lat: float
    lng: float
    distance_m: int
    approved_capacity: int | None
    enrolled: int | None
    phone: str | None


def _address(raw: object) -> str:
    """去掉開頭的郵遞區號；有兩個以上「高雄市」時（來源常把區與里重複寫一遍）取最後一個起。"""
    text = _POSTAL_PREFIX.sub("", str(raw or "").strip(), count=1)
    if text.count("高雄市") >= 2:
        return "高雄市" + text.rpartition("高雄市")[2]
    return text


def _is_active(value: object) -> bool:
    return value is True or str(value).strip().lower() in ("1", "true")


def parse_babycare(data: dict, *, report: ParseReport | None = None) -> list[BabycareRow]:
    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        raise BabycareFormatError("托嬰名單不是 GeoJSON FeatureCollection")
    report = report if report is not None else ParseReport()
    rows: list[BabycareRow] = []
    seen: set[str] = set()
    for feature in features:
        props = (feature.get("properties") or {}) if isinstance(feature, dict) else None
        if not isinstance(props, dict):
            report.skipped += 1
            continue
        if str(props.get("city") or "").replace("臺", "台") != "高雄市" or not _is_active(props.get("is_active")):
            continue
        row = _row(feature, props)
        if row is None or row.source_id in seen:
            report.skipped += 1
            continue
        seen.add(row.source_id)
        rows.append(row)
    if not rows:
        raise BabycareFormatError("托嬰名單裡沒有高雄市營業中的機構")
    return rows


def _row(feature: dict, props: dict) -> BabycareRow | None:
    """一筆高雄市營業中的機構 → 資料列；缺必要欄位、欄位放不進資料表、座標不合格回 None。"""
    try:
        lng, lat = (float(value) for value in feature["geometry"]["coordinates"][:2])
    except (KeyError, TypeError, ValueError):
        return None
    if not in_kaohsiung(lat, lng):
        return None
    source_id = _text_or_none(props.get("id"))
    name = _text_or_none(props.get("name"))
    address = _address(props.get("address"))
    if source_id is None or name is None or not address:
        return None
    row = BabycareRow(
        source_id=source_id,
        name=name,
        kind="home" if "家園" in name else "center",
        address=address,
        lat=lat,
        lng=lng,
        approved_capacity=_int_or_none(props.get("capacity")),
        enrolled=_int_or_none(props.get("status")),
        phone=_text_or_none(props.get("phone")),
    )
    if any(len(getattr(row, column) or "") > width for column, width in _WIDTHS.items()):
        return None
    return row


async def nearby(db: AsyncSession, lat: float, lng: float, radius_m: int) -> list[NearbyBabycare]:
    """半徑 radius_m 內營業中的機構，依距離（公尺，四捨五入）、名稱排序。先用經緯度方框篩，再算大圓距離。"""
    dlat = radius_m / _METERS_PER_DEGREE
    dlng = radius_m / (_METERS_PER_DEGREE * math.cos(math.radians(lat)))
    result = await db.execute(
        select(GeoBabycare).where(
            GeoBabycare.is_active.is_(True),
            GeoBabycare.lat.between(lat - dlat, lat + dlat),
            GeoBabycare.lng.between(lng - dlng, lng + dlng),
        )
    )
    items: list[NearbyBabycare] = []
    for row in result.scalars():
        distance = haversine_m(lat, lng, row.lat, row.lng)
        if distance > radius_m:
            continue
        items.append(
            NearbyBabycare(
                source_id=row.source_id, name=row.name, kind=row.kind, address=row.address, lat=row.lat, lng=row.lng,
                distance_m=round(distance), approved_capacity=row.approved_capacity, enrolled=row.enrolled, phone=row.phone,
            )
        )
    items.sort(key=lambda item: (item.distance_m, item.name))
    return items
