"""預售建案的同步與打包（2026-10-20 預售建案規格 P6–P9）：每 30 天一次、內容沒變只記確認、換版以新檔為準、縮水與上限、
連線被 reset 重試、地號座標只從檔案匯入且正式站同步完全不連國土測繪中心、CLI 與打包檔。HTTP 一律用 MockTransport。"""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select, update

from app import cli
from app.admissions.geo import presale as ps
from app.admissions.geo import presale_parcels as pp
from app.admissions.geo import sync
from app.admissions.geo.bundle import BundleFile, BundleError, open_bundle, write_bundle
from app.admissions.geo.models import GeoDatasetStatus, GeoParcelPoint, GeoPresaleBuildcase
from app.cli import geo_sync_command, geo_sync_options
from tests.geo_helpers import YIHUA_POINT, load_geo_samples
from tests.test_geo_presale import SAMPLE

TODAY = date(2026, 10, 20)


@pytest.fixture(autouse=True)
def _today(monkeypatch):
    monkeypatch.setattr(sync, "today_local", lambda *args: TODAY)


@pytest.fixture
def no_wait(monkeypatch):
    waits: list[float] = []

    async def record(seconds: float) -> None:
        waits.append(seconds)

    monkeypatch.setattr(sync, "_sleep", record)
    return waits


def _site(body: bytes | None = None, *, content_type: str = "text/csv"):
    """假的內政部下載站：只有預售建案單檔；任何別的網址（含國土測繪中心）都記下來，測試要求空的。"""
    seen: list[str] = []
    other: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == ps.SOURCE_URL:
            seen.append(url)
            return httpx.Response(200, content=SAMPLE.read_bytes() if body is None else body, headers={"content-type": content_type})
        other.append(url)
        return httpx.Response(404)

    return httpx.MockTransport(handle), seen, other


async def _sync(app, transport, *, now=None, force=False):
    async with httpx.AsyncClient(transport=transport) as client:
        return await sync.sync_presale(
            app.state.session_factory, client, now=now or datetime.now(timezone.utc), force=force, file=None
        )


async def _status(app) -> GeoDatasetStatus | None:
    async with app.state.session_factory() as db:
        return await db.get(GeoDatasetStatus, "presale_buildcases")


async def _cases(app) -> dict[str, GeoPresaleBuildcase]:
    async with app.state.session_factory() as db:
        return {row.name: row for row in (await db.execute(select(GeoPresaleBuildcase))).scalars()}


# ---- 網路 ----


async def test_first_sync_downloads_the_single_file_and_records_the_version(app, db_session):
    await load_geo_samples(db_session)
    transport, seen, other = _site()
    assert await _sync(app, transport) == ("updated", 9)
    assert seen == [ps.SOURCE_URL] and other == []
    status = await _status(app)
    assert (status.label, status.last_error) == (sync.current_label(), None)
    assert status.active_version == hashlib.sha256(SAMPLE.read_bytes()).hexdigest()
    assert (await _cases(app))["測試一號"].match_level == "exact"


async def test_not_due_means_no_request_and_same_content_only_records_the_check(app, db_session):
    await load_geo_samples(db_session)
    transport, seen, _ = _site()
    await _sync(app, transport)
    # 30 天內不連外。
    assert await _sync(app, transport) == ("skipped", 0) and len(seen) == 1
    # 超過 30 天：下載後內容一樣，只記確認時間，不重寫案子。
    async with app.state.session_factory() as db:
        await db.execute(update(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "presale_buildcases").values(
            checked_at=datetime.now(timezone.utc) - timedelta(days=31)
        ))
        await db.commit()
    before = (await _cases(app))["測試一號"].updated_at
    now = datetime.now(timezone.utc)
    assert await _sync(app, transport, now=now) == ("skipped", 0) and len(seen) == 2
    assert (await _status(app)).checked_at == now
    assert (await _cases(app))["測試一號"].updated_at == before


