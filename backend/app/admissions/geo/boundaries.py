"""高雄市里界 GeoJSON（docs/specs/2026-10-08-admissions-area-design.md §5.6）。檔案隨
backend 提交，產生方式見 app/admissions/geo_data/README.md；API 原樣回傳，另外提供
(區, 里) → 里代碼對照。"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path

BOUNDARY_PATH = Path(__file__).resolve().parent.parent / "geo_data" / "kaohsiung-villages.geojson"
# 內政部國土測繪中心村里界圖 VILLAGE_NLSC_1150817（115/08/17 版）。
BOUNDARY_VERSION = "115-08-17"


@lru_cache(maxsize=1)
def boundary_bytes() -> bytes:
    return BOUNDARY_PATH.read_bytes()


@lru_cache(maxsize=1)
def boundary_etag() -> str:
    digest = hashlib.sha1(boundary_bytes()).hexdigest()[:12]
    return f'"villages-{BOUNDARY_VERSION}-{digest}"'


@lru_cache(maxsize=1)
def _village_codes() -> dict[tuple[str, str], str]:
    """(區, 里) → 里代碼。里名在不同區可以重複（例：中正里），所以鍵是兩個一起；同一個 (區, 里) 出現
    兩次是界圖檔案有問題，直接報錯，不靜默讓後面的蓋掉前面的。"""
    codes: dict[tuple[str, str], str] = {}
    for feature in json.loads(boundary_bytes())["features"]:
        properties = feature["properties"]
        key = (properties["TOWNNAME"], properties["VILLNAME"])
        if key in codes:
            raise ValueError(f"里界資料有重複的行政區與里：{key[0]}{key[1]}")
        codes[key] = properties["VILLCODE"]
    return codes


def village_code(district: str, village: str) -> str | None:
    return _village_codes().get((district, village))


def village_codes() -> frozenset[str]:
    """里界檔裡所有的里代碼（各里人口匯入時，對不到的列略過）。"""
    return frozenset(_village_codes().values())


@lru_cache(maxsize=1)
def village_names() -> dict[str, tuple[str, str]]:
    """里代碼 → (區, 里)；village_code 的反查（招生機會要替人口表沒有的里寫出名稱）。"""
    return {code: key for key, code in _village_codes().items()}


def _ring_centroid(ring: list[list[float]]) -> tuple[float, float, float]:
    """外環的 (帶號面積, 重心經度, 重心緯度)：shoelace 公式，座標直接當平面算（一個里只有幾百公尺到
    幾公里，經緯度的變形可以忽略）。面積為 0 的退化環回 (0, 0, 0)，由呼叫端略過。"""
    area = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        cross = x1 * y2 - x2 * y1
        area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if area == 0:
        return 0.0, 0.0, 0.0
    return area / 2, cx / (3 * area), cy / (3 * area)


@lru_cache(maxsize=1)
def village_centroids() -> dict[str, tuple[float, float]]:
    """里代碼 → 面積重心 (緯度, 經度)（2026-10-13 招生機會規格 §5.3）：每個多邊形取外環重心，
    MultiPolygon 依各塊面積加權（洞不扣，里界幾乎沒有洞，影響可忽略）。"""
    centroids: dict[str, tuple[float, float]] = {}
    for feature in json.loads(boundary_bytes())["features"]:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        total = lng = lat = 0.0
        for polygon in polygons:
            area, x, y = _ring_centroid(polygon[0])
            weight = abs(area)
            total += weight
            lng += x * weight
            lat += y * weight
        if total > 0:
            centroids[feature["properties"]["VILLCODE"]] = (lat / total, lng / total)
    return centroids


@lru_cache(maxsize=1)
def _village_shapes() -> tuple[tuple[str, tuple[float, float, float, float], tuple], ...]:
    """每個里 (代碼, 外框 (最小經, 最小緯, 最大經, 最大緯), 多邊形們)；多邊形是 [外環, 洞, …]。"""
    shapes = []
    for feature in json.loads(boundary_bytes())["features"]:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        points = [point for polygon in polygons for ring in polygon for point in ring]
        xs, ys = [point[0] for point in points], [point[1] for point in points]
        shapes.append((feature["properties"]["VILLCODE"], (min(xs), min(ys), max(xs), max(ys)), tuple(polygons)))
    return tuple(shapes)


def _in_ring(lng: float, lat: float, ring: list[list[float]]) -> bool:
    """射線法：點在環內（邊上不保證）。"""
    inside = False
    previous = len(ring) - 1
    for index in range(len(ring)):
        x1, y1 = ring[index][0], ring[index][1]
        x2, y2 = ring[previous][0], ring[previous][1]
        if (y1 > lat) != (y2 > lat) and lng < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
        previous = index
    return inside


def village_at(lng: float, lat: float) -> str | None:
    """經緯度落在哪個里 → 里代碼；不在任何里界內（海上、外縣市）回 None。座標剛好在兩個里的邊上時取檔案裡先出現的。
    預售建案的地號座標（國土測繪中心）靠這個點入里（2026-10-20 預售建案規格 P5）。"""
    for code, (min_x, min_y, max_x, max_y), polygons in _village_shapes():
        if not (min_x <= lng <= max_x and min_y <= lat <= max_y):
            continue
        for polygon in polygons:
            if _in_ring(lng, lat, polygon[0]) and not any(_in_ring(lng, lat, hole) for hole in polygon[1:]):
                return code
    return None
