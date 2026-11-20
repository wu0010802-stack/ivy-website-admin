"""房價租金同步（2026-11-20 規格 §7.1「同步」、§11 第 7 條）：網路模式找最新季、往回 4 季逐季抓買賣與租賃、
缺一個檔就跳過那一季、殘缺檔不寫且舊資料保留；檔案模式要同季成對；門牌換版後重比。
HTTP 一律用 MockTransport，不連外；CSV 都是測試內組出來的假資料。"""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from app.admissions.geo import housing as hs
from app.admissions.geo import sync
from app.admissions.geo.models import GeoDatasetStatus, GeoHousingDeal
from tests.geo_helpers import INCOME_SAMPLE, PLVR_ERROR_PAGE, load_geo_samples

BOM = "\N{ZERO WIDTH NO-BREAK SPACE}"
SALE_COLUMNS = (
    "鄉鎮市區", "交易標的", "土地位置建物門牌", "交易筆棟數", "建物型態", "主要用途", "建物移轉總面積平方公尺",
    "總價元", "車位移轉總面積平方公尺", "車位總價元", "備註", "編號",
)
RENT_COLUMNS = (
    "鄉鎮市區", "交易標的", "土地位置建物門牌", "建物型態", "主要用途", "總額元", "出租型態", "備註", "編號",
)
SEASONS = ["115S1", "115S2", "115S3", "115S4", "116S1"]


def _csv(columns: tuple[str, ...], rows: list[dict[str, str]]) -> bytes:
    lines = [BOM + ",".join(columns), ",".join(f"english {i}" for i in range(len(columns)))]
    for row in rows:
        lines.append(",".join('"' + row[name] + '"' for name in columns))
    return ("\r\n".join(lines) + "\r\n").encode("utf-8")


def sale_file(season: str, count: int = 2) -> bytes:
    return _csv(SALE_COLUMNS, [
        {
            "鄉鎮市區": "苓雅區", "交易標的": "房地(土地+建物)+車位", "土地位置建物門牌": f"高雄市苓雅區假路{10 + i}號五樓",
            "交易筆棟數": "土地1建物1車位1", "建物型態": "住宅大樓(11層含以上有電梯)", "主要用途": "住家用",
            "建物移轉總面積平方公尺": "120.0", "總價元": "12000000", "車位移轉總面積平方公尺": "30.0",
            "車位總價元": "1500000", "備註": "", "編號": f"S{season}-{i}",
        }
        for i in range(count)
    ])


def rent_file(season: str, count: int = 2) -> bytes:
    return _csv(RENT_COLUMNS, [
        {
            "鄉鎮市區": "苓雅區", "交易標的": "租賃房屋", "土地位置建物門牌": f"高雄市苓雅區假路{10 + i}號五樓",
            "建物型態": "住宅大樓(11層含以上有電梯)", "主要用途": "住家用", "總額元": "18500",
            "出租型態": "整棟(戶)出租", "備註": "", "編號": f"R{season}-{i}",
        }
        for i in range(count)
    ])


def _site(*, sale_seasons=None, rent_seasons=None, sale_rows: dict[str, int] | None = None):
    """假的實價登錄季檔下載；沒列在 *_seasons 的季回 HTTP 200 的錯誤頁（和真的一樣）。"""
    sale_seasons = set(SEASONS if sale_seasons is None else sale_seasons)
    rent_seasons = set(SEASONS if rent_seasons is None else rent_seasons)
    sale_rows = sale_rows or {}

    def handle(request: httpx.Request) -> httpx.Response:
        url = request.url
        season, name = url.params.get("season", ""), url.params.get("fileName")
        if str(url).split("?")[0] != "https://plvr.land.moi.gov.tw/DownloadSeason":
            return httpx.Response(404)
        if name == hs.SALE_FILE and season in sale_seasons:
            return httpx.Response(200, content=sale_file(season, sale_rows.get(season, 2)))
        if name == hs.RENT_FILE and season in rent_seasons:
            return httpx.Response(200, content=rent_file(season))
        return httpx.Response(200, text=PLVR_ERROR_PAGE, headers={"content-type": "text/html"})

    return httpx.MockTransport(handle)