async def test_changed_file_replaces_the_cases_and_force_redownloads(app, db_session):
    await load_geo_samples(db_session)
    await _sync(app, _site()[0])
    lines = SAMPLE.read_bytes().decode("utf-8-sig").split("\r\n")
    smaller = "﻿" + "\r\n".join(line for line in lines if "測試二號" not in line and "測試五號" not in line)
    assert await _sync(app, _site(smaller.encode("utf-8"))[0], force=True) == ("updated", 7)
    assert set(await _cases(app)) == {f"測試{n}號" for n in ("一", "三", "四", "六", "七", "八", "九")}
    # force 且內容沒變也重抓、重寫。
    assert await _sync(app, _site(smaller.encode("utf-8"))[0], force=True) == ("updated", 7)


async def test_error_page_and_shrunken_file_keep_the_old_cases(app, db_session, monkeypatch):
    await load_geo_samples(db_session)
    await _sync(app, _site()[0])
    page = '<table class="border"><tr><td class="text_bg">系統訊息</td></tr></table>'.encode("utf-8")
    assert await _sync(app, _site(page, content_type="text/html")[0], force=True) == ("failed", 0)
    assert "不是預售建案檔" in (await _status(app)).last_error
    assert len(await _cases(app)) == 9
    monkeypatch.setattr(ps, "SHRINK_MIN_EXISTING", 5)
    lines = SAMPLE.read_bytes().decode("utf-8-sig").split("\r\n")
    tiny = "﻿" + "\r\n".join([*lines[:2], lines[2], lines[3]])
    # 還沒到期不會下載；把確認時間撥到 31 天前讓它到期（不是 force），縮水的檔不換。
    async with app.state.session_factory() as db:
        await db.execute(update(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "presale_buildcases").values(checked_at=datetime.now(timezone.utc) - timedelta(days=31)))
        await db.commit()
    assert await _sync(app, _site(tiny.encode("utf-8"))[0]) == ("failed", 0)
    assert "少了兩成" in (await _status(app)).last_error and len(await _cases(app)) == 9
    # --force 略過縮水檢查。
    assert await _sync(app, _site(tiny.encode("utf-8"))[0], force=True) == ("updated", 2)


