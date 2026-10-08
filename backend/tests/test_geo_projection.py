"""TWD97 TM2 → WGS84 與直線距離。測試向量由 pyproj（EPSG:3826 → EPSG:4326）算出。"""

from __future__ import annotations

import pytest

from app.admissions.geo.projection import haversine_m, twd97_tm2_to_wgs84

VECTORS = [
    (182545.62, 2504840.809, 22.642455639, 120.343713324),  # 義華路68號
    (176205.163, 2503011.609, 22.625672795, 120.282114231),  # 七賢三路110號
    (182380.03, 2509289.16, 22.682619963, 120.341910791),  # 京吉一路102號
    (165650.0, 2486410.0, 22.475262695, 120.180325848),  # 高雄市門牌 x、y 最小值
    (252731.0, 2590754.0, 23.419652797, 121.026724036),  # 高雄市門牌 x、y 最大值
    (250000.0, 2544283.12, 22.999999957, 121.0),  # 中央經線
]


@pytest.mark.parametrize(("x", "y", "lat", "lng"), VECTORS)
def test_tm2_to_wgs84_matches_pyproj(x, y, lat, lng):
    got_lat, got_lng = twd97_tm2_to_wgs84(x, y)
    assert got_lat == pytest.approx(lat, abs=1e-6)
    assert got_lng == pytest.approx(lng, abs=1e-6)


def test_haversine():
    yihua = (22.642455639, 120.343713324)
    renwu = (22.682619963, 120.341910791)
    assert haversine_m(*yihua, *renwu) == pytest.approx(4469.9, abs=1.0)
    assert haversine_m(*renwu, *yihua) == pytest.approx(haversine_m(*yihua, *renwu))
    assert haversine_m(*yihua, *yihua) == 0
