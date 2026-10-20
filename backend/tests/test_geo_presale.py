"""預售建案（2026-10-20 預售建案規格 §2、§3、P1–P5、P9）：容錯解析（拆行、多逗號、空編號、日期錯）、不讀起造人、
狀態與預計交屋邊界、坐落基地第一筆地號、定位順序（地號座標 → 門牌街名 → 只到區）、多條路、段＋地號格式的街道、
換版以新檔為準與縮水門檻、門牌換版與地號座標匯入後重比。fixture 是自己造的假資料，起造人換成假公司名。"""

from __future__ import annotations

from dataclasses import fields
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.admissions.geo import boundaries
from app.admissions.geo import presale as ps
from app.admissions.geo.models import GeoDatasetStatus, GeoParcelPoint, GeoPresaleBuildcase
from tests.geo_helpers import YIHUA_POINT, load_geo_samples

SAMPLE = Path(__file__).parent / "fixtures" / "geo" / "presale-buildcase-sample.csv"
TODAY = date(2026, 10, 20)
BENYANG = boundaries.village_code("三民區", "本揚里")
BOHUI = boundaries.village_code("三民區", "博惠里")


def _sample_lines() -> list[str]:
    return SAMPLE.read_bytes().decode("utf-8-sig").split("\r\n")


def _sample_batch() -> ps.PresaleBatch:
    text = ps.decode(SAMPLE.read_bytes())
    assert text is not None
    return ps.parse_csv(text)


def _status(row: ps.PresaleRow, today: date = TODAY) -> str:
    return ps.status_of(
        residential=row.residential, first_registered_on=row.first_registered_on, permit_on=row.permit_on, today=today
    )


# ---- 解析 ----


def test_decode_rejects_error_pages_and_accepts_bom():
    assert ps.decode(SAMPLE.read_bytes()) is not None
    assert ps.decode("鄉鎮市區,建案名稱".encode("utf-8")) is not None
    assert ps.decode('<table class="border"><tr><td>系統訊息</td></tr></table>'.encode("utf-8")) is None
    assert ps.decode("鄉鎮市區".encode("big5")) is None


def test_sample_parses_broken_rows_and_keeps_the_later_duplicate():
    batch = _sample_batch()
    assert (batch.total, batch.failed, batch.skipped) == (10, 0, 0)
    by_name = {row.name: row for row in batch.rows}
    assert len(batch.rows) == 9 and len(by_name) == 9
    # 同一個 (區, 案名) 再出現視為同案更新（P1）：戶數是後面那筆的 130。
    assert by_name["測試一號"].households == 130
    # 銷售期間含逗號與換行的記錄：續行併入，欄位沒有錯位。
    three = by_name["測試三號"]
    assert (three.households, three.main_use, three.permit_on, three.parcel_section, three.parcel_no) == (
        350, "H2集合住宅", date(2025, 1, 1), "新甲段", "1118-13"
    )
    # 日期格式錯（113311）與空白都是 None；子號 0 的地號不寫子號。
    seven = by_name["測試七號"]
    assert (seven.declared_on, seven.parcel_no) == (None, "99")
    assert by_name["測試四號"].declared_on is None
    # 坐落基地只有段名、沒有地號：沒有地號可查。
    assert (by_name["測試八號"].parcel_section, by_name["測試八號"].parcel_no) == (None, None)


def test_builder_is_never_read_or_stored():
    """起造人（含負責人姓名、自然人）整欄不讀：不在解析結果，也不在資料表。"""
    assert not any("builder" in field.name or "起造" in field.name for field in fields(ps.PresaleRow))
    assert "builder" not in GeoPresaleBuildcase.__table__.columns
    blob = repr(_sample_batch().rows)
    assert "測試建設" not in blob and "測試開發" not in blob and "測試工業" not in blob