@pytest.fixture(autouse=True)
def small_minimum(monkeypatch):
    monkeypatch.setattr(hs, "MIN_SEASON_ROWS", 2)
    monkeypatch.setattr(sync, "today_local", lambda *args: date(2027, 2, 1))  # 116S1


async def _run(app, transport, **kwargs) -> tuple[str, int]:
    async with sync.new_client(transport=transport) as client:
        return await sync.sync_housing(
            app.state.session_factory, client, now=datetime.now(timezone.utc), force=False, files=None, **kwargs
        )


async def _seasons(app) -> set[str]:
    async with app.state.session_factory() as db:
        return await hs.seasons_in_table(db)


async def test_housing_sync_writes_latest_four_seasons(app):
    assert await _run(app, _site()) == ("updated", 4)
    assert await _seasons(app) == {"115S2", "115S3", "115S4", "116S1"}
    async with app.state.session_factory() as db:
        status = await db.get(GeoDatasetStatus, "housing")
    assert (status.label, status.last_error) == ("116S1", None) and status.checked_at is not None


async def test_housing_sync_skips_season_missing_rent_file(app):
    first = hs.parse_season(sale_file("115S3").decode(), rent_file("115S3").decode(), "115S3", minimum=2)
    await hs.write_season(app.state.session_factory, first, now=datetime.now(timezone.utc))
    result = await _run(app, _site(rent_seasons=set(SEASONS) - {"116S1"}))
    assert result == ("updated", 2)  # 115S4、115S2 寫入；116S1 租賃檔是錯誤頁整季不寫
    assert await _seasons(app) == {"115S2", "115S3", "115S4"}
    async with app.state.session_factory() as db:
        serials = set((await db.execute(select(GeoHousingDeal.serial).where(GeoHousingDeal.season == "115S3"))).scalars())
    assert serials == {"S115S3-0", "S115S3-1", "R115S3-0", "R115S3-1"}  # 舊季沒動


async def test_housing_sync_records_error_and_keeps_old(app):
    old = hs.parse_season(sale_file("115S2").decode(), rent_file("115S2").decode(), "115S2", minimum=2)
    await hs.write_season(app.state.session_factory, old, now=datetime.now(timezone.utc))
    result = await _run(app, _site(sale_seasons={"115S3"}, sale_rows={"115S3": 1}))
    assert result == ("failed", 0)
    assert await _seasons(app) == {"115S2"}
    async with app.state.session_factory() as db:
        status = await db.get(GeoDatasetStatus, "housing")
    assert status.last_error and "115S3" in status.last_error and status.active_version == "115S2"


async def test_housing_files_mode_requires_pairs(app, tmp_path: Path):
    only_sale = tmp_path / "115S3_e_lvr_land_a.csv"
    only_sale.write_bytes(sale_file("115S3"))
    with pytest.raises(sync.GeoSyncError):
        sync._housing_files([only_sale])
    result = await sync.sync_housing(
        app.state.session_factory, None, now=datetime.now(timezone.utc), force=False, files=[only_sale]
    )
    assert result == ("failed", 0) and await _seasons(app) == set()
    rent = tmp_path / "115S3_e_lvr_land_c.csv"
    rent.write_bytes(rent_file("115S3"))
    result = await sync.sync_housing(
        app.state.session_factory, None, now=datetime.now(timezone.utc), force=False, files=[rent, only_sale]
    )
    assert result == ("updated", 1) and await _seasons(app) == {"115S3"}


async def test_run_geo_sync_rematches_housing_after_doorplate_change(app, db_session, tmp_path: Path):
    sale, rent = tmp_path / "115S3_e_lvr_land_a.csv", tmp_path / "115S3_e_lvr_land_c.csv"
    sale.write_bytes(sale_file("115S3"))
    rent.write_bytes(rent_file("115S3"))
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, housing_files=[sale, rent])
    assert (result.housing, result.housing_version, result.housing_seasons, result.housing_rematched) == (
        "updated", "115S3", 1, 0,
    )
    await load_geo_samples(db_session)  # 門牌之後才匯入：寫入時是 pending，換版後要重比
    income = tmp_path / "112_165-E.csv"
    income.write_bytes(INCOME_SAMPLE.read_bytes())
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, income_file=income)
    assert (result.housing, result.housing_rematched) == ("skipped", 4)