async def test_download_is_capped_and_retries_connection_resets(app, db_session, monkeypatch, no_wait):
    await load_geo_samples(db_session)
    monkeypatch.setattr(ps, "MAX_BYTES", 100)
    assert await _sync(app, _site()[0]) == ("failed", 0)
    assert "大小上限" in (await _status(app)).last_error
    monkeypatch.setattr(ps, "MAX_BYTES", 2 * 1024 * 1024)
    attempts: list[int] = []

    def flaky(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        if len(attempts) < 3:
            raise httpx.ConnectError("reset")
        return httpx.Response(200, content=SAMPLE.read_bytes(), headers={"content-type": "text/csv"})

    assert await _sync(app, httpx.MockTransport(flaky), force=True) == ("updated", 9)
    assert len(attempts) == 3 and no_wait == [2.0, 4.0]


async def test_only_https_is_followed(app, db_session):
    def redirect(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://plvr.land.moi.gov.tw/x"})

    async with sync.new_client(transport=httpx.MockTransport(redirect)) as client:
        result = await sync.sync_presale(
            app.state.session_factory, client, now=datetime.now(timezone.utc), force=False, file=None
        )
    assert result == ("failed", 0) and "https" in (await _status(app)).last_error


# ---- 檔案：run_geo_sync ----


def _copy(tmp_path: Path, name: str) -> Path:
    path = tmp_path / name
    path.write_bytes(SAMPLE.read_bytes())
    return path


async def test_file_mode_never_connects_and_takes_the_version_from_the_filename(app, db_session, tmp_path):
    await load_geo_samples(db_session)
    path = _copy(tmp_path, "presale-buildcases-115-09.csv")

    def forbidden(request: httpx.Request) -> httpx.Response:  # pragma: no cover - 呼叫就是錯
        raise AssertionError(f"檔案模式不該連外：{request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(forbidden)) as client:
        result = await sync.run_geo_sync(
            app.state.session_factory, app.state.settings, presale_buildcases_file=path, client=client
        )
    assert (result.presale_buildcases, result.presale_buildcases_version, result.presale_cases) == ("updated", "115-09", 9)
    assert (result.presale_parcels, result.presale_parcel_rows, result.presale_rematched) == ("skipped", 0, 0)
    # 其他資料沒指定檔案，全部跳過。
    assert (result.doorplates, result.new_homes, result.income) == ("skipped", "skipped", "skipped")


async def test_a_file_without_a_month_uses_today_and_a_bad_file_fails(app, db_session, tmp_path):
    await load_geo_samples(db_session)
    path = _copy(tmp_path, "e_lvr_buildcase.csv")
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, presale_buildcases_file=path)
    assert result.presale_buildcases_version == "115-10"
    bad = tmp_path / "bad.csv"
    bad.write_text("<html>系統訊息</html>", encoding="utf-8")
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, presale_buildcases_file=bad, force=True)
    assert result.presale_buildcases == "failed" and "不是預售建案檔" in (await _status(app)).last_error


# ---- 地號座標 ----

PARCELS_HEADER = ",".join(pp.COLUMNS)


def _parcels_file(tmp_path: Path, *rows: str, name: str = "presale_parcels.csv") -> Path:
    path = tmp_path / name
    path.write_text("\n".join([PARCELS_HEADER, *rows]) + "\n", encoding="utf-8")
    return path


def _yihua_parcel(section: str = "明義段", landno: str = "90") -> str:
    return f"三民區,{section},{landno},DA,0123,{YIHUA_POINT[1]},{YIHUA_POINT[0]},2026-10-20"


async def test_parcels_file_imports_then_everything_is_rematched(app, db_session, tmp_path):
    await load_geo_samples(db_session)
    await sync.run_geo_sync(app.state.session_factory, app.state.settings, presale_buildcases_file=_copy(tmp_path, "p-115-10.csv"))
    assert (await _cases(app))["測試二號"].match_level == "street"
    path = _parcels_file(tmp_path, _yihua_parcel(), "三民區,澄清段二小段,75,DA,0456,,,2026-10-20")
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, presale_parcels_file=path)
    assert (result.presale_parcels, result.presale_parcel_rows, result.presale_rematched) == ("updated", 2, 1)
    assert result.presale_buildcases == "skipped"
    two = (await _cases(app))["測試二號"]
    assert (two.match_level, two.village) == ("parcel", "本揚里") and two.lat == YIHUA_POINT[0]
    async with app.state.session_factory() as db:
        points = {row.landno: row for row in (await db.execute(select(GeoParcelPoint))).scalars()}
    assert points["90"].lon == YIHUA_POINT[1] and points["75"].lon is None


async def test_parcel_import_is_an_upsert_that_keeps_known_coordinates(app, db_session, tmp_path):
    first = _parcels_file(tmp_path, _yihua_parcel(), name="a.csv")
    await sync.run_geo_sync(app.state.session_factory, app.state.settings, presale_parcels_file=first)
    # 同一個鍵這次查無：不蓋掉已有座標；另一個地號是新增。
    second = _parcels_file(tmp_path, "三民區,明義段,90,DA,0123,,,2026-11-20", _yihua_parcel(landno="91"), name="b.csv")
    await sync.run_geo_sync(app.state.session_factory, app.state.settings, presale_parcels_file=second)
    async with app.state.session_factory() as db:
        points = {row.landno: row for row in (await db.execute(select(GeoParcelPoint))).scalars()}
    assert sorted(points) == ["90", "91"]
    assert points["90"].lon == YIHUA_POINT[1] and points["90"].fetched_on == date(2026, 11, 20)


@pytest.mark.parametrize(
    ("row", "message"),
    [
        ("台南市,明義段,90,DA,0123,120.3,22.6,2026-10-20", "區名或段名"),
        ("三民區,,90,DA,0123,120.3,22.6,2026-10-20", "區名或段名"),
        ("三民區,明義段,九十,DA,0123,120.3,22.6,2026-10-20", "地號格式"),
        ("三民區,明義段,90,DA,0123,120.3,,2026-10-20", "不是數字"),
        ("三民區,明義段,90,DA,0123,22.6,120.3,2026-10-20", "不在高雄"),  # 經緯度對調
        ("三民區,明義段,90,DA,0123,120.3,22.6,2026/10/20", "查詢日期"),
        ("三民區,明義段,90,DA,0123,120.3", "欄位數"),
    ],
)
async def test_bad_parcels_file_imports_nothing(app, tmp_path, row, message):
    path = _parcels_file(tmp_path, _yihua_parcel(landno="1"), row)
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, presale_parcels_file=path)
    assert result.presale_parcels == "failed"
    assert message in (await _status(app)).last_error
    async with app.state.session_factory() as db:
        assert (await db.execute(select(GeoParcelPoint))).first() is None