def test_bad_rows_are_counted_and_too_many_reject_the_file():
    lines = _sample_lines()
    # 兩列表頭、10 筆（其中 1 筆跨兩行）：塞一筆欄位不夠的壞行，壞行 1/11 超過 5%。
    bad = "\r\n".join([*lines[:3], "三民區,壞行,只有三欄", *lines[3:]])
    with pytest.raises(ps.PresaleFormatError, match="解析不出來"):
        ps.parse_csv(bad)
    # 夠多的好行稀釋後（<5%）壞行只計數、不擋。
    good = [
        f"三民區,多案{index},義華路,甲測試建設股份有限公司,10,住宅區,住家用,鋼筋混凝土造,,自售:無;,澄清段{index}地號,1130105,(113)字,,"
        for index in range(60)
    ]
    batch = ps.parse_csv("\r\n".join([*lines[:2], *good, "三民區,壞行,只有三欄"]))
    assert batch.failed == 1 and len(batch.rows) == 60
    # 戶數不是整數也是壞行。
    batch = ps.parse_csv("\r\n".join([*lines[:2], *good, good[0].replace(",10,", ",十戶,").replace("多案0", "多案x")]))
    assert batch.failed == 1


def test_header_and_row_count_checks():
    with pytest.raises(ps.PresaleFormatError, match="表頭"):
        ps.parse_csv("鄉鎮市區,建案名稱\r\n三民區,甲\r\n")
    with pytest.raises(ps.PresaleFormatError, match="空的"):
        ps.parse_csv("")
    header = _sample_lines()[:2]
    with pytest.raises(ps.PresaleFormatError, match="少於 1 案"):
        ps.parse_csv("\r\n".join(header))
    with pytest.raises(ps.PresaleFormatError, match="少於 50 案"):
        ps.parse_csv("\r\n".join(_sample_lines()), minimum=50)


def test_non_kaohsiung_rows_and_control_characters_are_handled():
    text = _sample_lines()
    nul = text[2].replace("測試一號", "測試\x00一號")
    batch = ps.parse_csv("\r\n".join([*text[:2], nul]))
    assert [row.name for row in batch.rows] == ["測試一號"]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("1090813", date(2020, 8, 13)), ("", None), ("113311", None), ("1130231", None), ("abcdefg", None), (" 1130105 ", date(2024, 1, 5))],
)
def test_roc_date(raw, expected):
    assert ps.roc_date(raw) == expected


@pytest.mark.parametrize(
    ("lands", "expected"),
    [
        ("澄清段二小段75地號", ("澄清段二小段", "75")),
        ("清楠段6-7地號", ("清楠段", "6-7")),
        ("新甲段1118-13地號", ("新甲段", "1118-13")),
        ("昭明段0135-0005地號等7筆", ("昭明段", "135-5")),
        ("鳳芸段地號1137-0000", ("鳳芸段", "1137")),
        ("鹽埔段 45-1 地號", ("鹽埔段", "45-1")),
        ("龍華二小段1379，1379-1地號", ("龍華二小段", "1379")),
        ("仁德段1334之2地號等45筆", ("仁德段", "1334-2")),
        ("九曲段404、408、410地號", ("九曲段", "404")),
        ("高雄市三民區澄清段75地號", ("澄清段", "75")),
        ("港子埔段中坑門小段１０８３地號", ("港子埔段中坑門小段", "1083")),
        ("1060-0000地號等3筆", None),
        ("海城段", None),
        ("", None),
        (None, None),
    ],
)
def test_first_parcel(lands, expected):
    assert ps.first_parcel(lands, "三民區") == expected


# ---- 狀態與預計交屋 ----


def test_status_follows_p3_with_six_year_boundary():
    def status(*, permit, registered=None, residential=True, today=TODAY):
        return ps.status_of(residential=residential, first_registered_on=registered, permit_on=permit, today=today)

    assert status(permit=date(2020, 10, 20)) == "building"  # 剛好往回 6 年
    assert status(permit=date(2020, 10, 19)) == "unknown"
    assert status(permit=None) == "unknown"
    assert status(permit=date(2024, 1, 1), registered=date(2026, 1, 1)) == "registered"
    assert status(permit=date(2024, 1, 1), residential=False) == "non_residential"
    assert status(permit=date(2024, 1, 1), registered=date(2026, 1, 1), residential=False) == "non_residential"
    # 2/29 往回 6 年：2022-02-28 以後算在建。
    assert status(permit=date(2022, 2, 28), today=date(2028, 2, 29)) == "building"
    assert status(permit=date(2022, 2, 27), today=date(2028, 2, 29)) == "unknown"
    by_name = {row.name: _status(row) for row in _sample_batch().rows}
    assert by_name == {
        "測試一號": "building", "測試二號": "building", "測試三號": "building", "測試四號": "building",
        "測試五號": "registered", "測試六號": "non_residential", "測試七號": "building", "測試八號": "unknown",
        "測試九號": "building",
    }


