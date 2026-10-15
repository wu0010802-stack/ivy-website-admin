"""清冊地址補行政區後比對門牌（2026-10-15 規格 §3.2）。門牌用樣本＋幾筆專為同名里、同名路造的假門牌。"""
from __future__ import annotations

import math

import pytest
import pytest_asyncio

from app.admissions.enrolled.locate import locate_roster_address
from app.admissions.geo.kaohsiung import CODE_OF_DISTRICT
from app.admissions.geo.matcher import CampusPoint
from app.admissions.geo.models import GeoDoorplate
from tests.geo_helpers import SAMPLE_TAG, YIHUA_POINT, load_geo_samples

CAMPUS = CampusPoint("yihua", YIHUA_POINT[0], YIHUA_POINT[1], None, "三民區")


def _offset(meters_north: float) -> tuple[float, float]:
    """義華正北（負數＝正南）幾公尺的座標：造「離本校剛好多遠」的假門牌用。"""
    return YIHUA_POINT[0] + meters_north / (math.pi / 180 * 6_371_000), YIHUA_POINT[1]


def _plate(district: str, village: str, street: str, number: int, lat: float, lng: float) -> GeoDoorplate:
    return GeoDoorplate(
        dataset_version=SAMPLE_TAG, town_code=CODE_OF_DISTRICT[district], district=district, village=village,
        street=street, street_kind="road", lane="", alley="", number=number, number_sub=0, lat=lat, lng=lng,
    )


@pytest_asyncio.fixture
async def plates(db_session):
    await load_geo_samples(db_session)
    db_session.add_all([
        # 同名里在兩區：三民區那一筆離義華近。
        _plate("三民區", "雙區里", "測試一路", 1, 22.6450, 120.3450),
        _plate("鳳山區", "雙區里", "測試一路", 1, 22.6200, 120.3600),
        # 地址寫本揚里，門牌表這一號在寶業里（里界調整過）。
        _plate("三民區", "寶業里", "測試三路", 7, 22.6440, 120.3420),
        # 同名路在兩區：三民區那一筆離義華近。
        _plate("苓雅區", "苓東里", "共用路", 3, 22.6200, 120.3100),
        _plate("三民區", "本揚里", "共用路", 3, 22.6460, 120.3430),
        # 同名路：遠處（約 23.5 km）有精確門牌、近處（約 4.8 km）只有鄰近門牌（號碼差 ≤ 30）——相差超過 1 km，選近處。
        _plate("林園區", "遠星里", "遠近路", 10, 22.4400, 120.4100),
        _plate("大社區", "近星里", "遠近路", 12, 22.6850, 120.3500),
        # 同名路：兩區都很近（約 0.14 km 與 0.24 km）、一邊精確一邊鄰近——相差不到 1 km，精確優先。
        _plate("三民區", "本上里", "邊界路", 20, 22.6430, 120.3450),
        _plate("鳳山區", "文福里", "邊界路", 21, 22.6420, 120.3460),
        _plate("三民區", "本上里", "邊界路", 25, 22.6431, 120.3451),
        # 精確與鄰近的距離差剛好卡在 1 km 兩側：差 0.2 km 選精確、差 1.2 km 選鄰近。
        _plate("三民區", "近門里", "門檻一路", 20, *_offset(400)),
        _plate("苓雅區", "遠門里", "門檻一路", 21, *_offset(-600)),
        _plate("三民區", "近檻里", "門檻二路", 20, *_offset(300)),
        _plate("苓雅區", "遠檻里", "門檻二路", 21, *_offset(-1500)),
        # 異體字：門牌表用「德」。
        _plate("苓雅區", "試德里", "試德街", 5, 22.6250, 120.3200),
        # 寫的里只在仁武區、路只在左營區。
        _plate("仁武區", "丙華里", "丙華一路", 1, 22.7000, 120.3450),
        _plate("左營區", "乙館里", "跨區路", 8, 22.6750, 120.3000),
    ])
    await db_session.commit()
    return db_session


async def _locate(db, raw: str):
    result = await locate_roster_address(db, raw, version=SAMPLE_TAG, campus=CAMPUS)
    return result.match.match_level, result.match.district, result.match.village, result.method


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("本揚里1鄰義華路68號", ("exact", "三民區", "本揚里", "village_unique")),
        ("本揚里１鄰義華路６８號", ("exact", "三民區", "本揚里", "village_unique")),
        ("本揚里1鄰\xa0義華路68號", ("exact", "三民區", "本揚里", "village_unique")),
        ("雙區里2鄰測試一路1號", ("exact", "三民區", "雙區里", "village_nearest")),
        ("本揚里3鄰測試三路7號", ("exact", "三民區", "寶業里", "village_mismatch")),
        ("義華路68號", ("exact", "三民區", "本揚里", "street_unique")),
        ("共用路3號", ("exact", "三民區", "本揚里", "street_nearest")),
        ("沒有里5鄰義華路70號", ("exact", "三民區", "本揚里", "street_unique")),
        ("高雄市三民區義華路68號", ("exact", "三民區", "本揚里", "written")),
        ("遠近路10號", ("nearby", "大社區", "近星里", "street_nearest")),
        ("邊界路21號", ("exact", "鳳山區", "文福里", "street_nearest")),
        ("門檻一路21號", ("exact", "苓雅區", "遠門里", "street_nearest")),
        ("門檻二路21號", ("nearby", "三民區", "近檻里", "street_nearest")),
        ("試徳街5號", ("exact", "苓雅區", "試德里", "street_unique")),
        ("試德里3鄰試徳街5號", ("exact", "苓雅區", "試德里", "village_unique")),
        ("丙華里4鄰跨區路8號", ("exact", "左營區", "乙館里", "village_mismatch")),
    ],
)
async def test_located_addresses(plates, raw, expected):
    assert await _locate(plates, raw) == expected


async def test_street_without_a_matching_number_is_street_level(plates):
    level, district, _village, method = await _locate(plates, "義華路999號")
    assert (level, district, method) == ("street", "三民區", "street_unique")


@pytest.mark.parametrize(
    ("raw", "reason", "method"),
    [
        ("臺北市內湖區文德路1號", "outside_kaohsiung", "written"),
        ("不存在路9號", "no_doorplate", "none"),
        ("", "no_address", "none"),
    ],
)
async def test_unlocated_addresses(plates, raw, reason, method):
    result = await locate_roster_address(plates, raw, version=SAMPLE_TAG, campus=CAMPUS)
    assert (result.match.match_level, result.match.unlocated_reason, result.method) == ("unlocated", reason, method)
    assert result.match.lat is None and result.match.district is None