def test_parcels_csv_round_trip_and_landno8():
    rows = pp.parse_csv("﻿" + PARCELS_HEADER + "\n" + _yihua_parcel() + "\n三民區,澄清段,12-3,DA,0001,,,2026-10-20\n")
    assert [row.landno for row in rows] == ["90", "12-3"] and rows[1].lon is None
    again = pp.parse_csv(pp.render_csv(rows))
    assert again == rows
    assert [pp.landno8(value) for value in ("120-1", "75", "1137", "9999-9999", "10000", "1-10000", "abc", "")] == [
        "01200001", "00750000", "11370000", "99999999", None, None, None, None,
    ]
    with pytest.raises(pp.ParcelFormatError, match="表頭"):
        pp.parse_csv("district,section\n")


def test_sync_module_never_references_the_nlsc_services():
    """正式站的同步迴圈不打國土測繪中心：同步相關模組不 import 查詢用的 nlsc，也沒有它的網址。"""
    from app.admissions.geo import bundle

    for module in (sync, ps, pp, bundle):
        source = Path(module.__file__).read_text(encoding="utf-8")
        assert "nlsc.gov.tw" not in source and "landmaps" not in source, module.__name__
        assert "import nlsc" not in source and "geo.nlsc" not in source, module.__name__


# ---- CLI 與打包檔 ----


def test_cli_options_for_presale(tmp_path: Path):
    a, b = _copy(tmp_path, "presale-buildcases-115-10.csv"), _parcels_file(tmp_path, _yihua_parcel())
    options = geo_sync_options(["--presale-file", str(a), "--presale-parcels-file", str(b)])
    assert (options["presale_buildcases_file"], options["presale_parcels_file"]) == (a, b)
    with pytest.raises(SystemExit):
        geo_sync_options(["--presale-file", str(tmp_path / "missing.csv")])


@pytest.fixture
def cli_on_test_app(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


async def test_bundle_imports_buildcases_and_parcels_together(app, db_session, cli_on_test_app, capsys, tmp_path: Path):
    await load_geo_samples(db_session)
    parcels = _parcels_file(tmp_path, _yihua_parcel())
    target = tmp_path / "bundle.zip"
    write_bundle(
        target,
        [
            BundleFile("presale-buildcases-115-10.csv", "presale_buildcases", "115-10", ps.SOURCE_URL, SAMPLE.read_bytes()),
            BundleFile("presale-parcels.csv", "presale_parcels", "2026-10-20", "local", parcels.read_bytes()),
        ],
    )
    await geo_sync_command(**geo_sync_options(["--bundle", str(target)]))
    out = capsys.readouterr().out
    assert "預售建案：updated（使用中 115-10，這次寫入 9 案，重比改變 1 案）；地號座標：updated（匯入 1 列）" in out
    assert (await _cases(app))["測試二號"].match_level == "parcel"


async def test_cli_reports_a_failed_parcels_file(app, cli_on_test_app, capsys, tmp_path: Path):
    path = _parcels_file(tmp_path, "三民區,明義段,90,DA,0123,22.6,120.3,2026-10-20")
    with pytest.raises(SystemExit):
        await geo_sync_command(**geo_sync_options(["--presale-parcels-file", str(path)]))
    assert "地號座標同步失敗" in capsys.readouterr().err


def test_bundle_allows_only_one_file_per_presale_kind(tmp_path: Path):
    target = tmp_path / "bundle.zip"
    write_bundle(
        target,
        [
            BundleFile("a-115-10.csv", "presale_buildcases", "115-10", "x", SAMPLE.read_bytes()),
            BundleFile("b-115-11.csv", "presale_buildcases", "115-11", "x", SAMPLE.read_bytes()),
        ],
    )
    with pytest.raises(BundleError, match="只能有一個檔"):
        open_bundle(target, tmp_path / "out")