@pytest.mark.parametrize(
    ("households", "months"),
    [(1, 25), (20, 25), (21, 36), (100, 36), (101, 48), (300, 48), (301, 52), (900, 52)],
)
def test_delivery_months_by_scale(households, months):
    assert ps.delivery_months(households) == months


def test_expected_delivery_and_half_year():
    assert ps.expected_delivery(date(2024, 3, 10), 120) == date(2028, 3, 10)
    assert ps.expected_delivery(date(2023, 1, 31), 10) == date(2025, 2, 28)  # 月底截齊
    assert ps.delivery_half(date(2027, 6, 30)) == (2027, 1) and ps.delivery_half(date(2027, 7, 1)) == (2027, 2)


# ---- 街道 ----


@pytest.mark.parametrize(
    ("street", "roads"),
    [
        ("義華路68號旁", ["義華路68號旁"]),
        ("平等路和延慶街交叉口", ["平等路", "延慶街交叉口"]),
        ("和隆街上近草衙二路", ["和隆街上近草衙二路"]),  # 「和」是路名的字，不拆
        ("和平路與中山路口", ["和平路", "中山路口"]),
        ("五和路v.s永田街", ["五和路", "永田街"]),
        ("永田街V.S.永和一街", ["永田街", "永和一街"]),
        ("北瑞興街、南瑞文街", ["北瑞興街", "南瑞文街"]),
        ("中正四路靠近瑞源路，中正骨科對面", ["中正四路靠近瑞源路"]),  # 沒有路名的片段丟掉
        ("橋新三路/橋新八路/橋新環路", ["橋新三路", "橋新八路", "橋新環路"]),
        ("民族街279、294號旁", ["民族街279"]),
    ],
)
def test_split_roads(street, roads):
    assert ps.split_roads(street) == roads


@pytest.mark.parametrize(
    ("street", "is_parcel"),
    [
        ("仁德段1334之2地號等45筆", True),
        ("梓信段475等46筆地號", True),
        ("龍華二小段1379，1379-1地號", True),
        ("鎮昌段293-59地號高雄市前鎮區康和路", True),
        ("海城段", False),
        ("民族一路二段100號", False),
        ("義華路68號旁", False),
        ("鳳林三路492號旁及鳳林三路478巷", False),
    ],
)
def test_is_parcel_street(street, is_parcel):
    assert ps.is_parcel_street(street) is is_parcel


# ---- 定位 ----


async def _match(db, street, *, district="三民區", section=None, landno=None, version="set", parcels=None):
    if version == "set":
        status = await db.get(GeoDatasetStatus, "doorplates")
        version = status.active_version if status is not None else None
    return await ps.match_case(
        db, district=district, street=street, parcel_section=section, parcel_no=landno,
        version=version, parcels=parcels or {},
    )


async def test_match_street_levels_with_coordinates_only_for_exact_and_nearby(db_session):
    await load_geo_samples(db_session)
    exact = await _match(db_session, "義華路68號旁")
    assert (exact.match_level, exact.village_code, exact.village) == ("exact", BENYANG, "本揚里")
    assert (round(exact.lat, 4), round(exact.lon, 4)) == (round(YIHUA_POINT[0], 4), round(YIHUA_POINT[1], 4))
    nearby = await _match(db_session, "義華路74號")
    assert (nearby.match_level, nearby.village_code, nearby.lat is not None) == ("nearby", BENYANG, True)
    street = await _match(db_session, "憲政路")
    assert (street.match_level, street.village_code, street.lat, street.lon) == ("street", BOHUI, None, None)
    # 同一條巷在兩個里：不硬選，只到區。
    ambiguous = await _match(db_session, "旗津三路900巷", district="旗津區")
    assert (ambiguous.match_level, ambiguous.village_code) == ("district", None)
    # 這條路不在門牌表。
    assert (await _match(db_session, "九如一路")).match_level == "district"


