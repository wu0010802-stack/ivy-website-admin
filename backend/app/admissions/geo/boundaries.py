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
