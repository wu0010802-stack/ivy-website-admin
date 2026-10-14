"""新成屋交屋（2026-10-14 里的變化規格 §2.2、§3.2、§4.3、V7、V8，B1 段）：季別運算、季檔解析與 V7 篩選、錯誤頁、
找最新季與回補 8 季、同一編號較新季覆蓋、連線被 reset 重試、門牌比對各等級與 pending、門牌換版後重比、檔案匯入、
CLI 與打包檔。HTTP 一律用 MockTransport，不連外。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select, update

from app import cli
from app.admissions.geo import new_homes as nh
from app.admissions.geo import sync
from app.admissions.geo.bundle import BundleFile, write_bundle
from app.admissions.geo.models import GeoDatasetStatus, GeoNewHomeSale
from app.cli import geo_sync_command, geo_sync_options
from tests.geo_helpers import (
    INCOME_SAMPLE,
    NEW_HOMES_SAMPLE,
    NEW_HOMES_SAMPLE_ROWS,
    NEW_HOMES_SAMPLE_SEASON,
    PLVR_ERROR_PAGE,
    SAMPLE_LABEL,
    load_geo_samples,
    plvr_response,
    plvr_sample,
)

TODAY = date(2026, 10, 14)  # 登記落在 115S4（還沒出），最新是 115S3


@pytest.fixture
def few_rows(monkeypatch):
    """樣本一季只有 7 筆新成屋；下限降到 1。"""
    monkeypatch.setattr(nh, "MIN_ROWS", 1)


@pytest.fixture
def october(monkeypatch):
    monkeypatch.setattr(sync, "today_local", lambda *args: TODAY)


@pytest.fixture
def no_wait(monkeypatch):
    waits: list[float] = []

    async def record(seconds: float) -> None:
        waits.append(seconds)

    monkeypatch.setattr(sync, "_sleep", record)
    return waits


def _site(seasons: set[str] | None = None):
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(httpx.URL(str(request.url)).params.get("season", str(request.url)))
        return plvr_response(str(request.url), seasons=seasons) or httpx.Response(404)

    return httpx.MockTransport(handle), seen


UP_TO_115S3 = set(nh.window("115S3", 12))


async def _sync(app, transport, **kwargs) -> tuple[str, int]:
    async with httpx.AsyncClient(transport=transport) as client:
        return await sync.sync_new_homes(
            app.state.session_factory, client, now=kwargs.pop("now", datetime.now(timezone.utc)),
            force=kwargs.pop("force", False), files=None, season=None,
        )


async def _seasons(app) -> dict[str, int]:
    async with app.state.session_factory() as db:
        rows = (await db.execute(select(GeoNewHomeSale.season, func.count()).group_by(GeoNewHomeSale.season))).all()
    return {season: count for season, count in rows}


async def _rows(app) -> dict[str, GeoNewHomeSale]:
    async with app.state.session_factory() as db:
        return {row.serial: row for row in (await db.execute(select(GeoNewHomeSale))).scalars()}


async def _status(app) -> GeoDatasetStatus | None:
    async with app.state.session_factory() as db:
        return await db.get(GeoDatasetStatus, "new_homes")


# ---- 季別 ----


@pytest.mark.parametrize(
    ("day", "season"),
    [
        (date(2026, 3, 10), "115S1"), (date(2026, 3, 11), "115S2"), (date(2026, 9, 10), "115S3"),
        (date(2026, 10, 14), "115S4"), (date(2026, 12, 10), "115S4"), (date(2026, 12, 11), "116S1"),
        (date(2026, 1, 1), "115S1"),
    ],
)
def test_season_of_day_follows_the_registration_windows(day, season):
    assert nh.season_of_day(day) == season


def test_season_arithmetic():
    assert nh.shift_season("115S1", -1) == "114S4" and nh.shift_season("114S4", 1) == "115S1"
    assert nh.window("115S3") == ["113S4", "114S1", "114S2", "114S3", "114S4", "115S1", "115S2", "115S3"]
    assert nh.season_end("115S3") == date(2026, 9, 10) and nh.season_end("115S4") == date(2026, 12, 10)
    assert nh.season_of_filename("115S3_e_lvr_land_a.csv") == "115S3"
    assert nh.season_of_filename("/data/plvr-115s2_e_lvr_land_a.csv") == "115S2"
    assert nh.season_of_filename("e_lvr_land_a.csv") is None
    assert nh.parse_season(" 115s3 ") == "115S3"
    with pytest.raises(nh.NewHomesFormatError):
        nh.parse_season("115Q3")
    assert nh.season_url("115S3") == "https://plvr.land.moi.gov.tw/DownloadSeason?season=115S3&fileName=e_lvr_land_a.csv"


# ---- 解析與 V7 ----


def _sample_batch(**kwargs) -> nh.NewHomesBatch:
    return nh.parse_csv(nh.decode(NEW_HOMES_SAMPLE.read_bytes()), NEW_HOMES_SAMPLE_SEASON, minimum=1, **kwargs)


def test_sample_keeps_only_new_homes():
    batch = _sample_batch()
    assert batch.total == 13 and len(batch.rows) == NEW_HOMES_SAMPLE_ROWS
    rows = {row.serial: row for row in batch.rows}
    # 預售屋交屋（交易日是幾年前，完工在 115-04）。
    presale = rows["RPVNMLLKOHLGFFE78DA"]
    assert (presale.presale, presale.building_type, presale.district, presale.street, presale.number) == (
        True, "住宅大樓", "橋頭區", "橋新環路", 999,
    )
    # 完工 114-09-12：和迄日 115-09-10 差 12 個月（以年月算），含。
    edge = rows["RPTNMLNJQHLGFLE86DA"]
    assert (edge.presale, edge.completed_on, edge.lane, edge.alley, edge.number) == (False, date(2025, 9, 12), "105", "31", 22)
    # 「號之１三樓」：之號 1、樓層丟掉。
    assert (rows["SAMPLESUBFLOOR00002"].number, rows["SAMPLESUBFLOOR00002"].number_sub) == (68, 1)
    # 「義華路６６號等１８５戶共用部分」：沒有市、區，用鄉鎮市區欄補上。
    assert rows["SAMPLESHARED0000005"].key == ("三民區", "義華路", "", "", 66, 0)
    # 完工 115-09-30：同一個月（0 個月）含；115-10-01 在迄日之後，不算。
    assert rows["SAMPLESHARED0000005"].completed_on == date(2026, 9, 30)
    assert "SAMPLEAFTEREND00006" not in rows
    # 完工太久、只有土地、商業用、沒有完工日、只有車位都不算。
    assert {"RPWNMLRJRHLGFEE96DA", "RPSPMLNJRHLGFCE78DA", "RPRNMLKKQHLGFBE08DA", "RPPNMLMJQHLGFFE38DA",
            "RPRNMLRKQHLGFAE68DA"}.isdisjoint(rows)


def test_error_pages_are_not_season_files():
    assert nh.decode(PLVR_ERROR_PAGE.encode("utf-8")) is None
    assert nh.decode(b"\xff\xfe not utf-8") is None
    assert nh.decode(NEW_HOMES_SAMPLE.read_bytes()) is not None


def _rewrite(change) -> str:
    lines = nh.decode(NEW_HOMES_SAMPLE.read_bytes()).split("\r\n")
    return "\r\n".join(change(lines))


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda lines: [lines[0].replace("建築完成年月", "完工"), *lines[1:]], "缺欄位：建築完成年月"),
        (lambda lines: [*lines, lines[3]], "重複的編號"),
        (lambda lines: [*lines[:2], lines[2].replace("RPVNMLLKOHLGFFE78DA", ""), *lines[3:]], "編號空白"),
    ],
)
def test_bad_files_are_refused(change, message):
    with pytest.raises(nh.NewHomesFormatError, match=message):
        nh.parse_csv(_rewrite(change), NEW_HOMES_SAMPLE_SEASON, minimum=1)


def test_too_few_new_homes_is_a_truncated_file():
    with pytest.raises(nh.NewHomesFormatError, match="少於 100 筆"):
        nh.parse_csv(nh.decode(NEW_HOMES_SAMPLE.read_bytes()), NEW_HOMES_SAMPLE_SEASON)


# ---- 網路同步 ----


async def test_first_sync_finds_the_latest_season_and_backfills_eight(app, few_rows, october):
    transport, seen = _site(UP_TO_115S3)
    assert await _sync(app, transport) == ("updated", 8)
    # 今天所在的 115S4 還沒出（錯誤頁），115S3 是最新；再由新到舊往回補 7 季（最新那季不重抓）。
    assert seen == ["115S4", "115S3", *reversed(nh.window("115S3")[:-1])]
    seasons = await _seasons(app)
    assert sorted(seasons) == nh.window("115S3") and all(count == NEW_HOMES_SAMPLE_ROWS for count in seasons.values())
    status = await _status(app)
    assert (status.active_version, status.label, status.last_error) == ("115S3", "115S3", None)


async def test_within_30_days_does_not_go_online(app, few_rows, october):
    transport, seen = _site(UP_TO_115S3)
    await _sync(app, transport)
    seen.clear()
    assert await _sync(app, transport) == ("skipped", 0)
    assert seen == []


async def test_a_new_season_is_added_and_the_oldest_pruned(app, few_rows, october):
    transport, _ = _site(UP_TO_115S3)
    now = datetime.now(timezone.utc)
    await _sync(app, transport, now=now)
    transport, seen = _site(UP_TO_115S3)
    assert await _sync(app, transport, now=now + timedelta(days=31)) == ("skipped", 0)
    assert seen == ["115S4"]  # 下一季還沒出：只問一次
    transport, seen = _site(UP_TO_115S3 | {"115S4"})
    assert await _sync(app, transport, now=now + timedelta(days=62)) == ("updated", 1)
    assert seen == ["115S4", "116S1"]
    assert sorted(await _seasons(app)) == nh.window("115S4")
    assert (await _status(app)).label == "115S4"


async def test_missing_seasons_in_the_window_are_skipped(app, few_rows, october):
    transport, _ = _site(UP_TO_115S3 - {"114S2"})
    assert await _sync(app, transport) == ("updated", 7)
    assert "114S2" not in await _seasons(app)


async def test_a_reset_connection_is_retried(app, few_rows, october, no_wait):
    transport, _ = _site(UP_TO_115S3)
    calls = {"n": 0}

    async def flaky(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 2:
            raise httpx.ReadError("Connection reset by peer", request=request)
        return await transport.handle_async_request(request)

    assert await _sync(app, httpx.MockTransport(flaky)) == ("updated", 8)
    assert no_wait == [2.0]


async def test_failure_midway_keeps_the_seasons_already_written(app, few_rows, october, no_wait):
    transport, _ = _site(UP_TO_115S3)

    async def broken_old_seasons(request: httpx.Request) -> httpx.Response:
        if httpx.URL(str(request.url)).params.get("season") == "114S3":
            raise httpx.ReadError("Connection reset by peer", request=request)
        return await transport.handle_async_request(request)

    result = await _sync(app, httpx.MockTransport(broken_old_seasons))
    assert result == ("failed", 4)  # 由新到舊：115S3～114S4 寫好了，114S3 斷掉
    assert sorted(await _seasons(app)) == ["114S4", "115S1", "115S2", "115S3"]
    status = await _status(app)
    assert status.label == "115S3" and status.last_error == "下載或匯入失敗：ReadError" and status.checked_at is None
    # 下一輪（還沒到 30 天，但上一輪沒做完）接著補缺的。
    transport, seen = _site(UP_TO_115S3)
    assert await _sync(app, transport) == ("updated", 4)
    assert sorted(await _seasons(app)) == nh.window("115S3")


async def test_the_same_serial_in_a_newer_season_wins(app, few_rows):
    """同一個編號在兩季都有（更正出現在後面的批次）：留較新的那季；較舊的季後寫也不會蓋掉。"""
    for season in ("115S3", "115S2"):
        batch = nh.parse_csv(nh.decode(plvr_sample(season, serial_prefix=False)), season)
        await nh.write_season(app.state.session_factory, batch, now=datetime.now(timezone.utc))
    rows = await _rows(app)
    assert rows["RPVNMLLKOHLGFFE78DA"].season == "115S3"
    assert await _seasons(app) == {"115S3": NEW_HOMES_SAMPLE_ROWS}
    # 再寫一次 115S3（force 重抓）：還是 115S3。
    batch = nh.parse_csv(nh.decode(plvr_sample("115S3", serial_prefix=False)), "115S3")
    await nh.write_season(app.state.session_factory, batch, now=datetime.now(timezone.utc))
    assert await _seasons(app) == {"115S3": NEW_HOMES_SAMPLE_ROWS}


# ---- 比對 ----


async def test_rows_are_matched_against_doorplates(app, db_session, few_rows):
    await load_geo_samples(db_session)
    await nh.write_season(app.state.session_factory, _sample_batch(), now=datetime.now(timezone.utc))
    rows = await _rows(app)
    levels = {serial: (row.match_level, row.village, row.doorplate_version) for serial, row in rows.items()}
    assert levels["SAMPLEEXACT00000001"] == ("exact", "本揚里", SAMPLE_LABEL)
    assert levels["SAMPLESUBFLOOR00002"] == ("exact", "本揚里", SAMPLE_LABEL)  # 68 之 1 對不到，退回 68 號
    assert levels["SAMPLESHARED0000005"] == ("exact", "本揚里", SAMPLE_LABEL)
    assert levels["SAMPLENEARBY0000003"] == ("nearby", "本揚里", SAMPLE_LABEL)
    assert levels["SAMPLESTREET0000004"] == ("street", "博惠里", SAMPLE_LABEL)
    assert levels["RPVNMLLKOHLGFFE78DA"] == ("district", None, SAMPLE_LABEL)  # 門牌樣本沒有橋新環路
    # 不存地址原文：表裡沒有放得下地址字串的欄位。
    assert not {"address", "price", "floor"} & set(GeoNewHomeSale.__table__.columns.keys())


async def test_pending_until_doorplates_then_rematched(app, db_session, few_rows):
    await nh.write_season(app.state.session_factory, _sample_batch(), now=datetime.now(timezone.utc))
    rows = await _rows(app)
    assert {row.match_level for row in rows.values()} == {"pending"}
    assert {row.doorplate_version for row in rows.values()} == {None}
    assert await nh.rematch(app.state.session_factory) == 0  # 門牌還沒匯入：不動
    await load_geo_samples(db_session)
    assert await nh.rematch(app.state.session_factory) == NEW_HOMES_SAMPLE_ROWS
    rows = await _rows(app)
    assert rows["SAMPLEEXACT00000001"].match_level == "exact" and rows["SAMPLEEXACT00000001"].doorplate_version == SAMPLE_LABEL
    assert await nh.rematch(app.state.session_factory) == 0  # 都是使用中的門牌月份了


async def test_a_new_doorplate_month_rematches_everything(app, db_session, few_rows):
    await load_geo_samples(db_session)
    await nh.write_season(app.state.session_factory, _sample_batch(), now=datetime.now(timezone.utc))
    await db_session.execute(update(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "doorplates").values(label="115-11"))
    await db_session.commit()
    assert await nh.rematch(app.state.session_factory, keys_per_commit=2) == NEW_HOMES_SAMPLE_ROWS
    assert {row.doorplate_version for row in (await _rows(app)).values()} == {"115-11"}


async def test_run_geo_sync_rematches_new_homes_at_the_end(app, db_session, few_rows, tmp_path: Path):
    path = tmp_path / "115S3_e_lvr_land_a.csv"
    path.write_bytes(NEW_HOMES_SAMPLE.read_bytes())
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, new_homes_files=[path])
    assert (result.new_homes, result.new_homes_version, result.new_homes_seasons, result.new_homes_rematched) == (
        "updated", "115S3", 1, 0,
    )
    await load_geo_samples(db_session)
    # 另一種資料的檔案模式同步（不碰新成屋、不連外）結束時，照樣把門牌月份不同（這裡是 pending）的新成屋重比。
    income = tmp_path / "112_165-E.csv"
    income.write_bytes(INCOME_SAMPLE.read_bytes())
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, income_file=income)
    assert (result.new_homes, result.new_homes_rematched) == ("skipped", NEW_HOMES_SAMPLE_ROWS)


# ---- 檔案、CLI、打包檔 ----


async def test_file_without_a_season_needs_one(app, few_rows, tmp_path: Path):
    path = tmp_path / "e_lvr_land_a.csv"
    path.write_bytes(NEW_HOMES_SAMPLE.read_bytes())
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, new_homes_files=[path])
    assert result.new_homes == "failed" and "--new-homes-season" in (await _status(app)).last_error
    result = await sync.run_geo_sync(
        app.state.session_factory, app.state.settings, new_homes_files=[path], new_homes_season="115S3"
    )
    assert (result.new_homes, result.new_homes_version) == ("updated", "115S3")


async def test_an_error_page_file_fails(app, few_rows, tmp_path: Path):
    path = tmp_path / "115S4_e_lvr_land_a.csv"
    path.write_text(PLVR_ERROR_PAGE, encoding="utf-8")
    result = await sync.run_geo_sync(app.state.session_factory, app.state.settings, new_homes_files=[path])
    assert result.new_homes == "failed" and "錯誤頁" in (await _status(app)).last_error


def test_cli_options_for_new_homes(tmp_path: Path):
    a, b = tmp_path / "115S3_e_lvr_land_a.csv", tmp_path / "115S2_e_lvr_land_a.csv"
    for path in (a, b):
        path.write_bytes(b"")
    options = geo_sync_options(["--new-homes-file", str(a), "--new-homes-file", str(b)])
    assert (options["new_homes_files"], options["new_homes_season"]) == ([a, b], None)
    assert geo_sync_options(["--new-homes-file", str(a), "--new-homes-season", "115s3"])["new_homes_season"] == "115S3"
    for args in (
        ["--new-homes-file", str(a), "--new-homes-file", str(b), "--new-homes-season", "115S3"],
        ["--new-homes-season", "115S3"],
        ["--new-homes-file", str(a), "--new-homes-season", "115Q3"],
    ):
        with pytest.raises(SystemExit):
            geo_sync_options(args)


@pytest.fixture
def cli_on_test_app(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


async def test_bundle_imports_new_home_seasons(app, few_rows, cli_on_test_app, capsys, tmp_path: Path):
    target = tmp_path / "bundle.zip"
    write_bundle(
        target,
        [
            BundleFile(f"{season}_e_lvr_land_a.csv", "new_homes", season, nh.season_url(season), plvr_sample(season))
            for season in ("115S3", "115S2")
        ],
    )
    await geo_sync_command(**geo_sync_options(["--bundle", str(target)]))
    assert "新成屋：updated（最新 115S3，這次寫入 2 季，重比 0 筆）" in capsys.readouterr().out
    assert await _seasons(app) == {"115S3": NEW_HOMES_SAMPLE_ROWS, "115S2": NEW_HOMES_SAMPLE_ROWS}