async def test_match_two_roads_need_the_same_village_else_first_road(db_session):
    await load_geo_samples(db_session)
    # 兩條路都到里、同一個里：算該里，座標取第一個有座標的（第一條只到街、第二條 exact）。
    same = await _match(db_session, "義華路與義華路68號")
    assert (same.match_level, same.village_code, same.lat is not None) == ("exact", BENYANG, True)
    # 不同里：取第一條路的結果。
    first_exact = await _match(db_session, "義華路68號與憲政路")
    assert (first_exact.match_level, first_exact.village_code) == ("exact", BENYANG)
    first_street = await _match(db_session, "憲政路與義華路68號")
    assert (first_street.match_level, first_street.village_code, first_street.lat) == ("street", BOHUI, None)
    # 第二條路對不到里：照樣取第一條。
    assert (await _match(db_session, "義華路68號與九如一路")).village_code == BENYANG
    # 第一條對不到里、第二條到里：取第一條的結果＝只到區。
    assert (await _match(db_session, "九如一路與義華路68號")).match_level == "district"


async def test_parcel_street_goes_to_district_unless_a_parcel_point_hits(db_session):
    await load_geo_samples(db_session)
    street = "仁德段1334之2地號等45筆"
    assert (await _match(db_session, street, section="仁德段", landno="1334-2")).match_level == "district"
    parcels = {("三民區", "仁德段", "1334-2"): (YIHUA_POINT[1], YIHUA_POINT[0])}
    hit = await _match(db_session, street, section="仁德段", landno="1334-2", parcels=parcels)
    assert (hit.match_level, hit.village_code, hit.village) == ("parcel", BENYANG, "本揚里")
    assert (hit.lat, hit.lon) == YIHUA_POINT
    # 地號座標在別區的地號不會被拿來用（鍵含區）。
    assert (await _match(db_session, street, district="大寮區", section="仁德段", landno="1334-2", parcels=parcels)).match_level == "district"


async def test_parcel_point_wins_over_street_and_falls_back_when_outside_the_boundaries(db_session):
    await load_geo_samples(db_session)
    parcels = {("三民區", "澄清段", "75"): (YIHUA_POINT[1], YIHUA_POINT[0])}
    # 街名比對會到博惠里，地號座標在本揚里：地號優先。
    parcel = await _match(db_session, "憲政路", section="澄清段", landno="75", parcels=parcels)
    assert (parcel.match_level, parcel.village_code) == ("parcel", BENYANG)
    # 座標在里界外（海上）：退回街名比對。
    offshore = {("三民區", "澄清段", "75"): (119.0, 22.0)}
    fallback = await _match(db_session, "憲政路", section="澄清段", landno="75", parcels=offshore)
    assert (fallback.match_level, fallback.village_code) == ("street", BOHUI)


async def test_pending_without_doorplates_but_parcel_still_hits(db_session):
    parcels = {("三民區", "澄清段", "75"): (YIHUA_POINT[1], YIHUA_POINT[0])}
    assert (await _match(db_session, "義華路68號旁", version=None)).match_level == "pending"
    hit = await _match(db_session, "義華路68號旁", section="澄清段", landno="75", version=None, parcels=parcels)
    assert (hit.match_level, hit.village_code) == ("parcel", BENYANG)


# ---- 寫入、換版、重比 ----


NOW = datetime(2026, 10, 20, 3, 0, tzinfo=timezone.utc)


async def _write(app, batch=None, **kwargs):
    kwargs.setdefault("source_version", "115-10")
    kwargs.setdefault("digest", "a" * 64)
    kwargs.setdefault("now", NOW)
    return await ps.write_batch(app.state.session_factory, batch or _sample_batch(), **kwargs)


async def _cases(app) -> dict[str, GeoPresaleBuildcase]:
    async with app.state.session_factory() as db:
        return {row.name: row for row in (await db.execute(select(GeoPresaleBuildcase))).scalars()}


async def test_write_batch_matches_rows_and_records_the_status(app, db_session):
    await load_geo_samples(db_session)
    assert await _write(app) == 9
    cases = await _cases(app)
    assert {name: (row.match_level, row.village) for name, row in cases.items()} == {
        "測試一號": ("exact", "本揚里"), "測試二號": ("street", "博惠里"), "測試三號": ("street", "八卦里"),
        "測試四號": ("district", None), "測試五號": ("street", "文英里"), "測試六號": ("district", None),
        "測試七號": ("street", "本揚里"), "測試八號": ("street", "大華里"), "測試九號": ("district", None),
    }
    assert cases["測試一號"].households == 130 and cases["測試一號"].source_version == "115-10"
    assert cases["測試一號"].doorplate_version == "115-10" and cases["測試一號"].lat is not None
    assert cases["測試二號"].match_level == "street" and cases["測試二號"].lat is None
    assert cases["測試六號"].residential is False
    async with app.state.session_factory() as db:
        status = await db.get(GeoDatasetStatus, "presale_buildcases")
    assert (status.active_version, status.label, status.last_error) == ("a" * 64, "115-10", None)
    assert status.synced_at == NOW and status.checked_at == NOW


