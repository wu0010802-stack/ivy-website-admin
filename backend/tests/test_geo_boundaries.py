"""高雄市里界 GeoJSON（2026-10-08 規格 §5.6）。"""

from __future__ import annotations

import json

from app.admissions.geo.boundaries import BOUNDARY_PATH, BOUNDARY_VERSION, boundary_bytes, boundary_etag, village_code
from app.admissions.geo.kaohsiung import DISTRICTS
from tests.geo_helpers import sample_doorplate_rows


def _features():
    return json.loads(boundary_bytes())["features"]


def _points(geometry):
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    for polygon in polygons:
        for ring in polygon:
            yield from ring


def test_file_has_kaohsiung_villages_only():
    features = _features()
    assert len(features) == 893
    assert all(f["properties"]["VILLNAME"] and f["properties"]["TOWNNAME"] in DISTRICTS for f in features)
    assert all(f["properties"]["VILLCODE"].startswith("64000") for f in features)
    assert set(features[0]["properties"]) == {"TOWNNAME", "VILLNAME", "VILLCODE"}


def test_no_far_away_islands():
    """未編定村里（東沙、南沙）要濾掉，否則地圖 fitBounds 會縮到南海。"""
    lngs, lats = zip(*(point for f in _features() for point in _points(f["geometry"])))
    assert 120.1 < min(lngs) and max(lngs) < 121.1
    assert 22.4 < min(lats) and max(lats) < 23.5


def test_village_codes():
    assert village_code("三民區", "鼎金里") == "64000050001"
    assert village_code("三民區", "本揚里") == "64000050015"
    assert village_code("鼓山區", "北美術館里") == "64000020040"
    assert village_code("三民區", "不存在里") is None


def test_doorplate_village_names_match_boundaries():
    """門牌表補過「里」字後，里名要對得上界圖。"""
    for row in sample_doorplate_rows():
        assert village_code(row.district, row.village) is not None, (row.district, row.village)


def test_etag_and_size():
    assert boundary_etag().startswith(f'"villages-{BOUNDARY_VERSION}-') and boundary_etag().endswith('"')
    assert BOUNDARY_PATH.stat().st_size < 800_000
