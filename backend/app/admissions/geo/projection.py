"""TWD97 二度分帶（TM2，中央經線 121°，EPSG:3826）座標轉 WGS84 經緯度，以及兩點的
大圓距離。門牌資料的橫縱座標是 TM2 公尺；TWD97 與 WGS84 的橢球差在公分級，
直接當 WGS84 用。不引入 pyproj：反算公式（Snyder, Map Projections 第 8 章）幾十行
就夠，與 pyproj 對照誤差在 1e-9 度以內（tests/test_geo_projection.py）。"""

from __future__ import annotations

import math

_A = 6378137.0  # GRS80 長半軸
_F = 1 / 298.257222101  # GRS80 扁率
_K0 = 0.9999
_LON0 = math.radians(121.0)
_FALSE_EASTING = 250000.0
_E2 = _F * (2 - _F)
_EP2 = _E2 / (1 - _E2)
_E1 = (1 - math.sqrt(1 - _E2)) / (1 + math.sqrt(1 - _E2))
_MU_DENOMINATOR = _A * (1 - _E2 / 4 - 3 * _E2**2 / 64 - 5 * _E2**3 / 256)
_EARTH_RADIUS_M = 6371008.8


def twd97_tm2_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """(橫座標, 縱座標) 公尺 → (緯度, 經度) 度。"""
    mu = (y / _K0) / _MU_DENOMINATOR
    phi1 = (
        mu
        + (3 * _E1 / 2 - 27 * _E1**3 / 32) * math.sin(2 * mu)
        + (21 * _E1**2 / 16 - 55 * _E1**4 / 32) * math.sin(4 * mu)
        + (151 * _E1**3 / 96) * math.sin(6 * mu)
        + (1097 * _E1**4 / 512) * math.sin(8 * mu)
    )
    sin1, cos1, tan1 = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    c1 = _EP2 * cos1**2
    t1 = tan1**2
    n1 = _A / math.sqrt(1 - _E2 * sin1**2)
    r1 = _A * (1 - _E2) / (1 - _E2 * sin1**2) ** 1.5
    d = (x - _FALSE_EASTING) / (n1 * _K0)
    lat = phi1 - (n1 * tan1 / r1) * (
        d**2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * _EP2) * d**4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * _EP2 - 3 * c1**2) * d**6 / 720
    )
    lng = _LON0 + (
        d
        - (1 + 2 * t1 + c1) * d**3 / 6
        + (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * _EP2 + 24 * t1**2) * d**5 / 120
    ) / cos1
    return math.degrees(lat), math.degrees(lng)


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """兩點大圓距離（公尺）。"""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lng2 - lng1)
    h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(h))