async def test_write_batch_replaces_with_the_new_file_and_updates_same_key(app, db_session):
    await load_geo_samples(db_session)
    await _write(app)
    smaller = ps.PresaleBatch(rows=[row for row in _sample_batch().rows if row.name in ("測試一號", "測試二號")])
    await _write(app, smaller, source_version="115-11", digest="b" * 64)
    cases = await _cases(app)
    assert sorted(cases) == ["測試一號", "測試二號"]
    assert cases["測試一號"].source_version == "115-11"
    async with app.state.session_factory() as db:
        assert (await db.get(GeoDatasetStatus, "presale_buildcases")).label == "115-11"


async def test_shrink_guard_blocks_a_truncated_file_unless_forced(app, db_session, monkeypatch):
    await load_geo_samples(db_session)
    await _write(app)
    monkeypatch.setattr(ps, "SHRINK_MIN_EXISTING", 5)
    tiny = ps.PresaleBatch(rows=_sample_batch().rows[:3])
    with pytest.raises(ps.PresaleFormatError, match="少了兩成"):
        await _write(app, tiny)
    assert len(await _cases(app)) == 9  # 沒換
    # 剛好 80%（9 案 → 8 案）不擋；--force 略過檢查。
    await _write(app, ps.PresaleBatch(rows=_sample_batch().rows[:8]))
    assert len(await _cases(app)) == 8
    await _write(app, tiny, check_shrink=False)
    assert len(await _cases(app)) == 3


async def test_rematch_after_doorplates_arrive_and_after_parcels_are_imported(app, db_session):
    # 門牌還沒匯入：只有街名的案是 pending。
    await _write(app)
    before = await _cases(app)
    assert {row.match_level for row in before.values()} == {"pending"}
    assert all(row.doorplate_version is None for row in before.values())
    assert await ps.rematch(app.state.session_factory) == 0  # 門牌還沒匯入，什麼都不做

    await load_geo_samples(db_session)
    changed = await ps.rematch(app.state.session_factory)
    assert changed == 9
    after = await _cases(app)
    assert after["測試一號"].match_level == "exact" and after["測試一號"].doorplate_version == "115-10"
    assert await ps.rematch(app.state.session_factory) == 0  # 門牌月份一樣，不再重比

    # 匯入地號座標後 everything 重比：測試二號改成 parcel（本揚里）。
    db_session.add(GeoParcelPoint(district="三民區", section_name="明義段", landno="90", lon=YIHUA_POINT[1], lat=YIHUA_POINT[0], fetched_on=TODAY))
    db_session.add(GeoParcelPoint(district="三民區", section_name="澄清段二小段", landno="75", lon=None, lat=None, fetched_on=TODAY))
    await db_session.commit()
    assert await ps.rematch(app.state.session_factory) == 0  # 沒要求 everything 就不動
    assert await ps.rematch(app.state.session_factory, everything=True) == 1
    final = await _cases(app)
    assert (final["測試二號"].match_level, final["測試二號"].village) == ("parcel", "本揚里")
    assert final["測試一號"].match_level == "exact"  # 查無座標的地號（空 lon/lat）不影響


async def test_write_uses_parcel_points_at_write_time(app, db_session):
    await load_geo_samples(db_session)
    db_session.add(GeoParcelPoint(district="大寮區", section_name="仁德段", landno="1334-2", lon=YIHUA_POINT[1], lat=YIHUA_POINT[0], fetched_on=TODAY))
    await db_session.commit()
    await _write(app)
    row = (await _cases(app))["測試九號"]
    assert (row.match_level, row.village_code) == ("parcel", BENYANG)


async def test_counts_are_unchanged_by_residential_filter_in_table(app, db_session):
    await load_geo_samples(db_session)
    await _write(app)
    async with app.state.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(GeoPresaleBuildcase)) == 9
        assert await db.scalar(
            select(func.count()).select_from(GeoPresaleBuildcase).where(GeoPresaleBuildcase.residential.is_(False))
        ) == 1
