"""區域分析房價租金（2026-11-20 規格 §7.1、§7.2、§11 第 4、5 條）：實價登錄買賣（H1）與租賃（H2）季檔的解析與篩選、
單價計算、中位數、寫入（較新季覆蓋、保留 4 季）、依里取交易與合併後的中位數。

CSV 都是測試內組出來的假資料（假地址、假編號），不放真檔的任何列。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.admissions.geo import boundaries
from app.admissions.geo import housing as hs
from app.admissions.geo.models import GeoDatasetStatus, GeoHousingDeal

BOM = "\ufeff"
SALE_COLUMNS = (
    "鄉鎮市區", "交易標的", "土地位置建物門牌", "交易筆棟數", "建物型態", "主要用途", "建物移轉總面積平方公尺",
    "總價元", "車位移轉總面積平方公尺", "車位總價元", "備註", "編號",
)
RENT_COLUMNS = (
    "鄉鎮市區", "交易標的", "土地位置建物門牌", "建物型態", "主要用途", "總額元", "出租型態", "備註", "編號",
)
SEASON = "115S3"


def _sale(**override) -> dict[str, str]:
    row = {
        "鄉鎮市區": "苓雅區", "交易標的": "房地(土地+建物)+車位", "土地位置建物門牌": "高雄市苓雅區假路１０號五樓",
        "交易筆棟數": "土地1建物1車位1", "建物型態": "住宅大樓(11層含以上有電梯)", "主要用途": "住家用",
        "建物移轉總面積平方公尺": "120.0", "總價元": "12000000", "車位移轉總面積平方公尺": "30.0",
        "車位總價元": "1500000", "備註": "", "編號": "SALE0001",
    }
    return {**row, **{key: str(value) for key, value in override.items()}}


def _rent(**override) -> dict[str, str]:
    row = {
        "鄉鎮市區": "苓雅區", "交易標的": "租賃房屋", "土地位置建物門牌": "高雄市苓雅區假路１０號五樓",
        "建物型態": "住宅大樓(11層含以上有電梯)", "主要用途": "住家用", "總額元": "18500",
        "出租型態": "整棟(戶)出租", "備註": "", "編號": "RENT0001",
    }
    return {**row, **{key: str(value) for key, value in override.items()}}


def _csv(columns: tuple[str, ...], rows: list[dict[str, str]]) -> str:
    """兩列表頭（中、英）加資料列，第一欄前加 BOM，CRLF。"""
    lines = [BOM + ",".join(columns), ",".join(f"english {i}" for i in range(len(columns)))]
    for row in rows:
        lines.append(",".join('"' + row[name].replace('"', '""') + '"' for name in columns))
    return "\r\n".join(lines) + "\r\n"


def _sales(*rows: dict[str, str]) -> list[hs.HousingRow]:
    return hs.parse_sales(_csv(SALE_COLUMNS, list(rows)), SEASON)


def _rents(*rows: dict[str, str]) -> list[hs.HousingRow]:
    return hs.parse_rents(_csv(RENT_COLUMNS, list(rows)), SEASON)


# ---- 買賣（H1） ----


def test_sale_keeps_ordinary_residential_and_computes_net_unit_price():
    """總價 1,200 萬、車位 150 萬、建物 120 m²、車位 30 m²：(1050 萬) ÷ (90 m² ÷ 3.30579) 四捨五入到百元。"""
    rows = _sales(_sale())
    assert len(rows) == 1
    row = rows[0]
    assert (row.kind, row.serial, row.season, row.building_type, row.district) == (
        "sale", "SALE0001", SEASON, "住宅大樓", "苓雅區",
    )
    assert row.unit_price == 385700 and row.monthly_rent is None
    assert row.street == "假路" and row.number == 10


@pytest.mark.parametrize(
    "note",
    ["親友", "員工", "特殊關係", "共有人", "瑕疵", "急買急賣", "政府機關", "債權債務", "拍賣", "含增建", "未登記建物", "毛胚", "預售屋"],
)
def test_sale_excludes_each_special_note(note):
    assert _sales(_sale(備註=f"本件有{note}之情形")) == []


@pytest.mark.parametrize(
    "override",
    [
        {"主要用途": "商業用"},
        {"建物型態": "店面(店鋪)"},
        {"交易標的": "土地"},
        {"交易筆棟數": "土地1建物2車位0"},
        {"建物移轉總面積平方公尺": "39.9", "車位移轉總面積平方公尺": "30.0"},  # 淨面積 9.9 m²
        {"總價元": "0"},
        {"總價元": "80000000000"},  # 單價約 29 億元／坪：超過 integer 欄位的防線（20 億）
    ],
)
def test_sale_excludes_non_residential_and_multi_building(override):
    assert _sales(_sale(**override)) == []


def test_sale_without_parking_uses_whole_price_and_area():
    rows = _sales(_sale(交易標的="房地(土地+建物)", 交易筆棟數="土地1建物1車位0", 車位移轉總面積平方公尺="0.0", 車位總價元="", 總價元="9000000", 建物移轉總面積平方公尺="100.0"))
    assert rows[0].unit_price == round(9_000_000 / (100 / 3.30579) / 100) * 100


# ---- 租賃（H2） ----


@pytest.mark.parametrize("rent_type", ["獨立套房", "分租套房", "分租雅房", "分層出租", ""])
def test_rent_excludes_partial_unit_rentals(rent_type):
    assert _rents(_rent(出租型態=rent_type)) == []


def test_rent_keeps_whole_unit_only():
    rows = _rents(_rent(), _rent(編號="RENT0002", 出租型態="獨立套房"), _rent(編號="RENT0003", 總額元="0"))
    assert [row.serial for row in rows] == ["RENT0001"]
    row = rows[0]
    assert (row.kind, row.building_type, row.monthly_rent, row.unit_price) == ("rent", "住宅大樓", 18500, None)


def test_rent_over_int32_guard_is_dropped():
    """月租超過 20 億（integer 欄位上限 21.4 億）多半是打錯：整列不收，剛好 20 億照收。"""
    rows = _rents(_rent(總額元="2000000000"), _rent(編號="RENT0002", 總額元="2000000001"), _rent(編號="RENT0003", 總額元="99999999999"))
    assert [row.serial for row in rows] == ["RENT0001"]


@pytest.mark.parametrize("note", ["親友", "員工", "特殊關係"])
def test_rent_excludes_related_party_notes(note):
    assert _rents(_rent(備註=f"{note}間租賃")) == []


def test_rent_excludes_non_residential_use():
    assert _rents(_rent(主要用途="商業用")) == []
    assert len(_rents(_rent(主要用途="集合住宅"))) == 1


def test_rent_excludes_non_residential_building_and_target():
    assert _rents(_rent(建物型態="店面(店鋪)")) == []
    assert _rents(_rent(交易標的="土地")) == []


# ---- 格式與整季 ----


def test_missing_required_column_raises_without_leaking_content():
    text = _csv(tuple(c for c in SALE_COLUMNS if c != "總價元"), [])
    with pytest.raises(hs.HousingFormatError) as raised:
        hs.parse_sales(text, SEASON)
    assert "總價元" in str(raised.value) and "假路" not in str(raised.value)


def test_duplicate_serial_raises():
    with pytest.raises(hs.HousingFormatError):
        _sales(_sale(), _sale())


def test_parse_season_rejects_short_file():
    """買賣只有 999 筆可用就是殘缺檔；租賃夠多也一樣不寫。"""
    sale = _csv(SALE_COLUMNS, [_sale(編號=f"S{i}") for i in range(999)])
    rent = _csv(RENT_COLUMNS, [_rent(編號=f"R{i}") for i in range(1000)])
    with pytest.raises(hs.HousingFormatError):
        hs.parse_season(sale, rent, SEASON)
    with pytest.raises(hs.HousingFormatError):
        hs.parse_season(_csv(SALE_COLUMNS, [_sale(編號=f"S{i}") for i in range(1000)]), _csv(RENT_COLUMNS, [_rent(編號=f"R{i}") for i in range(999)]), SEASON)


def test_parse_season_returns_both_kinds_and_skipped_count():
    sale = _csv(SALE_COLUMNS, [_sale(編號="S1"), _sale(編號="S2", 備註="親友")])
    rent = _csv(RENT_COLUMNS, [_rent(編號="R1"), _rent(編號="R2", 出租型態="獨立套房")])
    batch = hs.parse_season(sale, rent, SEASON, minimum=1)
    assert batch.season == SEASON
    assert [r.serial for r in batch.sales] == ["S1"] and [r.serial for r in batch.rents] == ["R1"]
    assert batch.skipped == 2


# ---- 中位數 ----


def test_median_needs_five():
    assert hs.median([1, 2, 3, 4]) is None
    assert hs.median([1, 2, 3, 4, 5]) == 3
    assert hs.median([1, 2, 3, 4, 5, 6]) == 4  # 3.5 四捨五入
    assert hs.median([5, 1, 4, 2, 3, 100]) == 4  # 沒排序也行
    assert hs.median([1, 2, 3, 4], minimum=4) == 3  # (2 + 3 + 1) // 2


# ---- 資料庫 ----


def _batch(season: str, sales: list[str], rents: list[str] | None = None) -> hs.HousingBatch:
    def row(kind: str, serial: str) -> hs.HousingRow:
        return hs.HousingRow(
            kind=kind, serial=serial, season=season, building_type="公寓", district="苓雅區", street="假路", lane="",
            alley="", number=10, number_sub=0, unit_price=300000 if kind == "sale" else None,
            monthly_rent=15000 if kind == "rent" else None,
        )

    return hs.HousingBatch(
        season=season, sales=[row("sale", s) for s in sales], rents=[row("rent", r) for r in rents or []], skipped=0
    )


async def _deals(app) -> dict[tuple[str, str], GeoHousingDeal]:
    async with app.state.session_factory() as db:
        return {(d.kind, d.serial): d for d in (await db.execute(select(GeoHousingDeal))).scalars()}


async def test_write_season_upserts_newer_season_and_prunes(app):
    now = datetime.now(timezone.utc)
    factory = app.state.session_factory
    for season in ("115S1", "115S2"):
        await hs.write_season(factory, _batch(season, [f"A-{season}"]), now=now)
    # 同一個 (sale, 編號) 在 115S3 與 115S4 都有：留 115S4 那列。
    await hs.write_season(factory, _batch("115S3", ["A-115S3", "DUP"]), now=now)
    await hs.write_season(factory, _batch("115S4", ["DUP", "A-115S4"], ["RENT-1"]), now=now)
    # 較舊的季後寫也不會蓋掉較新的。
    await hs.write_season(factory, _batch("115S3", ["A-115S3", "DUP"]), now=now)
    deals = await _deals(app)
    assert deals[("sale", "DUP")].season == "115S4"
    assert ("rent", "RENT-1") in deals
    assert {d.season for d in deals.values()} == {"115S1", "115S2", "115S3", "115S4"}

    latest = await hs.write_season(factory, _batch("116S1", ["NEW"]), now=now)
    assert latest == "116S1"
    deals = await _deals(app)
    assert {d.season for d in deals.values()} == {"115S2", "115S3", "115S4", "116S1"}  # 只剩後四季
    async with app.state.session_factory() as db:
        assert await hs.seasons_in_table(db) == {"115S2", "115S3", "115S4", "116S1"}
        status = await db.get(GeoDatasetStatus, "housing")
    assert (status.label, status.active_version, status.last_error) == ("116S1", "116S1", None)
    assert status.synced_at == now


async def test_write_season_replaces_that_season(app):
    now = datetime.now(timezone.utc)
    await hs.write_season(app.state.session_factory, _batch("115S3", ["A", "B"]), now=now)
    await hs.write_season(app.state.session_factory, _batch("115S3", ["A"]), now=now)
    assert set(await _deals(app)) == {("sale", "A")}


def _two_villages() -> list[tuple[str, str, str]]:
    names = sorted(boundaries.village_names().items())
    return [(code, district, village) for code, (district, village) in names[:2]]


async def _insert_deals(app, village: tuple[str, str, str], kind: str, prices: list[int], *, level: str = "exact", season: str = "115S3"):
    _, district, name = village
    async with app.state.session_factory() as db:
        for i, price in enumerate(prices):
            db.add(
                GeoHousingDeal(
                    kind=kind, serial=f"{kind}-{name}-{season}-{level}-{i}", season=season, building_type="公寓",
                    district=district, street="假路", lane="", alley="", number=i, number_sub=0, village=name,
                    match_level=level, doorplate_version="115-10",
                    unit_price=price if kind == "sale" else None, monthly_rent=price if kind == "rent" else None,
                )
            )
        await db.commit()


async def test_deals_by_code_and_summarize(app):
    villages = _two_villages()
    code_a, code_b = villages[0][0], villages[1][0]
    await _insert_deals(app, villages[0], "sale", [300000, 310000, 320000])
    await _insert_deals(app, villages[1], "sale", [330000, 340000, 350000, 360000])
    await _insert_deals(app, villages[1], "rent", [15000, 16000])
    await _insert_deals(app, villages[1], "sale", [999999] * 9, level="district")  # 沒比到里的不算
    async with app.state.session_factory() as db:
        latest, seasons, by_code = await hs.deals_by_code(db, [code_a, code_b])
    assert latest == "115S3" and seasons == ["115S3"]
    assert by_code[code_a] == ([300000, 310000, 320000], [])
    assert sorted(by_code[code_b][0]) == [330000, 340000, 350000, 360000] and sorted(by_code[code_b][1]) == [15000, 16000]

    alone = hs.summarize(by_code, [code_a])
    assert alone == {"sale_median": None, "sale_count": 3, "rent_median": None, "rent_count": 0}
    assert hs.summarize(by_code, [code_b])["sale_median"] is None  # 4 筆還是不夠
    merged = hs.summarize(by_code, [code_a, code_b])
    assert merged["sale_count"] == 7 and merged["sale_median"] == 330000
    assert merged["rent_count"] == 2 and merged["rent_median"] is None
    assert hs.summarize(by_code, ["不存在"]) == {"sale_median": None, "sale_count": 0, "rent_median": None, "rent_count": 0}


async def test_deals_by_code_only_reads_the_latest_four_seasons_present(app):
    villages = _two_villages()
    await _insert_deals(app, villages[0], "sale", [1] * 5, season="115S1")
    await _insert_deals(app, villages[0], "sale", [2] * 5, season="115S3")
    async with app.state.session_factory() as db:
        latest, seasons, by_code = await hs.deals_by_code(db, [villages[0][0]])
    assert latest == "115S3" and seasons == ["115S1", "115S3"]
    assert len(by_code[villages[0][0]][0]) == 10


async def test_deals_by_code_empty_table(app):
    async with app.state.session_factory() as db:
        assert await hs.deals_by_code(db, ["x"]) == (None, [], {})
