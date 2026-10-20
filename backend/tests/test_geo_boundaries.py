"""高雄市里界 GeoJSON（2026-10-08 規格 §5.6）。"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict

import pytest

from app.admissions.geo import boundaries
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


def test_village_names_is_the_inverse_of_village_codes():
    """里代碼 → (區, 里)：人口表沒有的里，招生機會要靠它寫出名稱。同名的里（中正里）靠區分開。"""
    names = boundaries.village_names()
    assert names["64000050015"] == ("三民區", "本揚里")
    assert len(names) == 893 and set(names) == boundaries.village_codes()
    assert all(village_code(*name) == code for code, name in names.items())


def test_doorplate_village_names_match_boundaries():
    """門牌表補過「里」字後，里名要對得上界圖。"""
    for row in sample_doorplate_rows():
        assert village_code(row.district, row.village) is not None, (row.district, row.village)


def test_etag_and_size():
    assert boundary_etag().startswith(f'"villages-{BOUNDARY_VERSION}-') and boundary_etag().endswith('"')
    assert BOUNDARY_PATH.stat().st_size < 800_000


def test_etag_is_the_version_plus_the_first_twelve_hex_of_the_files_sha1():
    """ETag 隨檔案內容變：檔案改了、版本字串沒改，快取也會失效。"""
    digest = hashlib.sha1(BOUNDARY_PATH.read_bytes()).hexdigest()
    assert boundary_etag() == f'"villages-{BOUNDARY_VERSION}-{digest[:12]}"'


def test_same_village_name_in_different_districts_gets_different_codes():
    """不少里名在多個區各有一個（例：中正里）：代碼要用 (區, 里) 查，不能只看里名。"""
    districts_of = defaultdict(set)
    for feature in _features():
        districts_of[feature["properties"]["VILLNAME"]].add(feature["properties"]["TOWNNAME"])
    shared = sorted(name for name, districts in districts_of.items() if len(districts) > 1)
    assert shared, "界圖裡應該有跨區同名的里"
    for name in shared[:20]:
        codes = {district: village_code(district, name) for district in districts_of[name]}
        assert all(code is not None for code in codes.values()), (name, codes)
        assert len(set(codes.values())) == len(codes), (name, codes)


def _geojson(*villages: tuple[str, str, str]) -> bytes:
    return json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"TOWNNAME": town, "VILLNAME": village, "VILLCODE": code}, "geometry": None}
                for town, village, code in villages
            ],
        }
    ).encode()


@pytest.fixture
def fake_boundaries(monkeypatch):
    """換掉界圖檔案內容，並在前後清掉 (區, 里) 對照表的快取，不污染其他測試。"""

    def use(data: bytes) -> None:
        monkeypatch.setattr(boundaries, "boundary_bytes", lambda: data)
        boundaries._village_codes.cache_clear()

    yield use
    boundaries._village_codes.cache_clear()


def test_duplicate_district_village_in_the_file_raises(fake_boundaries):
    """同一個 (區, 里) 出現兩次：靜默覆蓋會讓其中一個的代碼對不上，直接報錯（目前檔案 0 重複）。"""
    fake_boundaries(_geojson(("三民區", "鼎金里", "64000050001"), ("三民區", "鼎金里", "64000050099")))
    with pytest.raises(ValueError, match="三民區鼎金里"):
        village_code("三民區", "鼎金里")


def test_same_name_in_two_districts_is_not_a_duplicate(fake_boundaries):
    fake_boundaries(_geojson(("三民區", "中正里", "64000050001"), ("鼓山區", "中正里", "64000020001")))
    assert village_code("三民區", "中正里") == "64000050001"
    assert village_code("鼓山區", "中正里") == "64000020001"
    assert village_code("左營區", "中正里") is None


def test_village_at_finds_the_village_a_point_falls_in():
    """經緯度 → 里代碼（預售建案的地號座標點入里，2026-10-20 規格 P5）：義華校址的門牌座標在三民區本揚里。"""
    from tests.geo_helpers import YIHUA_POINT

    code = boundaries.village_at(YIHUA_POINT[1], YIHUA_POINT[0])
    assert code == village_code("三民區", "本揚里")
    assert boundaries.village_names()[code] == ("三民區", "本揚里")


def test_village_at_returns_none_outside_every_village():
    assert boundaries.village_at(119.0, 22.0) is None  # 海上
    assert boundaries.village_at(0.0, 0.0) is None
    assert boundaries.village_at(121.5, 25.0) is None  # 台北


def test_village_at_respects_holes_and_multipolygons(fake_boundaries):
    outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
    far = [[20, 0], [22, 0], [22, 2], [20, 2], [20, 0]]
    data = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"TOWNNAME": "甲區", "VILLNAME": "環里", "VILLCODE": "1"},
                 "geometry": {"type": "Polygon", "coordinates": [outer, hole]}},
                {"type": "Feature", "properties": {"TOWNNAME": "甲區", "VILLNAME": "洞里", "VILLCODE": "2"},
                 "geometry": {"type": "MultiPolygon", "coordinates": [[hole], [far]]}},
            ],
        }
    ).encode()
    fake_boundaries(data)
    boundaries._village_shapes.cache_clear()
    try:
        assert boundaries.village_at(1, 1) == "1"
        assert boundaries.village_at(5, 5) == "2"  # 外環的洞，剛好是另一個里
        assert boundaries.village_at(21, 1) == "2"  # 多塊的另一塊
        assert boundaries.village_at(15, 5) is None
    finally:
        boundaries._village_shapes.cache_clear()
